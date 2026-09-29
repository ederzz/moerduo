#!/usr/bin/env python3
"""素材工具。素材格式见 docs/03-素材格式.md。

用法：
  python3 scripts/material.py extract <slug> <音频或视频文件> [--keep]
      生成 materials/<slug>/audio.m4a。源文件是视频时，确认音频无误后把视频移到废纸篓（--keep 保留）
  python3 scripts/material.py ingest <文件夹> [--slug xxx] [--keep]
      处理一个放好了音频（或视频）和字幕的文件夹：识别英文、中文字幕，生成 audio.m4a，整理成标准素材目录。
      文件夹在 materials/ 下时，源文件处理完移到废纸篓；在别处时只移走视频（--keep 全部保留）
  python3 scripts/material.py words <slug>
      列出 words.txt 每一行：在字幕第几句、是否已有释义
  python3 scripts/material.py check [slug ...]
      校验素材，不传 slug 则检查 materials/ 下全部素材
  python3 scripts/material.py register <slug> --title T --title-zh 中文标题 --level B1 --tags 职场,对话 [--source 来源]
      登记到 materials/catalog.json（记录处理时间）。只有登记过的素材才会进小程序
  python3 scripts/material.py list
      列出已登记的素材，新的在前
  python3 scripts/material.py build [slug ...]
      校验通过后生成小程序数据 miniprogram/data/（不传 slug 时构建全部已登记素材，并删除没登记的数据）
"""
import argparse
import array
import json
import math
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MATERIALS = ROOT / "materials"
CATALOG = MATERIALS / "catalog.json"
LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
DATA = ROOT / "miniprogram" / "data" / "materials"
PEAKS = 120
TRASH = Path.home() / ".Trash"

TYPES = {"单词": "word", "短语": "phrase", "短语动词": "phrasal", "习语": "idiom"}
FIELDS = {"类型", "匹配", "句子", "词性", "音标", "本句"}
SECTIONS = ["近义词", "近义词比较", "使用场景", "口语化表达", "例句"]
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".flv", ".wmv"}
TIMESTAMP = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")
WORD = re.compile(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|[^\sA-Za-z0-9]+|\s+")
TAG = re.compile(r"<[^>]+>|\{\\[^}]*\}")
FIELD = re.compile(r"^[-*]\s*([^:：]+)[:：]\s*(.*)$")
WORDS_LINE = re.compile(r"^(?:@([\d,，\s]+?)\s+)?(.+)$")


class Report:
    def __init__(self, slug):
        self.slug, self.errors, self.warnings = slug, [], []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


# ---------- 解析 ----------

def seconds(h, m, s, ms):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def parse_srt(path):
    return parse_srt_text(path.read_text(encoding="utf-8-sig"), path.name)


def parse_srt_text(text, name):
    text = text.replace("\r\n", "\n").strip()
    cues = []
    for pos, block in enumerate(re.split(r"\n\s*\n", text) if text else [], 1):
        lines = block.strip().split("\n")
        ts = TIMESTAMP.search(lines[1]) if len(lines) > 1 else None
        if not lines[0].strip().isdigit() or not ts:
            raise ValueError(f"{name} 第 {pos} 段不是合法的 SRT 字幕块")
        g = ts.groups()
        body = " ".join(TAG.sub("", l).strip() for l in lines[2:]).strip()
        cues.append({"n": int(lines[0]), "start": round(seconds(*g[:4]), 3), "end": round(seconds(*g[4:]), 3), "text": body})
    return cues


def tokenize(text):
    """切成 [{w, p}]：w 是单词，p 是它后面的标点和空格。开头的标点放进 lead。"""
    toks, lead = [], ""
    for m in WORD.finditer(text):
        s = m.group(0)
        if s[0].isalnum():
            toks.append({"w": s, "p": ""})
        elif toks:
            toks[-1]["p"] += " " if s.isspace() else s
        elif not s.isspace():
            lead += s
    if toks:
        toks[-1]["p"] = toks[-1]["p"].rstrip()
    return toks, lead


def norm(w):
    return w.lower().replace("’", "'")


def words_of(text):
    return [norm(t["w"]) for t in tokenize(text)[0]]


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s).replace("'", "")).strip("-") or "entry"


def parse_numbers(s):
    return {int(x) for x in re.split(r"[,，\s]+", s.strip()) if x}


