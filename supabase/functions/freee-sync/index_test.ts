// 実行: deno test --allow-env --allow-net supabase/functions/freee-sync/index_test.ts
Deno.env.set("FREEE_TEST", "1");
const m = await import("./index.ts");

function assert(c: unknown, msg: string) { if (!c) throw new Error("ASSERT: " + msg); }
function eq<T>(a: T, b: T, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`EQ ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

const ENV = new Map<string, string>([
  ["FREEE_CLIENT_ID", "cid"], ["FREEE_CLIENT_SECRET", "csec"], ["SYNC_SECRET", "sync-secret-xyz"],
  ["SUPABASE_URL", "https://x.supabase.co"],
]);
const env = { get: (k: string) => ENV.get(k) };

/** CAS付きのインメモリストア（本番のPATCH条件付き更新と同じ挙動） */
function memStore(initial: any = null) {
  let tok = initial; const txns = new Map<number, any>();
  return {
    txns, get tok() { return tok; },
    loadTokens: async () => tok,
    saveTokens: async (t: any, prev: string | null) => {
      if (prev) { if (!tok || tok.refresh_token !== prev) return false; tok = { ...t }; return true; }
      tok = { ...t }; return true;
    },
    // 本番のupsert(merge-duplicates)と同じく「送った列だけ更新」＝仕訳・備考は残る
    upsertTxns: async (rows: any[]) => { for (const r of rows) txns.set(r.id, { ...(txns.get(r.id) ?? {}), ...r }); },
    latestTxnDate: async () => [...txns.values()].map((r) => r.txn_date).sort().pop() ?? null,
    stats: async () => ({ count: txns.size, latest: [...txns.values()].map((r) => r.txn_date).sort().pop() ?? null }),
    listTxns: async (from: string, to: string) =>
      [...txns.values()].filter((r) => r.txn_date >= from && r.txn_date <= to)
        .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.id - a.id),
    listAccounts: async () => [{ walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", latest_balance: 123, txn_count: txns.size }],
    annotate: async (id: number, a: any) => {
      const r = txns.get(id); if (!r) return null;
      txns.set(id, { ...r, ...a, annotated_at: "now" });
      return { id, ...a };
    },
  };
}

/** freeeのモック。calls に呼び出しを記録 */
function mockFreee(opts: { total?: number; companies?: any[]; refreshFail?: boolean } = {}) {
  const calls: string[] = [];
  const total = opts.total ?? 137;
  const f = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    calls.push(`${init?.method ?? "GET"} ${u.pathname}${u.search ? "?" + u.searchParams.get("offset") : ""}`);
    if (u.pathname.endsWith("/public_api/token")) {
      if (opts.refreshFail) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      const p = new URLSearchParams(init.body as string);
      return new Response(JSON.stringify({
        access_token: "AT-" + (p.get("grant_type") === "refresh_token" ? "R" : "N"),
        refresh_token: "RT-" + calls.length, expires_in: 21600,
      }));
    }
    if (u.pathname === "/api/1/companies") return new Response(JSON.stringify({ companies: opts.companies ?? [{ id: 777, display_name: "株式会社K-LINE" }] }));
    if (u.pathname === "/api/1/walletables") return new Response(JSON.stringify({ walletables: [{ id: 5, name: "GMOあおぞらネット銀行" }] }));
    if (u.pathname === "/api/1/wallet_txns") {
      const off = Number(u.searchParams.get("offset")); const lim = Number(u.searchParams.get("limit"));
      const rows = [];
      for (let i = off; i < Math.min(total, off + lim); i++) {
        rows.push({ id: 1000 + i, date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"), amount: i % 2 ? -1000 - i : 5000 + i,
          entry_side: i % 2 ? "expense" : "income", walletable_id: 5, walletable_type: "bank_account", description: "テスト" + i, balance: 100000 + i, status: 1 });
      }
      return new Response(JSON.stringify({ wallet_txns: rows }));
    }
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

const NOW = Date.parse("2026-10-07T03:00:00Z");
const fresh = (over: any = {}) => ({ access_token: "AT-OLD", refresh_token: "RT-OLD", expires_at: new Date(NOW + 3 * 3600e3).toISOString(), company_id: 777, ...over });

Deno.test("authorizeUrl に必要パラメータが入る", () => {
  const u = new URL(m.authorizeUrl("cid", "https://x/cb", "st"));
  eq(u.origin + u.pathname, "https://accounts.secure.freee.co.jp/public_api/authorize", "endpoint");
  eq([u.searchParams.get("client_id"), u.searchParams.get("response_type"), u.searchParams.get("state"), u.searchParams.get("redirect_uri")], ["cid", "code", "st", "https://x/cb"], "params");
});

Deno.test("期限に余裕があればトークン更新しない", async () => {
  const s = memStore(fresh()); const { f, calls } = mockFreee();
  const t = await m.getValidToken(env, s, f, NOW);
  eq(t.access_token, "AT-OLD", "そのまま"); eq(calls.length, 0, "通信なし");
});

Deno.test("期限が近ければrefreshし、新しいrefresh_tokenを保存(ローテーション)", async () => {
  const s = memStore(fresh({ expires_at: new Date(NOW + 5 * 60e3).toISOString() })); const { f } = mockFreee();
  const t = await m.getValidToken(env, s, f, NOW);
  eq(t.access_token, "AT-R", "新アクセストークン"); assert(s.tok.refresh_token.startsWith("RT-") && s.tok.refresh_token !== "RT-OLD", "refresh_tokenが入れ替わる");
  eq(s.tok.company_id, 777, "company_id維持");
});

Deno.test("refresh失敗は401で再認可を促す", async () => {
  const s = memStore(fresh({ expires_at: new Date(NOW - 1000).toISOString() })); const { f } = mockFreee({ refreshFail: true });
  try { await m.getValidToken(env, s, f, NOW); throw new Error("should throw"); }
  catch (e) { assert(e instanceof m.HttpError && e.status === 401, "401"); assert(String((e as Error).message).includes("再認可"), "メッセージ"); }
});

Deno.test("競合: 他プロセスが先にrefresh_tokenを更新済みなら409", async () => {
  const s = memStore(fresh({ expires_at: new Date(NOW - 1000).toISOString() })); const { f } = mockFreee();
  const orig = s.saveTokens; s.saveTokens = async (t: any, prev: any) => { (s as any).__ = 1; return false; };
  try { await m.getValidToken(env, s, f, NOW); throw new Error("should throw"); } catch (e) { eq((e as any).status, 409, "409"); }
  void orig;
});

Deno.test("ページング: 100件+37件=137件を全取得", async () => {
  const { f, calls } = mockFreee({ total: 137 });
  const rows = await m.fetchAllWalletTxns(f, "tok", 777, "2026-01-01", "2026-10-07");
  eq(rows.length, 137, "件数"); eq(calls.filter((c) => c.includes("wallet_txns")).length, 2, "2ページ");
});

Deno.test("ちょうど100件でも空ページまで見に行って止まる", async () => {
  const { f, calls } = mockFreee({ total: 100 });
  const rows = await m.fetchAllWalletTxns(f, "tok", 777, "2026-01-01", "2026-10-07");
  eq(rows.length, 100, "件数"); eq(calls.filter((c) => c.includes("wallet_txns")).length, 2, "次ページ確認で終了");
});

Deno.test("mapTxn: 支出も金額は正の値、sideで方向を持つ", () => {
  const r = m.mapTxn({ id: 1, date: "2026-09-01", amount: -3300, entry_side: "expense", walletable_id: 5, walletable_type: "bank_account", description: "ENEOS", balance: 10, status: 1 }, new Map([[5, "GMO"]]));
  eq([r.amount, r.entry_side, r.walletable_name, r.txn_date], [3300, "expense", "GMO", "2026-09-01"], "map");
});

Deno.test("chooseCompany: 単一/名前一致/曖昧/指定", () => {
  eq(m.chooseCompany([{ id: 1, name: "A" }]).id, 1, "単一");
  eq(m.chooseCompany([{ id: 1, display_name: "株式会社Kiraku" }, { id: 2, display_name: "株式会社K-LINE" }]).id, 2, "名前一致");
  eq(m.chooseCompany([{ id: 1, name: "x" }, { id: 2, name: "y" }], "2").id, 2, "指定");
  try { m.chooseCompany([{ id: 1, name: "x" }, { id: 2, name: "y" }]); throw new Error("should throw"); } catch (e) { eq((e as any).status, 409, "曖昧は409"); }
  try { m.chooseCompany([{ id: 1, name: "x" }], "9"); throw new Error("should throw"); } catch (e) { eq((e as any).status, 400, "存在しないID"); }
});

Deno.test("runSync: 初回は2026-01-01から取得、2回目は冪等(件数増えない)・差分は30日前から", async () => {
  const s = memStore(fresh({ company_id: null })); const { f } = mockFreee({ total: 137 });
  const r1 = await m.runSync(env, s, f, NOW);
  eq([r1.fetched, r1.from, r1.companyId], [137, "2026-01-01", 777], "初回"); eq(s.txns.size, 137, "保存件数"); eq(s.tok.company_id, 777, "company確定を保存");
  const r2 = await m.runSync(env, s, f, NOW + 3600e3);
  eq(s.txns.size, 137, "冪等"); assert(r2.from > "2026-08-01" && r2.from <= "2026-09-01", "差分窓=最新-30日: " + r2.from);
});

Deno.test("HTTP: 認証ヘッダー無しは403、正しければ同期、callbackのstate不一致は400", async () => {
  const s = memStore(fresh()); const { f } = mockFreee({ total: 3 });
  const h = m.makeHandler(env, s, f);
  eq((await h(new Request("https://x/functions/v1/freee-sync/sync"))).status, 403, "無認証");
  eq((await h(new Request("https://x/functions/v1/freee-sync/sync", { headers: { "x-sync-secret": "wrong" } }))).status, 403, "誤認証");
  const ok = await h(new Request("https://x/functions/v1/freee-sync/sync", { headers: { "x-sync-secret": "sync-secret-xyz" } }));
  eq(ok.status, 200, "正認証"); eq((await ok.json()).fetched, 3, "取得件数");
  eq((await h(new Request("https://x/functions/v1/freee-sync/callback?code=abc&state=bad"))).status, 400, "state不一致");
  const au = await h(new Request("https://x/functions/v1/freee-sync/authorize?key=sync-secret-xyz"));
  eq(au.status, 302, "authorize→302"); assert(au.headers.get("location")!.includes("client_id=cid"), "freeeへ飛ぶ");
});

Deno.test("HTTP: 正しいstateのcallbackでトークン保存・事業所確定", async () => {
  const s = memStore(null); const { f } = mockFreee();
  const h = m.makeHandler(env, s, f);
  const au = await h(new Request("https://x/functions/v1/freee-sync/authorize?key=sync-secret-xyz"));
  const state = new URL(au.headers.get("location")!).searchParams.get("state")!;
  const cb = await h(new Request(`https://x/functions/v1/freee-sync/callback?code=abc&state=${state}`));
  eq(cb.status, 200, "callback成功"); eq(s.tok.company_id, 777, "K-LINE事業所を確定"); eq(s.tok.access_token, "AT-N", "トークン保存");
});

