# -*- coding: utf-8 -*-
"""把例句不足 3 組的字補到 3 組（第 1 天那 20 個字是既有影片課程，原本只有 2 組）。"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_days as G

p = os.path.join(HERE, "days", "day001.json")
d = json.load(open(p, encoding="utf-8"))
need = [it for it in d["items"] if len(it.get("ex", [])) < 3]
print("需要補例句的字:", len(need), [x["word"] for x in need][:25])
if not need:
    raise SystemExit(0)

words = ", ".join(x["word"] for x in need)
prompt = f"""你是 TOEIC 多益教學內容編輯。下面每個單字已有 2 組例句，請為每個字「再寫 1 組」新的例句（要跟原本不同的情境與句型）。

單字：{words}

只輸出 JSON 陣列，不要說明。格式：
[{{"word":"schedule","ex":["The bus runs on a fixed schedule.","這班公車按固定時刻表行駛。"]}}]

規則：例句 6–14 個英文字、商務或職場情境、自然；中文用繁體中文（台灣用語）。每個字都要有一筆。"""

try:
    arr = G.call(prompt)
except Exception as e:
    print("補例句失敗（額度問題，先跳過）:", str(e)[:120])
    raise SystemExit(1)

add = {}
for x in arr:
    if isinstance(x, dict) and x.get("word") and isinstance(x.get("ex"), list) and len(x["ex"]) >= 2:
        add[x["word"].strip().lower()] = [x["ex"][0], x["ex"][1]]

got = 0
for it in d["items"]:
    k = it["word"].lower()
    if len(it.get("ex", [])) < 3 and k in add:
        it["ex"].append(add[k]); got += 1
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"補上 {got} 組例句；day001 現在每字例句數:", sorted({len(i['ex']) for i in d['items']}))
