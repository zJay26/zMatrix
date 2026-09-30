# v0.4.0 更新器验证记录

日期：2026-09-30。此记录区分自动化回归、真实文件写入与原生浏览器验收。真实平台发布流程沿用 [既有验收状态](acceptance.md)。

## 已验证的实现

- TypeScript 类型检查通过。全套原有及新增回归覆盖更新元数据、界面点击、下载、文件校验、真实临时目录写入与恢复、后台任务互斥。
- GitHub Release 资产接口使用 `application/octet-stream` 能重定向到 `release-assets.githubusercontent.com`。请求只访问本仓库公开资产，使用 `credentials: omit`，新增这一下载域名权限。
- 更新包核验 GitHub 资产的 SHA-256、压缩大小、逐文件大小与摘要，以及固定扩展身份和递增版本；拒绝路径穿越、Windows 特殊路径、大小超限、清单外文件、权限或运行范围变化。`zmatrix-package.json` 标记安装协议 `installer: 1`。
- 在 Windows 独立临时目录上，通过实现 File System Access 接口的文件适配器实际执行备份和写入；manifest 最后写入，目录内无关文件保留。故障注入验证自动回退、损坏备份停止恢复、回退失败保留恢复记录及随后恢复。
- 选择另一个同版本副本也会被目录证明校验拒绝。下载期间目录身份变化、覆盖非程序拥有的同名文件和缺少原文件清单均会停止安装。
- 后台测试覆盖多工作台页（含 `#updates`）、未结束的平台探测、安装锁、重载后的资源核验和原标签页复用；核验失败保留状态，不显示成功。
- 更新界面测试确认显示新版本不会自动安装，设置目录和安装只响应用户点击，进行中不能重复点击，普通网页预览不提供原生安装。
- 正式构建在独立 HTTP 来源检查设置页，默认桌面视口和 390px 窄视口下控件与安装说明可读，无横向溢出；控制台没有警告或错误。截图只展示空白测试工作空间。
- 沿用固定 manifest key、`tonggao-workbench` 数据库及 v2 结构。更新锁与内容事务互斥；执行中或存在未核实原站活动的任务会阻止开始更新。

## 验证边界

文件测试使用真实 Windows 临时文件，但目录授权弹窗、扩展 API 和重载事件使用测试替身。HTTP 本地网页预览只能检查设置页面与响应布局，不能替代 Edge 原生扩展验收。当前自动化浏览器工具不允许访问 `chrome-extension://` 或浏览器管理页面，因此没有将实际扩展内一键更新标记为验收通过。

尚需实际 Edge 验收：首次目录授权、浏览器重启后的权限续期、从本版更新至下一版、`runtime.reload()` 后重新打开工作台、已授予平台权限及真实稿件的保留。首次从旧版升级应手动替换程序文件并在 Edge 点击重新加载。

程序回退只撤回本次文件替换；新版本已开始运行后不自动降级数据库。工作空间备份始终独立保留，升级后的内容写入不会被程序回退覆盖。备份中包含私人稿件，请按自己的存储要求管理；打包脚本拒绝将含更新备份的安装目录作为 Release 输入。

## 实现依据

- [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)：用户手势、目录读写授权及句柄保存。
- [Chrome runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime)：扩展重载与上下文枚举。
- [Chrome management](https://developer.chrome.com/docs/extensions/reference/api/management)：读取本扩展安装方式。

SHA-256 用于校验通过 GitHub API 获取的发布文件；它不构成独立于发布账号的签名体系。