/* ---- restStore: PostgRESTへのリクエスト形を検証（本物のDBには繋がない） ---- */
function recFetch(respond: (url: string, init: any) => Response) {
  const log: Array<{ url: string; init: any }> = [];
  const f = (async (u: any, init: any) => { log.push({ url: String(u), init }); return respond(String(u), init); }) as typeof fetch;
  return { f, log };
}

Deno.test("restStore.saveTokens(prev): 旧refresh_token条件のPATCH・1行更新ならtrue/0行ならfalse", async () => {
  const hit = recFetch(() => new Response(JSON.stringify([{ id: 1 }])));
  const s1 = m.restStore("https://p.supabase.co", "SRK", hit.f);
  eq(await s1.saveTokens({ access_token: "a", refresh_token: "r", expires_at: "x", company_id: 1 }, "old/token+=1"), true, "更新あり");
  assert(hit.log[0].url.includes("freee_tokens?id=eq.1&refresh_token=eq.old%2Ftoken%2B%3D1"), "条件がエンコードされる: " + hit.log[0].url);
  eq(hit.log[0].init.method, "PATCH", "PATCH"); eq(hit.log[0].init.headers.Authorization, "Bearer SRK", "service role");
  const miss = recFetch(() => new Response(JSON.stringify([])));
  eq(await m.restStore("https://p.supabase.co", "SRK", miss.f).saveTokens({ access_token: "a", refresh_token: "r", expires_at: "x", company_id: 1 }, "old"), false, "0行=競合");
});

