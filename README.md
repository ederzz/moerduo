# 磨耳朵

一个自用的英语听力微信小程序：播放 2–5 分钟的英语音频，显示中英文字幕，点字幕里的单词或短语查看释义。全部方案零成本。

## 目录

```
docs/          调研和设计记录
prototype/     可交互的 HTML 原型（直接用浏览器打开 index.html）
materials/     学习素材，每份一个文件夹：audio.m4a、en.srt、zh.srt、notes.md
miniprogram/   小程序代码，用微信开发者工具打开仓库根目录
scripts/       素材工具（校验、构建小程序数据）和图标生成
.claude/skills/add-material/    新建素材：提取音频、翻译中文字幕
.claude/skills/word-notes/      为 words.txt 里的词生成释义
```

## 文档

0. [小程序信息](docs/00-小程序信息.md)：名称、简介、注册信息
1. [方案调研](docs/01-方案调研.md)：零成本方案、存储选型、为什么用音频
2. [UX 设计](docs/02-UX设计.md)：页面结构、交互、待确认的问题
3. [素材格式](docs/03-素材格式.md)：素材文件和释义文件的写法
4. [学习状态](docs/04-学习状态.md)：进度、生词本等怎么存
5. [小程序开发](docs/05-小程序开发.md)：本地运行、音频放 GitHub、发布体验版

## 新增一份素材

1. 在 Claude Code 里运行 `/add-material`，给它英文字幕和视频（或音频）。它会建好 `materials/<slug>/`、提取音频、翻译中文字幕，视频随后移到废纸篓。
2. 读字幕，把不认识的词和短语写进 `materials/<slug>/words.txt`，每行一个。
3. 运行 `/word-notes <slug>` 生成释义。

校验和生成小程序数据由 skill 自动完成，不用手动运行脚本。

`prototype/` 里的原型用的是另外生成的模拟对话，和 `materials/` 里的真实素材无关。