def parse_notes(path, report):
    raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    lines, meta, i = raw.split("\n"), {}, 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            if ":" in lines[i]:
                k, v = lines[i].split(":", 1)
                v = v.strip()
                meta[k.strip()] = [x.strip() for x in v.strip("[]").split(",") if x.strip()] if v.startswith("[") else v
            i += 1
        i += 1
    entries, cur, sec = [], None, None
    for ln in range(i, len(lines)):
        line = lines[ln]
        if line.startswith("## "):
            cur = {"head": line[3:].strip(), "fields": {}, "sections": [], "line": ln + 1}
            entries.append(cur)
            sec = None
        elif cur is None:
            continue
        elif line.startswith("### "):
            sec = {"title": line[4:].strip(), "lines": []}
            cur["sections"].append(sec)
        elif sec is None:
            m = FIELD.match(line.strip())
            if m:
                cur["fields"][m.group(1).strip()] = m.group(2).strip()
            elif line.strip():
                report.warn(f"notes.md 第 {ln + 1} 行：「{cur['head']}」的字段区有无法识别的内容：{line.strip()}")
        else:
            sec["lines"].append(line)
    for e in entries:
        e["sections"] = [{"title": s["title"], "body": "\n".join(s["lines"]).strip()} for s in e["sections"]]
    return meta, entries


def parse_words(path):
    """words.txt：每行一个要释义的词或短语。# 开头是注释，行首 @7 表示只看第 7 句。"""
    items = []
    for ln, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = WORDS_LINE.match(line)
        only, text = (parse_numbers(m.group(1)) if m.group(1) else None), m.group(2).strip()
        items.append({"line": ln, "text": text, "only": only})
    return items


# ---------- 匹配 ----------

def build_stream(cues):
    """整份字幕的词序列：[(句下标, 词下标, 小写词)]，用来跨句匹配。"""
    return [(ci, ti, norm(t["w"])) for ci, c in enumerate(cues) for ti, t in enumerate(c["tokens"])]


def find(seq, stream, cues, only=None):
    """返回 seq 在词序列里每次出现的起点。only 是允许的句号集合。"""
    if not seq:
        return []
    words = [x[2] for x in stream]
    return [s for s in range(len(words) - len(seq) + 1)
            if words[s:s + len(seq)] == seq and (not only or cues[stream[s][0]]["n"] in only)]


def cue_numbers(hit, stream, cues):
    s, n = hit
    return sorted({cues[stream[k][0]]["n"] for k in range(s, s + n)})


def locate(entry, stream, cues, report):
    only = None
    if entry["fields"].get("句子"):
        try:
            only = parse_numbers(entry["fields"]["句子"])
        except ValueError:
            report.error(f"「{entry['head']}」的「句子」应为句号数字，如 7 或 7, 12")
    hits = set()
    for phrase in entry["fields"].get("匹配", entry["head"]).split("|"):
        seq = words_of(phrase)
        hits.update((s, len(seq)) for s in find(seq, stream, cues, only))
    return sorted(hits)


def word_status(items, entries, stream, cues):
    """words.txt 每一行在字幕里的位置，以及是否已经有释义覆盖了同一处。"""
    covered = {h: e for e in entries for h in e.get("hits", [])}
    for it in items:
        seq = words_of(it["text"])
        it["hits"] = [(s, len(seq)) for s in find(seq, stream, cues, it["only"])]
        it["cues"] = sorted({n for h in it["hits"] for n in cue_numbers(h, stream, cues)})
        it["entry"] = next((covered[h]["head"] for h in it["hits"] if h in covered), None)
    return items


# ---------- 读取和校验 ----------

def probe_duration(path):
    if not shutil.which("ffprobe"):
        return None
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def is_standard_audio(path):
    """标准规格：AAC、单声道、码率不超过 64kbps。拿不到信息时当作标准，不误伤。"""
    if not shutil.which("ffprobe"):
        return True
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=codec_name,channels:format=bit_rate", "-of", "json", str(path)],
                         capture_output=True, text=True)
    try:
        info = json.loads(out.stdout)
        st = info["streams"][0]
        rate = int(info["format"].get("bit_rate") or 0)
    except (ValueError, KeyError, IndexError):
        return True
    return st.get("codec_name") == "aac" and st.get("channels") == 1 and (not rate or rate <= 64000)


def load_catalog():
    if not CATALOG.exists():
        return []
    items = json.loads(CATALOG.read_text(encoding="utf-8"))
    return sorted(items, key=lambda x: x["addedAt"], reverse=True)


