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

## 教材下载与离线阅读（票 03）

在“笔记库”选择文件夹后，从“教材书架”明确添加当前版本。添加完成前不写书架成员；下载失败可重试，已校验文件会复用。教材页图、缩略图和目录共 405 项，使用票 14 的固定清单及代码内固定 SHA-256。完成后仍使用原有连续阅读器、目录、页面缩略图、搜索、原文定位与知识图。当前内置解读只读提供；04 将接入初始 Markdown 笔记包，本票不生成 Markdown 或读取云端个人内容。

资源字节保存在 Electron `userData/textbook-resources/<教材版本ID>/`，属于持久资料，不放在索引或 Chromium 缓存中。`complete.json` 只在全量资源及安装资源校验通过后写入；启动时重新逐项校验，不凭该标记宣告完成。每次读取原页也校验对应字节，发现丢失或损坏后撤销当前可用状态并提供重试。下载先核对 HTTP 状态、长度和 SHA-256，再写同目录临时文件、同步并原子提交。

教材目录仅在明确添加动作中写入所选库的 `.textbook/textbooks/<教材版本ID>/catalog.json`。相同目录复用，已有不同内容则保留并报错，不覆盖 `custom.json` 或笔记。所有中间目录拒绝符号链接和目录联接，目录文件拒绝符号链接、硬链接及非普通文件。下载过程中切库会让旧 token 失效，提交目录前重新检查，目录提交与切库使用同一串行队列；已下载的资源仍可供另一库明确添加时复用。

书架成员、启动目的地与阅读位置使用 `desktop-textbooks:<库路径摘要>:` 命名空间保存到桌面 origin 的本机存储；与网页版键及其他笔记库隔离。移出、撤销、重加均保留资源、目录、个人文件及该库续读记录。`window.textbookResources` 只提供 `context`、`status`、`add(vaultToken, textbookId)` 和 `catalog(vaultToken)`；主进程校验调用来源、当前库 token 和固定教材版本。返回的添加结果含 `textbookId`、`catalogPath` 和 `manifestSha256`，供 04 在同一明确添加动作中衔接导入。

生产来源尚未提供，默认添加会提示缺少下载源。发行配置可向主进程提供 `TEXTBOOK_DOWNLOAD_BASE_URL`，须为获准的 HTTPS 目录 URL，以 `/` 结尾且无凭据、查询或片段；不跟随重定向，不向渲染端暴露该配置。清单摘要固定在可信应用代码中，不能由下载服务器替换。不要将 token 或个人凭据放入客户端。生产来源与发布授权由后续票承接。

`desktop:build` 会先构建前端，再移除 `dist/textbooks/` 并生成构建专属的安装资源清单；打包规则同时排除该目录。字体、公式 JS 及所有延迟加载 chunk 留在安装包，并在启动时核对。桌面入口另加载 Pixi 的静态 shader/uniform 适配模块，以遵守禁止 eval 的 CSP；网页入口不加载该适配模块。普通 `npm run build` 仍产生包含教材的网页版构建。

```sh
# 只供本机验收，服务传输真实 HTTP；不表示教材已公开发布。
DESKTOP_EXECUTABLE=/完整路径/课本解读.app/Contents/MacOS/课本解读 node desktop/check-textbooks.mjs
```

该检查启动临时 loopback HTTP 服务，以安装产物执行失败重试、慢下载时切库、双库明确添加和各自续读。随后停止服务、移除来源配置、清理该临时应用的 Chromium 缓存，并以 Electron 断网模拟重启，逐项检查 405 个资源的字节摘要和图片解码、6 个字体、202 个原页节点、目录、缩略图、公式、搜索定位、知识图与移出重加。`--textbook-local-http` 只在显式验收时允许 loopback HTTP。它使用对话框桩，macOS 原生安装和窗口操作仍归 15；Windows 实机归 13。
