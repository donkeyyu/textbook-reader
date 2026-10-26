# 本轮技能筛选

日期：2026-10-26。范围为图更新连续性、绘制生命周期、现有抽屉与减少动态效果；不新增动效产品功能。

## 采纳

| 技能 | 来源与副本 | 本轮用途 |
| --- | --- | --- |
| frontend-design | 从已安装的 `/Users/chengqiyu/.agents/skills/frontend-design/` 原样复制到 [项目副本](../../.agents/skills/frontend-design/SKILL.md)；安装锁记录来源为 `anthropics/skills`，安装日期 2026-10-05 | 保留现有阅读界面、焦点与类型色；动态反馈只解释用户操作，不扩大成重设计。 |
| animation-performance | skills.sh 动效搜索指向 Emil Kowalski 的技能仓库；核读官方 [`emilkowalski/skills`](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202/skills/animation-performance)，复制到 [项目副本](../../.agents/skills/animation-performance/SKILL.md) | 先确认重建、React 更新或绘制的触发原因，再调整；区分代码检查、浏览器过程采样和真实设备性能。 |
| impeccable animate | 复用已安装的 `/Users/chengqiyu/.agents/skills/impeccable/reference/animate.md`，版本由已安装主技能标为 4.5.0 | Operate／Read 模式下保持反馈与空间连续性；重复操作可中断、隐藏停机，减少动态效果仍保留可读状态。未复制整套运行器。 |

两个项目副本都保留上游文件和完整许可。各自 `SOURCE.md` 记录来源、版本及文件 SHA-256；没有修改第三方原件。复制共六个小型文本文件，无运行缓存、凭据、二进制或新依赖。SKILL.md 的相对 Markdown 文件引用已核对；frontend-design 的 LICENSE.txt 也存在。animation-performance 没有必须随带的相对文件引用；文中其他技能名称是相邻工作类型的说明，本轮不依赖它们。

技能指导服从本项目规格。animation-performance 中关于浏览器合成、动画库加速路径及设备帧预算的概括，不作为本项目已测结论；具体路径仍以当前源码和真实采样为准。它不是把 Pixi 力布局改成 CSS 的指令，也不要求把既有 grid 抽屉换成 transform。类型更新、布局对象复用与同轮 resize 绘制按本票验收；不承诺 FPS，不以桌面模拟替代真实设备。

## 筛选过程与未采纳项

- 本地：检查当前项目 `.agents/skills`、全局 `.agents/skills`、Codex 技能缓存及 dev 下技能。阅读 frontend-design、Impeccable animate 和 Remotion 主技能。Remotion 面向视频帧合成，与运行中的 Pixi 图不符，未复制。
- MJY：Spotlight 名称搜索无结果；dev 文件清单和 Desktop、Documents、Downloads、Shared 的有限深度目录搜索未定位 MJY。主目录扩展扫描未及时结束，已停止，不声称扫描了整盘。`/Volumes` 只看到系统盘链接。未猜测路径，也未从名称相似的其他项目复制。现有及 marketplace 来源已提供适用技能，因此这不是实施阻塞；若以后提供 MJY 的实际目录，可补充核对。
- Marketplace：运行 skill-installer 的 OpenAI `.curated` 目录查询，无专门适用的网页动效技能。插件目录以 `animation motion frontend skills` 查询，返回媒体生成、设计平台及通用框架等，未发现此任务必须新增的服务；不安装无关插件。
- [skills.sh 搜索](https://www.skills.sh/vercel-labs/open-agents/web-animation-design)发现网页动效候选；结合目录中的 Emil Kowalski 来源提示，直接核对官方仓库树、固定提交和许可。采用 animation-performance；没有安装来源链更长的 dotfiles 衍生包。
- 同时阅读官方 `review-animations/SKILL.md`。其中绝对 GPU-only、时间阈值等审查规则会与现有 Pixi 布局和已验收 grid 抽屉产生不必要冲突，本轮不采纳。营销展示、整站重设计、Expo 原生动画、Anime.js 和视频制作候选也不匹配范围。

## 交付边界

本记录只确认技能筛选和文件完整性；不证明 02／03 已实现或浏览器验收通过。工作者可立即读取项目副本，后续会话的技能自动发现以应用重新加载目录为准。
