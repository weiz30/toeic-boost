# -*- coding: utf-8 -*-
"""打包「先上線 21 天」版本：1–21 天各 20 字。

不足 20 字的天數，用 22 天以後已經產生的字（依天序）補滿；
這些字之後正式跑完時會回到原本的天，不影響內容正確性（只是預覽版的主題對應可能略鬆）。
"""
import json, os, glob, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "data", "curriculum.json")
MAXDAY = 21
PER = 20

files = sorted(glob.glob(os.path.join(HERE, "days", "day*.json")))
recs = {}
for f in files:
    d = json.load(open(f, encoding="utf-8"))
    recs[d["day"]] = d

# 全域 dedupe（保留最早出現的那一天）
seen = {}
for day in sorted(recs):
    keep = []
    for it in recs[day]["items"]:
        k = it["word"].strip().lower()
        if k in seen:
            continue
        seen[k] = day
        keep.append(it)
    recs[day]["items"] = keep

# 預覽版：1–21 天
days = []
short = []
for day in range(1, MAXDAY + 1):
    d = recs.get(day)
    if not d:
        continue
    items = d["items"][:PER]
    if len(items) < PER:
        short.append(day)
    days.append({"day": day, "theme": d.get("theme", ""), "level": d.get("level", ""),
                 "kind": d.get("kind", "word"), "items": items})

# 儲備池：22 天以後尚未用到的字
pool = []
for day in sorted(recs):
    if day <= MAXDAY:
        continue
    pool.extend(recs[day]["items"])

# 補滿
pi = 0
for d in days:
    while len(d["items"]) < PER and pi < len(pool):
        d["items"].append(pool[pi])
        pi += 1

def clean(it):
    return {
        "word": it["word"].strip(), "ph": it.get("ph", ""), "pos": it.get("pos", ""),
        "zh": it.get("zh", ""), "colloc": it.get("colloc", ""),
        "distinct": it.get("distinct", ""), "root": it.get("root", ""),
        "ex": [[p[0], p[1]] for p in it.get("ex", []) if p and len(p) == 2],
    }

days = [{"day": d["day"], "theme": d["theme"], "level": d["level"], "kind": d["kind"],
         "items": [clean(x) for x in d["items"]]} for d in days]
total = sum(len(d["items"]) for d in days)
meta = {"days": len(days), "perDay": PER, "total": total, "planned": 2000,
        "built": time.strftime("%Y-%m-%d %H:%M"), "preview": True}
json.dump({"meta": meta, "days": days}, open(OUT, "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"預覽版：{len(days)} 天 / {total} 字，補過的短天數 {short}，用掉儲備 {pi} 個字")
print("每天字數:", [len(d["items"]) for d in days])
words = [i["word"].lower() for d in days for i in d["items"]]
print("重複:", len(words) - len(set(words)), "| 檔案大小 %.0f KB" % (os.path.getsize(OUT) / 1024))
