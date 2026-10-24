# -*- coding: utf-8 -*-
"""把 days_audio/dayNNN.json 併成 public/data/curriculum.json（只包含已完成的連續天數）。"""
import json, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = json.load(open(os.path.join(HERE, "master2000.json"), encoding="utf-8"))
DST = os.path.join(HERE, "days_audio")
OUT = os.path.join(HERE, "..", "public", "data", "curriculum.json")

days = []
for d in MASTER["days"]:
    f = os.path.join(DST, "day%03d.json" % d["day"])
    if not os.path.exists(f):
        break
    rec = json.load(open(f, encoding="utf-8"))
    if len(rec.get("items", [])) != 20:
        break
    days.append(rec)

total = sum(len(d["items"]) for d in days)
meta = {"days": len(days), "perDay": 20, "total": total, "planned": 2000,
        "built": __import__("time").strftime("%Y-%m-%d %H:%M"),
        "source": MASTER["meta"]["source"]}
json.dump({"meta": meta, "days": days}, open(OUT, "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("上線 %d 天 / %d 字（規劃 2000）　%.0f KB" % (len(days), total, os.path.getsize(OUT)/1024))
