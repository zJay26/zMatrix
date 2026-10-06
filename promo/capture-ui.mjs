// 从本地网页预览（npm run preview / localhost:5173）抓取真实界面截图，供视频合成使用。
// 只使用内置示例稿和临时演示数据；不连接平台、不登录账号。
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./video/ui/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const URL_ = process.env.ZMATRIX_PREVIEW ?? "http://localhost:5173/";
const rects = {};

const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
  colorScheme: "light",
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 160)));
await p.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForSelector("#root *", { timeout: 120000 });
await p.addStyleTag({
  content: `
  *,*::before,*::after{transition:none!important;animation-duration:0s!important;caret-color:transparent!important}
  .cm-cursor,.cm-cursorLayer{display:none!important}
  .zm-hide{display:none!important}
  ::-webkit-scrollbar{width:0;height:0}`,
});
const wait = (ms) => p.waitForTimeout(ms);
const hideNotes = () =>
  p.evaluate(() => {
    for (const el of document.querySelectorAll(".distribute-main > *"))
      if (el.textContent.includes("这是本地界面预览")) el.classList.add("zm-hide");
  });
const hideToast = (hide) =>
  p.evaluate((hide) => {
    for (const el of document.querySelectorAll("[role=status],.toast,.toasts"))
      el.style.visibility = hide ? "hidden" : "";
  }, hide);
const rect = async (key, locator) => {
  try {
    const r = await locator.first().boundingBox();
    if (r) rects[key] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  } catch {}
};
const shot = async (name, ms = 500) => {
  await wait(ms);
  await p.mouse.move(5, 895);
  await p.screenshot({ path: new URL(`${name}.png`, OUT).pathname.slice(1) });
  console.log("shot", name);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log("FAIL", name, e.message.split("\n")[0]);
  }
};
const nav = (name) => p.locator("nav button, aside button").filter({ hasText: name }).first().click();

// ── 1. 示例稿：编辑器 ─────────────────────────────────────────
await p.getByText("用示例体验").click();
await p.waitForSelector(".cm-content");
await wait(3500);
await rect("ed.title", p.locator(".article-title"));
await rect("ed.addTab", p.locator(".add-tab"));
await rect("ed.distribute", p.getByRole("button", { name: "分发到平台" }));
await rect("ed.tools", p.locator("[aria-label='稿件工具']"));
await rect("ed.tagInput", p.getByPlaceholder("输入标签，回车添加"));
await rect("ed.source", p.locator(".cm-editor"));
await shot("ed0");

// 正文向下滚动，展示表格 / Mermaid / 公式的预览
const scrollPanes = (y) =>
  p.evaluate((y) => {
    const main = document.querySelector(".cm-scroller");
    main && (main.scrollTop = y * 0.82);
    const all = [...document.querySelectorAll("main *, section *")].filter(
      (e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY.match(/auto|scroll/) && !e.closest(".cm-editor"),
    );
    for (const e of all) if (e.querySelector("h1,h2,pre,table")) e.scrollTop = y;
  }, y);
await scrollPanes(520);
await shot("ed_scroll1", 1500);
await scrollPanes(1150);
await shot("ed_scroll2", 2500);
await scrollPanes(0);

await p.locator(".add-tab").click();
await wait(300);
await rect("ed.addAll", p.getByText("全部添加"));
await shot("ed_add");
await p.getByText("全部添加").click();
await wait(600);
await shot("ed1");

const tagInput = p.getByPlaceholder("输入标签，回车添加").first();
let i = 0;
for (const t of ["创作工具", "多平台分发", "效率"]) {
  await tagInput.fill(t);
  await tagInput.press("Enter");
  await shot(`ed_t${++i}`, 250);
}
await rect("ed.extract", p.getByText("从正文提取"));
await p.getByText("从正文提取").first().click();
await shot("ed_s", 400);
await rect("ed.inspector", p.getByText("通用发布信息").first().locator("xpath=ancestor::aside[1]"));

// ── 3. 图文制作 ───────────────────────────────────────────────
await step("card studio", async () => {
  await hideToast(true);
  await p.locator("[aria-label='稿件工具']").click();
  await wait(200);
  await shot("ed_tools", 200);
  await rect("ed.makeCards", p.getByText("制作图文"));
  await p.getByText("制作图文").first().click();
  await p.waitForSelector(".card-studio");
  await p.locator(".studio-options select").selectOption("technical");
  await rect("cs.modal", p.locator("[role=dialog]"));
  await rect("cs.generate", p.getByRole("button", { name: "生成预览" }));
  await shot("cs0", 500);
  await p.getByRole("button", { name: "生成预览" }).click();
  await p.waitForSelector(".card-grid img", { timeout: 90000 });
  await wait(2500);
  await shot("cs1", 500);
  const cards = await p.evaluate(async () => {
    const out = [];
    for (const img of document.querySelectorAll(".card-grid img")) {
      const blob = await (await fetch(img.src)).blob();
      out.push(
        await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.readAsDataURL(blob);
        }),
      );
    }
    return out;
  });
  cards.forEach((c, k) => writeFileSync(new URL(`card${k + 1}.png`, OUT), Buffer.from(c, "base64")));
  rects["cs.cards"] = cards.length;
  console.log("cards", cards.length);
  await p.locator("[role=dialog] .icon-button").first().click();
});

