# zMatrix · 自媒体矩阵工作台

面向个人创作者，在本地集中管理内容、平台版本、发布准备、文章数据与评论。

A local-first workspace for managing content across creator platforms, delivered as a Microsoft Edge extension.

Microsoft Edge Manifest V3 本地扩展，使用 WXT、React、TypeScript、Dexie、CodeMirror 6、unified、KaTeX、Mermaid 和 html-to-image。

**当前是 0.1.2 开发预览，尚未达到完整 v1 验收标准。** 验收覆盖六条路径的保存草稿与发布前准备，最后发布由用户手动完成。五站真实指标与评论仍需逐项实测。按钮存在、单元测试通过和网页预览均不算真实平台验收通过。详情见 [验收记录](docs/acceptance.md)。

## 获取与安装

从 [GitHub Releases](https://github.com/zJay26/zMatrix/releases) 下载 `zMatrix-edge-0.1.2.zip`，解压到固定目录，在 Edge 的 `edge://extensions` 中开启开发人员模式并选择“加载解压缩的扩展”。选中的目录应直接包含 `manifest.json`。

点击扩展工具栏中的 **zMatrix** 打开独立标签页工作台。详细步骤、升级与数据恢复见 [安装说明](docs/installation.md)。

## 已实现的本地工作流

- Markdown 写作、图片粘贴、Markdown 文件及配套图片目录导入。
- 母稿与七种平台版本，独立覆盖、继承恢复、母稿变化提醒、正文差异。
- 代码、表格、LaTeX、Mermaid 预览；按平台能力转换公式、图表、表格为图片。
- 三种固定图文模板、封面、主题色、字号、边距与分页，输出 1080 × 1440 PNG。
- 发布前预览、冻结版本、持久化串行任务、意外中断后先核实，避免直接重发。
- “准备发布，手动确认”不会自动点击最终发布；设置未核对齐全时显示“发布设置待核对”，只有核对齐全才显示“等待手动发布”。旧队列的 publish 任务也按此边界执行。
- 登记文章链接、按文章缓存指标与评论、分页去重和工具内已读状态。
- IndexedDB 自动保存；ZIP 导出、校验和恢复；授权目录自动备份及前一份备份。
- 平台适配器框架、原生编辑器填充、草稿和发布操作、结果核实、指标与评论读取路径。尚未通过真实验收的能力明确标注。
- 自动最终发布入口已禁用。除博客园已观察到的单页表单外，其余平台最终设置步骤仍需原站实测补齐；提前停止不算发布前验收通过。

## 开发

使用 Node.js 24。依赖版本由 package-lock.json 固定；GitHub CI 对公开提交执行相同的检查与打包流程。

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run package
```

`npm run preview` 在 `http://127.0.0.1:5173` 打开界面测试。它拥有独立的本地数据库，不连接平台。为稳定进行手动验收，预览关闭 HMR；修改代码后刷新页面。

`npm run preview:built` 在 `http://127.0.0.1:4173` 打开编译后的界面，并施加与扩展相同的脚本 CSP。此处同样是网页预览，不具备扩展权限；它用于检查正式构建的显示、存储、打包 Worker 与恢复流程，不能代替实际扩展验收。

扩展目录是 `.output/edge-mv3`；发布 ZIP、源码 ZIP 和 SHA256 位于 `dist`。安装和更新见 [说明](docs/installation.md)。

## 数据与权限

所有稿件、素材、任务与缓存均存于扩展 IndexedDB。没有服务器、遥测、密码保存或 Cookie 导出。连接某平台时才请求该平台的站点访问权限，复用 Edge 中已有的登录状态。

扩展后台只能从自己的工作台接收有限的任务命令。发布任务先存储不可变内容，再操作原站；同版本同平台同操作禁止重复排队。提交超时、中断或无法完整核对时保留“结果待核实”。重新打开工作台不会自动继续待发布任务。

恢复备份是原子合并：已有本地记录优先，导入缺失记录，素材验证 SHA256，未完成任务暂停，旧标签页 ID 丢弃。格式目前为 version 1，未知格式拒绝恢复。备份不包含平台登录信息。

## 代码结构

| 目录              | 内容                                         |
| ----------------- | -------------------------------------------- |
| `src/core`        | 数据模型、版本、导入转换、备份、任务与聚合   |
| `src/platforms`   | 能力声明、URL 校验、平台页面适配与结果核实   |
| `src/entrypoints` | MV3 后台、扩展工作台入口                     |
| `src/ui`          | 编辑器、图文制作、发布队列、数据、评论和设置 |
| `tests`           | 版本、任务、转换、备份、评论、平台保护测试   |
| `docs`            | 安装、开发验收、可选公开验收稿               |

本项目原创代码采用 [MIT License](LICENSE)。第三方依赖与参考实现部分保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；扩展包与源码包均附带许可文本。

开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。为兼容早期版本，扩展公开 `key`、IndexedDB 数据库名及备份格式标识保持稳定。
