#!/usr/bin/env python3
"""生成 miniprogram/styles/icons.wxss。

WXSS 不能引用本地图片，所以把 SVG 转成 base64 放进 mask-image。
图标颜色跟随文字颜色（background-color: currentColor），深色模式自动适配。
用法：<text class="i i-play"></text>，大小由 font-size 控制。
"""
import base64
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "miniprogram" / "styles" / "icons.wxss"

STROKE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{}</svg>'
FILL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">{}</svg>'

ICONS = {
    "play": FILL.format('<path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/>'),
    "pause": FILL.format('<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>'),
    "prev": FILL.format('<rect x="4.5" y="5" width="2.4" height="14" rx="1.2"/><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.2 12.83a1 1 0 0 1 0-1.66l8.25-5.8A1 1 0 0 1 19 6.2z"/>'),
    "next": FILL.format('<rect x="17.1" y="5" width="2.4" height="14" rx="1.2"/><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.25-5.8a1 1 0 0 0 0-1.66L6.55 5.37A1 1 0 0 0 5 6.2z"/>'),
    "loop": STROKE.format('<path d="M17 3l3 3-3 3"/><path d="M4 12v-1.5A4.5 4.5 0 0 1 8.5 6H20"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v1.5a4.5 4.5 0 0 1-4.5 4.5H4"/><path d="M11 10.5l1.5-1v5"/>'),
    "star": STROKE.format('<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
    "star-fill": FILL.format('<path d="M12 2.6a.9.9 0 0 1 .8.5l2.4 4.9 5.4.8a.9.9 0 0 1 .5 1.53l-3.9 3.8.92 5.37a.9.9 0 0 1-1.3.95L12 17.9l-4.82 2.55a.9.9 0 0 1-1.3-.95l.92-5.37-3.9-3.8a.9.9 0 0 1 .5-1.53l5.4-.8 2.4-4.9a.9.9 0 0 1 .8-.5z"/>'),
    "check": STROKE.format('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    "down": STROKE.format('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    "left": STROKE.format('<path d="M15 5l-7 7 7 7"/>'),
    "right": STROKE.format('<path d="M9 5l7 7-7 7"/>'),
    "offline": STROKE.format('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'),
    "headphones": STROKE.format('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>'),
    "bookmark": STROKE.format('<path d="M6 3.5h12v17l-6-4-6 4z"/>'),
}


def main():
    lines = [
        "/* 由 scripts/gen_icons.py 生成，不要手改 */",
        ".i{display:inline-block;width:1em;height:1em;vertical-align:-0.125em;background-color:currentColor;"
        "-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;"
        "-webkit-mask-size:contain;mask-size:contain;flex:none}",
    ]
    for name, svg in ICONS.items():
        uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
        lines.append(f'.i-{name}{{-webkit-mask-image:url("{uri}");mask-image:url("{uri}")}}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已生成 {OUT.name}：{len(ICONS)} 个图标")


if __name__ == "__main__":
    main()
