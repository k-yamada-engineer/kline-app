import { useState, useEffect, useMemo, useRef } from "react";
import {
  Home as HomeIcon, ListChecks, Plus, Settings as SettingsIcon, Truck,
  FileText, ChevronLeft, ChevronRight, Trash2, X, Camera, Building2,
  Receipt, Pencil, Download, Upload, Check, Users, Printer, JapaneseYen
} from "lucide-react";

/* ============================================================
   株式会社K-LINE 運搬記録・請求書アプリ v3
   ============================================================ */

/* ---------- storage ---------- */
const LS = (k, def) => {
  try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; }
  catch { return def; }
};
const saveLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; }
};
function usePersist(key, def) {
  const [v, setV] = useState(() => LS(key, def));
  useEffect(() => { saveLS(key, v); }, [key, v]);
  return [v, setV];
}

/* ---------- date helpers ---------- */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthOf = (iso) => (iso || "").slice(0, 7);
const thisMonth = () => todayISO().slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const fmtDay = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};
const fmtDateJP = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};
const fmtMonth = (ym) => { const [y, m] = ym.split("-"); return `${y}年${Number(m)}月`; };
const wareki = (y) => `令和${y - 2018}年`;
const shiftMonth = (ym, delta) => {
  let [y, m] = ym.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
};
const lastDay = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
/* 締め期間: 末締め=当月1〜末 / 20日締め=前月21〜当月20 */
const closingPeriod = (ym, closing) => {
  if (closing === "20") {
    const prev = shiftMonth(ym, -1);
    return { from: `${prev}-21`, to: `${ym}-20` };
  }
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay(ym)).padStart(2, "0")}` };
};

/* ---------- formatting ---------- */
const yen = (n) => "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
const num = (n) => (Number(n) || 0).toLocaleString("ja-JP");
const calcAmount = (qty, price, unit) => {
  const q = Number(qty) || 0, p = Number(price) || 0;
  if (unit === "㎏") return Math.round((q * p) / 1000); // ㎏数量 × 円/t 単価
  return Math.round(q * p);
};

/* ---------- 初期データ（実データからプリセット） ---------- */
/* 公開ページのため機密情報は埋め込まない。
   初期データ（取引先・従業員・車両・振込先）は
   設定 → 読み込み からセットアップファイルを取り込む。 */
const DEF_COMPANY = {
  name: "株式会社K-LINE",
  rep: "",
  zip: "",
  address: "",
  tel: "",
  bankName: "",
  bankBranch: "",
  bankType: "普通預金",
  bankNumber: "",
  bankHolder: "",
  regNo: "",
  taxRate: 10,
  invoiceNote: "お振込手数料は御社にてご負担をお願いいたします。",
};
const DEF_CLIENTS = [];
const DEF_EMPLOYEES = [];
const DEF_VEHICLES = [];
const DEF_UNITS = ["台", "㎏", "㎥", "日", "式"];
const K = {
  company: "kline3:company", clients: "kline3:clients", employees: "kline3:employees",
  vehicles: "kline3:vehicles", units: "kline3:units", records: "kline3:records",
};

/* ---------- 写真圧縮 ---------- */
const compressImage = (file) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const max = 900;
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * sc);
    c.height = Math.round(img.height * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    resolve(c.toDataURL("image/jpeg", 0.55));
  };
  img.onerror = () => resolve(null);
  img.src = URL.createObjectURL(file);
});

/* ============================================================ */
export default function App() {
  const [company, setCompany] = usePersist(K.company, DEF_COMPANY);
  const [clients, setClients] = usePersist(K.clients, DEF_CLIENTS);
  const [employees, setEmployees] = usePersist(K.employees, DEF_EMPLOYEES);
  const [vehicles, setVehicles] = usePersist(K.vehicles, DEF_VEHICLES);
  const [units, setUnits] = usePersist(K.units, DEF_UNITS);
  const [records, setRecords] = usePersist(K.records, []);

  const [tab, setTab] = useState("home");
  const [month, setMonth] = useState(thisMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [invoicePrev, setInvoicePrev] = useState(null); // {clientId, ym}
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const saveRecord = (rec) => {
    setRecords((prev) => {
      const i = prev.findIndex((r) => r.id === rec.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = rec; return cp; }
      return [...prev, rec];
    });
    setFormOpen(false);
    setEditRec(null);
    setMonth(monthOf(rec.date));
    setTab("records");
    setHighlightId(rec.id);
    showToast("保存しました ✓");
    setTimeout(() => setHighlightId(null), 2600);
  };
  const deleteRecord = (id) => {
    if (!window.confirm("この記録を削除しますか？")) return;
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setFormOpen(false);
    setEditRec(null);
    showToast("削除しました");
  };
  const openEdit = (r) => { setEditRec(r); setFormOpen(true); };
  const openNew = () => { setEditRec(null); setFormOpen(true); };

  return (
    <div className="kl-root">
      <div className="app-ui">
        <main className="kl-main">
          {tab === "home" && (
            <HomeView records={records} onAdd={openNew} onEdit={openEdit} goInvoice={() => setTab("invoice")} goRecords={(ym) => { setMonth(ym); setTab("records"); }} />
          )}
          {tab === "records" && (
            <RecordsView records={records} month={month} setMonth={setMonth} onEdit={openEdit} highlightId={highlightId} onAdd={openNew} />
          )}
          {tab === "invoice" && (
            <InvoiceListView records={records} clients={clients} month={month} setMonth={setMonth} onPreview={(clientId, ym) => setInvoicePrev({ clientId, ym })} />
          )}
          {tab === "settings" && (
            <SettingsView
              company={company} setCompany={setCompany}
              clients={clients} setClients={setClients}
              employees={employees} setEmployees={setEmployees}
              vehicles={vehicles} setVehicles={setVehicles}
              records={records} setRecords={setRecords}
              showToast={showToast}
            />
          )}
        </main>

        <nav className="kl-nav">
          <NavBtn icon={<HomeIcon size={22} />} label="ホーム" active={tab === "home"} onClick={() => setTab("home")} />
          <NavBtn icon={<ListChecks size={22} />} label="日報" active={tab === "records"} onClick={() => setTab("records")} />
          <button className="kl-fab" onClick={openNew} aria-label="記録を追加"><Plus size={28} strokeWidth={2.6} /></button>
          <NavBtn icon={<Receipt size={22} />} label="請求書" active={tab === "invoice"} onClick={() => setTab("invoice")} />
          <NavBtn icon={<SettingsIcon size={22} />} label="設定" active={tab === "settings"} onClick={() => setTab("settings")} />
        </nav>

        {formOpen && (
          <RecordForm
            record={editRec} records={records}
            clients={clients} vehicles={vehicles} employees={employees} units={units}
            onSave={saveRecord} onDelete={deleteRecord}
            onClose={() => { setFormOpen(false); setEditRec(null); }}
          />
        )}
        {toast && <div className="kl-toast">{toast}</div>}
      </div>

      {invoicePrev && (
        <InvoiceDoc
          company={company}
          client={clients.find((c) => c.id === invoicePrev.clientId)}
          ym={invoicePrev.ym}
          records={records}
          onClose={() => setInvoicePrev(null)}
        />
      )}
      <GlobalStyle />
    </div>
  );
}

function NavBtn({ icon, label, active, onClick }) {
  return (
    <button className={"kl-navbtn" + (active ? " is-active" : "")} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

/* ============================================================
   ホーム
   ============================================================ */
function HomeView({ records, onAdd, onEdit, goInvoice, goRecords }) {
  const today = todayISO();
  const ym = thisMonth();
  const todayRecs = records.filter((r) => r.date === today);
  const monthRecs = records.filter((r) => monthOf(r.date) === ym);
  const sum = (rs) => rs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const dai = (rs) => rs.filter((r) => r.unit === "台" && r.type !== "toll").reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const recent = [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  return (
    <div className="kl-page">
      <header className="kl-header">
        <div>
          <div className="kl-brand"><Truck size={18} /> 株式会社K-LINE</div>
          <h1>{fmtDay(today)} の日報</h1>
        </div>
      </header>

      <div className="kl-statgrid">
        <div className="kl-stat">
          <span>今日の売上（税抜）</span>
          <b>{yen(sum(todayRecs))}</b>
          <small>{todayRecs.length}件 / {num(dai(todayRecs))}台</small>
        </div>
        <div className="kl-stat" onClick={() => goRecords(ym)} role="button">
          <span>今月の売上（税抜）</span>
          <b>{yen(sum(monthRecs))}</b>
          <small>{monthRecs.length}件 / {num(dai(monthRecs))}台</small>
        </div>
      </div>

      <button className="kl-bigadd" onClick={onAdd}>
        <Plus size={22} strokeWidth={2.6} /> 今日の運搬を記録する
      </button>

      <section className="kl-section">
        <div className="kl-sechead">
          <h2>今日の記録</h2>
          {todayRecs.length > 0 && <span className="kl-secsum">{yen(sum(todayRecs))}</span>}
        </div>
        {todayRecs.length === 0 ? (
          <div className="kl-empty">まだ記録がありません。<br />下の「＋」から30秒で記録できます。</div>
        ) : (
          <div className="kl-cards">
            {todayRecs.map((r) => <RecordCard key={r.id} r={r} onClick={() => onEdit(r)} />)}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="kl-section">
          <div className="kl-sechead"><h2>最近の記録</h2></div>
          <div className="kl-cards">
            {recent.map((r) => <RecordCard key={r.id} r={r} showDate onClick={() => onEdit(r)} />)}
          </div>
        </section>
      )}

      <button className="kl-linkbtn" onClick={goInvoice}><Receipt size={17} /> 請求書を作成する</button>
    </div>
  );
}

/* ============================================================
   記録カード
   ============================================================ */
function RecordCard({ r, onClick, showDate, highlight }) {
  return (
    <button id={`rec-${r.id}`} className={"kl-rec" + (highlight ? " is-flash" : "")} onClick={onClick}>
      <div className="kl-rec-l">
        <b>{r.client}</b>
        <span className="kl-rec-site">{r.site || "（現場未入力）"}</span>
        <span className="kl-rec-meta">
          {showDate && <em>{fmtDay(r.date)}</em>}
          {r.type === "toll"
            ? <em className="kl-tag-toll">高速立替</em>
            : <em>{num(r.qty)}{r.unit}{r.unitPrice ? ` × ${num(r.unitPrice)}円` : ""}</em>}
          {r.vehicle && <em className="kl-tag">車番 {r.vehicle}</em>}
          {r.driver && <em className="kl-tag">{r.driver}</em>}
        </span>
      </div>
      <div className="kl-rec-r">
        <b>{yen(r.amount)}</b>
        {r.photo && <Camera size={14} className="kl-rec-photo" />}
      </div>
    </button>
  );
}

/* ============================================================
   日報一覧
   ============================================================ */
function RecordsView({ records, month, setMonth, onEdit, highlightId, onAdd }) {
  const monthRecs = useMemo(() => records.filter((r) => monthOf(r.date) === month), [records, month]);
  const byDay = useMemo(() => {
    const m = {};
    monthRecs.forEach((r) => { (m[r.date] = m[r.date] || []).push(r); });
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]));
  }, [monthRecs]);
  const total = monthRecs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const dai = monthRecs.filter((r) => r.unit === "台" && r.type !== "toll").reduce((a, r) => a + (Number(r.qty) || 0), 0);

  useEffect(() => {
    if (highlightId) {
      const el = document.getElementById(`rec-${highlightId}`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightId]);

  return (
    <div className="kl-page">
      <MonthNav month={month} setMonth={setMonth} title="日報" />
      <div className="kl-monthsum">
        <div><span>件数</span><b>{monthRecs.length}</b></div>
        <div><span>台数</span><b>{num(dai)}</b></div>
        <div><span>売上（税抜）</span><b>{yen(total)}</b></div>
      </div>

      {byDay.length === 0 && (
        <div className="kl-empty">
          {fmtMonth(month)}の記録はありません。
          <button className="kl-empty-add" onClick={onAdd}><Plus size={16} /> 記録を追加</button>
        </div>
      )}

      {byDay.map(([date, rs]) => {
        const dsum = rs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
        return (
          <section key={date} className="kl-section">
            <div className="kl-sechead">
              <h2>{fmtDay(date)}</h2>
              <span className="kl-secsum">{rs.length}件・{yen(dsum)}</span>
            </div>
            <div className="kl-cards">
              {rs.map((r) => (
                <RecordCard key={r.id} r={r} onClick={() => onEdit(r)} highlight={r.id === highlightId} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MonthNav({ month, setMonth, title }) {
  return (
    <header className="kl-header kl-header-nav">
      <h1>{title}</h1>
      <div className="kl-monthnav">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="前月"><ChevronLeft size={20} /></button>
        <b>{fmtMonth(month)}</b>
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="翌月"><ChevronRight size={20} /></button>
      </div>
    </header>
  );
}

/* ============================================================
   記録フォーム
   ============================================================ */
function RecordForm({ record, records, clients, vehicles, employees, units, onSave, onDelete, onClose }) {
  const isEdit = !!record;
  const [type, setType] = useState(record?.type || "normal");
  const [date, setDate] = useState(record?.date || todayISO());
  const [client, setClient] = useState(record?.client || "");
  const [site, setSite] = useState(record?.site || "");
  const [qty, setQty] = useState(record ? String(record.qty ?? "") : "1");
  const [unit, setUnit] = useState(record?.unit || "台");
  const [unitPrice, setUnitPrice] = useState(record ? String(record.unitPrice ?? "") : "");
  const [tollAmount, setTollAmount] = useState(record?.type === "toll" ? String(record.amount ?? "") : "");
  const [vehicle, setVehicle] = useState(record?.vehicle || "");
  const [driver, setDriver] = useState(record?.driver || "");
  const [memo, setMemo] = useState(record?.memo || "");
  const [photo, setPhoto] = useState(record?.photo || null);
  const fileRef = useRef(null);

  /* 取引先ごとの直近の現場・品名候補 */
  const siteSuggestions = useMemo(() => {
    const rs = records.filter((r) => (!client || r.client === client) && r.site);
    const seen = new Set(); const out = [];
    [...rs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((r) => {
      if (!seen.has(r.site)) { seen.add(r.site); out.push(r.site); }
    });
    return out.slice(0, 6);
  }, [records, client]);

  /* 同じ取引先×現場の前回単価を自動プリセット */
  const applySite = (s) => {
    setSite(s);
    if (!unitPrice) {
      const last = [...records]
        .filter((r) => r.client === client && r.site === s && r.type !== "toll")
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      if (last) { setUnitPrice(String(last.unitPrice || "")); setUnit(last.unit || "台"); }
    }
  };

  const amount = type === "toll"
    ? Math.round(Number(tollAmount) || 0)
    : calcAmount(qty, unitPrice, unit);

  const canSave = client && date && (type === "toll" ? amount > 0 : Number(qty) > 0);

  const handlePhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const data = await compressImage(f);
    if (data) setPhoto(data);
  };

  const submit = () => {
    if (!canSave) return;
    onSave({
      id: record?.id || uid(),
      type, date, client, site,
      qty: type === "toll" ? 1 : Number(qty) || 0,
      unit: type === "toll" ? "式" : unit,
      unitPrice: type === "toll" ? amount : Number(unitPrice) || 0,
      amount,
      vehicle, driver, memo, photo,
      createdAt: record?.createdAt || Date.now(),
    });
  };

  return (
    <div className="kl-sheet" role="dialog">
      <div className="kl-sheet-head">
        <button className="kl-iconbtn" onClick={onClose} aria-label="閉じる"><X size={22} /></button>
        <h2>{isEdit ? "記録を編集" : "運搬を記録"}</h2>
        {isEdit
          ? <button className="kl-iconbtn kl-danger" onClick={() => onDelete(record.id)} aria-label="削除"><Trash2 size={20} /></button>
          : <span style={{ width: 40 }} />}
      </div>

      <div className="kl-sheet-body">
        <div className="kl-typetab">
          <button className={type === "normal" ? "is-on" : ""} onClick={() => setType("normal")}>運搬</button>
          <button className={type === "toll" ? "is-on" : ""} onClick={() => setType("toll")}>高速立替（非課税）</button>
        </div>

        <Field label="日付">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="取引先 *">
          {clients.length === 0 ? (
            <p className="kl-note">取引先が未登録です。「設定 → 読み込み」でセットアップファイルを取り込むか、「設定 → 取引先」で追加してください。</p>
          ) : (
            <div className="kl-chips">
              {clients.map((c) => (
                <button key={c.id} className={"kl-chip" + (client === c.name ? " is-on" : "")} onClick={() => setClient(c.name)}>
                  {c.short || c.name}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="現場名・品名">
          <input type="text" value={site} onChange={(e) => setSite(e.target.value)} placeholder="例）中央砕石～6号 / 十三残土引き取り" />
          {siteSuggestions.length > 0 && (
            <div className="kl-chips kl-chips-sub">
              {siteSuggestions.map((s) => (
                <button key={s} className={"kl-chip kl-chip-s" + (site === s ? " is-on" : "")} onClick={() => applySite(s)}>{s}</button>
              ))}
            </div>
          )}
        </Field>

        {type === "normal" ? (
          <>
            <div className="kl-row2">
              <Field label="数量">
                <div className="kl-stepper">
                  <button onClick={() => setQty(String(Math.max(0, (Number(qty) || 0) - 1)))}>−</button>
                  <input type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <button onClick={() => setQty(String((Number(qty) || 0) + 1))}>＋</button>
                </div>
              </Field>
              <Field label="単位">
                <div className="kl-chips">
                  {units.map((u) => (
                    <button key={u} className={"kl-chip" + (unit === u ? " is-on" : "")} onClick={() => setUnit(u)}>{u}</button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label={unit === "㎏" ? "単価（円/t）※㎏入力×t単価で自動計算" : "単価（円・税抜）"}>
              <input type="text" inputMode="numeric" value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="例）3550" />
            </Field>
          </>
        ) : (
          <Field label="高速代金額（円・非課税）">
            <input type="text" inputMode="numeric" value={tollAmount}
              onChange={(e) => setTollAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="例）2020" />
          </Field>
        )}

        <div className="kl-amount">
          <span>金額{type === "toll" ? "（非課税）" : "（税抜）"}</span>
          <b>{yen(amount)}</b>
        </div>

        <div className="kl-row2">
          <Field label="車番">
            <div className="kl-chips">
              {vehicles.map((v) => (
                <button key={v.id} className={"kl-chip" + (vehicle === v.number ? " is-on" : "")}
                  onClick={() => setVehicle(vehicle === v.number ? "" : v.number)}>{v.number}</button>
              ))}
            </div>
          </Field>
          <Field label="運転手">
            <div className="kl-chips">
              {employees.map((p) => (
                <button key={p.id} className={"kl-chip" + (driver === p.name ? " is-on" : "")}
                  onClick={() => setDriver(driver === p.name ? "" : p.name)}>{p.name.split(" ")[0]}</button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="メモ">
          <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" />
        </Field>

        <Field label="受領書写真">
          <button className="kl-photoup" onClick={() => fileRef.current?.click()}>
            {photo ? <img src={photo} alt="受領書" /> : (<><Camera size={22} /><span>タップして撮影・選択</span></>)}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
          {photo && <button className="kl-photodel" onClick={() => setPhoto(null)}><Trash2 size={14} /> 写真を削除</button>}
        </Field>
      </div>

      <div className="kl-sheet-foot">
        <button className="kl-save" disabled={!canSave} onClick={submit}>
          <Check size={20} strokeWidth={2.6} /> 保存する{amount > 0 ? `（${yen(amount)}）` : ""}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="kl-field">
      <span className="kl-label">{label}</span>
      {children}
    </label>
  );
}

/* ============================================================
   請求書一覧
   ============================================================ */
function InvoiceListView({ records, clients, month, setMonth, onPreview }) {
  const rows = clients.map((c) => {
    const { from, to } = closingPeriod(month, c.closing);
    const rs = records.filter((r) => r.client === c.name && r.date >= from && r.date <= to);
    const normal = rs.filter((r) => r.type !== "toll");
    const toll = rs.filter((r) => r.type === "toll");
    const sub = normal.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const tollSum = toll.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    return { c, count: rs.length, sub, tollSum, from, to };
  });
  const active = rows.filter((r) => r.count > 0);
  const inactive = rows.filter((r) => r.count === 0);

  return (
    <div className="kl-page">
      <MonthNav month={month} setMonth={setMonth} title="請求書" />
      <p className="kl-note">締め日（20日／末）に合わせて対象期間を自動集計します。タップでプレビュー → 印刷・PDF保存。</p>

      {active.length === 0 && <div className="kl-empty">{fmtMonth(month)}締めの対象記録がありません。<br />日報を記録すると自動で集計されます。</div>}

      <div className="kl-cards">
        {active.map(({ c, count, sub, tollSum, from, to }) => (
          <button key={c.id} className="kl-invcard" onClick={() => onPreview(c.id, month)}>
            <div className="kl-invcard-l">
              <b>{c.name}</b>
              <span>{fmtDay(from)}〜{fmtDay(to)}・{count}件{tollSum > 0 ? `・高速${yen(tollSum)}` : ""}</span>
            </div>
            <div className="kl-invcard-r">
              <b>{yen(sub)}</b>
              <span>税抜</span>
            </div>
          </button>
        ))}
      </div>

      {inactive.length > 0 && (
        <details className="kl-details">
          <summary>記録のない取引先（{inactive.length}社）</summary>
          <div className="kl-cards">
            {inactive.map(({ c }) => (
              <div key={c.id} className="kl-invcard is-dim">
                <div className="kl-invcard-l"><b>{c.name}</b><span>{c.closing === "20" ? "20日締め" : "末締め"}・記録なし</span></div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/* ============================================================
   請求書ドキュメント（プレビュー＋印刷）
   ============================================================ */
function InvoiceDoc({ company, client, ym, records, onClose }) {
  if (!client) return null;
  const { from, to } = closingPeriod(ym, client.closing);
  const rs = records
    .filter((r) => r.client === client.name && r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const normal = rs.filter((r) => r.type !== "toll");
  const toll = rs.filter((r) => r.type === "toll");
  const sub = normal.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const tax = Math.floor((sub * (Number(company.taxRate) || 0)) / 100);
  const tollSum = toll.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const total = sub + tax + tollSum;
  const [y, m] = ym.split("-").map(Number);
  const closingLabel = `${wareki(y)}${m}月${client.closing === "20" ? "20日" : "末"}締分`;
  const invNo = `${ym.replace("-", "")}-${String(client.id).replace(/\D/g, "").padStart(2, "0")}`;

  return (
    <div className="kl-invoverlay">
      <div className="kl-invtools no-print">
        <button className="kl-iconbtn" onClick={onClose}><X size={22} /></button>
        <b>{client.name}</b>
        <button className="kl-printbtn" onClick={() => window.print()}><Printer size={17} /> 印刷・PDF保存</button>
      </div>

      <div className="kl-doc" id="invoice-doc">
        <div className="kl-doc-closing">{closingLabel}</div>
        <h1 className="kl-doc-title">請　求　書</h1>

        <div className="kl-doc-head">
          <div className="kl-doc-to">
            <div className="kl-doc-client">{client.name}<span>御中</span></div>
            <p>下記のとおり、御請求申し上げます。</p>
            <div className="kl-doc-total">
              <span>御請求金額</span>
              <b>{yen(total)}</b>
              <span>（税込）</span>
            </div>
            {company.regNo && <div className="kl-doc-reg">登録番号：{company.regNo}</div>}
          </div>
          <div className="kl-doc-from">
            <b>{company.name}</b>
            <p>〒{company.zip}<br />{company.address}<br />TEL&FAX　{company.tel}</p>
            <div className="kl-doc-bank">
              <b>【振込先】</b>
              <p>{company.bankName}　{company.bankBranch}<br />{company.bankType}口座　{company.bankNumber}<br />口座名義　{company.bankHolder}</p>
            </div>
            <p className="kl-doc-invno">請求書番号：{invNo}<br />発行日：{fmtDateJP(todayISO())}</p>
          </div>
        </div>

        <table className="kl-doc-sumtable">
          <thead>
            <tr><th>税抜御請求額</th><th>消費税額（{company.taxRate}％）</th><th>税込合計額</th><th>高速立替額（非課税）</th></tr>
          </thead>
          <tbody>
            <tr><td>{yen(sub)}</td><td>{yen(tax)}</td><td>{yen(sub + tax)}</td><td>{yen(tollSum)}</td></tr>
          </tbody>
        </table>

        <h2 className="kl-doc-h2">御請求明細書</h2>
        <table className="kl-doc-table">
          <thead>
            <tr><th>年月日</th><th>現場名・品名</th><th className="ta-r">数量</th><th>単位</th><th className="ta-r">単価</th><th className="ta-r">金額</th><th>車番</th></tr>
          </thead>
          <tbody>
            {normal.map((r) => (
              <tr key={r.id}>
                <td>{r.date.replaceAll("-", "/")}</td>
                <td>{r.site || ""}</td>
                <td className="ta-r">{num(r.qty)}</td>
                <td>{r.unit}</td>
                <td className="ta-r">{num(r.unitPrice)}</td>
                <td className="ta-r">{num(r.amount)}</td>
                <td>{r.vehicle || ""}</td>
              </tr>
            ))}
            <tr className="kl-doc-subrow">
              <td colSpan={5}>合計（税抜）</td>
              <td className="ta-r">{num(sub)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {toll.length > 0 && (
          <>
            <h2 className="kl-doc-h2">高速立替明細（非課税）</h2>
            <table className="kl-doc-table">
              <thead><tr><th>年月日</th><th>現場名・品名</th><th className="ta-r">金額</th></tr></thead>
              <tbody>
                {toll.map((r) => (
                  <tr key={r.id}><td>{r.date.replaceAll("-", "/")}</td><td>{r.site || "高速代"}</td><td className="ta-r">{num(r.amount)}</td></tr>
                ))}
                <tr className="kl-doc-subrow"><td colSpan={2}>高速立替合計（非課税）</td><td className="ta-r">{num(tollSum)}</td></tr>
              </tbody>
            </table>
          </>
        )}

        {company.invoiceNote && <p className="kl-doc-note">※ {company.invoiceNote}</p>}
        {!company.regNo && <p className="kl-doc-note">※ 適格請求書発行事業者登録番号は申請中です。</p>}
      </div>
    </div>
  );
}

/* ============================================================
   設定
   ============================================================ */
function SettingsView({ company, setCompany, clients, setClients, employees, setEmployees, vehicles, setVehicles, records, setRecords, showToast }) {
  const setC = (k) => (e) => setCompany({ ...company, [k]: e.target.value });
  const importRef = useRef(null);

  const exportData = () => {
    const data = { app: "kline-v3", exported: new Date().toISOString(), company, clients, employees, vehicles, records };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kline-backup-${todayISO()}.json`;
    a.click();
    showToast("バックアップを保存しました");
  };
  const importData = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (d.app !== "kline-v3") throw new Error();
        if (!window.confirm(`バックアップ（${(d.records || []).length}件の記録）を読み込みますか？\n現在のデータは上書きされます。`)) return;
        if (d.company) setCompany(d.company);
        if (d.clients) setClients(d.clients);
        if (d.employees) setEmployees(d.employees);
        if (d.vehicles) setVehicles(d.vehicles);
        if (d.records) setRecords(d.records);
        showToast("読み込みました ✓");
      } catch { window.alert("バックアップファイルを読み込めませんでした。"); }
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  const wipeAll = () => {
    if (!window.confirm("全データを削除しますか？この操作は取り消せません。")) return;
    if (!window.confirm("本当に削除しますか？（先にバックアップ保存を推奨）")) return;
    setRecords([]);
    showToast("記録を全削除しました");
  };

  return (
    <div className="kl-page">
      <header className="kl-header"><h1>設定</h1></header>

      <SettingCard icon={<Building2 size={17} />} title="自社情報（請求書に印字）">
        <div className="kl-form">
          <Field label="会社名"><input value={company.name} onChange={setC("name")} /></Field>
          <Field label="代表者"><input value={company.rep} onChange={setC("rep")} /></Field>
          <div className="kl-row2">
            <Field label="郵便番号"><input value={company.zip} onChange={setC("zip")} inputMode="numeric" /></Field>
            <Field label="電話・FAX"><input value={company.tel} onChange={setC("tel")} inputMode="tel" /></Field>
          </div>
          <Field label="住所"><input value={company.address} onChange={setC("address")} /></Field>
          <Field label="インボイス登録番号（取得後に入力）">
            <input value={company.regNo} onChange={setC("regNo")} placeholder="T0000000000000（申請中は空欄）" />
          </Field>
          <div className="kl-row2">
            <Field label="銀行名"><input value={company.bankName} onChange={setC("bankName")} /></Field>
            <Field label="支店名"><input value={company.bankBranch} onChange={setC("bankBranch")} /></Field>
          </div>
          <div className="kl-row2">
            <Field label="口座種別・番号"><input value={company.bankNumber} onChange={setC("bankNumber")} inputMode="numeric" /></Field>
            <Field label="口座名義"><input value={company.bankHolder} onChange={setC("bankHolder")} /></Field>
          </div>
          <div className="kl-row2">
            <Field label="消費税率（%）"><input value={company.taxRate} onChange={setC("taxRate")} inputMode="numeric" /></Field>
          </div>
          <Field label="請求書の備考"><input value={company.invoiceNote} onChange={setC("invoiceNote")} /></Field>
          <p className="kl-note">入力内容は自動保存されます。</p>
        </div>
      </SettingCard>

      <SettingCard icon={<Receipt size={17} />} title={`取引先（${clients.length}社）`}>
        <ClientList clients={clients} setClients={setClients} />
      </SettingCard>

      <SettingCard icon={<Users size={17} />} title={`従業員（${employees.length}名）`}>
        <PersonList
          items={employees} setItems={setEmployees}
          fields={[{ key: "name", ph: "氏名" }, { key: "role", ph: "役割（ドライバー等）" }]}
        />
      </SettingCard>

      <SettingCard icon={<Truck size={17} />} title={`車両（${vehicles.length}台）`}>
        <PersonList
          items={vehicles} setItems={setVehicles}
          fields={[{ key: "number", ph: "車番（例：9003）" }, { key: "name", ph: "名称（例：10tダンプ）" }]}
        />
      </SettingCard>

      <SettingCard icon={<FileText size={17} />} title="データ管理">
        <div className="kl-datacount">
          <div><b>{records.length}</b><span>記録</span></div>
          <div><b>{records.filter((r) => r.photo).length}</b><span>写真</span></div>
          <div><b>{clients.length}</b><span>取引先</span></div>
        </div>
        <div className="kl-databtns">
          <button onClick={exportData}><Download size={16} /> バックアップ保存</button>
          <button onClick={() => importRef.current?.click()}><Upload size={16} /> 読み込み</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={importData} />
        </div>
        <p className="kl-note">データはこの端末のブラウザ内に保存されます。機種変更前に必ずバックアップ保存を。ホーム画面に追加するとアプリのように使えます（共有 → ホーム画面に追加）。</p>
        <button className="kl-wipe" onClick={wipeAll}><Trash2 size={15} /> 記録を全削除</button>
      </SettingCard>
    </div>
  );
}

