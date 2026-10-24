# -*- coding: utf-8 -*-
"""把 build/days/dayNNN.json 併成 public/data/curriculum.json（給網站用）。"""
import json, os, glob, sys
MAXDAY = int(sys.argv[1]) if len(sys.argv) > 1 else 100

ROOT = os.path.dirname(os.path.abspath(__file__))
DAYS = os.path.join(ROOT, "days")
OUT = os.path.join(ROOT, "..", "public", "data", "curriculum.json")

days, total, bad = [], 0, []
for f in sorted(glob.glob(os.path.join(DAYS, "day*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    if d.get("day", 0) > MAXDAY:
        continue
    items = d.get("items", [])
    if len(items) != 20:
        bad.append((d.get("day"), len(items)))
    clean = []
    for it in items:
        clean.append({
            "word": it["word"].strip(),
            "ph": it.get("ph", ""),
            "pos": it.get("pos", ""),
            "zh": it.get("zh", ""),
            "colloc": it.get("colloc", ""),
            "distinct": it.get("distinct", ""),
            "root": it.get("root", ""),
            "ex": [[p[0], p[1]] for p in it.get("ex", []) if p and len(p) == 2],
        })
    days.append({"day": d["day"], "theme": d.get("theme", ""), "level": d.get("level", ""),
                 "kind": d.get("kind", "word"), "items": clean})
    total += len(clean)

days.sort(key=lambda x: x["day"])
meta = {"days": len(days), "perDay": 20, "total": total,
        "built": __import__("time").strftime("%Y-%m-%d %H:%M"),
        "source": "Gemini 生成 + content/day001.py 種子"}
out = {"meta": meta, "days": days}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

size = os.path.getsize(OUT) / 1024
print(f"寫入 {os.path.abspath(OUT)}")
print(f"天數 {len(days)}　單字 {total}　大小 {size:.0f} KB")
if bad:
    print("⚠️ 不滿 20 個項目的天數:", bad)
else:
    print("每天都是 20 個字 ✓")
words = [it["word"].lower() for d in days for it in d["items"]]
print("重複字:", len(words) - len(set(words)))
