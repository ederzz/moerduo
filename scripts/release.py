#!/usr/bin/env python3
"""发布新版本：把当前的素材音频固定成一个新 tag，供小程序通过 jsDelivr 访问。

步骤：检查工作区 → 校验并构建素材 → 算出下一个 tag（v1、v2……）→ 更新 config.js 的 ref
      → 提交 → 打 tag → 推送分支和 tag → 检查 jsDelivr 上每份音频都能访问。

用法：
  python3 scripts/release.py --dry-run   只看会做什么，不改任何东西
  python3 scripts/release.py             执行发布

每次发布都用新 tag，不要移动或复用旧 tag：jsDelivr 会永久缓存 tag 下的文件。
发布后要在开发者工具里重新上传小程序，新的 ref 才会生效。
"""
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
        sys.exit(f"git {' '.join(args)} 失败：\n{r.stderr.strip()}")
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
    dry = "--dry-run" in sys.argv

    # 1. 工作区必须干净：发布的内容就是已经提交的内容
    dirty = git("status", "--porcelain")
    if dirty:
        sys.exit("还有没提交的改动，先提交再发布：\n" + dirty)

    # 2. 校验并构建；构建结果必须和已提交的一致
    r = tool("check")
    if r.returncode != 0:
        sys.exit("素材校验没通过，先修好再发布：\n" + r.stdout)
    r = tool("build")
    if r.returncode != 0:
        sys.exit("构建失败：\n" + r.stdout)
    changed = git("status", "--porcelain")
    if changed:
        sys.exit("构建后小程序数据有变化，说明最新的数据还没提交。先提交这些改动再发布：\n" + changed)

    # 3. 仓库和下一个 tag
    remote = git("remote", "get-url", "origin", check=False)
    repo = repo_of(remote)
    if not repo:
        sys.exit("没有找到 GitHub 远程仓库（origin）")
    cfg = CONFIG.read_text(encoding="utf-8")
    cfg_repo = repo_of(re.search(r"repo:\s*'([^']*)'", cfg).group(1))
    if cfg_repo != repo:
        sys.exit(f"config.js 里的仓库（{cfg_repo or '未填写'}）和 git 远程仓库（{repo}）不一致，先改 config.js")
    git("fetch", "--tags", "origin")
    nums = [int(t[1:]) for t in git("tag", "--list", "v*").split() if re.fullmatch(r"v\d+", t)]
    tag = f"v{max(nums, default=0) + 1}"
    old_ref = REF.search(cfg).group(2)
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    materials = [x["id"] for x in json.loads(CATALOG.read_text(encoding="utf-8"))] if CATALOG.exists() else []

    print(f"仓库：{repo}（分支 {branch}）")
    print(f"新 tag：{tag}" + (f"（已有：{', '.join(f'v{n}' for n in sorted(nums))}）" if nums else "（第一次发布）"))
    print(f"config.js 的 ref：{old_ref} → {tag}")
    print(f"素材：{len(materials)} 份")
    if dry:
        print("\n--dry-run：以上是计划，没有做任何改动")
        return

    # 4. 更新 ref、提交、打 tag
    if old_ref != tag:
        CONFIG.write_text(REF.sub(rf"\g<1>{tag}\g<3>", cfg, count=1), encoding="utf-8")
        git("add", str(CONFIG.relative_to(ROOT)))
        git("commit", "-m", f"发布 {tag}")
    git("tag", "-a", tag, "-m", f"发布 {tag}")

    # 5. 推送。失败时撤掉本地 tag，下次重新发布还是这个号
    for what in (branch, tag):
        r = subprocess.run(["git", "push", "origin", what], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            git("tag", "-d", tag, check=False)
            sys.exit(f"推送 {what} 失败，已删除本地 tag {tag}：\n{r.stderr.strip()}")
    print(f"✓ 已推送 {branch} 和 {tag}")

    # 6. 检查 jsDelivr 上的音频
    ok = True
    for mid in materials:
        local = (ROOT / "materials" / mid / "audio.m4a").stat().st_size
        url = f"https://cdn.jsdelivr.net/gh/{repo}@{tag}/materials/{mid}/audio.m4a"
        for attempt in range(6):
            try:
                size = fetch_size(url)
                break
            except Exception as e:
                size, err = None, e
                time.sleep(5)
        if size == local:
            print(f"✓ {mid}：可以访问（{size} 字节）")
        else:
            ok = False
            print(f"✗ {mid}：{'大小不一致 ' + str(size) if size else '访问失败 ' + str(err)}  {url}")
    print("\n下一步：在微信开发者工具里重新上传小程序，新的 ref 才会生效。" if ok else
          "\n有音频暂时访问不到，过几分钟再打开上面的链接看看；一直不行的话检查仓库是否公开。")


if __name__ == "__main__":
    main()
