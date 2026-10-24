# -*- coding: utf-8 -*-
"""把 E:\\單字 全部 mp3 轉成逐字稿（faster-whisper base, CPU, int8）。

輸出：build/asr/<folder>/<basename>.json  （含 segments 時間碼 + 全文）
      build/asr/_progress.log
可中斷續跑：已存在的 json 會跳過。
"""
import os, sys, glob, json, time, av
from faster_whisper import WhisperModel

SRC = r"E:\單字"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", "asr")
LOG = os.path.join(OUT, "_progress.log")
os.makedirs(OUT, exist_ok=True)

def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

files = sorted(glob.glob(os.path.join(SRC, "**", "*.mp3"), recursive=True))
log(f"start: {len(files)} files")

# 先算總時長，方便估進度
total_sec = 0.0
for f in files:
    try:
        with av.open(f) as c:
            total_sec += float(c.duration) / av.time_base
    except Exception:
        pass
log(f"total audio {total_sec/3600:.2f} h")

model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
done_sec = 0.0
t_start = time.time()

for i, path in enumerate(files, 1):
    rel = os.path.relpath(path, SRC)
    folder = os.path.dirname(rel)
    stem = os.path.splitext(os.path.basename(rel))[0]
    odir = os.path.join(OUT, folder)
    os.makedirs(odir, exist_ok=True)
    ofile = os.path.join(odir, stem + ".json")
    if os.path.exists(ofile):
        continue
    try:
        with av.open(path) as c:
            dur = float(c.duration) / av.time_base
        segs, info = model.transcribe(path, language="en", beam_size=1,
                                      vad_filter=True, condition_on_previous_text=False)
        rows = [{"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip()} for s in segs if s.text.strip()]
        data = {"file": rel, "dur": round(dur, 2), "segments": rows,
                "text": " ".join(r["t"] for r in rows)}
        with open(ofile, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        done_sec += dur
        rate = done_sec / max(1e-6, time.time() - t_start)
        eta = (total_sec - done_sec) / rate / 60 if rate else 0
        log(f"[{i}/{len(files)}] {rel}  {dur:.0f}s  {len(rows)} segs  {rate:.1f}x  ETA {eta:.0f} min")
    except Exception as e:
        log(f"[{i}/{len(files)}] FAIL {rel}: {type(e).__name__} {e}")

log("ALL DONE")
