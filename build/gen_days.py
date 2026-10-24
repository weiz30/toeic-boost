# -*- coding: utf-8 -*-
"""產生 100 天 × 20 字課程內容（Gemini gemini-3.8-flash，平行 4 執行緒）。

輸出：build/days/dayNNN.json
第二階段：dedupe + top-up（補足不足 20 個項目的天數）
"""
import json, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(ROOT, "days")
LOG = os.path.join(ROOT, "gen_days.log")
MODELS = ["gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-3.5-flash-lite",
          "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.8-flash"]
WORKERS = 2
EXH = os.path.join(ROOT, "exhausted_models.json")
_lock = threading.Lock()


def load_exh():
    try:
        return set(json.load(open(EXH, encoding="utf-8")))
    except Exception:
        return set()


def save_exh(s):
    json.dump(sorted(s), open(EXH, "w", encoding="utf-8"))


EXHAUSTED = load_exh()
os.makedirs(OUTDIR, exist_ok=True)

KEYS = [l.strip() for l in open(r"C:/Users/SuperSpyer/toeic/gemini_keys.txt", encoding="utf-8")
        if l.strip() and not l.startswith("#")]

def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

sys.path.insert(0, ROOT)
from curriculum import DAYS  # 重用主題表

SCHEMA = """[{"word":"agenda","ph":"/əˈdʒendə/","pos":"n. 議程","zh":"議程",
 "colloc":"on the agenda 列入議程 | set an agenda 訂定議程",
 "distinct":"schedule 行程表 | timetable 時刻表",
 "ex":[["Let us review the agenda first.","我們先看議程。"],
       ["The topic is on the agenda.","這個議題列入議程。"],
       ["They set a clear agenda.","他們訂了明確的議程。"]]}]"""

def build_prompt(d, used, k=20):
    kind_rule = ("每個項目都是**片語或慣用語**（2–4 個字），不要單字。" if d["kind"] == "phrase"
                 else "每個項目都是**單字**（可含連字號複合字），不要整句。")
    return f"""你是 TOEIC 多益教學內容編輯，服務繁體中文母語的台灣學習者。
「多益 100 天、每天 20 個單字」課程，第 {d['day']} 天。

主題：{d['theme']}
難度：{d['level']}
{kind_rule}
產生 {k} 個符合主題的新項目，不可與下列已用過的項目重複（大小寫、單複數、動詞變化都算重複）：
{", ".join(used) if used else "（尚無）"}

只輸出 JSON 陣列，不要說明文字、不要 markdown 圍籬。元素格式：
{SCHEMA}

規則：
1. ex 剛好 3 組，每組 [英文例句, 繁體中文翻譯]；例句 6–14 個英文字，商務或主題情境，自然、不要每句同開頭。
2. ph 國際音標，前後加斜線，標重音。
3. pos「詞性 + 繁體中文意思」，多詞性用 | 分隔。
4. zh 精簡中文意思，多義用；分隔（最多 3 個）。
5. colloc 2 個常見搭配（英文 + 中文）；distinct 2 個易混淆字辨析。
6. 全部繁體中文（台灣用語），不得有簡體字；不要出現 apple、happy 這類國中基本字。"""

def call(prompt, timeout=180):
    """每個 Gemini 模型的免費額度是各自獨立的桶子；429 就把該模型標記為用完，換下一個。"""
    global EXHAUSTED
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9,
                                 "maxOutputTokens": 8192, "thinkingConfig": {"thinkingBudget": 0}}}
    last = None
    for attempt in range(len(MODELS) * 2):
        with _lock:
            avail = [m for m in MODELS if m not in EXHAUSTED]
        if not avail:
            raise RuntimeError("all model buckets exhausted: " + last)
        model = avail[attempt % len(avail)]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEYS[attempt % len(KEYS)]}"
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
            txt = d["candidates"][0]["content"]["parts"][0]["text"].strip()
            if txt.startswith("```"):
                txt = txt[txt.index("["):]
            arr = json.loads(txt)
            if not isinstance(arr, list) or len(arr) < 3:
                raise ValueError("too few items: %s" % len(arr if isinstance(arr, list) else -1))
            log(f"    model={model} items={len(arr)}")
            return arr
        except urllib.error.HTTPError as e:
            code = e.code
            last = f"HTTP {code} {model}"
            if code == 429:
                with _lock:
                    EXHAUSTED.add(model)
                    save_exh(EXHAUSTED)
                log(f"    429 quota out: {model} → 換模型")
            else:
                log(f"    {last}: {e.read()[:90].decode('utf-8', 'replace')}")
                time.sleep(6)
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:90]}"
            log(f"    {model} {last}")
            time.sleep(4)
    raise RuntimeError(last)

