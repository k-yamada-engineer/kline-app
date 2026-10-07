import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "fs";

/* テスト内の「今日」を 2026-07-14 に固定する（6月実績データ前提の検証が、実行日によって壊れないように）。
   経過時間は実時間で進めるので setTimeout 等はそのまま動く */
{
  const FIXED = Date.parse("2026-07-14T03:00:00Z");
  const RealDate = Date;
  const START = RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED + (RealDate.now() - START)); else super(...a); }
    static now() { return FIXED + (RealDate.now() - START); }
  };
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://example.com/kline-app/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const w = dom.window;
for (const k of ["window","document","navigator","localStorage","HTMLElement","Element","Node","CustomEvent","Event","MutationObserver","fetch","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","Image","FileReader","confirm","alert","prompt"]) {
  try { globalThis[k] = k in w ? w[k] : undefined; } catch {}
}
globalThis.window = w;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
w.HTMLElement.prototype.scrollIntoView = function () {}; // jsdom未実装のポリフィル（実ブラウザは対応済み）
w.prompt = globalThis.prompt = () => "1234";
w.confirm = globalThis.confirm = () => true;
w.alert = globalThis.alert = (m) => console.log("ALERT:", m);

const asset = readdirSync("docs/assets").find(f => f.endsWith(".js"));
console.log("bundle:", asset);
await import("./docs/assets/" + asset);
await new Promise(r => setTimeout(r, 500));

const text = w.document.body.textContent;
console.log("--- initial screen contains 役割選択?:", text.includes("この端末を使う人を選んでください"));
console.log("--- 管理者ボタン?:", text.includes("管理者として使う"));
console.log("--- 従業員名表示?:", text.includes("山田 善正"));

// 管理者としてログイン
const adminBtn = [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("管理者として使う"));
adminBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
const t2 = w.document.body.textContent;
console.log("--- 管理者ホーム表示?:", t2.includes("の日報"), "/ 先月カード?:", t2.includes("先月"), "/ 6月データ?:", t2.includes("先月（2026年6月）"));

// 日報タブ → 6月に移動して件数確認
const seedCount = JSON.parse(w.localStorage.getItem("kline4:records")).length;
console.log("--- localStorage records:", seedCount);

