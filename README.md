# TOEIC BOOST — 多益衝刺站

免費、無框架、無外部依賴的多益（TOEIC Listening & Reading）教學網站。
原生 HTML / CSS / JavaScript，部署在 Cloudflare Workers（靜態資產）。

## 內容

- **150 個職場高頻單字**（六大分類：辦公室行政、財務會計、人事招募、業務行銷、生產製造、旅遊出差），附 IPA、原創例句、中文翻譯。
- **52 題原創練習題**：Part 2 應答 8 題、Part 3 對話 6 題、Part 4 短講 6 題、Part 5 句子填空 18 題、Part 6 段落填空 6 題、Part 7 閱讀 8 題。
- 每題都有繁體中文解析與考點提示；聽力題用瀏覽器內建語音朗讀，可重播。
- 今日課表（五格）、單字卡熟練度分級、Part 分項正確率、5 分鐘 10 題計時模考與弱點分析。
- 學習進度存在瀏覽器 `localStorage`，不上傳、不需登入。

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

## 檔案結構

```
public/
  index.html            版面
  assets/style.css      設計樣式（高對比印刷風）
  assets/app.js         單字卡 / 練習 / 模考 / 進度邏輯
  data/vocab.json       單字庫
  data/drills_*.json    題庫
wrangler.jsonc          Cloudflare Workers 設定
```

## 授權

教學內容為原創；單字題材參考多益常見商務情境，非官方試題。