// ── 2. 分发面板 ───────────────────────────────────────────────
await p.getByRole("button", { name: "分发到平台" }).click();
await p.waitForSelector(".distribute");
await hideNotes();
await rect("dd.modal", p.locator("[role=dialog]"));
await rect("dd.side", p.locator(".distribute-side"));
await rect("dd.grid", p.locator(".target-grid"));
await rect("dd.primary", p.locator("[role=dialog] button.primary").last());
await rect("dd.queue", p.getByText("加入队列，稍后执行"));
const boxes = p.locator(".target-grid .target input[type=checkbox]");
const n = await boxes.count();
for (let k = 0; k < n; k++) await rect(`dd.check${k}`, p.locator(".target-grid .target").nth(k));
await shot("dd0", 800);
for (let k = 0; k < n; k++) {
  await boxes.nth(k).click();
  await hideNotes();
  await shot(`dd${k + 1}`, 350);
}
rects["dd.count"] = n;
await step("dd_preview", async () => {
  await p.locator(".target-open").first().click();
  await p.getByRole("button", { name: "内容预览" }).click();
  await hideNotes();
  await shot("dd_preview", 3500);
  await p.locator(".shared-target").click();
  await hideNotes();
});
await step("dd_mode", async () => {
  await p.getByRole("button", { name: "准备发布，手动确认" }).click();
  await hideNotes();
  await shot("dd_mode", 600);
  await p.getByRole("button", { name: "保存草稿" }).click();
});
await p.getByText("加入队列，稍后执行").click();
await wait(700);

// ── 4. 再写几篇稿件，让内容库和矩阵有内容 ──────────────────────
const extra = [
  ["从零搭建个人知识库：我的 Markdown 工作流", "记录我如何用纯文本管理笔记、草稿和发布记录。\n\n## 为什么是 Markdown\n\n可迁移、可版本化，也能直接进入发布流程。", ["知识管理", "Markdown"], [0, 1, 2, 3, 4]],
  ["TypeScript 类型体操入门：五个实用技巧", "从条件类型到模板字面量，五个在业务里真正用得上的写法。\n\n```ts\ntype Id<T> = T extends { id: infer U } ? U : never;\n```", ["TypeScript", "前端"], [0, 2, 3]],
  ["独立开发一年复盘：收入、踩坑与下一步", "这一年做了三个产品，这是完整的数字和教训。\n\n## 收入\n\n先讲最关心的部分。", ["独立开发", "复盘"], [0, 4, 5]],
  ["把浏览器扩展迁移到 Manifest V3 的全过程", "Service Worker、权限按需申请、内容安全策略，逐项记录迁移步骤。", ["浏览器扩展", "MV3"], []],
  ["写给新手的图文排版指南", "标题、留白和配色的三个原则，让笔记更容易被读完。", ["排版", "设计"], [4, 5]],
];
for (const [title, body, tags, picks] of extra) {
  await step(`article ${title}`, async () => {
    await p.locator(".new-article").click();
    await p.waitForSelector(".article-title");
    await wait(400);
    await p.locator(".article-title").fill(title);
    await p.locator(".cm-content").click();
    await p.keyboard.insertText(body);
    const ti = p.getByPlaceholder("输入标签，回车添加").first();
    for (const t of tags) {
      await ti.fill(t);
      await ti.press("Enter");
    }
    await wait(1500);
    if (!picks.length) return;
    await p.getByRole("button", { name: "分发到平台" }).click();
    await p.waitForSelector(".distribute");
    const cb = p.locator(".target-grid .target input[type=checkbox]");
    for (const k of picks) if (!(await cb.nth(k).isChecked())) await cb.nth(k).click();
    for (let k = 0; k < (await cb.count()); k++) if (!picks.includes(k) && (await cb.nth(k).isChecked())) await cb.nth(k).click();
    await wait(300);
    await p.getByText("加入队列，稍后执行").click();
    await wait(900);
  });
}

// ── 5. 队列 / 内容库 / 总览 ───────────────────────────────────
await hideToast(true);
await step("queue", async () => {
  await nav("发布队列");
  await shot("queue", 900);
});
await step("library", async () => {
  await nav("内容库");
  await shot("lib_grid", 900);
  await p.locator("[title='平台矩阵视图']").click();
  await rect("lib.matrix", p.locator(".matrix"));
  await shot("lib_matrix", 700);
});
await step("home", async () => {
  await nav("总览");
  await shot("home", 900);
});

// ── 6. 深色外观 ───────────────────────────────────────────────
await step("dark", async () => {
  const toggle = p.locator(".theme-toggle");
  for (let k = 0; k < 4 && !(await toggle.innerText()).includes("深色"); k++) await toggle.click();
  await nav("内容库");
  await shot("lib_matrix_dark", 900);
  await p.locator("[title='卡片视图']").click();
  await shot("lib_grid_dark", 600);
  await p.getByText("用一篇稿件，连接每个平台").first().click();
  await p.waitForSelector(".cm-content");
  await shot("ed_dark", 3500);
});

writeFileSync(new URL("rects.json", OUT), JSON.stringify(rects, null, 1));
await b.close();
console.log("done");