// 設定タブ
const navBtns = [...w.document.querySelectorAll(".kl-navbtn")];
navBtns.find(b => b.textContent.includes("設定")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const t3 = w.document.body.textContent;
console.log("--- 設定: 取引先13社?:", t3.includes("取引先（13社）"), "/ 権限カード?:", t3.includes("権限・PIN"), "/ 従業員5名?:", t3.includes("従業員（5名）"));

// 請求書タブ → 前月へ → オクノ税抜額
navBtns.find(b => b.textContent.includes("請求書")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const prevArrow = w.document.querySelector('.kl-monthnav button[aria-label="前月"]');
prevArrow.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const t4 = w.document.body.textContent;
console.log("--- 請求書6月: オクノ¥6,690,775?:", t4.includes("6,690,775"), "/ M.S¥1,676,864?:", t4.includes("1,676,864"));
console.log("--- CSVボタン表示?:", t4.includes("月次データをCSVでエクスポート"));

// CSVエクスポートの中身を検証（bundleが参照するグローバルBlob/URLをフック）
let capturedCsv = null;
const OrigBlob = globalThis.Blob;
globalThis.Blob = class extends OrigBlob {
  constructor(parts, opts) { super(parts, opts); capturedCsv = parts[0]; }
};
const origCreateObjectURL = globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL = () => "blob:mock";
const origAClick = w.HTMLAnchorElement.prototype.click;
w.HTMLAnchorElement.prototype.click = function () {}; // jsdomのnavigationエラーを避ける
const csvBtn = [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("CSVでエクスポート"));
csvBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
console.log("--- CSV生成された?:", !!capturedCsv, "/ BOM付き?:", capturedCsv && capturedCsv.charCodeAt(0) === 0xFEFF);
console.log("--- CSVヘッダ正しい?:", capturedCsv && capturedCsv.includes("日付,取引先,現場名・品名,数量,単位,単価,金額,車番,運転手,区分,メモ"));
console.log("--- CSVにオクノ行あり?:", capturedCsv && capturedCsv.includes("オクノナマコン"));
globalThis.Blob = OrigBlob; globalThis.URL.createObjectURL = origCreateObjectURL; w.HTMLAnchorElement.prototype.click = origAClick;

// 日報タブ → グループ切替（ダンプ別／運転手別／取引先別）を検証
navBtns.find(b => b.textContent.includes("日報")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const prevArrow2 = w.document.querySelector('.kl-monthnav button[aria-label="前月"]');
prevArrow2.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
console.log("--- 日報タブ: グループボタン4種表示?:", ["日別", "ダンプ別", "運転手別", "取引先別"].every(l => w.document.body.textContent.includes(l)));

const clickTab = (label) => {
  const btn = [...w.document.querySelectorAll(".kl-grouptabs button")].find(b => b.textContent === label);
  btn.dispatchEvent(new w.Event("click", { bubbles: true }));
};
clickTab("ダンプ別");
await new Promise(r => setTimeout(r, 300));
console.log("--- ダンプ別: 車番9003見出しあり?:", w.document.body.textContent.includes("車番 9003"));

clickTab("運転手別");
await new Promise(r => setTimeout(r, 300));
console.log("--- 運転手別: 未設定グループの見出しあり?:", w.document.body.textContent.includes("運転手未設定")); // seedデータは運転手未入力のため

clickTab("取引先別");
await new Promise(r => setTimeout(r, 300));
console.log("--- 取引先別: オクノ見出しあり?:", w.document.body.textContent.includes("株式会社オクノナマコン"));

clickTab("日別");
await new Promise(r => setTimeout(r, 300));
console.log("--- 日別に戻せた?:", w.document.body.textContent.includes("6/") || w.document.body.textContent.includes("5/"));

// 実際に運転手を選んで記録を1件保存し、運転手別グルーピング＋アバター表示を検証
const fabBtn = w.document.querySelector(".kl-fab");
fabBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const clientChip = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.includes("オクノ"));
clientChip.dispatchEvent(new w.Event("click", { bubbles: true }));
const driverChip = [...w.document.querySelectorAll(".kl-chip-driver")].find(b => b.textContent.includes("善正"));
console.log("--- フォームの運転手チップにアバター(kl-avatar)あり?:", w.document.querySelectorAll(".kl-chip-driver .kl-avatar").length > 0);
driverChip.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
const saveBtn = [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("保存する"));
saveBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
console.log("--- 保存後 日報カードに運転手名(善正)表示?:", w.document.body.textContent.includes("山田 善正"));
console.log("--- 保存後 カードにアバター(kl-avatar)描画?:", w.document.querySelectorAll(".kl-rec-avatar .kl-avatar").length > 0);

clickTab("運転手別");
await new Promise(r => setTimeout(r, 300));
console.log("--- 運転手別: 山田善正の見出しグループが出た?:", w.document.body.textContent.includes("山田 善正"));
console.log("--- 運転手別: グループ見出しにアバターあり?:", w.document.querySelectorAll(".kl-sechead .kl-avatar").length > 0);

// 複数現場まとめ登録のテスト（同じ日・車・運転手で3現場を1回のフォームで保存）
const beforeCount = w.localStorage.getItem("kline4:records") ? JSON.parse(w.localStorage.getItem("kline4:records")).length : 0;
w.document.querySelector(".kl-fab").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const clientChip2 = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.includes("千石"));
clientChip2.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- 新規フォーム: 初期状態で「現場を追加」ボタンあり?:", [...w.document.querySelectorAll("button")].some(b => b.textContent.includes("現場を追加")));
const addSiteBtn = () => [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("現場を追加"));
addSiteBtn().dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
addSiteBtn().dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- 3行(現場1/2/3)描画された?:", w.document.body.textContent.includes("現場 1") && w.document.body.textContent.includes("現場 2") && w.document.body.textContent.includes("現場 3"));

const siteRows = [...w.document.querySelectorAll(".kl-siterow")];
console.log("--- kl-siterow要素が3個ある?:", siteRows.length === 3);
const fillRow = (rowEl, siteName, price) => {
  const siteInput = rowEl.querySelector('input[type="text"]');
  const setNative = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  setNative.call(siteInput, siteName);
  siteInput.dispatchEvent(new w.Event("input", { bubbles: true }));
  const priceInput = [...rowEl.querySelectorAll('input[inputmode="numeric"]')][0];
  setNative.call(priceInput, String(price));
  priceInput.dispatchEvent(new w.Event("input", { bubbles: true }));
};
fillRow(siteRows[0], "現場A", "10000");
fillRow(siteRows[1], "現場B", "20000");
fillRow(siteRows[2], "現場C", "30000");
await new Promise(r => setTimeout(r, 150));
const tAmt = w.document.body.textContent;
console.log("--- 合計金額表示(3件・¥60,000)?:", tAmt.includes("合計金額") && tAmt.includes("3件") && tAmt.includes("60,000"));

const saveBtn2 = [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("保存する"));
console.log("--- 保存ボタンに3件表記あり?:", saveBtn2.textContent.includes("3件"));
saveBtn2.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
console.log("--- トースト「保存しました（3件）」表示?:", w.document.body.textContent.includes("保存しました（3件）"));
const afterRecords = JSON.parse(w.localStorage.getItem("kline4:records"));
console.log("--- レコード件数が+3?:", afterRecords.length === beforeCount + 3);
const savedSites = afterRecords.filter(r => ["現場A", "現場B", "現場C"].includes(r.site));
console.log("--- 現場A/B/Cが別々のIDで3件保存?:", savedSites.length === 3 && new Set(savedSites.map(r => r.id)).size === 3);
console.log("--- 3件とも金額が正しい(10000/20000/30000)?:", savedSites.every(r => [10000, 20000, 30000].includes(r.amount)));
console.log("--- 3件とも取引先=千石?:", savedSites.every(r => r.client.includes("千石")));

// 編集モードでは複数現場追加ボタンが出ないことを確認
const editTarget = savedSites[0];
const editCard = [...w.document.querySelectorAll(".kl-rec")].find(b => b.textContent.includes("現場A"));
if (editCard) {
  editCard.dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  console.log("--- 編集モードでは「現場を追加」ボタンが非表示?:", ![...w.document.querySelectorAll("button")].some(b => b.textContent.includes("現場を追加")));
  const closeBtn = w.document.querySelector(".kl-sheet-head .kl-iconbtn");
  closeBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
} else {
  console.log("--- 編集モード確認: 現場Aカードが見つからずスキップ");
}

// 単位管理（設定画面）: "t" を新規追加できるか
navBtns.find(b => b.textContent.includes("設定")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
console.log("--- 設定に単位カードあり(t込み6種)?:", w.document.body.textContent.includes("単位（6種）"));
const setNativeVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
const unitInputs = [...w.document.querySelectorAll(".kl-addrow input")];
const unitInput = unitInputs.find(i => i.placeholder && i.placeholder.includes("単位を追加"));
setNativeVal.call(unitInput, "回");
unitInput.dispatchEvent(new w.Event("input", { bubbles: true }));
const unitAddBtn = unitInput.closest(".kl-addrow").querySelector(".kl-rowadd");
unitAddBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
console.log("--- 単位「回」が追加され7種になった?:", w.document.body.textContent.includes("単位（7種）"));
console.log("--- localStorageのunitsに\"回\"が入った?:", JSON.parse(w.localStorage.getItem("kline4:units") || "[]").includes("回"));

// 新規記録フォームで単位「t」を選択→そのまま掛け算(kgの/1000変換なし)になることを検証
w.document.querySelector(".kl-fab").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const clientChip3 = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.includes("オクノ"));
clientChip3.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const tUnitBtn = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.trim() === "t");
console.log("--- フォームの単位チップに\"t\"が表示?:", !!tUnitBtn);
tUnitBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const qtyInput = [...w.document.querySelectorAll('input[inputmode="decimal"]')][0];
setNativeVal.call(qtyInput, "10");
qtyInput.dispatchEvent(new w.Event("input", { bubbles: true }));
const priceInputT = [...w.document.querySelectorAll('input[inputmode="numeric"]')].find(i => i.placeholder === "例）3550");
setNativeVal.call(priceInputT, "5000");
priceInputT.dispatchEvent(new w.Event("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- 単位t: 10×5000円=¥50,000(kgのような/1000変換なし)?:", w.document.body.textContent.includes("50,000"));
// v3.16: 小数が出る掛け算は全単位で切り捨て（23.61×3260=76,968.6→76,968）
setNativeVal.call(qtyInput, "23.61");
qtyInput.dispatchEvent(new w.Event("input", { bubbles: true }));
setNativeVal.call(priceInputT, "3260");
priceInputT.dispatchEvent(new w.Event("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- 切り捨て: 23.61t×3260円=¥76,968?:", w.document.body.textContent.includes("76,968") && !w.document.body.textContent.includes("76,969"));
// フォームを閉じる（保存せず破棄）
const closeBtn2 = w.document.querySelector(".kl-sheet-head .kl-iconbtn");
closeBtn2.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 200));

