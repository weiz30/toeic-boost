# -*- coding: utf-8 -*-
"""用 Gemini（免費額度）產生 100 天 × 20 字的「多益 100 天 2000 單字」課程內容。

每天一次 API 呼叫，輸出 build/days/dayNNN.json；可中斷續跑（已存在就跳過）。
最後由 assemble.py 併成 public/data/curriculum.json。
"""
import json, os, sys, time, urllib.request, urllib.error, random

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(ROOT, "days")
USED = os.path.join(ROOT, "used_words.json")
LOG = os.path.join(ROOT, "curriculum.log")
os.makedirs(OUTDIR, exist_ok=True)

MODELS = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash-lite"]

def load_keys():
    keys = []
    for env in ("HERMES_GEMINI_KEYS", "GEMINI_API_KEYS"):
        v = os.environ.get(env)
        if v:
            keys += [k.strip() for k in v.replace(";", ",").split(",") if k.strip()]
    kf = r"C:/Users/SuperSpyer/toeic/gemini_keys.txt"
    if os.path.exists(kf):
        for line in open(kf, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#"):
                keys.append(line)
    return list(dict.fromkeys(keys))

KEYS = load_keys()

def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

# ---------------------------------------------------------------- 100 天主題
BASIC = ["職場日常與辦公室", "公司組織與部門", "會議與討論", "排程、期限與進度", "電話與訊息往來",
         "辦公設備與用品", "招募與徵才", "面試與履歷", "薪資與福利", "請假、出勤與加班",
         "財務基礎", "發票、收據與付款", "報帳與費用", "銀行往來", "採購與下單",
         "庫存與盤點", "出貨與物流", "客戶服務", "客訴與售後", "產品介紹與規格",
         "訂單與交期", "出差安排", "機場與通關", "飯店與住宿", "餐廳與餐飲",
         "交通與通勤", "團隊協作", "教育訓練", "簡報與報告", "商務書信"]
MID = ["合約與條款", "談判與協商", "行銷活動", "廣告與媒體採購", "市場調查",
       "品牌與定位", "業務開發", "通路與經銷", "定價與促銷", "財務報表",
       "預算編列", "成本控制", "投資與理財", "保險", "租賃與房地產",
       "製造與生產線", "品質管理", "工安與規範", "環境與永續", "資訊科技",
       "資料分析", "專案管理", "風險管理", "法規與遵循", "專利與商標",
       "併購與合作", "供應鏈管理", "人力資源進階", "績效考核", "職涯與升遷"]
HIGH = ["高頻抽象名詞", "研究與學術", "醫療與健康", "公共政策", "媒體與傳播",
        "文化與藝術", "運動與休閒", "觀光與旅遊業", "航空與運輸業", "會展與活動",
        "教育制度", "社會議題", "心理與行為", "環境科學", "能源與資源",
        "農業與食品", "建築與工程", "汽車與機械", "電子商務", "金融科技",
        "通訊與網路", "法律與訴訟", "國際貿易", "談判讓步與讓價", "資訊安全",
        "人工智慧與自動化", "都市與空間", "人力流動與離職", "危機與應變", "企業社會責任"]
PHRASE = ["高頻動詞片語（一）", "高頻動詞片語（二）", "高頻介系詞片語", "商務慣用語（一）",
          "商務慣用語（二）", "電話與會議慣用語", "談判與讓步慣用語", "財務與數字慣用語",
          "綜合複習：最高頻 20 字", "綜合複習：易混淆字 20 組"]

DAYS = []
for i, t in enumerate(BASIC, 1):
    DAYS.append(dict(day=i, theme=t, level="基礎 600–750", kind="word"))
for i, t in enumerate(MID, 31):
    DAYS.append(dict(day=i, theme=t, level="進階 750–850", kind="word"))
for i, t in enumerate(HIGH, 61):
    DAYS.append(dict(day=i, theme=t, level="高分 850–900", kind="word"))
for i, t in enumerate(PHRASE, 91):
    DAYS.append(dict(day=i, theme=t, level="片語與總複習", kind="phrase"))
assert len(DAYS) == 100, len(DAYS)

SCHEMA = """[
 {"word": "schedule", "ph": "/ˈskedʒuːl/", "pos": "n. 行程表 | v. 安排", "zh": "行程表；安排",
  "colloc": "on schedule 準時 | behind schedule 落後",
  "distinct": "timetable 時刻表（交通）| agenda 會議議程",
  "ex": [["English sentence.", "繁體中文翻譯。"], ["...", "..."], ["...", "..."]]}
]"""

def prompt_for(d):
    used = load_used()
    recent = used[-260:]
    kind_rule = ("每個項目都是**片語或慣用語**（2–4 個字），不要單字。" if d["kind"] == "phrase"
                 else "每個項目都是**單字**（可含連字號複合字），不要整句片語。")
    return f"""你是 TOEIC 多益教學內容編輯，服務繁體中文母語的台灣學習者。
現在要建立「多益 100 天、每天 20 個單字」課程的第 {d['day']} 天。

主題：{d['theme']}
難度：{d['level']}
{kind_rule}

請產生 21 個符合這個主題的項目（我會挑前 20 個），全部是新項目，不可與下面已用過的項目重複：
{", ".join(recent) if recent else "（尚無）"}

輸出格式：只要 JSON 陣列，不要任何說明或 markdown 圍籬。每個元素：
{SCHEMA}

嚴格規則：
1. ex 必須剛好 3 組，每組是 [英文例句, 繁體中文翻譯]；例句要在 6–14 個英文字、商務或該主題情境、自然口語，不要每句都用相同開頭。
2. ph 是國際音標（前後加斜線）；多音節字要標重音。
3. pos 是「詞性縮寫 + 繁體中文意思」，多個詞性用 | 分隔，例如 "n. 發票 | v. 開立發票"。
4. zh 是精簡中文意思，多義用；分隔，最多 3 個義項。
5. colloc 給 2 個常見搭配（英文 + 中文）；distinct 給 2 個易混淆字辨析（沒有就寫同性質的近義比較）。
6. 全部使用繁體中文（台灣用語），不得出現簡體字。
7. 不要輸出重複的項目，也不要用過於簡單的國中基本字（如 apple、happy、big）。"""

def load_used():
    if os.path.exists(USED):
        try:
            return json.load(open(USED, encoding="utf-8"))
        except Exception:
            return []
    return []

def call_gemini(prompt, timeout=240):
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json",
                                 "temperature": 0.9, "maxOutputTokens": 4096,
                                 "thinkingConfig": {"thinkingBudget": 0}}}
    last = None
    for attempt in range(6):
        model = MODELS[attempt % len(MODELS)]
        key = KEYS[attempt % len(KEYS)]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
            txt = d["candidates"][0]["content"]["parts"][0]["text"].strip()
            if txt.startswith("```"):
                txt = txt.split("```")[1]
                txt = txt[txt.index("["):]
            return json.loads(txt)
        except urllib.error.HTTPError as e:
            code = e.code
            msg = e.read()[:160].decode("utf-8", "replace")
            last = f"HTTP {code} {model}: {msg}"
            log(f"  retry {attempt+1}: {last}")
            time.sleep(20 if code in (429, 500, 503) else 5)
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            log(f"  retry {attempt+1}: {last}")
            time.sleep(5)
    raise RuntimeError(last)

