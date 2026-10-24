# TOEIC BOOST — 多益衝刺站

免費、無框架、無外部依賴的多益（TOEIC Listening & Reading）教學網站。
原生 HTML / CSS / JavaScript，部署在 Cloudflare Workers（靜態資產）。

## 內容

- **2000 個多益單字／片語，100 天 × 每天 20 個**：字表來自 `E:\單字` 的 249 個教材 mp3（Hackers TOEIC Vocabulary），用本機 faster-whisper 轉出 20.5 小時逐字稿後抽出 2,266 個項目，去重並依教材層級排序（basic → score basic → 800/900），前 1,280 個單字排第 1–64 天、720 個片語排第 65–100 天。
- **每個字都有**：IPA（片語留空）、詞性中文、3 組中英對照例句、2 個常見搭配、2 個易混淆辨析。
- 聽力題用瀏覽器內建語音朗讀，可重播。
- 今日 20 字、單字卡熟練度、100 天地圖、遺忘曲線複習（1/2/4/7/15/30 天）、Part 2–7 練習 52 題、5 分鐘計時模考。
- 學習進度存在瀏覽器 `localStorage`，不上傳、不需登入；舊版（150 字字卡）進度會自動遷移進複習排程。

## 線上網址

**https://toeic-boost.weiz30.workers.dev**

Repo：https://github.com/weiz30/toeic-boost

## 本機預覽

```bash
cd sites/toeic-boost
python -m http.server 8787 --directory public
# 開啟 http://localhost:8787
```

（一定要用 http server，直接雙擊 index.html 會因為 `fetch()` 讀不到 JSON 而空白。）

## 部署到 Cloudflare Workers

```bash
npx wrangler login          # 只需一次
npx wrangler deploy         # 讀 wrangler.jsonc，把 public/ 當靜態資產上傳
```

Worker 名稱是 `toeic-boost`，帳號 ID `2259832f71636dfcfad4aa9a1d61979d`（weiz30@gmail.com）。

## 自動部署（push 就上線）

Cloudflare 後台 → Workers & Pages → `toeic-boost` → Settings → Builds → Connect，
選這個 GitHub repo，設定：

- Build command：留空（沒有建置步驟）
- Deploy command：`npx wrangler deploy`
- Root directory：`/`

之後每次 push 到 `main` 就會自動重新部署。

## 帳號與雲端進度

- 免費註冊（帳號 3–20 字、密碼 ≥ 6 字元），登入後進度（單字熟練度、遺忘曲線排程、已完成天數、各 Part 正確率、模考紀錄、錯題本）會同步到 Cloudflare D1。
- 未登入也能用：資料留在瀏覽器 `localStorage`；登入時會和雲端合併（取較高熟練度、較早到期日），不會覆蓋掉既有進度。
- 密碼用 PBKDF2-SHA256（100,000 次迭代 + 隨機 salt）儲存，登入後發 30 天 session token。
- **錯題本**：按「不熟」或複習時選「忘記了」會自動記錄，越常錯排越前面；練對會遞減。
- **留言板**：登入後可留言，管理員可回覆。
- **管理介面**（`admin` / `admin1234`）：學習者總數、7 日活躍、平均已學字數、留言待回覆、全站最常錯的單字、學習者列表（已學／完成天數／錯題／正確率／最後上線）。

> 上線前請把 `admin` 的預設密碼改掉：目前沒有改密碼的 UI，可改 `migrations/0002_admin.sql` 的雜湊後重新執行，或做一頁「修改密碼」。API：`worker/index.js`。

## 檔案結構

```
public/
  index.html            版面
  assets/style.css      設計樣式（高對比印刷風）
  assets/app.js         單字卡 / 練習 / 模考 / 複習 / 帳號 / 錯題本 / 留言板
  data/curriculum.json  100 天 × 20 字課程資料
  data/drills_*.json    Part 2–7 題庫
worker/index.js         API：註冊登入、進度同步、留言、管理
migrations/             D1 資料表與 admin 種子
wrangler.jsonc          Workers + D1 + 靜態資產設定
```

## 授權

教學內容為原創；單字題材參考多益常見商務情境，非官方試題。
