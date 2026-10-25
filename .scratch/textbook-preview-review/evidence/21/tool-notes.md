# 工具与重试记录

- 使用独立 Ego TaskSpace 38、独立预览源；未重启浏览器、清除其他存储或操作其他服务。
- 旧版本在 320×1200 下复现末页 fraction=-1.5137828205687687，提示“阅读位置无效。”，见 baseline-failure.json。
- 普通 Ego 页面调用会把仿真尺寸恢复为 1772×909；因此固定视口阶段使用同一 Page 的 CDP Runtime/Input/Emulation。Enter 需携带 `text: '\r'` 才触发原生默认激活；此适配前的脚本失败不计产品失败。
- 一次桌面收起导航的连续末页操作超时，页面保留文件第101页；单独重新跳202成功。输入适配等待两帧布局完成后，完整收起导航检查通过。保留此处记录，不以首次失败计通过。
- 首次访问的封面检查在无阅读记录时通过；后续已保存位置并改变尺寸后再次断言 scrollTop=0 得到10.5，属检查前提错误，已取消该重复断言。
- CDP reload 是异步的；后续检查使用新文档标记和阅读器出现两个条件等待，避免在旧 DOM 仍存在时开始下一步。
- Ego Lite提示0.6.0.16有更新，本轮未升级。
- 首次桌面两层返回检查得到面板0→32px。适配器用preventScroll焦点后立即记基准，而鼠标激活先将不可见链接滚入视口，产品保存的实际来源为32px。已将测试焦点改为正常focus()滚入视口后再取基准；复核结果另见desktop.json，未针对这个适配差异改产品。
- 关闭桌面标签后新建的空白页尚无viewport meta，mobile仿真时innerWidth不是390；已在同一新标签先设置仿真、导航实际教材、待meta生效后继续。关闭/重开与窄屏刷新结果通过，未新建TaskSpace恢复。
- Browser.getVersion命令不可用；浏览器版本取自实际navigator.userAgent。额外Page.reload未暴露原生离开确认框，Page.handleJavaScriptDialog返回No dialog is showing；只将其记为未验证。截图接口也返回Unable to capture screenshot，未生成或伪造截图。
