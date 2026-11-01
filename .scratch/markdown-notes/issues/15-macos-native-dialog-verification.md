# 15: macOS 原生对话框与安装启动验收

Status: ready-for-agent
Category: enhancement

**What to build:** 承接 01 中受 Mac 锁屏阻塞的原生选库、关闭确认与安装启动操作验证。自动检查可以模拟系统对话框返回值，但不能替代本票的实际操作。

**Blocked by:** 01：桌面打开笔记库并保存第一篇笔记

## Acceptance criteria

- [x] 在已解锁 Mac 上从 DMG 安装产物启动，记录系统与产物版本，不以开发服务器启动代替。
- [x] 通过真实系统选库窗口选择与取消；取消不创建或改写笔记，切换前可保存或取消，草稿保持。
- [x] 通过真实系统关闭确认验证取消后保留草稿、明确放弃后关闭，正常保存后重开恢复内容和可用位置。
- [x] 保留原生交互证据；若发现实现问题交回对应票修复，并将结果交给 12 收口。

## Comments

- 2026-11-01：协调者依据实际锁屏阻塞从 01 拆出，已请求 DonQ 解锁。其余实现及自动验证继续，本票未通过时不能宣称首版交付完成。
- 2026-11-01：DonQ 回复“已解锁”，已派发专用原生验收会话；尚未以回复替代实际验收结果。
- 2026-11-01 原生验收：DonQ 已解锁。从已审查基线 `0140b9ed4e6fe38679910243f5425a07aada39d1` 创建工作树 `/Users/chengqiyu/dev/textbook-notes-15`、分支 `codex/markdown-notes-15-macos-native`。本次只更新本票；未修改实现、中央调度表或其他票。解除缺少解锁信息的分流状态，`Status` 不表示首版完成。
- 安装来源与环境：macOS `26.7.1`（`25G241`），Intel `x86_64`；应用 `0.0.0`，bundle ID `com.textbook.reader`。使用 01 的 `release/textbook-reader-0.0.0-mac-x64.dmg`（195328786 字节，SHA-256 `4d5e460ba30d5a5cf5eaad1ecba98d28e910ad1a5716676ca4d5718e3ed8abd0`）。重新只读挂载 DMG，逐一比较其中应用与已有 `release/installed/课本解读.app` 的 273 个文件或链接，全部一致后卸载映像。安装副本 `Contents/Resources/app.asar` SHA-256 为 `7438db8f1c30cb58a2d51a6ecb35cbe9de2264686f34f4c7209443a7e2bd2059`。从该安装副本启动，界面 URL 为 `textbook://app/`，未用开发服务器。
- 隔离与方法：新建测试根目录 `/var/folders/w5/kpp0bgcj4tb377ck3_y5_z3m0000gn/T/textbook-notes-15-native-29gylw_q`；其下 `vault-a`、`vault-b` 和空目录 `canceled-vault` 均为本票测试数据，`user-data` 通过 `--user-data-dir=<测试根目录>/user-data` 单独指定。A 含 160 行手动 Markdown 和未知用户属性，B 含独立原文。全部选库、输入、按钮、窗口关闭和原生确认均由受支持的 CUA 原生控制执行；没有替换 `dialog` 返回值、注入页面脚本或连接 Playwright。
- 选库与取消：真实 macOS `open-panel` 先定位空目录并点击 `Cancel`，仍回到空欢迎页；随后用系统 `Open` 选择 A 并读取手动文件。两步之后 A、B 的文件列表、SHA-256 和修改时间均与基线一致，空目录仍为空；首次取消也未写 `last-vault.json`。已有 B 正文时再次打开系统选库并取消，仍保留 B 正文且所有笔记未改写。
- 草稿保护与保存切库：在 A 末尾输入 `NATIVE_DRAFT_A_KEEP_AFTER_CANCEL`，点击切库，实际操作应用内“取消”，返回 A 后仍显示“未保存”和该标记。点击原生窗口关闭按钮，真实 macOS alert 显示“还有未保存的草稿。”、“继续编辑”和“放弃并关闭”；点击“继续编辑”后窗口、草稿和未保存状态均保留，磁盘内容及修改时间仍为基线。再次切库并选择“保存并继续”，确认 A 已落盘后，经真实系统选库窗口打开 B；返回 A 时恢复已保存标记和原有位置。A 的未知属性保持，B 原文不变。
- 保存后重开与明确放弃：已保存状态下关闭进程（退出码 0），以同一独立 `user-data` 重开，自动恢复 A 和 `native-manual.md`，已保存标记仍在。光标 `4069` 与窗口 `{x:346,y:170,width:1100,height:780}` 保持；滚动由 `4063.5` 调整为 `4036.5`，截图显示相邻一行，位置可用。另输入 `NATIVE_DISCARD_MUST_NOT_REACH_DISK`，通过真实关闭 alert 点击“放弃并关闭”，进程退出码 0；再次隔离重开只出现已保存标记，放弃标记不存在。保存后的 A 文件 SHA-256 `517dd92fa3987af5ec02ce0a42be96e303e19321922ec00384bca6886c838b1c` 在上述关闭、重开、放弃全过程不变。两个库的状态文件分开保存在库外，最后的测试实例已正常关闭。
- 发现并交回协调者的问题（未改实现，供 12 收口）：本次观察到一次保存后切库的多余错误条。操作步骤：A 打开长手动文件 → 文末编辑 → 取消切库 → 原生关闭时选“继续编辑” → 再次切库并选“保存并继续” → 系统选库框打开 B。B 已正常列出 `other.md`，顶部却出现“笔记库已切换，请重新读取。”。点击 B 的 `other` 后提示消失，B 正常读取，A 保存内容也未丢失。证据 `11-switched-b.png`、`11-switched-b-full.ax.txt`，及保存前后快照。尚未单独重复定位原因。协调者已确认交给正在维护 DesktopApp 异步状态的 02 修复并补跨库竞态测试，最终修复复核由协调者记录；不能把本票的原生路径通过理解为无缺陷或全部桌面交付通过。
- 证据目录（本机保留，不提交二进制）：`/Users/chengqiyu/dev/textbook-notes-15/release/evidence/native-dialog-20261101/`。`environment.json` 记录系统、产物及来源比较；`02-native-picker.png`、`05-switch-guard.png`、`07-native-close-confirm.png`、`13-vault-a-restored.png`、`15-reopened-saved.png`、`19-reopened-after-discard.png` 和对应 AX 文本记录实际操作；`00-baseline.json` 至 `20-final.json` 记录笔记摘要、修改时间和库外状态；`verification-summary.json` 的 17 项原生路径／文件证据核对通过，`evidence-sha256.json` 保存证据摘要。记录交由协调者审查并转交 12，不直接改写 01、12 或中央调度。
- 工具边界与未验证项：首次截图因 ScreenCaptureKit 短暂报错，后续真实截图成功。明确放弃后，CUA 的窗口查询自动重启了一个未带隔离参数的空欢迎页实例；未选库或打开笔记，随即关闭，之后重新显式带隔离参数核对结果。未手动清理默认应用数据，该实例的启动缓存不作为隔离验收依据。本票未验证 Windows、离线教材、后续 02／03 实现、签名、公证或整套桌面交付；这些仍按 13、12 及后续票的门槛处理。只修改验收记录，未重跑无关实现测试；检查本票 diff 和 `git diff --check`。
- 2026-11-01：协调者已核对真实关闭确认、切库错误截图、17 项证据摘要及全部证据文件哈希，记录以 `a08a32c` 集成。确认原生操作与文件保持证据有效；过期提示缺陷仍由 02 修复，修复后的复核待补，不据此宣称无未决问题。