def save_catalog(items):
    items = sorted(items, key=lambda x: x["addedAt"], reverse=True)
    CATALOG.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def catalog_entry(slug):
    return next((x for x in load_catalog() if x["id"] == slug), None)


def load(slug):
    """读取并校验一份素材，返回 (report, material)。en.srt 读不了时 material 为 None。"""
    r, d = Report(slug), MATERIALS / slug
    if not d.is_dir():
        r.error(f"找不到素材目录 materials/{slug}")
        return r, None
    en_p, zh_p, notes_p, audio_p, words_p = (d / f for f in ("en.srt", "zh.srt", "notes.md", "audio.m4a", "words.txt"))

    if not en_p.exists():
        r.error("缺少 en.srt")
        return r, None
    try:
        cues = parse_srt(en_p)
    except ValueError as e:
        r.error(str(e))
        return r, None
    for c in cues:
        c["tokens"], c["lead"] = tokenize(c["text"])
        if not c["tokens"]:
            r.warn(f"en.srt 第 {c['n']} 句没有英文单词")
    stream = build_stream(cues)

    zh = None
    if zh_p.exists():
        try:
            zh = parse_srt(zh_p)
        except ValueError as e:
            r.error(str(e))
        if zh is not None:
            if len(zh) != len(cues):
                r.error(f"zh.srt 有 {len(zh)} 句，en.srt 有 {len(cues)} 句，必须一一对应")
            else:
                for a, b in zip(cues, zh):
                    if (a["n"], a["start"], a["end"]) != (b["n"], b["start"], b["end"]):
                        r.error(f"zh.srt 第 {b['n']} 句的序号或时间轴和 en.srt 不一致")
                        break
                    if not b["text"]:
                        r.error(f"zh.srt 第 {b['n']} 句是空的")
    else:
        r.warn("还没有 zh.srt")

    dur = None
    if audio_p.exists():
        dur = probe_duration(audio_p)
        over = cues[-1]["end"] - dur if dur and cues else 0
        if over > 3:
            r.error(f"字幕结束于 {cues[-1]['end']:.1f}s，但音频只有 {dur:.1f}s，可能配错了音频")
        elif over > 0.5:
            r.warn(f"字幕最后一句结束于 {cues[-1]['end']:.1f}s，比音频（{dur:.1f}s）长 {over:.1f}s，生成数据时按音频长度截断")
        if not is_standard_audio(audio_p):
            r.warn("audio.m4a 不是标准规格（AAC 单声道 48kbps），可以用 ingest 或 extract 重新生成")
    else:
        r.error("缺少 audio.m4a")

    notes = []
    if notes_p.exists():
        meta, notes = parse_notes(notes_p, r)
        if meta:
            r.warn("notes.md 开头的素材信息已经不用了，标题等信息在 materials/catalog.json 里")
        ids = set()
        for e in notes:
            where = f"notes.md 第 {e['line']} 行「{e['head']}」"
            f = e["fields"]
            for k in f:
                if k not in FIELDS:
                    r.warn(f"{where}：未知字段「{k}」")
            if f.get("类型") not in TYPES:
                r.error(f"{where}：「类型」必须是 {'、'.join(TYPES)} 之一")
            if not f.get("本句"):
                r.error(f"{where}：缺少「本句」")
            missing = [t for t in SECTIONS if t not in {x["title"] for x in e["sections"]}]
            if missing:
                r.warn(f"{where}：缺少标准分节 {'、'.join(missing)}")
            e["id"] = slugify(e["head"])
            if e["id"] in ids:
                r.error(f"{where}：词条重复")
            ids.add(e["id"])
            e["hits"] = locate(e, stream, cues, r)
            if not e["hits"]:
                hint = "（词条里有 sb/sth 时要写「匹配」）" if re.search(r"\b(sb|sth)\b", e["head"]) else ""
                r.error(f"{where}：在字幕里找不到{hint}")
    else:
        r.warn("还没有 notes.md")

    words = word_status(parse_words(words_p), notes, stream, cues) if words_p.exists() else []
    for it in words:
        if not it["hits"]:
            r.warn(f"words.txt 第 {it['line']} 行「{it['text']}」在字幕里找不到")
        elif not it["entry"]:
            r.warn(f"words.txt 第 {it['line']} 行「{it['text']}」还没有释义")

    entry = catalog_entry(slug)
    if not entry:
        r.warn("还没登记到 materials/catalog.json，不会出现在小程序里（add-material 最后一步会登记）")

    return r, {"slug": slug, "dir": d, "entry": entry, "cues": cues, "stream": stream, "zh": zh,
               "notes": notes, "words": words, "duration": dur}


