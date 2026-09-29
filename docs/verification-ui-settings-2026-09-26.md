# 界面、设置与更新检测验证

范围：在已有未提交工作台改动上改进 UI，新增通用偏好与自选更新检测；保留扩展身份、数据库名、备份格式及手动发布边界。未创建 Git 提交、推送或公开 Release。

## 已完成检查

- `npm run typecheck`：通过。
- `npm test -- --reporter=dot`：8 个测试文件、84 项通过。新增覆盖字体范围及偏好持久化、并发设置合并、语义版本排序、预览版筛选、受信任的扩展包链接、只读取版本元数据、六小时去重、关闭后手动检查、离线／限流／404、频道切换失败后的缓存处理、并发租约、关闭提醒和后台闹钟重建。
- `npm run build`：Edge MV3 构建通过。
- `git diff --check`：通过。
- 构建 manifest：公开身份 key 与原文件一致；原 CSP 保持 `script-src 'self'; object-src 'self'`；新增 `alarms` 和 GitHub API 主机权限。
- 示例测试使用独立的 `http://127.0.0.1:5219` 来源；未操作已有扩展的真实稿件、平台登录或发布任务。

## 浏览器检查

- 通用偏好、软件更新和内容库在 Edge 中打开正常；构建预览启用与扩展相同的 CSP，所查控制台无错误或警告。
- 将界面字号设为 22px、编辑字号设为 26px，立即读取到相应的计算字号；重新加载后设置保留。
- 列表与“仅编辑”默认视图重新打开后生效。恢复默认后返回卡片、双栏和 16px／17px，并保留此前关闭的自动更新开关。
- 390px 宽度、22px 界面字号的设置页无水平溢出：文档宽度 375px（其余为滚动条），可用控件仍出现在可访问性树中。
- 最终构建的编辑器和预览均为 17px，编辑器使用 Cascadia Code／Consolas／Microsoft YaHei 字体链；代码、表格、公式和 Mermaid 示例预览正常。
- 真实 GitHub 检查：包含预览版时识别 `v0.1.2`；仅正式版时显示“暂无可用版本”。关闭自动检测后手动检查成功，恢复默认偏好不会覆盖更新选项。
- 本地截图：`validation/ui-settings/settings-desktop.png`。

## 验证边界

后台六小时调度、重建闹钟与并发恢复通过模拟 API 的自动化测试，本轮未让真实 Edge 后台连续运行六小时，也未在用户的已安装扩展上执行更新安装。新版本分支使用受控 Release 数据验证；远端当前没有高于本地 0.1.2 的版本可进行真实升级验收。

更新功能自动检测并提供手动下载入口；当前解压扩展仍需用户替换文件并在扩展管理页重新加载，不会静默下载、安装或刷新工作台。现有公开 v0.1.2 Release 不包含这些源码改动。

实现依据：[Chrome alarms 文档](https://developer.chrome.com/docs/extensions/reference/api/alarms)、[扩展重新加载](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)、[GitHub Releases API](https://docs.github.com/en/rest/releases/releases)。