// 請求書プレビュー: SP幅ではカード表示・PC幅では表表示に切り替わることを検証
navBtns.find(b => b.textContent.includes("請求書")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const prevArrow3 = w.document.querySelector('.kl-monthnav button[aria-label="前月"]');
prevArrow3.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const okunoInvBtn = [...w.document.querySelectorAll(".kl-invcard")].find(b => b.textContent.includes("オクノ"));
okunoInvBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
console.log("--- 請求書プレビュー: 表のみでカードDOMなし?:",
  !!w.document.querySelector(".kl-doc-table") && !w.document.querySelector(".kl-doc-cards"));
const cols = [...w.document.querySelectorAll(".kl-doc-table colgroup col")].map(c => c.style.width);
console.log("--- colgroup配分(年月日15%/現場名36%/車番8%)?:", cols[0] === "15%" && cols[1] === "36%" && cols[6] === "8%");
console.log("--- 明細の数量が㎏表記のまま(15,680等)?:", /15,680|15,770|16,330/.test(w.document.querySelector(".kl-doc-table").textContent));
console.log("--- ㎏レコードが㎏のまま多数残存(オクノ128運行等)?:", JSON.parse(w.localStorage.getItem("kline4:records")).filter(r => r.unit === "㎏").length >= 120);

// ㎏の計算がさっきまでの正確な式（㎏×トン単価÷1000）に戻っていることを検証
w.document.querySelector(".kl-fab").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const clientChipKg = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.includes("M.S"));
clientChipKg.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const kgBtn = [...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.trim() === "㎏");
kgBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const setNV = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
const qtyKg = [...w.document.querySelectorAll('input[inputmode="decimal"]')][0];
setNV.call(qtyKg, "23500"); qtyKg.dispatchEvent(new w.Event("input", { bubbles: true }));
const priceKg = [...w.document.querySelectorAll('input[inputmode="numeric"]')].find(i => i.placeholder === "例）3550");
setNV.call(priceKg, "3260"); priceKg.dispatchEvent(new w.Event("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- ㎏計算復活: 23,500㎏×3,260円=¥76,610?:", w.document.body.textContent.includes("76,610") && !w.document.body.textContent.includes("76,610,000"));
w.document.querySelector(".kl-sheet-head .kl-iconbtn").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 200));