Deno.test("restStore.upsertTxns: on_conflict=id・merge-duplicates", async () => {
  const r = recFetch(() => new Response(null, { status: 201 }));
  await m.restStore("https://p.supabase.co/", "SRK", r.f).upsertTxns([{ id: 1 } as any]);
  assert(r.log[0].url === "https://p.supabase.co/rest/v1/bank_txns?on_conflict=id", "URL: " + r.log[0].url);
  assert(String(r.log[0].init.headers.Prefer).includes("merge-duplicates"), "upsert指定");
});

Deno.test("restStore.stats: content-rangeから件数を読む", async () => {
  const r = recFetch((url) => url.includes("order=txn_date")
    ? new Response(JSON.stringify([{ txn_date: "2026-09-30" }]))
    : new Response("[]", { headers: { "content-range": "0-0/412" } }));
  eq(await m.restStore("https://p.supabase.co", "SRK", r.f).stats(), { count: 412, latest: "2026-09-30" }, "stats");
});

Deno.test("restStore: DBエラーは握りつぶさず例外にする", async () => {
  const r = recFetch(() => new Response("boom", { status: 500 }));
  try { await m.restStore("https://p.supabase.co", "SRK", r.f).loadTokens(); throw new Error("should throw"); }
  catch (e) { assert(String((e as Error).message).includes("loadTokens failed: 500"), "メッセージ"); }
});

