#!/usr/bin/env python3
"""发布：提交全部改动 → 打 tag → 推送 → 检查音频能访问。

步骤：
  1. 校验并构建素材（miniprogram/data 更新到最新）
  2. 算出下一个 tag（v1、v2……），把 miniprogram/config.js 的 ref 改成它
  3. git add -A 并提交（有改动时必须用 -m 给出提交说明）
  4. 打 tag，推送分支和 tag
  5. 检查 jsDelivr 上每份音频都能访问

用法：
  python3 scripts/release.py --dry-run            只看计划，不改任何东西
  python3 scripts/release.py -m "提交说明"         执行发布

每次发布都用新 tag，不要移动或复用旧 tag：jsDelivr 会永久缓存 tag 下的文件。
小程序不在这里上传，需要时在微信开发者工具里手动上传。
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "miniprogram" / "config.js"
CATALOG = ROOT / "materials" / "catalog.json"
REF = re.compile(r"(ref:\s*')([^']*)(')")


def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)} 失败：\n{r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


def repo_of(url):
    m = re.search(r"github[^:/]*[:/]([^/:\s]+)/([^/\s]+?)(?:\.git)?/?$", url)
    return f"{m.group(1)}/{m.group(2)}" if m else ""


def tool(*args):
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "material.py"), *args], cwd=ROOT,
                          capture_output=True, text=True)


def fetch_size(url):
    req = urllib.request.Request(url, headers={"User-Agent": "moerduo-release"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return len(r.read())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-m", "--message", default="", help="提交说明")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 1. 校验并构建素材
    r = tool("check")
    if r.returncode != 0:
        sys.exit("素材校验没通过，先修好再发布：\n" + r.stdout)
    if not args.dry_run:
        r = tool("build")
        if r.returncode != 0:
            sys.exit("构建失败：\n" + r.stdout)

    # 2. 仓库、下一个 tag
    repo = repo_of(git("remote", "get-url", "origin", check=False))
    if not repo:
        sys.exit("没有找到 GitHub 远程仓库（origin）")
    cfg = CONFIG.read_text(encoding="utf-8")
    cfg_repo = repo_of(re.search(r"repo:\s*'([^']*)'", cfg).group(1))
    if cfg_repo != repo:
        sys.exit(f"config.js 里的仓库（{cfg_repo or '未填写'}）和 git 远程仓库（{repo}）不一致，先改 config.js")
    git("fetch", "--tags", "origin")
    nums = [int(t[1:]) for t in git("tag", "--list", "v*").split() if re.fullmatch(r"v\d+", t)]
    n = max(nums, default=0) + 1
    tag = f"v{n}"
    old_ref = REF.search(cfg).group(2)
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    materials = [x["id"] for x in json.loads(CATALOG.read_text(encoding="utf-8"))] if CATALOG.exists() else []
    changes = git("status", "--porcelain")

    print(f"仓库：{repo}（分支 {branch}）")
    print(f"新 tag：{tag}" + (f"（已有 {', '.join(f'v{x}' for x in sorted(nums))}）" if nums else "（第一次发布）"))
    print(f"config.js 的 ref：{old_ref} → {tag}")
    print(f"素材：{len(materials)} 份")
    print("待提交的改动：" + ("\n" + changes if changes else "无"))
    if args.dry_run:
        print("\n--dry-run：以上是计划，没有做任何改动")
        return

    # 3. 更新 ref 并提交全部改动
    if old_ref != tag:
        CONFIG.write_text(REF.sub(rf"\g<1>{tag}\g<3>", cfg, count=1), encoding="utf-8")
    git("add", "-A")
    if git("diff", "--cached", "--name-only"):
        if not args.message:
            git("reset", "-q")
            if old_ref != tag:
                CONFIG.write_text(cfg, encoding="utf-8")
            sys.exit("有改动要提交，请用 -m 给出提交说明")
        git("commit", "-m", args.message)
        print("✓ 已提交：" + args.message.splitlines()[0])

    # 4. 打 tag 并推送。推送失败时撤掉本地 tag，下次重新发布还是这个号
    git("tag", "-a", tag, "-m", f"发布 {tag}")
    for what in (branch, tag):
        r = subprocess.run(["git", "push", "origin", what], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            git("tag", "-d", tag, check=False)
            sys.exit(f"推送 {what} 失败，已删除本地 tag {tag}（提交保留在本地）：\n{r.stderr.strip()}")
    print(f"✓ 已推送 {branch} 和 {tag}")

    # 5. 检查 jsDelivr 上的音频
    for mid in materials:
        local = (ROOT / "materials" / mid / "audio.m4a").stat().st_size
        url = f"https://cdn.jsdelivr.net/gh/{repo}@{tag}/materials/{mid}/audio.m4a"
        size, err = None, None
        for _ in range(6):
            try:
                size = fetch_size(url)
                break
            except Exception as e:
                err = e
                time.sleep(5)
        if size == local:
            print(f"✓ 音频 {mid}：可以访问（{size} 字节）")
        else:
            print(f"✗ 音频 {mid}：{'大小不一致 ' + str(size) if size else '访问失败 ' + str(err)}  {url}")


if __name__ == "__main__":
    main()
