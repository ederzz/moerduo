# 磨耳朵

自用的英语听力微信小程序。硬性约束：**开发和运行都不能花钱**，方案里不能引入需要付费、备案域名或服务器的东西。

- 文档、界面文案、提交说明都用中文。
- 设计和调研记录在 `docs/`，决定了新的东西要同步更新对应文档。
- 素材格式以 `docs/03-素材格式.md` 为准。改格式时同时改 `scripts/material.py`、`.claude/skills/add-material/` 和 `.claude/skills/word-notes/`。
- 改动 `materials/` 后运行 `python3 scripts/material.py check`，必须通过。
- 小程序代码在 `miniprogram/`，原生 WXML/WXSS/JS，不引入框架和 npm。`miniprogram/data/` 和 `miniprogram/styles/icons.wxss` 是生成的，不要手改。
- 素材文件夹名（slug）是学习进度和生词本的关联键，建好后不要改名。
- 素材登记在 `materials/catalog.json` 里才会进小程序；登记由 `add-material` 最后一步通过 `material.py register` 完成，不要手动改 `addedAt`。
- 新建素材、翻译字幕用 `add-material` skill；为 `words.txt` 生成释义用 `word-notes` skill，两者分开。