def valid(it, kind):
    if not isinstance(it, dict) or not {"word", "ph", "pos", "zh", "colloc", "distinct", "ex"} <= set(it):
        return False
    ex = it.get("ex")
    if not isinstance(ex, list) or len(ex) < 2:
        return False
    if any(not (isinstance(p, (list, tuple)) and len(p) == 2 and p[0] and p[1]) for p in ex):
        return False
    w = it["word"].strip()
    if not w or not w.replace("-", "").replace("'", "").replace(" ", "").isalpha():
        return False
    if kind == "phrase" and " " not in w:
        return False
    if kind == "word" and len(w.split()) > 2:
        return False
    return True

def used_words(exclude_day=None):
    out = []
    for f in sorted(os.listdir(OUTDIR)):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(OUTDIR, f), encoding="utf-8"))
        except Exception:
            continue
        if exclude_day and d.get("day") == exclude_day:
            continue
        out += [i["word"] for i in d.get("items", [])]
    return out

def gen_day(d):
    n = d["day"]
    f = os.path.join(OUTDIR, f"day{n:03d}.json")
    if os.path.exists(f):
        return f"day{n:03d} skip"
    t0 = time.time()
    items = call(build_prompt(d, used_words()))
    picked, seen = [], set()
    for it in items:
        if not valid(it, d["kind"]):
            continue
        k = it["word"].strip().lower()
        if k in seen:
            continue
        seen.add(k)
        it["word"] = it["word"].strip()
        picked.append(it)
        if len(picked) == 20:
            break
    if len(picked) < 20:
        return f"day{n:03d} INCOMPLETE {len(picked)}"
    rec = dict(d, items=picked, generated=time.strftime("%Y-%m-%d %H:%M"))
    json.dump(rec, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return f"day{n:03d} ok {len(picked)} ({time.time()-t0:.0f}s) {d['theme']}"

def phase1():
    todo = [d for d in DAYS if not os.path.exists(os.path.join(OUTDIR, f"day{d['day']:03d}.json"))]
    log(f"phase1 start: {len(todo)} days, workers={WORKERS}")
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(gen_day, d): d for d in todo}
        for fu in as_completed(futs):
            try:
                log(fu.result())
            except Exception as e:
                log(f"day{futs[fu]['day']:03d} ERROR {e}")

def phase2():
    """dedupe（保留先出現的）＋ 補足不足 20 個的天數"""
    global_seen, problems = {}, []
    for d in DAYS:
        n = d["day"]
        f = os.path.join(OUTDIR, f"day{n:03d}.json")
        if not os.path.exists(f):
            problems.append(n); continue
        rec = json.load(open(f, encoding="utf-8"))
        keep = []
        for it in rec["items"]:
            k = it["word"].strip().lower()
            if k in global_seen:
                continue
            global_seen[k] = n
            keep.append(it)
        rec["items"] = keep
        json.dump(rec, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if len(keep) < 20:
            problems.append(n)
    log(f"phase2: {len(problems)} days need top-up: {problems[:20]}")
    for n in problems:
        d = next(x for x in DAYS if x["day"] == n)
        f = os.path.join(OUTDIR, f"day{n:03d}.json")
        rec = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else dict(d, items=[])
        need = 20 - len(rec["items"])
        if need <= 0:
            continue
        used = used_words(exclude_day=n) + [i["word"] for i in rec["items"]]
        for attempt in range(3):
            try:
                items = call(build_prompt(d, used, k=need + 3))
            except Exception as e:
                log(f"topup day{n:03d} fail {e}"); continue
            have = {i["word"].strip().lower() for i in rec["items"]} | {u.lower() for u in used}
            for it in items:
                if not valid(it, d["kind"]):
                    continue
                k = it["word"].strip().lower()
                if k in have:
                    continue
                have.add(k); it["word"] = it["word"].strip(); rec["items"].append(it)
                if len(rec["items"]) == 20:
                    break
            if len(rec["items"]) == 20:
                break
        json.dump(rec, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        log(f"topup day{n:03d} → {len(rec['items'])}")

if __name__ == "__main__":
    phase1()
    phase2()
    total = 0
    bad = []
    for d in DAYS:
        f = os.path.join(OUTDIR, f"day{d['day']:03d}.json")
        if os.path.exists(f):
            n = len(json.load(open(f, encoding="utf-8"))["items"]); total += n
            if n != 20: bad.append((d["day"], n))
    log(f"ALL DONE total items {total}, days!=20: {bad}")
