# 桌面笔记库（票 01）

桌面端复用 React/Vite 和 CodeMirror，提供本地笔记库及源码编辑。网页入口继续使用原阅读器。自动保存、完整冲突操作和三模式编辑器分别由票 02、05 承接。

```sh
npm ci
npm run desktop                 # 先构建，再启动 Electron；不连接开发服务器
npm run test:desktop            # 文件、格式、时间与本机状态检查
npm run desktop:check           # 编译后应用的自动交互检查；选库对话框使用桩
npm run desktop:pack:mac        # Intel macOS DMG
npm run desktop:pack:win        # Windows x64 NSIS 安装包
```

固定版本为 Electron 45.2.1、electron-builder 26.18.0。若本机 npm 策略未执行 Electron 下载脚本，可执行 `node node_modules/electron/install.js`；不需修改系统安全设置。产物在 `release/`，不纳入 Git。首版使用默认图标，未签名、公证或发布，发布工作归票 12。当前 macOS 构建目标为 x64；Windows 实机验证归票 13。

`DESKTOP_EXECUTABLE=/完整路径/课本解读.app/Contents/MacOS/课本解读 npm run desktop:check` 可对从 DMG 复制安装后的程序运行同一检查。检查创建独立临时库与应用数据目录，保留路径并打印结果；不读取用户笔记，不调用云端个人内容接口。原生选库窗口另用真实系统对话框验证，不能以该桩代替。

## 文件与接口

用户选择的目录是库根目录。文件名（含可选子目录）就是笔记名称；新建时父目录须已存在。同名建议采用“名称（2）.md”；新建通过独占链接提交，现有文件通过同目录临时文件和原子替换保存。支持 UTF-8 `.md`，单篇上限 10 MB。读取和扫描不写文件；隐藏文件、库内符号链接、目录联接及硬链接不参与笔记操作。

主进程持有库路径，渲染端仅持有本轮选库 token 与相对路径。preload 仅暴露 `restore`、`chooseVault`、`list`、`read`、`save`、`saveState`、`setDirty`；主进程校验主窗口、主框架、应用 URL、参数及每段库内路径。启用沙箱、上下文隔离和 CSP，禁用 Node 集成、外部导航、弹窗及权限请求。源码编辑器将 HTML 当文本；后续预览仍须保持此边界。

`save(token, path, source, revision)` 中 `revision` 为读取内容的 SHA-256；新建为 `null`。保存前重新读取比较摘要，发现变化就返回失败并保留 UI 草稿。写入前将磁盘原文和候选内容写入库外 `save-recovery/<库和路径摘要>.json`，用于异常写入后的人工恢复。此记录是辅助副本；`.md` 始终是正文依据。预检查与最终替换间仍有外部写入竞态，不宣称原子比较交换；票 02 承接完整冲突查看、另存及恢复操作。

YAML 使用文档 AST 修改内置字段，保留未知属性、注释及顺序；当前 `_textbook.schema_version` 为 1，新笔记使用 UUID。时间仅在候选内容成功写入后反馈为已保存。手动文件不补创建时间，仅补 ID 不生成时间；正文、用户属性及 anchors 修改才推进合法更新时间。异常时间保留并提示；异常 ID、重复字段、无效 YAML 阻止保存，允许用户明确修改源码后重试。较新格式只读，键盘命令及撤销也受 CodeMirror 的只读状态约束。

## 本机状态

Electron `userData` 中的 `last-vault.json` 保存上次库路径；`vaults/<库路径摘要>.json` 保存各库的窗口位置和大小、当前文件、光标及滚动位置。不向库内写这些状态，不持久化未保存草稿。可用位置在重开时恢复；超出文件或显示器范围时限制到可用范围，损坏状态提示后仍可选择并阅读文件。窗口关闭和切换文件或库时保护草稿，取消继续保留当前内容。

手动立即保存及 Ctrl/Cmd+S 可用。失败时保留编辑内容并显示原因；恢复权限后可重试。自动交互检查使用当前平台真实 Electron 进程与文件系统，但对原生选择框和关闭确认采用可控返回值，须与真实原生窗口证据分别记录。
