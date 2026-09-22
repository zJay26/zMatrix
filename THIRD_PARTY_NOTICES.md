# 第三方组件与参考实现

zMatrix 原创代码采用根目录 MIT License。第三方组件与参考实现部分保留原许可证，不能将根目录的 MIT 声明视为对这些部分的重新授权。

本项目使用 WXT、React、TypeScript、Dexie、CodeMirror、unified / remark / rehype、KaTeX、Mermaid、html-to-image、fflate、Zod、Lucide 和 diff 等公开组件。版本见 package-lock.json；打包脚本会附带已安装生产依赖的许可证原文及包名版本，详见发布包中的 THIRD_PARTY_LICENSES.txt。

## MultiPost Extension

- 项目：https://github.com/leaperone/MultiPost-Extension
- 作者和原始版权归 MultiPost Extension 项目及其贡献者。
- 许可证：Apache License 2.0。
- 参考范围：原生平台编辑器定位、富文本粘贴，以及博客园图片上传的 FormData / XSRF 处理。
- 涉及文件：`src/platforms/page-driver.ts`；其中参考衍生部分保留 Apache-2.0 条件，文件头包含组合许可标识。
- 本项目重新组织了适配接口，加入持久化任务、结果核实、重复提交保护和本地工作台。未复制或使用该项目的远端同步服务。

参考源路径：`src/sync/article/zhihu.ts`、`juejin.ts`、`cnblogs.ts`、`src/sync/dynamic/rednote.ts`。这些源码只作为公开实现参考，不能证明在当前账号上可用。

Apache License 2.0 全文随源码保存在 `docs/licenses/Apache-2.0.txt`，并包含在扩展发布包的许可文本中。
