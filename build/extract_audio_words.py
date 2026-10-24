# -*- coding: utf-8 -*-
"""從 E:\\單字 的逐字稿彙整出實際教的單字／片語（詞典過濾掉課程名稱與 ASR 雜訊）。"""
import json, os, re, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ASR = os.path.join(HERE, "build", "asr")
OUT = os.path.join(HERE, "audio_words.json")
ECDICT = r"C:/Users/SuperSpyer/sites/toeic-700-sprint/app/vocabulary.generated.ts"

STOP = set("""a an the and or but if so to of in on at for with by from as is are was were be been being do does did done have has had will would can could should may might must this that these those it its i you he she we they me him her us them my your his our their what which who whom whose when where why how not no yes yeah okay ok oh well now then here there very really just also too much many some any all both each every other another such than more most less least first second next last thank thanks hello hi hey bye please sorry good great right sure fine nice up out off over back down about into onto through during before after while because although however therefore though one two three four five six seven eight nine ten""".split())
META = set("""hackers toic toeic vocabulary vocab day days part parts chapter unit lesson book books password listening reading speaking writing test tests review checkup check phrase phrases accent elsie echo nova aria jenny speaker conversation dialogue explain explanation example examples next repeat once twice again listen answer question questions learn learning study today tomorrow yesterday week weeks month year years time times number numbers page pages lc rc abc ab cd alright""".split())


def norm(s):
    s = s.lower().replace("\u2019", "'")
    s = re.sub(r"[^a-z0-9'\- ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_dict():
    src = open(ECDICT, encoding="utf-8").read()
    i = src.index("= [") + 2
    j = src.rindex("]")
    return {str(d.get("word", "")).strip().lower() for d in json.loads(src[i:j + 1]) if d.get("word")}


DICT = load_dict()


def known(tok):
    if tok in DICT or tok in STOP:
        return True
    for suf, rep in (("ies", "y"), ("es", ""), ("s", ""), ("ed", ""), ("ed", "e"), ("ing", ""), ("ing", "e"), ("ly", ""), ("er", ""), ("est", "")):
        if tok.endswith(suf) and len(tok) > len(suf) + 2:
            base = tok[: -len(suf)] + rep
            if base in DICT or base in STOP:
                return True
    return False


def ok_phrase(p):
    if re.search(r"\d", p):
        return False
    toks = p.split()
    if not (1 <= len(toks) <= 5):
        return False
    if any(t in META for t in toks):
        return False
    if not all(known(t) for t in toks):
        return False
    return any(t not in STOP for t in toks)


files = sorted(glob.glob(os.path.join(ASR, "**", "*.json"), recursive=True))
p_files = collections.defaultdict(set)
p_count = collections.Counter()
for f in files:
    folder = os.path.dirname(os.path.relpath(f, ASR))
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    local = collections.Counter()
    for s in d.get("segments", []):
        p = norm(s.get("t", ""))
        if p and ok_phrase(p):
            local[p] += 1
    for p, c in local.items():
        p_count[p] += c
        p_files[p].add(folder)

rows = [{"phrase": p, "count": p_count[p], "files": len(fs), "folders": sorted(fs)} for p, fs in p_files.items()]
keep = [r for r in rows if r["count"] >= 2 or r["files"] >= 3]
keep.sort(key=lambda r: (-r["files"], -r["count"], r["phrase"]))
json.dump(keep, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

cur = json.load(open(os.path.join(HERE, "..", "public", "data", "curriculum.json"), encoding="utf-8"))
have = {it["word"].lower() for d in cur["days"] for it in d["items"]}
missing = [r for r in keep if r["phrase"] not in have]
print("逐字稿 %d 檔 → 候選 %d → 詞典過濾後 %d" % (len(files), len(rows), len(keep)))
print("已在網站課程 %d　尚未收錄 %d" % (len(keep) - len(missing), len(missing)))
c = collections.Counter()
for r in keep:
    for f in r["folders"]:
        c[f] += 1
print("分資料夾:")
for k, v in sorted(c.items()):
    print("  %-32s %d" % (k, v))
print("\n前 45 個:")
for r in keep[:45]:
    print("  %s %-30s %d 檔 / %d 次" % ("v" if r["phrase"] in have else "+", r["phrase"], r["files"], r["count"]))
