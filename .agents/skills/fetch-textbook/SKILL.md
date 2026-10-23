---
name: fetch-textbook
description: 从国家中小学智慧教育平台查找、下载教材 PDF，并核对版本、保存来源。用于获取人教版等中小学电子课本，复用 happycola233/tchMaterial-parser。
---

# 教材下载

使用 [tchMaterial-parser](https://github.com/happycola233/tchMaterial-parser) 的目录、解析及下载函数。脚本不启动 GUI，保留原始 PDF，不添加书签或改写页面。

## 环境

优先复用 `~/.cache/tchmaterial-parser/venv/bin/python`。首次使用时，准备源码和独立环境：

```sh
textbook_cache="$HOME/.cache/tchmaterial-parser"
git clone https://github.com/happycola233/tchMaterial-parser.git "$textbook_cache/repo"
git -C "$textbook_cache/repo" checkout 244170e17bf8bc97401f65e04d261533d252572a
python3 -m venv "$textbook_cache/venv"
"$textbook_cache/venv/bin/python" -m pip install --no-deps -e "$textbook_cache/repo"
"$textbook_cache/venv/bin/python" -m pip install 'requests>=2.31,<3' 'pypdf>=6.18,<7'
```

已存在的源码目录先核对版本，避免覆盖本地修改。上述提交已实测；更新上游版本后重新验证脚本。Python 需支持 `tkinter`，因为上游下载模块在导入时依赖它；不需要打开窗口。无需安装上游的主题等 GUI 依赖。

## 查找与下载

1. 从用户请求及项目背景确定学科、学段、版本、年级和上下册。从仓库根目录运行，查询词按空格分隔：

   ```sh
   "$HOME/.cache/tchmaterial-parser/venv/bin/python" .agents/skills/fetch-textbook/scripts/textbook.py search '初中 数学 人教版 七年级 上册'
   ```

   脚本输出匹配教材的分类路径和 `content_id`。有多个候选时，按用户指定版本筛选；仍有实质歧义时，展示候选供用户选择。

2. 使用选中的 `content_id` 和明确的本地路径下载：

   ```sh
   "$HOME/.cache/tchmaterial-parser/venv/bin/python" .agents/skills/fetch-textbook/scripts/textbook.py download \
     540ac93d-67fc-4353-9e49-1ef20d02b5a4 \
     materials/textbooks/人教版-数学-七年级上册.pdf
   ```

   该 ID 是 2026-10-23 实测的人教版数学七年级上册，用于重取同一资源；其他教材须重新查询。

   脚本只选一本 PDF，检查可解析页数，计算 SHA-256，并生成同名 `.source.json`。`resource_url` 是解析得到的资源地址，上游下载时可能使用其镜像。已有 PDF 或来源文件时停止，保留原文件。失败时清理本次下载的临时文件。

3. 渲染并查看封面、版权页、目录、正文起始页和末页。核对学科、册次及出版社。课程标准年份、教材审定年份、出版年份分别记录；原页未列出的出版或印次信息保留为未核实。将核对结果补入 `.source.json` 的 `verification`。

   `pypdf` 能解析文件不等于能正确提取全部文字。首次样本的 `extract_text()` 遇到字体对象错误；使用 `pdftotext -layout` 检索，并以渲染原页为准。PDF 页序与印刷页码分别核对，避免推定全书固定偏移。

交付 PDF 路径、来源记录、已核对的版本信息，以及尚未核实的事项。项目内获取的教材加入本地资料入口；有 Git 时将教材 PDF 排除出版本控制，保留来源记录。

## 访问失败

上游使用当前资源地址、签名请求头和有限镜像重试。本次样本无需 Token，但不保证其他教材始终可匿名下载。脚本会读取上游工具已保存的本地凭据，不输出凭据。

如返回 400、401 或 403，保留错误并说明需要有效的平台登录凭据。按[上游使用说明](https://github.com/happycola233/tchMaterial-parser#️-使用方法)让用户在本地设置凭据；凭据留在上游配置中，避免写入技能、日志或来源记录。

教材原页标注仅供个人学习，其他用途需另行授权。下载范围不包含公开托管或二次分发。
