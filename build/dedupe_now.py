# -*- coding: utf-8 -*-
"""只針對目前已產生的天數做 dedupe + 補足 20 個字（不生成新的一天）。"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_days as G

OUT = G.OUTDIR
files = sorted(f for f in os.listdir(OUT) if f.startswith("day") and f.endswith(".json"))
recs = []
for f in files:
    recs.append((f, json.load(open(os.path.join(OUT, f), encoding="utf-8"))))
recs.sort(key=lambda x: x[1]["day"])

seen = {}
for f, r in recs:
    keep = []
    for it in r["items"]:
        k = it["word"].strip().lower()
        if k in seen:
            continue
        seen[k] = r["day"]
        keep.append(it)
    r["items"] = keep
    json.dump(r, open(os.path.join(OUT, f), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

MAXDAY = int(sys.argv[1]) if len(sys.argv) > 1 else 100
problems = [(f, r) for f, r in recs if len(r["items"]) < 20 and r["day"] <= MAXDAY]
print("天數", len(recs), "／不滿 20 字：", [(r["day"], len(r["items"])) for _, r in problems])

for f, r in problems:
    d = next(x for x in G.DAYS if x["day"] == r["day"])
    need = 20 - len(r["items"])
    used = [i["word"] for i in r["items"]] + list(seen.keys())
    try:
        items = G.call(G.build_prompt(d, used, k=need + 4))
    except Exception as e:
        print("day", r["day"], "top-up 失敗:", str(e)[:90])
        continue
    have = {i["word"].strip().lower() for i in r["items"]}
    for it in items:
        if not G.valid(it, r.get("kind", "word")):
            continue
        k = it["word"].strip().lower()
        if k in have or k in seen:
            continue
        have.add(k)
        it["word"] = it["word"].strip()
        r["items"].append(it)
        if len(r["items"]) == 20:
            break
    for it in r["items"]:
        seen.setdefault(it["word"].lower(), r["day"])
    json.dump(r, open(os.path.join(OUT, f), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("day", r["day"], "→", len(r["items"]), "字")

bad = [(r["day"], len(r["items"])) for _, r in recs if len(r["items"]) != 20]
print("完成。仍不滿 20 字的天數:", bad if bad else "無")
print("全域唯一字數:", len(seen))