function SettingCard({ icon, title, children }) {
  return (
    <section className="kl-setcard">
      <div className="kl-setcard-head">{icon}<h2>{title}</h2></div>
      {children}
    </section>
  );
}

/* 取引先リスト（締め日つき） */
function ClientList({ clients, setClients }) {
  const [name, setName] = useState("");
  const [closing, setClosing] = useState("末");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    setClients([...clients, { id: uid(), name: n, short: n.replace(/株式会社|有限会社|\(株\)|㈱|\(有\)/g, "").trim() || n, closing }]);
    setName("");
  };
  const setClosingOf = (id, c) => setClients(clients.map((x) => (x.id === id ? { ...x, closing: c } : x)));
  const del = (id) => { if (window.confirm("この取引先を削除しますか？（過去の記録は残ります）")) setClients(clients.filter((x) => x.id !== id)); };

  return (
    <div>
      {clients.map((c) => (
        <div key={c.id} className="kl-listrow">
          <div className="kl-listrow-main">
            <b>{c.name}</b>
          </div>
          <div className="kl-closing">
            <button className={c.closing === "20" ? "is-on" : ""} onClick={() => setClosingOf(c.id, "20")}>20日締</button>
            <button className={c.closing === "末" ? "is-on" : ""} onClick={() => setClosingOf(c.id, "末")}>末締</button>
          </div>
          <button className="kl-rowdel" onClick={() => del(c.id)}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="kl-addrow">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="取引先名を追加" />
        <div className="kl-closing">
          <button className={closing === "20" ? "is-on" : ""} onClick={() => setClosing("20")}>20日</button>
          <button className={closing === "末" ? "is-on" : ""} onClick={() => setClosing("末")}>末</button>
        </div>
        <button className="kl-rowadd" onClick={add}><Plus size={17} /></button>
      </div>
    </div>
  );
}

/* 従業員・車両 共通リスト */
function PersonList({ items, setItems, fields }) {
  const [draft, setDraft] = useState({});
  const add = () => {
    const main = (draft[fields[0].key] || "").trim();
    if (!main) return;
    setItems([...items, { id: uid(), ...fields.reduce((o, f) => ({ ...o, [f.key]: (draft[f.key] || "").trim() }), {}) }]);
    setDraft({});
  };
  const del = (id) => { if (window.confirm("削除しますか？")) setItems(items.filter((x) => x.id !== id)); };
  return (
    <div>
      {items.map((it) => (
        <div key={it.id} className="kl-listrow">
          <div className="kl-listrow-main">
            <b>{it[fields[0].key]}</b>
            {fields[1] && it[fields[1].key] && <span>{it[fields[1].key]}</span>}
          </div>
          <button className="kl-rowdel" onClick={() => del(it.id)}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="kl-addrow">
        {fields.map((f) => (
          <input key={f.key} value={draft[f.key] || ""} placeholder={f.ph}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
        ))}
        <button className="kl-rowadd" onClick={add}><Plus size={17} /></button>
      </div>
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */
function GlobalStyle() {
  return (
    <style>{`
:root{
  --bg:#F5F3EE; --card:#FFFFFF; --ink:#17181A; --ink2:#4C5058; --muted:#8A8F98;
  --line:#E4E1D8; --accent:#B03A2A; --accent-soft:#F9E9E5; --green:#1E7F4F;
  --shadow:0 1px 3px rgba(25,20,10,.07);
}
*{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
html,body{ margin:0; padding:0; }
body{ background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;
  font-size:15px; line-height:1.55; }
button{ font-family:inherit; }
.kl-root{ min-height:100dvh; }
.app-ui{ max-width:480px; margin:0 auto; }
.kl-main{ padding:0 16px calc(96px + env(safe-area-inset-bottom)); }
.kl-page{ padding-top:14px; }

/* header */
.kl-header{ display:flex; align-items:flex-end; justify-content:space-between; margin:6px 0 14px; }
.kl-header h1{ font-size:22px; font-weight:800; margin:0; letter-spacing:.01em; }
.kl-brand{ display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--accent); margin-bottom:2px; }
.kl-header-nav{ align-items:center; }
.kl-monthnav{ display:flex; align-items:center; gap:2px; background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); }
.kl-monthnav b{ font-size:15px; min-width:96px; text-align:center; font-variant-numeric:tabular-nums; }
.kl-monthnav button{ width:42px; height:42px; border:none; background:none; color:var(--ink2); display:grid; place-items:center; cursor:pointer; }

/* stats */
.kl-statgrid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.kl-stat{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 14px; box-shadow:var(--shadow); }
.kl-stat span{ font-size:11.5px; color:var(--muted); font-weight:700; }
.kl-stat b{ display:block; font-size:21px; font-weight:800; margin-top:2px; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
.kl-stat small{ font-size:11.5px; color:var(--ink2); }

.kl-bigadd{ width:100%; margin:14px 0 4px; min-height:56px; border:none; border-radius:14px;
  background:var(--accent); color:#fff; font-size:16.5px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px;
  box-shadow:0 4px 14px rgba(176,58,42,.32); cursor:pointer; }
.kl-bigadd:active{ transform:scale(.985); }

/* sections */
.kl-section{ margin-top:20px; }
.kl-sechead{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px; }
.kl-sechead h2{ font-size:14px; font-weight:800; color:var(--ink2); margin:0; }
.kl-secsum{ font-size:13px; font-weight:800; color:var(--ink); font-variant-numeric:tabular-nums; }
.kl-cards{ display:flex; flex-direction:column; gap:8px; }
.kl-empty{ background:var(--card); border:1.5px dashed var(--line); border-radius:14px; padding:26px 16px; text-align:center; color:var(--muted); font-size:13.5px; line-height:1.7; }
.kl-empty-add{ display:inline-flex; align-items:center; gap:5px; margin-top:10px; border:none; background:var(--accent-soft); color:var(--accent); font-weight:800; font-size:13.5px; padding:9px 16px; border-radius:10px; cursor:pointer; }

/* record card */
.kl-rec{ width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center; gap:10px;
  background:var(--card); border:1px solid var(--line); border-radius:13px; padding:12px 14px; box-shadow:var(--shadow); cursor:pointer; }
.kl-rec:active{ background:#FCFAF5; }
.kl-rec-l{ min-width:0; display:flex; flex-direction:column; gap:2px; }
.kl-rec-l > b{ font-size:15px; font-weight:800; }
.kl-rec-site{ font-size:13px; color:var(--ink2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kl-rec-meta{ display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
.kl-rec-meta em{ font-style:normal; font-size:11.5px; color:var(--muted); font-weight:700; }
.kl-tag{ background:var(--bg); border-radius:6px; padding:1px 6px; }
.kl-tag-toll{ background:#EDF4FF; color:#2B5CAB; border-radius:6px; padding:1px 6px; }
.kl-rec-r{ text-align:right; flex:0 0 auto; }
.kl-rec-r b{ font-size:16px; font-weight:800; font-variant-numeric:tabular-nums; }
.kl-rec-photo{ color:var(--muted); margin-top:3px; }
@keyframes flash{ 0%{background:#FFF3D6; box-shadow:0 0 0 3px #F4C445;} 100%{background:var(--card); box-shadow:var(--shadow);} }
.kl-rec.is-flash{ animation:flash 2.2s ease forwards; }

/* month summary */
.kl-monthsum{ display:flex; justify-content:space-around; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 8px; box-shadow:var(--shadow); text-align:center; }
.kl-monthsum span{ display:block; font-size:11px; color:var(--muted); font-weight:700; }
.kl-monthsum b{ font-size:18px; font-weight:800; font-variant-numeric:tabular-nums; }

/* nav */
.kl-nav{ position:fixed; bottom:0; left:0; right:0; max-width:480px; margin:0 auto; height:66px;
  background:rgba(255,255,255,.97); backdrop-filter:blur(10px); border-top:1px solid var(--line);
  display:flex; align-items:center; justify-content:space-around; padding-bottom:env(safe-area-inset-bottom); z-index:30; }
.kl-navbtn{ flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; background:none; border:none; color:var(--muted); font-size:10.5px; font-weight:700; cursor:pointer; padding:6px 0; }
.kl-navbtn.is-active{ color:var(--accent); }
.kl-fab{ width:58px; height:58px; border-radius:50%; background:var(--accent); color:#fff; border:none; display:grid; place-items:center; cursor:pointer; margin-top:-26px; box-shadow:0 6px 16px rgba(176,58,42,.4); flex:0 0 auto; }
.kl-fab:active{ transform:scale(.94); }

/* link button */
.kl-linkbtn{ width:100%; margin-top:22px; min-height:50px; border:1.5px solid var(--line); background:var(--card); border-radius:13px; font-size:15px; font-weight:800; color:var(--ink); display:flex; align-items:center; justify-content:center; gap:7px; cursor:pointer; box-shadow:var(--shadow); }

/* form sheet */
.kl-sheet{ position:fixed; inset:0; z-index:50; background:var(--bg); max-width:480px; margin:0 auto; display:flex; flex-direction:column; animation:up .22s ease; }
@keyframes up{ from{transform:translateY(30px); opacity:0;} to{transform:none; opacity:1;} }
.kl-sheet-head{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px 8px; }
.kl-sheet-head h2{ font-size:17px; font-weight:800; margin:0; }
.kl-iconbtn{ width:40px; height:40px; border:none; background:var(--card); border-radius:12px; display:grid; place-items:center; color:var(--ink2); cursor:pointer; border:1px solid var(--line); }
.kl-iconbtn.kl-danger{ color:#C0392B; }
.kl-sheet-body{ flex:1; overflow-y:auto; padding:6px 16px 24px; }
.kl-sheet-foot{ padding:10px 16px calc(14px + env(safe-area-inset-bottom)); background:linear-gradient(to top, var(--bg) 70%, transparent); }
.kl-save{ width:100%; min-height:56px; border:none; border-radius:14px; background:var(--green); color:#fff; font-size:16.5px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; box-shadow:0 4px 14px rgba(30,127,79,.3); }
.kl-save:disabled{ background:#C7CCD1; box-shadow:none; }

.kl-typetab{ display:flex; background:#EBE8E0; border-radius:12px; padding:4px; margin-bottom:14px; }
.kl-typetab button{ flex:1; min-height:42px; border:none; border-radius:9px; background:none; font-size:14px; font-weight:800; color:var(--ink2); cursor:pointer; }
.kl-typetab button.is-on{ background:#fff; color:var(--ink); box-shadow:var(--shadow); }

.kl-field{ display:block; margin-bottom:14px; }
.kl-label{ display:block; font-size:12px; font-weight:800; color:var(--ink2); margin-bottom:6px; }
.kl-field input[type=text], .kl-field input[type=date], .kl-field input:not([type]){
  width:100%; min-height:48px; border:1.5px solid var(--line); border-radius:12px; background:var(--card);
  padding:10px 14px; font-size:16px; font-weight:600; color:var(--ink); outline:none; }
.kl-field input:focus{ border-color:var(--accent); }
.kl-row2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }

.kl-chips{ display:flex; flex-wrap:wrap; gap:7px; }
.kl-chips-sub{ margin-top:8px; }
.kl-chip{ min-height:42px; padding:8px 14px; border-radius:11px; border:1.5px solid var(--line); background:var(--card); font-size:14px; font-weight:700; color:var(--ink); cursor:pointer; }
.kl-chip.is-on{ border-color:var(--accent); background:var(--accent-soft); color:var(--accent); }
.kl-chip-s{ min-height:36px; padding:6px 11px; font-size:12.5px; color:var(--ink2); }

.kl-stepper{ display:flex; align-items:stretch; border:1.5px solid var(--line); border-radius:12px; background:var(--card); overflow:hidden; }
.kl-stepper button{ width:48px; border:none; background:var(--bg); font-size:22px; font-weight:700; color:var(--ink2); cursor:pointer; }
.kl-stepper input{ flex:1; width:100%; min-width:0; border:none; text-align:center; font-size:18px; font-weight:800; outline:none; padding:10px 4px; font-variant-numeric:tabular-nums; }

.kl-amount{ display:flex; align-items:center; justify-content:space-between; background:#fff; border:1.5px solid var(--line); border-left:4px solid var(--accent); border-radius:12px; padding:12px 16px; margin-bottom:14px; }
.kl-amount span{ font-size:12.5px; font-weight:800; color:var(--ink2); }
.kl-amount b{ font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; }

.kl-photoup{ width:100%; aspect-ratio:16/9; border:1.5px dashed var(--line); border-radius:12px; background:var(--card); display:grid; place-items:center; gap:4px; color:var(--muted); cursor:pointer; font-size:13px; font-weight:700; overflow:hidden; padding:0; }
.kl-photoup img{ width:100%; height:100%; object-fit:cover; }
.kl-photodel{ margin-top:8px; display:inline-flex; align-items:center; gap:5px; border:none; background:none; color:#C0392B; font-size:13px; font-weight:700; cursor:pointer; }

/* invoice list */
.kl-note{ font-size:12.5px; color:var(--muted); line-height:1.7; margin:2px 0 14px; }
.kl-invcard{ width:100%; display:flex; justify-content:space-between; align-items:center; gap:10px; text-align:left;
  background:var(--card); border:1px solid var(--line); border-radius:13px; padding:14px 15px; box-shadow:var(--shadow); cursor:pointer; }
.kl-invcard.is-dim{ opacity:.55; cursor:default; }
.kl-invcard-l b{ display:block; font-size:15px; font-weight:800; }
.kl-invcard-l span{ font-size:12px; color:var(--muted); font-weight:600; }
.kl-invcard-r{ text-align:right; }
.kl-invcard-r b{ display:block; font-size:17px; font-weight:800; font-variant-numeric:tabular-nums; }
.kl-invcard-r span{ font-size:10.5px; color:var(--muted); font-weight:700; }
.kl-details summary{ font-size:13px; font-weight:700; color:var(--muted); margin:16px 0 10px; cursor:pointer; }

/* settings */
.kl-setcard{ background:var(--card); border:1px solid var(--line); border-radius:15px; padding:16px; box-shadow:var(--shadow); margin-bottom:14px; }
.kl-setcard-head{ display:flex; align-items:center; gap:7px; margin-bottom:12px; color:var(--accent); }
.kl-setcard-head h2{ font-size:15px; font-weight:800; margin:0; color:var(--ink); }
.kl-form .kl-field{ margin-bottom:11px; }
.kl-listrow{ display:flex; align-items:center; gap:8px; padding:10px 2px; border-bottom:1px solid var(--line); }
.kl-listrow:last-of-type{ border-bottom:none; }
.kl-listrow-main{ flex:1; min-width:0; }
.kl-listrow-main b{ font-size:14.5px; font-weight:700; display:block; }
.kl-listrow-main span{ font-size:12px; color:var(--muted); }
.kl-closing{ display:flex; gap:4px; flex:0 0 auto; }
.kl-closing button{ min-height:34px; padding:4px 9px; font-size:11.5px; font-weight:800; border-radius:8px; border:1.5px solid var(--line); background:var(--card); color:var(--muted); cursor:pointer; }
.kl-closing button.is-on{ border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
.kl-rowdel{ width:36px; height:36px; border:none; background:var(--bg); border-radius:9px; color:var(--muted); display:grid; place-items:center; cursor:pointer; flex:0 0 auto; }
.kl-addrow{ display:flex; gap:7px; margin-top:12px; }
.kl-addrow input{ flex:1; min-width:0; min-height:44px; border:1.5px solid var(--line); border-radius:11px; padding:8px 12px; font-size:16px; font-weight:600; outline:none; background:#FCFBF8; }
.kl-addrow input:focus{ border-color:var(--accent); }
.kl-rowadd{ width:46px; min-height:44px; border:none; border-radius:11px; background:var(--accent); color:#fff; display:grid; place-items:center; cursor:pointer; flex:0 0 auto; }
.kl-datacount{ display:flex; justify-content:space-around; text-align:center; margin-bottom:12px; }
.kl-datacount b{ display:block; font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; }
.kl-datacount span{ font-size:11px; color:var(--muted); font-weight:700; }
.kl-databtns{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.kl-databtns button{ min-height:46px; border:1.5px solid var(--line); background:var(--bg); border-radius:11px; font-size:13.5px; font-weight:800; color:var(--ink); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; }
.kl-wipe{ margin-top:12px; width:100%; min-height:42px; border:none; background:none; color:#C0392B; font-size:13px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:5px; cursor:pointer; }

/* toast */
.kl-toast{ position:fixed; bottom:calc(92px + env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%);
  background:var(--ink); color:#fff; padding:12px 22px; border-radius:24px; font-size:14px; font-weight:800; z-index:80;
  box-shadow:0 8px 24px rgba(0,0,0,.28); animation:pop .2s ease; white-space:nowrap; }
@keyframes pop{ from{opacity:0; transform:translate(-50%,8px);} to{opacity:1; transform:translate(-50%,0);} }

/* ============ 請求書 ============ */
.kl-invoverlay{ position:fixed; inset:0; z-index:100; background:#6B6E75; overflow-y:auto; padding:0 0 40px; }
.kl-invtools{ position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(38,40,44,.94); backdrop-filter:blur(8px); }
.kl-invtools b{ flex:1; color:#fff; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.kl-printbtn{ display:flex; align-items:center; gap:6px; min-height:42px; padding:8px 16px; border:none; border-radius:11px; background:var(--accent); color:#fff; font-size:14px; font-weight:800; cursor:pointer; }

.kl-doc{ background:#fff; color:#111; max-width:760px; margin:14px auto; padding:34px 30px 40px; box-shadow:0 8px 30px rgba(0,0,0,.3);
  font-family:"Hiragino Mincho ProN","Yu Mincho",serif; font-size:13px; line-height:1.6; }
.kl-doc-closing{ text-align:right; font-size:12px; font-weight:700; }
.kl-doc-title{ text-align:center; font-size:26px; letter-spacing:.35em; margin:4px 0 18px; font-weight:700; }
.kl-doc-head{ display:flex; justify-content:space-between; gap:20px; flex-wrap:wrap; }
.kl-doc-to{ flex:1 1 300px; }
.kl-doc-client{ font-size:19px; font-weight:700; border-bottom:2px solid #111; padding-bottom:4px; display:inline-block; min-width:70%; }
.kl-doc-client span{ font-size:14px; margin-left:10px; }
.kl-doc-to p{ margin:10px 0 6px; font-size:12.5px; }
.kl-doc-total{ display:flex; align-items:baseline; gap:10px; border:2px solid #111; padding:10px 16px; margin-top:6px; }
.kl-doc-total b{ font-size:24px; font-variant-numeric:tabular-nums; }
.kl-doc-total span{ font-size:12px; font-weight:700; }
.kl-doc-reg{ margin-top:8px; font-size:12px; }
.kl-doc-from{ flex:0 1 250px; font-size:12px; }
.kl-doc-from > b{ font-size:15px; }
.kl-doc-from p{ margin:5px 0; }
.kl-doc-bank{ border:1px solid #999; padding:8px 10px; margin-top:8px; }
.kl-doc-bank b{ font-size:11.5px; }
.kl-doc-bank p{ margin:3px 0 0; }
.kl-doc-invno{ color:#444; font-size:11px; }
.kl-doc-sumtable{ width:100%; border-collapse:collapse; margin:18px 0 6px; }
.kl-doc-sumtable th, .kl-doc-sumtable td{ border:1px solid #111; padding:7px 10px; text-align:center; }
.kl-doc-sumtable th{ background:#F1EEE6; font-size:11.5px; }
.kl-doc-sumtable td{ font-size:14.5px; font-weight:700; font-variant-numeric:tabular-nums; }
.kl-doc-h2{ font-size:14px; margin:20px 0 8px; letter-spacing:.15em; }
.kl-doc-table{ width:100%; border-collapse:collapse; }
.kl-doc-table th, .kl-doc-table td{ border:1px solid #333; padding:5px 8px; font-size:11.5px; }
.kl-doc-table th{ background:#F1EEE6; font-weight:700; text-align:center; }
.kl-doc-table .ta-r{ text-align:right; font-variant-numeric:tabular-nums; }
.kl-doc-subrow td{ font-weight:700; background:#FAF8F2; }
.kl-doc-note{ font-size:11px; color:#333; margin-top:14px; }

/* print */
@page{ size:A4; margin:12mm; }
@media print{
  body{ background:#fff !important; }
  .app-ui, .no-print{ display:none !important; }
  .kl-invoverlay{ position:static !important; background:#fff !important; overflow:visible !important; padding:0 !important; }
  .kl-doc{ box-shadow:none !important; margin:0 !important; max-width:none !important; padding:0 !important; }
}
    `}</style>
  );
}
