import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "fs";

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
