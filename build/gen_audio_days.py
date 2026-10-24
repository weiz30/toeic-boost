# -*- coding: utf-8 -*-
"""依 master2000.json 的固定字表，用 Gemini 產生每天的單字卡內容（可續跑）。"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_days as G   # 重用模型輪替 / 429 處理 / 驗證

MASTER = json.load(open(os.path.join(HERE, "master2000.json"), encoding="utf-8"))
OUT = os.path.join(HERE, "days_audio")
os.makedirs(OUT, exist_ok=True)
LOG = os.path.join(HERE, "gen_audio.log")


def log(msg):
    import time
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    open(LOG, "a", encoding="utf-8").write(line + "\n")


def prompt_for(d):
    kind = d["kind"]
    items = [x["word"] for x in d["items"]]
    kind_rule = ("這些是片語／慣用語，ph 請留空字串。" if kind == "phrase"
                 else "這些是單字，ph 要給國際音標（前後加斜線、標重音）。")
    return f"""你是 TOEIC 多益教學內容編輯，服務繁體中文母語的台灣學習者。
請為下面 20 個項目寫單字卡內容（這是教材第 {d['day']} 天，主題 {d['theme']}）。

項目：{", ".join(items)}
{kind_rule}

只輸出 JSON 陣列（20 筆，順序跟上面一致），不要說明、不要 markdown。每筆：
{{"word":"schedule","ph":"/ˈskedʒuːl/","pos":"n. 行程表 | v. 安排","zh":"行程表；安排",
 "colloc":"on schedule 準時 | behind schedule 落後",
 "distinct":"timetable 時刻表（交通）| agenda 會議議程",
 "ex":[["Let us check the schedule.","我們看一下行程。"],
       ["The interview is scheduled for Monday.","面試安排在星期一。"],
       ["The project is behind schedule.","這個專案進度落後。"]]}}

規則：
1. ex 剛好 3 組，每組 [英文例句, 繁體中文翻譯]；例句 6–14 個英文字、商務或職場情境、自然，不要每句同開頭。
2. pos 用「詞性 + 繁體中文意思」，多詞性用 | 分隔；片語給「phr. 中文意思」。
3. zh 精簡中文意思，多義用；分隔（最多 3 個）。
4. colloc 2 個常見搭配（英文 + 中文）；distinct 2 個易混淆項辨析。
5. 全部繁體中文（台灣用語），不得有簡體字。
6. word 欄位必須跟上面給的項目一字不差。"""


def valid_item(it, word, kind):
    if not isinstance(it, dict):
        return False
    if it.get("word", "").strip().lower() != word.lower():
        return False
    ex = it.get("ex")
    if not isinstance(ex, list) or len(ex) < 3:
        return False
    if any(not (isinstance(p, (list, tuple)) and len(p) == 2 and p[0] and p[1]) for p in ex):
        return False
    if not it.get("pos") or not it.get("zh"):
        return False
    if kind == "phrase":
        it["ph"] = ""
    return True


def main():
    done = 0
    todo = [d for d in MASTER["days"]
            if not os.path.exists(os.path.join(OUT, "day%03d.json" % d["day"]))]
    log("待生成 %d 天（已存在 %d 天）" % (len(todo), len(MASTER["days"]) - len(todo)))
    for d in todo:
        try:
            arr = G.call(prompt_for(d))
        except Exception as e:
            log("day%03d 失敗：%s" % (d["day"], str(e)[:100]))
            continue
        by = {}
        for it in arr if isinstance(arr, list) else []:
            if isinstance(it, dict):
                by[it.get("word", "").strip().lower()] = it
        items, miss = [], []
        for x in d["items"]:
            w = x["word"]
            it = by.get(w.lower())
            if it and valid_item(it, w, d["kind"]):
                it["word"] = w
                it["ex"] = [[p[0], p[1]] for p in it["ex"][:3]]
                items.append(it)
            else:
                miss.append(w)
        if len(items) < 20:
            log("day%03d 只拿到 %d/20（缺 %s）→ 跳過" % (d["day"], len(items), ", ".join(miss[:6])))
            continue
        rec = {"day": d["day"], "theme": d["theme"], "level": d["level"], "kind": d["kind"], "items": items}
        json.dump(rec, open(os.path.join(OUT, "day%03d.json" % d["day"]), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        done += 1
        log("day%03d ok（累計完成 %d）" % (d["day"], len(os.listdir(OUT))))
    log("結束：本次新增 %d 天，總計 %d 天" % (done, len(os.listdir(OUT))))


if __name__ == "__main__":
    main()