/* ---- adminStore: supabase-js(ctx.supabaseAdmin) の呼び方を検証（偽クライアント） ---- */
function fakeDb(result: any) {
  const calls: Array<{ table: string; ops: any[] }> = [];
  const db = {
    from(table: string) {
      const rec = { table, ops: [] as any[] };
      const b: any = {};
      for (const op of ["select", "update", "upsert", "eq", "gte", "lte", "order", "limit"]) {
        b[op] = (...args: any[]) => { rec.ops.push([op, ...args]); return b; };
      }
      b.maybeSingle = () => { rec.ops.push(["maybeSingle"]); calls.push(rec); return Promise.resolve(result); };
      b.then = (ok: any, ng: any) => { calls.push(rec); return Promise.resolve(result).then(ok, ng); };
      return b;
    },
  };
  return { db, calls };
}

Deno.test("adminStore.saveTokens(prev): id=1かつ旧refresh_tokenの行だけ更新・1行ならtrue/0行ならfalse", async () => {
  const hit = fakeDb({ data: [{ id: 1 }], error: null });
  eq(await m.adminStore(hit.db).saveTokens({ access_token: "a", refresh_token: "r", expires_at: "x", company_id: 1 }, "OLD"), true, "更新あり");
  const ops = hit.calls[0].ops.map((o: any[]) => o[0]);
  eq([hit.calls[0].table, ops], ["freee_tokens", ["update", "eq", "eq", "select"]], "update→eq(id)→eq(refresh_token)→select");
  eq(hit.calls[0].ops[2], ["eq", "refresh_token", "OLD"], "旧トークン条件");
  const miss = fakeDb({ data: [], error: null });
  eq(await m.adminStore(miss.db).saveTokens({ access_token: "a", refresh_token: "r", expires_at: "x", company_id: 1 }, "OLD"), false, "0行=競合");
});

Deno.test("adminStore.saveTokens(null): id=1でupsert", async () => {
  const r = fakeDb({ data: null, error: null });
  eq(await m.adminStore(r.db).saveTokens({ access_token: "a", refresh_token: "r", expires_at: "x", company_id: null }, null), true, "保存");
  const up = r.calls[0].ops[0];
  eq([up[0], up[1].id, up[2]], ["upsert", 1, { onConflict: "id" }], "upsert id=1");
});

