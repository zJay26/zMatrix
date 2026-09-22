import { defineConfig } from "wxt";
import { readFileSync } from "node:fs";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  webExt: { disabled: true },
  manifest: {
    name: "zMatrix · 自媒体矩阵工作台",
    description:
      "面向个人创作者的自媒体矩阵工作台，在本地统一管理内容、平台版本、发布准备与文章数据。",
    key: JSON.parse(
      readFileSync(
        new URL("./extension-identity.json", import.meta.url),
        "utf8",
      ),
    ).key,
    minimum_chrome_version: "116",
    permissions: ["storage", "scripting", "unlimitedStorage"],
    optional_host_permissions: [
      "https://*.zhihu.com/*",
      "https://juejin.cn/*",
      "https://*.cnblogs.com/*",
      "https://*.csdn.net/*",
      "https://*.xiaohongshu.com/*",
      "https://linux.do/*",
    ],
    action: { default_title: "打开 zMatrix 工作台" },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
