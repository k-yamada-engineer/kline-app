// freee会計 → Supabase(bank_txns) 入出金の自動同期 Edge Function（新形式: export default + withSupabase）
// ・関数の設定で「Verify JWT」は OFF にする（freeeからの戻り＝callbackはブラウザ経由でJWTを付けられないため）
//   代わりに x-sync-secret（合言葉）と OAuth state で自前認証する
// ・DBへは ctx.supabaseAdmin（新しいsecretキー方式）でアクセス。触るのは freee_tokens / bank_txns の2表だけ
// ・freeeには読み取りスコープだけ渡す（freee側のデータは一切書き換えない）
// ・Secrets: FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / SYNC_SECRET
//   任意: FREEE_COMPANY_ID（事業所が複数ある時）/ FIRST_SYNC_FROM（初回取得開始日。既定 2026-01-01）/ REDIRECT_URI

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const FREEE_AUTH = "https://accounts.secure.freee.co.jp/public_api";
const FREEE_API = "https://api.freee.co.jp";
const REFRESH_MARGIN_MS = 10 * 60 * 1000; // 期限10分前から更新
const PAGE = 100;
const MAX_PAGES = 100;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  company_id: number | null;
}
export interface TxnRow {
  id: number;
  txn_date: string;
  amount: number;
  entry_side: string;
  walletable_id: number | null;
  walletable_type: string | null;
  walletable_name: string | null;
  description: string;
  balance: number | null;
  freee_status: number | null;
  raw: unknown;
  synced_at: string;
  // ※ journal / memo（アプリで入力する仕訳・備考）はここに含めない＝自動取り込みで上書きされない
}
/** 注釈は部分更新。送った項目だけを書き換える（請求書の紐づけで仕訳・備考を消さないため） */
export interface Annotation {
  journal?: string | null;
  memo?: string | null;
  invoice_ref?: string | null; // 請求書の紐づけ（"取引先ID:YYYY-MM"）
}
/** アプリ表示用の明細（raw等の重い列は返さない） */
export const LEDGER_COLS =
  "id,txn_date,amount,entry_side,walletable_id,walletable_type,walletable_name,description,balance,freee_status,journal,memo,invoice_ref,annotated_at";
/** 請求書の入金状況表示用（紐づけ済み入金） */
export const LINKED_COLS = "id,txn_date,amount,entry_side,description,walletable_name,invoice_ref";
export interface Store {
  loadTokens(): Promise<TokenRow | null>;
  /** prevRefresh があれば「その refresh_token の行だけ更新」(競合防止)。null なら新規/上書き保存 */
  saveTokens(t: TokenRow, prevRefresh: string | null): Promise<boolean>;
  upsertTxns(rows: TxnRow[]): Promise<void>;
  latestTxnDate(): Promise<string | null>;
  stats(): Promise<{ count: number; latest: string | null }>;
  listTxns(from: string, to: string): Promise<any[]>;
  listAccounts(): Promise<any[]>;
  annotate(id: number, a: Annotation): Promise<any | null>;
  /** 請求書に紐づけ済みの入金（全期間） */
  listLinked(): Promise<any[]>;
}
export interface Env {
  get(k: string): string | undefined;
}
type Fetch = typeof fetch;

/* ---------- 小物 ---------- */
const jstDate = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const need = (env: Env, k: string) => {
  const v = env.get(k);
  if (!v) throw new HttpError(500, `Secret ${k} が未設定です`);
  return v;
};

/* ---------- OAuth ---------- */
export function authorizeUrl(clientId: string, redirectUri: string, state: string) {
  const u = new URL(FREEE_AUTH + "/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(f: Fetch, params: Record<string, string>, now: number): Promise<TokenRow> {
  const res = await f(FREEE_AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token || !j.refresh_token) {
    throw new HttpError(401, `freeeトークン取得に失敗: ${j.error_description || j.error || res.status}（再認可が必要な可能性）`);
  }
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: new Date(now + (Number(j.expires_in) || 21600) * 1000 - 60 * 1000).toISOString(),
    company_id: null,
  };
}
export const exchangeCode = (env: Env, f: Fetch, code: string, redirectUri: string, now = Date.now()) =>
  tokenRequest(f, {
    grant_type: "authorization_code",
    client_id: need(env, "FREEE_CLIENT_ID"),
    client_secret: need(env, "FREEE_CLIENT_SECRET"),
    code,
    redirect_uri: redirectUri,
  }, now);