// --- v3.15: 運搬＋高速立替の同時保存／編集時の種別固定 ---
const beforeMix = JSON.parse(w.localStorage.getItem("kline4:records")).length;
const preOverflowBody = w.document.body.style.overflow, preOverflowHtml = w.document.documentElement.style.overflow;
w.document.querySelector(".kl-fab").dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
[...w.document.querySelectorAll(".kl-chip")].find(b => b.textContent.includes("拓建材")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const qtyMix = [...w.document.querySelectorAll('input[inputmode="decimal"]')][0];
setNV.call(qtyMix, "2"); qtyMix.dispatchEvent(new w.Event("input", { bubbles: true }));
const priceMix = [...w.document.querySelectorAll('input[inputmode="numeric"]')].find(i => i.placeholder === "例）3550");
setNV.call(priceMix, "15000"); priceMix.dispatchEvent(new w.Event("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
[...w.document.querySelectorAll(".kl-typetab button")].find(b => b.textContent.includes("高速立替")).dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
const tollInput = [...w.document.querySelectorAll('input[inputmode="numeric"]')].find(i => i.placeholder === "例）2020");
setNV.call(tollInput, "2020"); tollInput.dispatchEvent(new w.Event("input", { bubbles: true }));
await new Promise(r => setTimeout(r, 150));
console.log("--- 同時保存の案内表示?:", w.document.body.textContent.includes("も一緒に保存されます"));
console.log("--- 合計が運搬+高速(¥32,020)?:", w.document.body.textContent.includes("32,020"));
const saveMix = [...w.document.querySelectorAll("button")].find(b => b.textContent.includes("保存する"));
console.log("--- 保存ボタンが2件表記?:", saveMix.textContent.includes("2件"));
saveMix.dispatchEvent(new w.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
const afterMix = JSON.parse(w.localStorage.getItem("kline4:records"));
console.log("--- 運搬+高速で+2件保存?:", afterMix.length === beforeMix + 2);
const mixToll = afterMix.find(r => r.type === "toll" && r.amount === 2020 && (r.client || "").includes("拓建材"));
const mixNorm = afterMix.find(r => r.type === "normal" && r.amount === 30000 && (r.client || "").includes("拓建材"));
console.log("--- 高速2,020円がtollで保存?:", !!mixToll, "/ 運搬30,000円がnormalで保存?:", !!mixNorm);
console.log("--- 運搬とtollのIDが別?:", !!(mixToll && mixNorm && mixToll.id !== mixNorm.id));

// 編集で開くと種別タブが固定されている（運搬⇄高速の変換＝上書き事故ができない）
const tollCard = [...w.document.querySelectorAll(".kl-rec")].find(b => b.textContent.includes("高速立替") && b.textContent.includes("2,020"));
if (tollCard) {
  tollCard.dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const tabBtns = [...w.document.querySelectorAll(".kl-typetab button")];
  console.log("--- 編集時タブ1個のみ?:", tabBtns.length === 1, "/ 種別固定ラベル表示?:", !!tabBtns[0] && tabBtns[0].textContent.includes("高速立替（非課税）の編集"));
  w.document.querySelector(".kl-sheet-head .kl-iconbtn").dispatchEvent(new w.Event("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
} else {
  console.log("--- 編集タブ固定テスト: tollカード見つからずスキップ（要確認）");
}

// モーダルを閉じた後にbodyスクロールが開閉前の状態に戻っていること（v3.15スクロール修正）
console.log("--- body overflow復元?:", w.document.body.style.overflow === preOverflowBody && w.document.documentElement.style.overflow === preOverflowHtml);

// --- v3.19-20: 口座タブ（freee連携の入出金・仕訳/備考・月累計・請求書の紐づけ） ---
{
  const sv = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  const svSel = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, "value").set;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // テスト用の「6月分オクノの請求額」をアプリと同じ式で計算（締め日に応じた期間・税10%切り捨て・高速立替込み）
  const lsClients = JSON.parse(w.localStorage.getItem("kline4:clients"));
  const lsRecords = JSON.parse(w.localStorage.getItem("kline4:records"));
  const okuno = lsClients.find((c) => c.name.includes("オクノ"));
  const ym = "2026-06";
  const d = parseInt(okuno.closing, 10);
  const period = (okuno.closing !== "末" && d >= 1 && d <= 28)
    ? { from: `2026-05-${String(d + 1).padStart(2, "0")}`, to: `2026-06-${String(d).padStart(2, "0")}` }
    : { from: "2026-06-01", to: "2026-06-30" };
  let sub = 0, toll = 0;
  for (const r of lsRecords) if (r.client === okuno.name && r.date >= period.from && r.date <= period.to) { if (r.type === "toll") toll += Number(r.amount) || 0; else sub += Number(r.amount) || 0; }
  const okunoTotal = sub + Math.floor(sub * 10 / 100) + toll;
  const okunoRef = `${okuno.id}:${ym}`;

  const bankCalls = [];
  const serverRefs = {}; // 紐づけ状態（サーバーを模擬）
  const ledgerTxns = [
    { id: 900, txn_date: "2026-07-25", amount: okunoTotal, entry_side: "income", walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", description: "ﾌﾘｺﾐ ｶ)ｵｸﾉﾅﾏｺﾝ", balance: 9000000, journal: null, memo: null, invoice_ref: null },
    { id: 901, txn_date: "2026-07-10", amount: 1122000, entry_side: "income", walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", description: "ﾌﾘｺﾐ ﾃｽﾄｼｮｳｼﾞ", balance: 3456789, journal: null, memo: null, invoice_ref: null },
    { id: 902, txn_date: "2026-07-06", amount: 33000, entry_side: "expense", walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", description: "ENEOS 高槻 1006", balance: 2334789, journal: null, memo: null, invoice_ref: null },
    { id: 903, txn_date: "2026-07-03", amount: 21000, entry_side: "expense", walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", description: "ENEOS 高槻 1003", balance: 2367789, journal: null, memo: null, invoice_ref: null },
    { id: 904, txn_date: "2026-07-02", amount: 500000, entry_side: "income", walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", description: "ﾐﾅﾄｷﾞﾝｺｳ ｶﾗ", balance: 2388789, journal: "資金移動", memo: null, invoice_ref: null },
  ];
  const ledger = () => ({
    ok: true, from: "2026-07-01", to: "2026-07-31",
    accounts: [{ walletable_id: 5, walletable_name: "GMOあおぞらネット銀行", walletable_type: "bank_account", latest_balance: 3456789, latest_date: "2026-07-25", txn_count: 201, last_synced_at: "2026-07-14T02:05:00Z" }],
    txns: ledgerTxns.map((t) => ({ ...t, invoice_ref: serverRefs[t.id] ?? t.invoice_ref })),
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/functions/v1/freee-sync/")) {
      bankCalls.push({ u, init });
      if (init.headers?.["x-app-key"] !== "goodkey1234abcd0") return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
      if (u.includes("/ledger")) return new Response(JSON.stringify(ledger()), { status: 200 });
      if (u.includes("/links")) return new Response(JSON.stringify({ ok: true, links: ledgerTxns.filter((t) => serverRefs[t.id]).map((t) => ({ ...t, invoice_ref: serverRefs[t.id] })) }), { status: 200 });
      if (u.includes("/annotate")) {
        const b = JSON.parse(init.body);
        if ("invoice_ref" in b) { if (b.invoice_ref) serverRefs[b.id] = b.invoice_ref; else delete serverRefs[b.id]; }
        return new Response(JSON.stringify({ ok: true, txn: { id: b.id, ...("journal" in b ? { journal: b.journal || null } : {}), ...("memo" in b ? { memo: b.memo || null } : {}), ...("invoice_ref" in b ? { invoice_ref: b.invoice_ref || null } : {}) } }), { status: 200 });
      }
      if (u.includes("/refresh")) return new Response(JSON.stringify({ ok: true, fetched: 98 }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const nav = (label) => [...w.document.querySelectorAll(".kl-navbtn")].find((b) => b.textContent.includes(label)).dispatchEvent(new w.Event("click", { bubbles: true }));
  const btn = (text) => [...w.document.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  // 表示月を2026年7月に合わせる（前のテストで6月に移動しているため）
  nav("口座"); await wait(300);
  for (let i = 0; i < 6 && !w.document.querySelector(".kl-monthnav b").textContent.includes("2026年7月"); i++) {
    const cur = w.document.querySelector(".kl-monthnav b").textContent;
    w.document.querySelector(`.kl-monthnav button[aria-label="${cur < "2026年7月" ? "翌月" : "前月"}"]`).dispatchEvent(new w.Event("click", { bubbles: true }));
    await wait(120);
  }
  console.log("--- 口座タブ: パスワード入力画面?:", w.document.body.textContent.includes("口座データの表示パスワード"));
  const fab = w.document.querySelector(".kl-fab"); const sides = w.document.querySelectorAll(".kl-nav-side");
  console.log("--- ナビ: 左右グループ2つで＋ボタンが中央?:", sides.length === 2 && fab.previousElementSibling === sides[0] && fab.nextElementSibling === sides[1]);
  let pw = w.document.querySelector('.kl-setcard input[type="password"]');
  sv.call(pw, "wrongwrongwrong1"); pw.dispatchEvent(new w.Event("input", { bubbles: true }));
  btn("口座を表示する").dispatchEvent(new w.Event("click", { bubbles: true })); await wait(300);
  console.log("--- 誤パスワード: エラー表示＆端末に記憶しない?:", w.document.body.textContent.includes("パスワードが違います") && !JSON.parse(w.localStorage.getItem("kline4:bankKey") || '""'));
  pw = w.document.querySelector('.kl-setcard input[type="password"]');
  sv.call(pw, "goodkey1234abcd0"); pw.dispatchEvent(new w.Event("input", { bubbles: true }));
  btn("口座を表示する").dispatchEvent(new w.Event("click", { bubbles: true })); await wait(400);
  let tx = w.document.body.textContent;
  console.log("--- 正パスワード: 端末に記憶?:", JSON.parse(w.localStorage.getItem("kline4:bankKey")) === "goodkey1234abcd0");
  console.log("--- 口座カード(銀行名・残高¥3,456,789)?:", tx.includes("GMOあおぞらネット銀行") && tx.includes("3,456,789"));
  console.log("--- 明細5件表示?:", w.document.querySelectorAll(".kl-btx").length === 5);
  console.log("--- 差引カードは廃止?:", !tx.includes("差引"));
  const incTotal = okunoTotal + 1122000; // 資金移動の50万は除外
  console.log("--- 入金 月累計＝¥" + incTotal.toLocaleString() + "（資金移動を除外・2件）?:", tx.includes("入金 月累計") && tx.includes(incTotal.toLocaleString()) && tx.includes("2件"));
  console.log("--- 出金¥54,000?:", tx.includes("54,000"));
  const dayHeads = [...w.document.querySelectorAll(".kl-day")].map((e) => e.textContent);
  console.log("--- 日付ヘッダーに月累計（7/10時点¥1,122,000・7/25時点¥" + incTotal.toLocaleString() + "）?:",
    dayHeads.some((h) => h.includes("月累計 ¥1,122,000")) && dayHeads.some((h) => h.includes("月累計 ¥" + incTotal.toLocaleString())));
  console.log("--- 未入力件数はチップに表示（4件＝資金移動以外）?:", btn("仕訳が未入力のみ").textContent.includes("（4）"));

  // 請求書との紐づけ：オクノ入金に「名義・金額一致」の候補
  const okRow = () => [...w.document.querySelectorAll(".kl-btx")].find((r) => r.textContent.includes("ｵｸﾉﾅﾏｺﾝ") || r.textContent.includes("オクノナマコン"));
  const cand = okRow().querySelector(".kl-inv-cand");
  console.log("--- 半角カナ名義の入金に『オクノ 6月分・名義・金額一致』の候補?:", !!cand && cand.textContent.includes("6月分") && cand.textContent.includes("名義・金額一致"), "| 請求額:", okunoTotal.toLocaleString());
  const testRow = [...w.document.querySelectorAll(".kl-btx")].find((r) => r.textContent.includes("ﾃｽﾄｼｮｳｼﾞ"));
  console.log("--- 無関係な入金には候補なし・手動選択は出る?:", !testRow.querySelector(".kl-inv-cand") && !!testRow.querySelector(".kl-inv-select"));
  const outRow = [...w.document.querySelectorAll(".kl-btx")].find((r) => r.textContent.includes("ENEOS 高槻 1006"));
  console.log("--- 出金行には請求書欄なし?:", !outRow.querySelector(".kl-btx-inv"));
  cand.dispatchEvent(new w.Event("click", { bubbles: true })); await wait(300);
  const linkCall = bankCalls.filter((c) => c.u.includes("/annotate")).pop();
  const lb = linkCall ? JSON.parse(linkCall.init.body) : {};
  console.log("--- 紐づけ: POST {id:900, invoice_ref, 仕訳=売掛金回収（空欄だったので自動）}?:", lb.id === 900 && lb.invoice_ref === okunoRef && lb.journal === "売掛金回収");
  console.log("--- 紐づけ後『オクノ 6月分の請求・✓ 全額入金』表示?:", okRow().textContent.includes("6月分の請求") && okRow().textContent.includes("全額入金"));

  // 手動で仕訳・備考を入れても紐づけは消えない（部分更新）
  const [jIn, mIn] = okRow().querySelectorAll("input");
  sv.call(mIn, "6月分入金"); mIn.dispatchEvent(new w.Event("input", { bubbles: true }));
  mIn.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true })); await wait(300);
  const memoCall = bankCalls.filter((c) => c.u.includes("/annotate")).pop();
  const mb = JSON.parse(memoCall.init.body);
  console.log("--- 備考保存は invoice_ref を送らない（紐づけを壊さない）?:", mb.memo === "6月分入金" && !("invoice_ref" in mb) && okRow().textContent.includes("全額入金"));

  // ENEOSの仕訳→同じ相手先に候補
  const row = [...w.document.querySelectorAll(".kl-btx")].find((r) => r.textContent.includes("ENEOS 高槻 1006"));
  const [eJ] = row.querySelectorAll("input");
  sv.call(eJ, "燃料費"); eJ.dispatchEvent(new w.Event("input", { bubbles: true }));
  eJ.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true })); await wait(300);
  const row3 = [...w.document.querySelectorAll(".kl-btx")].find((r) => r.textContent.includes("ENEOS 高槻 1003"));
  console.log("--- 仕訳保存→同じ相手先(数字違い)に『候補: 燃料費』?:", row3.textContent.includes("候補: 燃料費"));

  // 今すぐ更新
  btn("今すぐ更新").dispatchEvent(new w.Event("click", { bubbles: true })); await wait(400);
  console.log("--- 今すぐ更新: POST /refresh→トースト?:", bankCalls.some((c) => c.u.includes("/refresh") && c.init.method === "POST") && w.document.body.textContent.includes("freeeから更新しました"));

  // 請求書タブ：6月のオクノに入金状況
  nav("請求書"); await wait(300);
  for (let i = 0; i < 3 && !w.document.querySelector(".kl-monthnav b").textContent.includes("2026年6月"); i++) {
    w.document.querySelector('.kl-monthnav button[aria-label="前月"]').dispatchEvent(new w.Event("click", { bubbles: true })); await wait(150);
  }
  await wait(300);
  const okCard = [...w.document.querySelectorAll(".kl-invcard")].find((b) => b.textContent.includes("オクノ"));
  console.log("--- 請求書タブ: 6月オクノに『✓ 全額入金・7/25』?:", !!okCard && okCard.textContent.includes("全額入金") && okCard.textContent.includes("7/25"));
  const otherCard = [...w.document.querySelectorAll(".kl-invcard")].find((b) => !b.textContent.includes("オクノ") && !b.classList.contains("is-dim"));
  console.log("--- 請求書タブ: 紐づけのない請求は『未入金』?:", !!otherCard && otherCard.textContent.includes("未入金"));
  console.log("--- 請求書カードに請求額（税込＋高速）表示?:", !!okCard && okCard.textContent.includes("請求 ¥" + okunoTotal.toLocaleString()));

  globalThis.fetch = origFetch;
  nav("ホーム"); await wait(200);
}

// 従業員モードテスト: モードリセット→従業員選択
w.localStorage.removeItem("kline4:mode");
console.log("--- done");

// --- 従業員モード検証（リロード相当: 再マウントの代わりにモード選択から進む）
const w2 = w;
// モード選択画面に戻る（設定→モード選択に戻すを直接localStorage+リロードで再現できないため、ボタン経由で確認済みの管理者画面から実行）
const settingsBtn = [...w2.document.querySelectorAll(".kl-navbtn")].find(b => b.textContent.includes("設定"));
settingsBtn.dispatchEvent(new w2.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const resetBtn = [...w2.document.querySelectorAll("button")].find(b => b.textContent.includes("モード選択に戻す"));
resetBtn.dispatchEvent(new w2.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
console.log("--- モード選択に戻った?:", w2.document.body.textContent.includes("この端末を使う人を選んでください"));
const zenBtn = [...w2.document.querySelectorAll(".kl-role-btn")].find(b => b.textContent.includes("山田 善正"));
zenBtn.dispatchEvent(new w2.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
const tw = w2.document.body.textContent;
console.log("--- 従業員ホーム?:", tw.includes("今日のあなたの記録"), "/ 請求書タブ非表示?:", !tw.includes("請求書を作成する") && ![...w2.document.querySelectorAll(".kl-navbtn")].length);
console.log("--- 売上金額非表示?:", !tw.includes("今月の売上"));
// 記録追加フォームを開いて運転手が固定されているか
const addBtn = [...w2.document.querySelectorAll("button")].find(b => b.textContent.includes("運搬を記録する"));
addBtn.dispatchEvent(new w2.Event("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
const tf = w2.document.body.textContent;
console.log("--- フォーム開いた?:", tf.includes("保存する"), "/ 運転手固定?:", tf.includes("山田 善正"));
console.log("--- ALL DONE");

console.log("EXIT");process.exit(0);