def valid(item, kind):
    need = {"word", "ph", "pos", "zh", "colloc", "distinct", "ex"}
    if not isinstance(item, dict) or not need.issubset(item):
        return False
    if not isinstance(item["ex"], list) or len(item["ex"]) < 2:
        return False
    if any(not (isinstance(p, (list, tuple)) and len(p) == 2 and p[0] and p[1]) for p in item["ex"]):
        return False
    if kind == "phrase" and " " not in item["word"]:
        return False
    if kind == "word" and len(item["word"].split()) > 2:
        return False
    return True

def main(only=None):
    for d in DAYS:
        n = d["day"]
        f = os.path.join(OUTDIR, f"day{n:03d}.json")
        if os.path.exists(f):
            continue
        if only and n not in only:
            continue
        t0 = time.time()
        try:
            items = call_gemini(prompt_for(d))
        except Exception as e:
            log(f"day{n:03d} FAILED: {e}")
            continue
        used = load_used()
        usedset = {w.lower() for w in used}
        picked, seen = [], set()
        for it in items:
            if not valid(it, d["kind"]):
                continue
            w = it["word"].strip()
            k = w.lower()
            if k in usedset or k in seen:
                continue
            seen.add(k)
            it["word"] = w
            picked.append(it)
            if len(picked) == 20:
                break
        if len(picked) < 20:
            log(f"day{n:03d} only {len(picked)} valid items — retrying once")
            try:
                items = call_gemini(prompt_for(d))
                for it in items:
                    if not valid(it, d["kind"]):
                        continue
                    w = it["word"].strip()
                    if w.lower() in usedset or w.lower() in seen:
                        continue
                    seen.add(w.lower()); it["word"] = w; picked.append(it)
                    if len(picked) == 20:
                        break
            except Exception as e:
                log(f"day{n:03d} second attempt failed: {e}")
        if len(picked) < 20:
            log(f"day{n:03d} SKIP incomplete ({len(picked)})")
            continue
        rec = dict(d, items=picked[:20], generated=time.strftime("%Y-%m-%d %H:%M"))
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False, indent=1)
        used.extend(it["word"] for it in rec["items"])
        json.dump(used, open(USED, "w", encoding="utf-8"), ensure_ascii=False)
        log(f"day{n:03d} ok  {len(rec['items'])} items  ({time.time()-t0:.0f}s)  {rec['theme']}")
    log("ALL DONE")

if __name__ == "__main__":
    only = None
    if len(sys.argv) > 1:
        only = {int(x) for x in sys.argv[1].split(",")}
        log(f"only={sorted(only)}")
    main(only)
