# zMatrix 图标候选

打开 index.html 或 overview.png 查看 8 款候选。当前尚未修改扩展 manifest，也未应用任何候选。

每款包含 SVG 源文件及 16、24、32、48、128、256 px 透明 PNG。overview.png 中的小尺寸使用对应 PNG 原始像素嵌入，背景为模拟工具栏。

- **A 极简 z**：个人标识最直接，干净利落。
- **B 像素矩阵**：用矩阵里的亮点拼出 z。
- **C 一稿多发**：一份内容，连接多个平台。
- **D 朱砂印**：像给每篇作品落下一枚印章。
- **E 叠页**：母稿与各平台版本，一眼可见。
- **F 折带 z**：一条折带串起内容的流动。
- **G 对话气泡**：内容与互动，都有自己的位置。
- **H 矩阵之窗**：把不同平台，放进同一个窗口。

## 重新生成

使用 Node.js 和 sharp。若 sharp 不在当前模块搜索路径，将环境变量 ZMATRIX_RENDER_MODULES 指向已安装 sharp 的 node_modules 目录，再执行 node design/icon-options/generate.mjs。此依赖仅用于设计稿渲染，不增加扩展运行依赖。
