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