def summary(m):
    hits = sum(len(e["hits"]) for e in m["notes"])
    return f"{len(m['cues'])} 句，{len(m['notes'])} 条释义（字幕中共 {hits} 处）"


def print_report(r, m):
    print(("✗ " if r.errors else "✓ ") + r.slug + ("" if r.errors or not m else "：" + summary(m)))
    for e in r.errors:
        print("   错误：" + e)
    for w in r.warnings:
        print("   提醒：" + w)


# ---------- 命令 ----------

def to_trash(path):
    dest = TRASH / path.name
    if dest.exists():
        dest = TRASH / f"{path.stem} {time.strftime('%Y-%m-%d %H.%M.%S')}{path.suffix}"
    shutil.move(str(path), str(dest))


def make_audio(slug, src):
    """把音频或视频转成 materials/<slug>/audio.m4a，核对时长。失败时源文件不动。"""
    d = MATERIALS / slug
    d.mkdir(parents=True, exist_ok=True)
    out = d / "audio.m4a"
    if out.exists():
        sys.exit(f"{out.relative_to(ROOT)} 已存在，先确认是否要覆盖")
    tmp = d / "audio.tmp.m4a"
    run = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "48k",
                          "-movflags", "+faststart", str(tmp)], capture_output=True, text=True)
    if run.returncode != 0:
        tmp.unlink(missing_ok=True)
        sys.exit("ffmpeg 转换失败：\n" + run.stderr.strip())
    src_dur, out_dur = probe_duration(src), probe_duration(tmp)
    if not out_dur or (src_dur and abs(src_dur - out_dur) > 1.0):
        tmp.unlink(missing_ok=True)
        sys.exit(f"音频时长不对（源文件 {src_dur}s，音频 {out_dur}s），已放弃，源文件保留")
    tmp.rename(out)
    print(f"✓ 已生成 {out.relative_to(ROOT)}：{out_dur:.1f}s，{out.stat().st_size / 1e6:.2f}MB")


def cmd_extract(slug, src, keep):
    src = Path(src).expanduser().resolve()
    if not src.is_file():
        sys.exit(f"找不到文件：{src}")
    make_audio(slug, src)
    if src.suffix.lower() not in VIDEO_EXT:
        print(f"源文件是音频，保留：{src}")
    elif keep:
        print(f"按要求保留视频：{src}")
    else:
        to_trash(src)
        print(f"✓ 视频已移到废纸篓：{src.name}（可在废纸篓里恢复）")