Deno.test("adminStore.upsertTxns / stats / loadTokens", async () => {
  const u = fakeDb({ error: null });
  await m.adminStore(u.db).upsertTxns([{ id: 9 } as any]);
  eq([u.calls[0].table, u.calls[0].ops[0][0], u.calls[0].ops[0][2]], ["bank_txns", "upsert", { onConflict: "id" }], "明細upsert");
  const empty = fakeDb({ error: null });
  await m.adminStore(empty.db).upsertTxns([]);
  eq(empty.calls.length, 0, "0件なら呼ばない");
  const s = fakeDb({ count: 412, data: [{ txn_date: "2026-09-30" }], error: null });
  eq(await m.adminStore(s.db).stats(), { count: 412, latest: "2026-09-30" }, "stats");
  const l = fakeDb({ data: { access_token: "A", refresh_token: "R", expires_at: "x", company_id: 7 }, error: null });
  eq((await m.adminStore(l.db).loadTokens())?.company_id, 7, "loadTokens");
});

Deno.test("adminStore: DBエラーは例外にする（握りつぶさない）", async () => {
  const r = fakeDb({ data: null, error: { message: "permission denied" } });
  try { await m.adminStore(r.db).loadTokens(); throw new Error("should throw"); }
  catch (e) { assert(String((e as Error).message).includes("loadTokens failed: permission denied"), "メッセージ"); }
});

/* ---- pickStore: 新方式→旧方式→どちらも無ければ500 ---- */
Deno.test("pickStore: supabaseAdminがあれば新方式・無ければ旧キー・どちらも無ければ500を返すストア", async () => {
  const admin = fakeDb({ data: null, error: null });
  await m.pickStore({ supabaseAdmin: admin.db }, { get: () => undefined }).loadTokens();
  eq(admin.calls[0].table, "freee_tokens", "新方式を使う");

  const legacyEnv = new Map([["SUPABASE_SERVICE_ROLE_KEY", "SRK"], ["SUPABASE_URL", "https://p.supabase.co"]]);
  const s = m.pickStore({}, { get: (k: string) => legacyEnv.get(k) });
  assert(typeof s.loadTokens === "function", "旧方式ストア");

  const none = m.pickStore({}, { get: () => undefined });
  try { await none.loadTokens(); throw new Error("should throw"); }
  catch (e) { eq((e as any).status, 500, "500"); assert(String((e as Error).message).includes("管理者キー"), "理由つき"); }
});

Deno.test("エントリポイント: テンプレートと同じ export default { fetch } 形式", () => {
  assert(typeof (m as any).default?.fetch === "function", "default.fetch が関数");
});

/* ===================== v2: アプリ用（口座画面）の窓口 ===================== */
const APPKEY = await m.appKeyOf("sync-secret-xyz");
const H = (extra: Record<string, string> = {}) => ({ headers: { "x-app-key": APPKEY, ...extra } });

Deno.test("mapTxn: 仕訳・備考の列を含めない（自動取り込みで上書きしないため）・synced_atを付ける", () => {
  const r = m.mapTxn({ id: 1, date: "2026-09-01", amount: 1, entry_side: "income" }, new Map(), NOW) as any;
  assert(!("journal" in r) && !("memo" in r) && !("annotated_at" in r), "注釈列なし");
  eq(r.synced_at, new Date(NOW).toISOString(), "synced_at");
});

Deno.test("appKeyOf: 16桁・SYNC_SECRETと別物・決定的", async () => {
  eq(APPKEY.length, 16, "16桁"); assert(APPKEY !== "sync-secret-xyz", "合言葉そのものではない");
  eq(await m.appKeyOf("sync-secret-xyz"), APPKEY, "同じ入力→同じ値");
});

Deno.test("ledger: パスワード無し/違い/合言葉(SYNC_SECRET)では403", async () => {
  const h = m.makeHandler(env, memStore(fresh()), mockFreee().f);
  const u = "https://x/functions/v1/freee-sync/ledger?from=2026-09-01&to=2026-09-30";
  eq((await h(new Request(u))).status, 403, "無し");
  eq((await h(new Request(u, { headers: { "x-app-key": "wrong" } }))).status, 403, "違い");
  eq((await h(new Request(u, { headers: { "x-sync-secret": "sync-secret-xyz" } }))).status, 403, "同期用の合言葉では見られない");
});

