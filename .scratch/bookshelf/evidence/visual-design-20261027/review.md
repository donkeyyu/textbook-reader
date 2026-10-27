# 书架视觉验收 · 2026-10-27

DonQ 确认本次范围为书架首页。改动覆盖书架、空状态、教材选择及信息窗口，保留 SPEC R13 的行为。教材内容、阅读状态及账号逻辑未在本次修改。

| 检查维度 | 实现与核对 |
| --- | --- |
| 字体 | 保留系统中文字体，区分页面标题、书名、版本和位置；长标题完整换行。 |
| 留白 | 工具栏、标题与教材网格共用对齐线；封面周围留白，文字与操作紧密分组。修正 subgrid 造成的信息行过大间距。 |
| 视觉层级 | 产品标识、书架标题、教材分隔行、原封面、阅读操作逐级呈现；书名和操作不再套卡片外框。 |
| 颜色 | 保留蓝色操作，使用白底与浅灰封面承托。正文、次要文字、蓝色操作对比度分别为 16.83、5.23、5.57:1；已添加状态文字为 4.57:1。 |
| 动效 | 封面悬停抬起、阅读箭头及窗口进入使用 CSS；减少动态效果时，窗口动画为 none、封面过渡为 0s，位移和旋转取消。 |
| 微交互 | 检查添加、禁用、焦点、菜单键盘操作、关闭归还焦点、移出、撤销、错误与重试。可见按钮触区均不小于 44px，键盘焦点为 2px 实线。 |
| 响应式 | 320、600、768、1440px 检查无横向溢出；手机保持两列；菜单均在视口内。另检查 390px 的空状态、选择窗口及实际教材。 |
| 原创性 | 自绘书本图标与真实教材封面形成统一视觉；表达围绕教材选择和续读任务。独立审查未发现新的具体可见缺陷。 |

参考了 [Awwwards 的 My Little Storybook 获奖页](https://www.awwwards.com/sites/my-little-storybook)、[FWA 的同名案例](https://thefwa.com/cases/my-little-storybook)及 [Webby 教育类获奖记录](https://winners.webbyawards.com/winners/apps-software-immersive/consumer-apps/education-culture-learning)。这些是视觉参照；本记录不构成奖项评审或获奖认证。

验证结果：

- `npm test`：42 项通过。
- `npm run build`：最终源码类型检查与生产构建通过。
- `git diff --check`、`node --check scripts/check-manage-books.mjs`：通过。
- `checkBookshelf`：添加、取消、刷新保留、匿名阅读、续读、关联返回、草稿保护探针、记录损坏及写入失败通过。
- `checkManageBooks`：键盘菜单、信息窗口、移出、撤销、重新添加续读及保存失败重试通过。
- `checkManagedVersions`：测试专用同名长标题与不同版本的管理、内容记录保留、无重复及无溢出通过。
- 390px 的 `checkBookshelf` 和 `checkManagedVersions` 均通过；固定视口与检查在同一浏览器调用中执行。补跑采用 DOMContentLoaded 导航等待，保留原有控件状态和行为断言，关闭额外截图；结果见同目录的 [窄屏记录](narrow-results.json)。
- 设计检测器只报告阴影色的建议；最终改为已有正文色的透明变体，新增浅灰底色与次要文字色已记入 DESIGN.md。

独立审查覆盖当前源码及桌面、手机、空状态和教材选择截图。真机、Safari 和学生使用效果未验证。浏览器准备与补录中发生过导航及截图接口超时，与已成功输出的产品断言分开记录；超时本身不计为通过或产品缺陷。

截图：[桌面](final-desktop.png)、[手机](final-mobile.png)、[320px](final-320.png)、[空书架](final-empty-mobile.png)、[教材选择](final-picker-mobile.png)。

本次源码 SHA-256：

```text
560c17f53532b7e39acb58042aa95b0e3a6e44fdeee3fbd5d73cd5b07915f4a6  src/app/Shelf.tsx
9d5b759ed75a8ca613600ec1a4f873c6b586ee21fd8d4219d7e94a45da9cb89f  src/app/shelf.css
4e785aa4c172d6930c7a4fad7f6f11efb709fcad01cb0b6239cebd96469b2285  scripts/check-manage-books.mjs
bd20e85f81f7b78eae341cef1714070129a1b0ebd10a10d865545391797a9d86  DESIGN.md
```