/** 有効なアクセストークンを返す。期限が近ければ refresh（refresh_tokenは使い捨てのローテーション方式） */
export async function getValidToken(env: Env, store: Store, f: Fetch, now = Date.now()): Promise<TokenRow> {
  const t = await store.loadTokens();
  if (!t) throw new HttpError(409, "freee未認可です。/authorize?key=... を開いて認可してください");
  if (new Date(t.expires_at).getTime() - now > REFRESH_MARGIN_MS) return t;
  const fresh = await tokenRequest(f, {
    grant_type: "refresh_token",
    client_id: need(env, "FREEE_CLIENT_ID"),
    client_secret: need(env, "FREEE_CLIENT_SECRET"),
    refresh_token: t.refresh_token,
  }, now);
  const next = { ...fresh, company_id: t.company_id };
  const ok = await store.saveTokens(next, t.refresh_token);
  if (!ok) throw new HttpError(409, "トークン保存が競合しました（同時実行）。次回再試行されます");
  return next;
}

/* ---------- freee API ---------- */
async function freeeGet(f: Fetch, token: string, path: string, params: Record<string, string | number> = {}) {
  const u = new URL(FREEE_API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await f(u, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status === 429 ? 429 : 502, `freee API ${path} が ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchCompanies(f: Fetch, token: string) {
  const j = await freeeGet(f, token, "/api/1/companies");
  return (j.companies ?? []) as Array<{ id: number; name?: string; display_name?: string }>;
}

export function chooseCompany(cs: Array<{ id: number; name?: string; display_name?: string }>, preferred?: string | null) {
  if (preferred) {
    const c = cs.find((x) => String(x.id) === String(preferred));
    if (!c) throw new HttpError(400, `FREEE_COMPANY_ID=${preferred} の事業所が見つかりません`);
    return c;
  }
  if (cs.length === 1) return cs[0];
  const hit = cs.filter((x) => /k.?line|ケーライン/i.test(`${x.name ?? ""} ${x.display_name ?? ""}`));
  if (hit.length === 1) return hit[0];
  throw new HttpError(
    409,
    "freeeに事業所が複数あり特定できません。Secrets に FREEE_COMPANY_ID を設定してください: " +
      cs.map((x) => `${x.id}=${x.display_name ?? x.name}`).join(" / "),
  );
}

async function fetchWalletableNames(f: Fetch, token: string, companyId: number) {
  const names = new Map<number, string>();
  try {
    const j = await freeeGet(f, token, "/api/1/walletables", { company_id: companyId });
    for (const w of j.walletables ?? []) names.set(w.id, w.name);
  } catch (_e) { /* 口座名は付加情報。取れなくても同期は続行 */ }
  return names;
}

export async function fetchAllWalletTxns(f: Fetch, token: string, companyId: number, start: string, end: string) {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await freeeGet(f, token, "/api/1/wallet_txns", {
      company_id: companyId, start_date: start, end_date: end, limit: PAGE, offset: page * PAGE,
    });
    const rows = (j.wallet_txns ?? []) as any[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export function mapTxn(t: any, names: Map<number, string>, now = Date.now()): TxnRow {
  return {
    synced_at: new Date(now).toISOString(),
    id: t.id,
    txn_date: t.date,
    amount: Math.abs(Number(t.amount) || 0),
    entry_side: t.entry_side,
    walletable_id: t.walletable_id ?? null,
    walletable_type: t.walletable_type ?? null,
    walletable_name: names.get(t.walletable_id) ?? null,
    description: t.description ?? "",
    balance: t.balance ?? null,
    freee_status: t.status ?? null,
    raw: t,
  };
}

/* ---------- 同期本体 ---------- */
export async function runSync(env: Env, store: Store, f: Fetch, now = Date.now()) {
  const t = await getValidToken(env, store, f, now);
  let companyId = t.company_id;
  if (!companyId) {
    const c = chooseCompany(await fetchCompanies(f, t.access_token), env.get("FREEE_COMPANY_ID"));
    companyId = c.id;
    await store.saveTokens({ ...t, company_id: companyId }, t.refresh_token);
  }
  const today = jstDate(now);
  const latest = await store.latestTxnDate();
  // 既取得分も過去30日は再取得（freee側の消込ステータス変更を反映するため）
  const from = latest ? addDays(latest, -30) : env.get("FIRST_SYNC_FROM") ?? "2026-01-01";
  const names = await fetchWalletableNames(f, t.access_token, companyId);
  const txns = await fetchAllWalletTxns(f, t.access_token, companyId, from, today);
  const rows = txns.map((x) => mapTxn(x, names, now));
  for (let i = 0; i < rows.length; i += 500) await store.upsertTxns(rows.slice(i, i + 500));
  return { ok: true, companyId, from, to: today, fetched: rows.length };
}

/* ---------- DBストア①（推奨）: ctx.supabaseAdmin（新しいsecretキー方式・RLSを越えて2表だけ触る） ---------- */
export function adminStore(db: any): Store {
  const fail = (what: string, error: any) => { throw new Error(`${what} failed: ${error?.message ?? error}`); };
  return {
    async loadTokens() {
      const { data, error } = await db.from("freee_tokens").select("access_token,refresh_token,expires_at,company_id").eq("id", 1).maybeSingle();
      if (error) fail("loadTokens", error);
      return data ?? null;
    },
    async saveTokens(t, prev) {
      const row = { ...t, updated_at: new Date().toISOString() };
      if (prev) {
        const { data, error } = await db.from("freee_tokens").update(row).eq("id", 1).eq("refresh_token", prev).select("id");
        if (error) fail("saveTokens", error);
        return (data ?? []).length === 1;
      }
      const { error } = await db.from("freee_tokens").upsert({ id: 1, ...row }, { onConflict: "id" });
      if (error) fail("saveTokens", error);
      return true;
    },
    async upsertTxns(rows) {
      if (!rows.length) return;
      const { error } = await db.from("bank_txns").upsert(rows, { onConflict: "id" });
      if (error) fail("upsertTxns", error);
    },
    async latestTxnDate() {
      const { data, error } = await db.from("bank_txns").select("txn_date").order("txn_date", { ascending: false }).limit(1);
      if (error) fail("latestTxnDate", error);
      return data?.[0]?.txn_date ?? null;
    },
    async stats() {
      const { count, error } = await db.from("bank_txns").select("id", { count: "exact", head: true });
      if (error) fail("stats", error);
      return { count: count ?? 0, latest: await this.latestTxnDate() };
    },
    async listTxns(from, to) {
      const { data, error } = await db.from("bank_txns").select(LEDGER_COLS)
        .gte("txn_date", from).lte("txn_date", to)
        .order("txn_date", { ascending: false }).order("id", { ascending: false }).limit(1000);
      if (error) fail("listTxns", error);
      return data ?? [];
    },
    async listAccounts() {
      const { data, error } = await db.from("bank_accounts_summary").select("*");
      if (error) fail("listAccounts", error);
      return data ?? [];
    },
    async annotate(id, a) {
      const { data, error } = await db.from("bank_txns")
        .update({ ...a, annotated_at: new Date().toISOString() })
        .eq("id", id).select("id,journal,memo,invoice_ref,annotated_at");
      if (error) fail("annotate", error);
      return data?.[0] ?? null;
    },
    async listLinked() {
      const { data, error } = await db.from("bank_txns").select(LINKED_COLS).not("invoice_ref", "is", null)
        .order("txn_date", { ascending: false }).limit(1000);
      if (error) fail("listLinked", error);
      return data ?? [];
    },
  };
}

/* ---------- DBストア②（予備）: 旧service_roleキーでREST直叩き。①が使えない古いプロジェクト向け ---------- */
export function restStore(url: string, key: string, f: Fetch = fetch): Store {
  const base = url.replace(/\/$/, "") + "/rest/v1";
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const must = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
    return res;
  };
  return {
    async loadTokens() {
      const res = await must(await f(`${base}/freee_tokens?id=eq.1&select=access_token,refresh_token,expires_at,company_id`, { headers: h }), "loadTokens");
      const rows = await res.json();
      return rows[0] ?? null;
    },
    async saveTokens(t, prev) {
      const body = JSON.stringify({ ...t, updated_at: new Date().toISOString() });
      if (prev) {
        const res = await must(
          await f(`${base}/freee_tokens?id=eq.1&refresh_token=eq.${encodeURIComponent(prev)}`, {
            method: "PATCH", headers: { ...h, Prefer: "return=representation" }, body,
          }),
          "saveTokens",
        );
        return (await res.json()).length === 1;
      }
      await must(
        await f(`${base}/freee_tokens?on_conflict=id`, {
          method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: 1, ...t, updated_at: new Date().toISOString() }),
        }),
        "saveTokens",
      );
      return true;
    },
    async upsertTxns(rows) {
      if (!rows.length) return;
      await must(
        await f(`${base}/bank_txns?on_conflict=id`, {
          method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows),
        }),
        "upsertTxns",
      );
    },
    async latestTxnDate() {
      const res = await must(await f(`${base}/bank_txns?select=txn_date&order=txn_date.desc&limit=1`, { headers: h }), "latestTxnDate");
      const rows = await res.json();
      return rows[0]?.txn_date ?? null;
    },
    async stats() {
      const res = await must(
        await f(`${base}/bank_txns?select=id&limit=1`, { headers: { ...h, Prefer: "count=exact", Range: "0-0" } }),
        "stats",
      );
      const count = Number((res.headers.get("content-range") ?? "").split("/")[1]) || 0;
      return { count, latest: await this.latestTxnDate() };
    },
    async listTxns(from, to) {
      const res = await must(
        await f(`${base}/bank_txns?select=${LEDGER_COLS}&txn_date=gte.${from}&txn_date=lte.${to}&order=txn_date.desc,id.desc&limit=1000`, { headers: h }),
        "listTxns",
      );
      return res.json();
    },
    async listAccounts() {
      const res = await must(await f(`${base}/bank_accounts_summary?select=*`, { headers: h }), "listAccounts");
      return res.json();
    },
    async annotate(id, a) {
      const res = await must(
        await f(`${base}/bank_txns?id=eq.${id}&select=id,journal,memo,invoice_ref,annotated_at`, {
          method: "PATCH", headers: { ...h, Prefer: "return=representation" },
          body: JSON.stringify({ ...a, annotated_at: new Date().toISOString() }),
        }),
        "annotate",
      );
      return (await res.json())[0] ?? null;
    },
    async listLinked() {
      const res = await must(
        await f(`${base}/bank_txns?select=${LINKED_COLS}&invoice_ref=not.is.null&order=txn_date.desc&limit=1000`, { headers: h }),
        "listLinked",
      );
      return res.json();
    },
  };
}

/** 使えるDBストアを選ぶ。どちらも無ければ、呼ばれた時に500で理由を返すストアにする（関数自体は落とさない） */
export function pickStore(ctx: any, env: Env): Store {
  try {
    if (ctx?.supabaseAdmin) return adminStore(ctx.supabaseAdmin);
  } catch (_e) { /* ②へ */ }
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = env.get("SUPABASE_URL");
  if (key && url) return restStore(url, key);
  const broken = async () => { throw new HttpError(500, "DBの管理者キーが取得できません（SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY）"); };
  return {
    loadTokens: broken, saveTokens: broken, upsertTxns: broken, latestTxnDate: broken, stats: broken,
    listTxns: broken, listAccounts: broken, annotate: broken, listLinked: broken,
  } as unknown as Store;
}

/* ---------- HTTPハンドラ ---------- */
/** アプリ用パスワード（16桁）。SYNC_SECRETからの一方向導出 */
export const appKeyOf = async (syncSecret: string) => (await sha256Hex(syncSecret + ":app-view")).slice(0, 16);

/** アプリ(GitHub Pages)から直接呼ぶためのCORS。認証はCookieでなくヘッダーのパスワードなので * で安全 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-app-key, x-sync-secret, content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function makeHandler(env: Env, store: Store, f: Fetch) {
  const redirectUri = () => env.get("REDIRECT_URI") ?? `${need(env, "SUPABASE_URL").replace(/\/$/, "")}/functions/v1/freee-sync/callback`;
  const stateOf = async () => (await sha256Hex(need(env, "SYNC_SECRET") + ":freee-oauth")).slice(0, 24);
  const authed = (req: Request, url: URL) => {
    const given = req.headers.get("x-sync-secret") ?? url.searchParams.get("key") ?? "";
    return safeEqual(given, need(env, "SYNC_SECRET"));
  };
  // アプリ用パスワード：SYNC_SECRETから一方向に導出（漏れてもSYNC_SECRETは逆算できない／Secretsの追加不要）
  const appAuthed = async (req: Request) => safeEqual(req.headers.get("x-app-key") ?? "", await appKeyOf(need(env, "SYNC_SECRET")));
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "").split("/").pop();
    try {
      if (route === "authorize") {
        if (!authed(req, url)) return json({ ok: false, error: "forbidden" }, 403);
        return Response.redirect(authorizeUrl(need(env, "FREEE_CLIENT_ID"), redirectUri(), await stateOf()), 302);
      }
      if (route === "callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        // Supabaseは *.supabase.co 上のHTMLを text/plain に書き換える（文字化けの原因）ため、結果はJSON(UTF-8固定)で返す
        if (!code || !safeEqual(state, await stateOf())) return json({ ok: false, message: "認可に失敗しました。もう一度 /authorize から開き直してください。" }, 400);
        const token = await exchangeCode(env, f, code, redirectUri());
        let companyId: number | null = null;
        let note = "";
        try {
          companyId = chooseCompany(await fetchCompanies(f, token.access_token), env.get("FREEE_COMPANY_ID")).id;
        } catch (e) {
          note = e instanceof HttpError ? e.message : "事業所の特定に失敗しました";
        }
        await store.saveTokens({ ...token, company_id: companyId }, null);
        return json(
          note
            ? { ok: false, message: "⚠️ 認可は成功、事業所の特定が未完了", detail: note }
            : { ok: true, message: "✅ freeeとの連携が完了しました。このタブは閉じて大丈夫です。入出金は自動で取り込まれます。", companyId },
        );
      }
      if (route === "sync") {
        if (!authed(req, url)) return json({ ok: false, error: "forbidden" }, 403);
        return json(await runSync(env, store, f));
      }
      if (route === "status") {
        if (!authed(req, url)) return json({ ok: false, error: "forbidden" }, 403);
        const tok = await store.loadTokens();
        return json({ ok: true, authorized: !!tok, companyId: tok?.company_id ?? null, tokenExpiresAt: tok?.expires_at ?? null, ...(await store.stats()) });
      }

      /* ---- ここから下はアプリ（管理者画面）用。x-app-key 必須 ---- */
      if (route === "ledger" || route === "annotate" || route === "refresh" || route === "links") {
        if (!(await appAuthed(req))) return json({ ok: false, error: "forbidden" }, 403);
      }
      if (route === "ledger") {
        const from = url.searchParams.get("from") ?? "";
        const to = url.searchParams.get("to") ?? "";
        if (!DATE.test(from) || !DATE.test(to) || from > to) return json({ ok: false, error: "from/to は YYYY-MM-DD で指定してください" }, 400);
        const [txns, accounts] = await Promise.all([store.listTxns(from, to), store.listAccounts()]);
        return json({ ok: true, from, to, accounts, txns });
      }
      if (route === "annotate") {
        if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
        const b = await req.json().catch(() => null);
        const id = Number(b?.id);
        if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: "id が不正です" }, 400);
        const clean = (v: unknown, max: number) => {
          const s = String(v ?? "").trim();
          if (s.length > max) throw new HttpError(400, `${max}文字以内で入力してください`);
          return s === "" ? null : s;
        };
        // 送られてきた項目だけ更新する（例：請求書の紐づけだけ送っても、仕訳・備考は消えない）
        const patch: Annotation = {};
        if (b && "journal" in b) patch.journal = clean(b.journal, 60);
        if (b && "memo" in b) patch.memo = clean(b.memo, 500);
        if (b && "invoice_ref" in b) {
          const ref = clean(b.invoice_ref, 60);
          if (ref !== null && !/^[\w-]+:\d{4}-\d{2}$/.test(ref)) return json({ ok: false, error: "invoice_ref の形式が不正です" }, 400);
          patch.invoice_ref = ref;
        }
        if (Object.keys(patch).length === 0) return json({ ok: false, error: "更新する項目がありません" }, 400);
        const saved = await store.annotate(id, patch);
        if (!saved) return json({ ok: false, error: "明細が見つかりません" }, 404);
        return json({ ok: true, txn: saved });
      }
      if (route === "links") {
        return json({ ok: true, links: await store.listLinked() });
      }
      if (route === "refresh") {
        if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
        return json(await runSync(env, store, f));
      }
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: "internal error" }, 500);
    }
  };
}

/* ---------- エントリポイント（テンプレートと同じ形式） ---------- */
// auth: "none" = Supabaseのキー無しで受け付ける（freeeのcallbackのため）。認証は makeHandler 内の合言葉/stateで行う
export default {
  fetch: withSupabase({ auth: "none", cors: { headers: CORS_HEADERS } }, (req: Request, ctx: any) =>
    makeHandler(Deno.env, pickStore(ctx, Deno.env), fetch)(req)
  ),
};