def read_text_any(path):
    """字幕常见编码：UTF-8（可能带 BOM）、UTF-16、GBK。"""
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        for enc in ("utf-8-sig", "gb18030"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            sys.exit(f"{path.name} 的编码无法识别")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def cjk_ratio(text):
    letters = [c for c in text if c.isalpha()]
    return sum(1 for c in letters if "\u4e00" <= c <= "\u9fff") / max(1, len(letters))


def cmd_ingest(folder, slug, keep):
    """处理一个放好了音频（或视频）和字幕的文件夹，整理成标准的素材目录。"""
    src_dir = Path(folder).expanduser().resolve()
    if not src_dir.is_dir():
        sys.exit(f"找不到文件夹：{src_dir}")
    inside = src_dir.parent == MATERIALS
    slug = slug or (src_dir.name if inside else "")
    if not SLUG.match(slug):
        sys.exit(f"「{slug or src_dir.name}」不能当素材 ID：要用小写英文、数字和连字符，如 running-late。用 --slug 指定")
    dest = MATERIALS / slug
    if inside and dest != src_dir:
        if dest.exists():
            sys.exit(f"materials/{slug} 已存在")
        src_dir.rename(dest)
        print(f"✓ 文件夹已改名为 materials/{slug}")
        src_dir = dest
    dest.mkdir(parents=True, exist_ok=True)

    std = dest / "audio.m4a"
    if inside and std.exists() and not is_standard_audio(std):
        raw = dest / "audio-source.m4a"
        if raw.exists():
            sys.exit("audio.m4a 和 audio-source.m4a 同时存在，不知道该用哪个，请只留一个")
        std.rename(raw)
        print("audio.m4a 是原始下载文件（不是单声道 48kbps），先改名为 audio-source.m4a 再转换")

    media = sorted(f for f in src_dir.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXT | AUDIO_EXT
                   and f.name not in ("audio.m4a", "audio.tmp.m4a"))
    srts = sorted(f for f in src_dir.glob("*.srt") if f.name not in ("en.srt", "zh.srt"))
    if len(media) > 1:
        sys.exit("文件夹里有多个音频或视频，只能留一个：" + "、".join(f.name for f in media))
    if not media and not (dest / "audio.m4a").exists():
        sys.exit("文件夹里没有音频或视频")

    # 按内容区分英文和中文字幕
    en_src = zh_src = None
    texts = {f: read_text_any(f) for f in srts}
    en_list = [f for f in srts if cjk_ratio(texts[f]) < 0.3]
    zh_list = [f for f in srts if cjk_ratio(texts[f]) >= 0.3]
    if not (dest / "en.srt").exists():
        if len(en_list) != 1:
            sys.exit("需要正好一个英文字幕，现在有 %d 个：%s" % (len(en_list), "、".join(f.name for f in en_list) or "无"))
        en_src = en_list[0]
        try:
            parse_srt_text(texts[en_src], en_src.name)
        except ValueError as e:
            sys.exit(str(e))
        (dest / "en.srt").write_text(texts[en_src].strip() + "\n", encoding="utf-8")
        print(f"✓ en.srt ← {en_src.name}")
    if len(zh_list) == 1 and not (dest / "zh.srt").exists():
        try:
            a, b = parse_srt(dest / "en.srt"), parse_srt_text(texts[zh_list[0]], zh_list[0].name)
            if [(x["n"], x["start"], x["end"]) for x in a] == [(x["n"], x["start"], x["end"]) for x in b]:
                zh_src = zh_list[0]
                (dest / "zh.srt").write_text(texts[zh_src].strip() + "\n", encoding="utf-8")
                print(f"✓ zh.srt ← {zh_src.name}（自带中文字幕，和英文一一对应，不用再翻译）")
            else:
                print(f"提醒：{zh_list[0].name} 和英文字幕的时间轴对不上，不使用，需要重新翻译")
        except ValueError:
            print(f"提醒：{zh_list[0].name} 格式不对，不使用，需要重新翻译")

    if media:
        make_audio(slug, media[0])

    # 清理源文件：素材目录里只留标准文件；外部文件夹只移走视频
    moved = []
    for f in [x for x in (media[0] if media else None, en_src, zh_src) if x]:
        if keep:
            continue
        if inside or f.suffix.lower() in VIDEO_EXT:
            to_trash(f)
            moved.append(f.name)
    if moved:
        print("✓ 已把源文件移到废纸篓（可恢复）：" + "、".join(moved))
    print(f"完成：materials/{slug}" + ("" if (dest / "zh.srt").exists() else "，还需要翻译 zh.srt"))


def cmd_register(slug, title, title_zh, level, tags, source):
    r, m = load(slug)
    if r.errors:
        print_report(r, m)
        sys.exit("校验没通过，先修好再登记")
    if level not in LEVELS:
        sys.exit(f"--level 必须是 {'、'.join(sorted(LEVELS))} 之一")
    items = load_catalog()
    old = next((x for x in items if x["id"] == slug), None)
    entry = {
        "id": slug, "title": title.strip(), "titleZh": title_zh.strip(), "level": level,
        "tags": [t.strip() for t in re.split(r"[,，]", tags or "") if t.strip()],
        "addedAt": old["addedAt"] if old else datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if source or (old and old.get("source")):
        entry["source"] = (source or old["source"]).strip()
    items = [x for x in items if x["id"] != slug] + [entry]
    save_catalog(items)
    print(("✓ 已更新登记 " if old else "✓ 已登记 ") + f"{slug}：{entry['title']}（{entry['titleZh']}），处理时间 {entry['addedAt']}")


def cmd_list():
    items = load_catalog()
    if not items:
        print("还没有登记的素材")
        return
    for x in items:
        missing = "" if (MATERIALS / x["id"]).is_dir() else "  ✗ 素材目录不存在"
        print(f"{x['addedAt'][:16].replace('T', ' ')}  {x['id']}  {x['title']} / {x['titleZh']}  {x['level']}  {'、'.join(x['tags'])}{missing}")


def cmd_words(slug):
    r, m = load(slug)
    if not m:
        print_report(r, m)
        sys.exit(1)
    items = m["words"]
    if not (m["dir"] / "words.txt").exists():
        sys.exit(f"materials/{slug}/words.txt 不存在")
    done = sum(1 for it in items if it["entry"])
    missing = sum(1 for it in items if not it["hits"])
    print(f"{slug} / words.txt：{len(items)} 行，{done} 行已有释义，{len(items) - done - missing} 行待生成，{missing} 行在字幕里找不到")
    for it in items:
        where = "第 " + ", ".join(map(str, it["cues"])) + " 句" if it["cues"] else ""
        if not it["hits"]:
            mark, tail = "✗", "字幕里找不到"
        elif it["entry"]:
            mark, tail = "✓", f"{where}，已有词条「{it['entry']}」"
        else:
            mark, tail = "·", f"{where}，待生成"
        print(f"  {mark} 第 {it['line']} 行  {it['text']}  —  {tail}")


def cmd_check_build(cmd, slugs, prune):
    failed, built = False, []
    registered = {x["id"] for x in load_catalog()}
    if prune:
        for x in load_catalog():
            if not (MATERIALS / x["id"]).is_dir():
                print(f"✗ catalog.json 里登记了 {x['id']}，但素材目录不存在")
                failed = True
    for slug in slugs:
        r, m = load(slug)
        print_report(r, m)
        if r.errors:
            failed = True
        elif cmd == "build" and slug not in registered:
            print(f"   跳过构建：{slug} 还没登记")
        elif cmd == "build":
            DATA.mkdir(parents=True, exist_ok=True)
            data = to_data(m)
            (DATA / f"{slug}.js").write_text(
                "// 由 scripts/material.py build 从 materials/%s/ 生成，不要手改\nmodule.exports = %s\n"
                % (slug, json.dumps(data, ensure_ascii=False, separators=(",", ":"))), encoding="utf-8")
            built.append(slug)
    if cmd == "build":
        if prune:
            # 构建全部素材时，顺便删掉没登记的素材数据
            for f in DATA.glob("*.js"):
                if f.stem not in registered:
                    f.unlink()
                    print(f"已删除过期数据 {f.relative_to(ROOT)}")
        write_index()
        if built:
            print(f"已更新小程序数据 {DATA.relative_to(ROOT)}/：{'、'.join(built)}")
    sys.exit(1 if failed else 0)


def write_index():
    """按 catalog.json 的顺序（处理时间，新的在前）重建索引，只收录已经生成数据的素材。
    require 必须写成静态路径，上传时才不会被当成无用文件过滤掉。"""
    slugs = [x["id"] for x in load_catalog() if (DATA / f"{x['id']}.js").exists()]
    lines = ["// 由 scripts/material.py build 生成，不要手改", "const list = ["]
    lines += [f"  require('./materials/{s}.js')," for s in slugs]
    lines += ["]", "", "module.exports = {", "  list,", "  get: id => list.find(m => m.id === id)", "}", ""]
    (DATA.parent / "index.js").write_text("\n".join(lines), encoding="utf-8")


def audio_peaks(path, n=PEAKS):
    """音频波形，用于播放页进度条：n 个 0.06–1 之间的数。"""
    if not shutil.which("ffmpeg"):
        return [0.3] * n
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    samples = array.array("h", raw[:len(raw) // 2 * 2])
    if not samples:
        return [0.3] * n
    step = max(1, len(samples) // n)
    rms = []
    for k in range(n):
        chunk = samples[k * step:(k + 1) * step:4]
        rms.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)) if chunk else 0)
    top = max(rms) or 1
    return [round(max(0.06, math.sqrt(v / top)), 2) for v in rms]


INLINE = re.compile(r"(\*\*.+?\*\*|\*[^*\s][^*]*?\*)")


def inline_runs(text):
    """把 **加粗**、*斜体* 拆成 [{t, b?, i?}]。"""
    runs = []
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            runs.append({"t": part[2:-2], "b": 1})
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            runs.append({"t": part[1:-1], "i": 1})
        else:
            runs.append({"t": part})
    return runs


def md_blocks(body):
    """分节内容转成 [{k: 'p'|'li', r: runs, sub?: 次行文字}]，小程序里不用再解析 Markdown。"""
    blocks = []
    for line in body.split("\n"):
        if not line.strip():
            blocks.append(None)
            continue
        m = re.match(r"^[-*]\s+(.*)$", line)
        if m:
            blocks.append({"k": "li", "r": inline_runs(m.group(1).strip())})
        elif line.startswith((" ", "\t")) and blocks and blocks[-1] and blocks[-1]["k"] == "li":
            b = blocks[-1]
            b["sub"] = (b.get("sub", "") + " " + line.strip()).strip()
        elif blocks and blocks[-1] and blocks[-1]["k"] == "p":
            blocks[-1]["r"] += inline_runs(line.strip())
        else:
            blocks.append({"k": "p", "r": inline_runs(line.strip())})
    return [b for b in blocks if b]


def to_data(m):
    stream, per_cue = m["stream"], {}
    for e in m["notes"]:
        for s, n in e["hits"]:
            spans = {}
            for ci, ti, _ in stream[s:s + n]:
                spans[ci] = (spans.get(ci, (ti,))[0], ti)
            for ci, (a, b) in spans.items():
                per_cue.setdefault(ci, []).append({"s": a, "e": b, "id": e["id"]})
    cues, order, seen = [], [], set()
    for ci, c in enumerate(m["cues"]):
        anns = sorted(per_cue.get(ci, []), key=lambda x: (x["s"], -(x["e"] - x["s"])))
        for a in anns:
            if a["id"] not in seen:
                seen.add(a["id"])
                order.append({"id": a["id"], "cue": ci})
        end = min(c["end"], m["duration"]) if m["duration"] else c["end"]
        cue = {"start": c["start"], "end": end, "zh": m["zh"][ci]["text"] if m["zh"] else "",
               "tokens": c["tokens"], "anns": anns}
        if c["lead"]:
            cue["lead"] = c["lead"]
        cues.append(cue)
    meta = m["entry"]
    return {
        "id": m["slug"], "title": meta["title"], "titleZh": meta["titleZh"],
        "level": meta["level"], "tags": meta["tags"], "addedAt": meta["addedAt"],
        "duration": round(m["duration"] or (m["cues"][-1]["end"] if m["cues"] else 0), 2),
        "peaks": audio_peaks(m["dir"] / "audio.m4a"),
        "cues": cues,
        "order": order,
        "notes": {e["id"]: {
            "head": e["head"], "type": TYPES[e["fields"]["类型"]], "pos": e["fields"].get("词性", ""),
            "ipa": e["fields"].get("音标", ""), "context": e["fields"]["本句"],
            "sections": [{"title": x["title"], "blocks": md_blocks(x["body"])} for x in e["sections"]],
        } for e in m["notes"]},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("extract")
    p.add_argument("slug")
    p.add_argument("src")
    p.add_argument("--keep", action="store_true", help="保留源视频，不移到废纸篓")
    p = sub.add_parser("ingest")
    p.add_argument("folder")
    p.add_argument("--slug", default="")
    p.add_argument("--keep", action="store_true", help="保留源文件，不移到废纸篓")
    sub.add_parser("words").add_argument("slug")
    p = sub.add_parser("register")
    p.add_argument("slug")
    p.add_argument("--title", required=True, help="英文标题")
    p.add_argument("--title-zh", required=True, help="简短的中文标题")
    p.add_argument("--level", required=True, help="CEFR 等级 A1–C2")
    p.add_argument("--tags", default="", help="话题标签，逗号分隔")
    p.add_argument("--source", default="", help="素材来源，可不填")
    sub.add_parser("list")
    for name in ("check", "build"):
        sub.add_parser(name).add_argument("slugs", nargs="*")
    args = ap.parse_args()

    if args.cmd == "extract":
        cmd_extract(args.slug, args.src, args.keep)
    elif args.cmd == "ingest":
        cmd_ingest(args.folder, args.slug, args.keep)
    elif args.cmd == "words":
        cmd_words(args.slug)
    elif args.cmd == "register":
        cmd_register(args.slug, args.title, args.title_zh, args.level, args.tags, args.source)
    elif args.cmd == "list":
        cmd_list()
    else:
        folders = sorted(p.name for p in MATERIALS.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))
        default = folders if args.cmd == "check" else [x["id"] for x in load_catalog() if x["id"] in folders]
        cmd_check_build(args.cmd, args.slugs or default, prune=not args.slugs)


if __name__ == "__main__":
    main()