Deno.test("ledger: 期間の明細（新しい順）と口座一覧を返す・日付不正は400", async () => {
  const s = memStore(fresh()); const { f } = mockFreee({ total: 40 });
  await m.runSync(env, s, f, NOW);
  const h = m.makeHandler(env, s, f);
  const r = await h(new Request("https://x/functions/v1/freee-sync/ledger?from=2026-09-01&to=2026-09-10", H()));
  eq(r.status, 200, "200");
  const j = await r.json();
  assert(j.txns.length > 0 && j.txns.every((t: any) => t.txn_date >= "2026-09-01" && t.txn_date <= "2026-09-10"), "期間内のみ");
  assert(j.txns[0].txn_date >= j.txns[j.txns.length - 1].txn_date, "新しい順");
  eq(j.accounts[0].walletable_name, "GMOあおぞらネット銀行", "口座一覧");
  eq((await h(new Request("https://x/functions/v1/freee-sync/ledger?from=2026-9-1&to=x", H()))).status, 400, "日付不正");
});

Deno.test("annotate: 仕訳・備考を保存、空はnull、長すぎは400、GETは405、存在しないIDは404", async () => {
  const s = memStore(fresh()); const { f } = mockFreee({ total: 3 });
  await m.runSync(env, s, f, NOW);
  const h = m.makeHandler(env, s, f);
  const post = (body: any) => h(new Request("https://x/functions/v1/freee-sync/annotate", { method: "POST", ...H({ "content-type": "application/json" }), body: JSON.stringify(body) }));
  const ok = await post({ id: 1000, journal: " 燃料費 ", memo: "ENEOS 高槻" });
  eq(ok.status, 200, "保存"); eq([s.txns.get(1000).journal, s.txns.get(1000).memo], ["燃料費", "ENEOS 高槻"], "前後空白を除いて保存");
  await post({ id: 1000, journal: "燃料費", memo: "" });
  eq(s.txns.get(1000).memo, null, "空欄はnull＝消去");
  eq((await post({ id: 1000, journal: "x".repeat(61), memo: "" })).status, 400, "仕訳61文字は400");
  eq((await post({ id: "abc", journal: "a" })).status, 400, "id不正");
  eq((await post({ id: 999999, journal: "a" })).status, 404, "存在しない");
  eq((await h(new Request("https://x/functions/v1/freee-sync/annotate", H()))).status, 405, "GETは405");
});

Deno.test("自動取り込みをもう一度走らせても、入力済みの仕訳・備考は消えない", async () => {
  const s = memStore(fresh()); const { f } = mockFreee({ total: 5 });
  await m.runSync(env, s, f, NOW);
  await s.annotate(1001, { journal: "売上高", memo: "オクノ9月分" });
  await m.runSync(env, s, f, NOW + 7200e3);
  eq([s.txns.get(1001).journal, s.txns.get(1001).memo], ["売上高", "オクノ9月分"], "保持");
});

Deno.test("refresh: アプリパスワードで取り込みを実行・POSTのみ", async () => {
  const s = memStore(fresh()); const { f } = mockFreee({ total: 7 });
  const h = m.makeHandler(env, s, f);
  eq((await h(new Request("https://x/functions/v1/freee-sync/refresh", H()))).status, 405, "GETは405");
  const r = await h(new Request("https://x/functions/v1/freee-sync/refresh", { method: "POST", ...H() }));
  eq(r.status, 200, "200"); eq((await r.json()).fetched, 7, "取り込み件数");
});

Deno.test("adminStore.listTxns / annotate のクエリ形", async () => {
  const l = fakeDb({ data: [{ id: 1 }], error: null });
  await m.adminStore(l.db).listTxns("2026-09-01", "2026-09-30");
  const ops = l.calls[0].ops;
  eq(ops.find((o: any[]) => o[0] === "gte"), ["gte", "txn_date", "2026-09-01"], "from");
  eq(ops.find((o: any[]) => o[0] === "lte"), ["lte", "txn_date", "2026-09-30"], "to");
  assert(String(ops[0][1]).includes("journal") && !String(ops[0][1]).includes("raw"), "仕訳を含み、重いrawは返さない");
  const a = fakeDb({ data: [{ id: 7, journal: "j" }], error: null });
  eq((await m.adminStore(a.db).annotate(7, { journal: "j", memo: null }))?.id, 7, "annotate");
  eq(a.calls[0].ops[0][0], "update", "update"); eq(a.calls[0].ops[1], ["eq", "id", 7], "id条件");
  assert(!("amount" in a.calls[0].ops[0][1]), "金額など銀行由来の列は書き換えない");
});
