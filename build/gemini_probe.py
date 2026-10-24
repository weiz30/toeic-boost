# -*- coding: utf-8 -*-
"""測試 Gemini 文字生成（免費額度），看能不能穩定吐 JSON 單字卡內容。"""
import json, os, sys, urllib.request, urllib.error

KEY = None
for line in open(r"C:/Users/SuperSpyer/toeic/gemini_keys.txt", encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#"):
        KEY = line
        break
print("key prefix:", KEY[:10] + "…", "len", len(KEY))

PROMPT = """你是 TOEIC 多益教學內容編輯，服務繁體中文母語的台灣學習者。
針對下面每個單字，產生一張單字卡資料。只輸出 JSON，不要任何說明文字。

單字：schedule, invoice, negotiate

JSON 格式（最外層是陣列）：
[{
 "word": "schedule",
 "ph": "/ˈskedʒuːl/",                 // 國際音標，前後帶斜線
 "pos": "n. 行程表 | v. 安排",          // 詞性 + 繁體中文意思，多個詞性用 | 分隔
 "zh": "行程表；安排",                  // 精簡中文意思，用；分隔
 "colloc": "on schedule 準時 | behind schedule 落後",   // 2 個常見搭配
 "distinct": "timetable 時刻表（交通）| agenda 會議議程",  // 易混淆字辨析
 "ex": [["Let's check the schedule for next week.", "我們看一下下週的行程。"],
        ["The interview is scheduled for Monday morning.", "面試安排在星期一上午。"],
        ["The project is running behind schedule.", "這個專案進度落後。"]]
}]

規則：
- ex 一定要 3 組，每組 [英文例句, 繁體中文翻譯]，例句要商務職場情境、12 字以內、自然。
- 不要抄字典例句，不要每句都用同樣的開頭。
- 全部使用繁體中文（台灣用語）。
"""

def call(model, prompt, timeout=120):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.8, "maxOutputTokens": 2048},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

for model in ("gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"):
    try:
        d = call(model, PROMPT)
        txt = d["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(txt)
        print(f"[OK] {model}: {len(data)} entries")
        print(json.dumps(data[0], ensure_ascii=False, indent=1)[:500])
        break
    except urllib.error.HTTPError as e:
        print(f"[HTTP {e.code}] {model}: {e.read()[:200]}")
    except Exception as e:
        print(f"[ERR] {model}: {type(e).__name__} {e}")
