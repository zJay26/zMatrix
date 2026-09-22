import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { database, fixture, imageFile } from "./helpers";
import { importMarkdownFiles, normalizePath } from "../src/core/import";
import {
  renderMarkdown,
  conversionRanges,
  prepareContent,
  preflight,
} from "../src/core/render";
import { sanitizePreparedHtml } from "../src/core/sanitize";
import { parseRemoteUrl } from "../src/platforms/catalog";
import { matchesContent } from "../src/platforms/browser-adapter";
const db = database();
afterEach(async () => {
  await db.delete();
});
beforeEach(async () => {
  await db.open();
});
describe("内容转换", () => {
  it("只转换公式和 Mermaid，不误转换代码内的美元符号", async () => {
    const { snapshot } = await fixture("zhihu:article");
    const source =
      '行内 $x^2$\n\n```js\nconst s = "$x$";\n```\n\n```mermaid\ngraph LR\nA-->B\n```';
    const ranges = conversionRanges(source, snapshot);
    expect(ranges.map((r) => r.label)).toEqual(["公式", "Mermaid 图表"]);
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe("$x^2$");
  });
  it("中文、代码、表格和公式保留；原始 HTML 不执行", async () => {
    const html = await renderMarkdown(
      "# 中文\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n$E=mc^2$\n\n|甲|乙|\n|--|--|\n|1|2|",
    );
    expect(html).toContain("<h1>中文</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("katex");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
    expect(
      await sanitizePreparedHtml(
        '<img src="data:image/png;base64,aA==" onerror="evil()"><script>evil()</script>',
      ),
    ).not.toMatch(/onerror|script/);
  });
  it("图片回退生成素材和提醒，保留原快照源码", async () => {
    const { snapshot } = await fixture("zhihu:article");
    snapshot.markdown = "正文 $x^2$";
    const prepared = await prepareContent(snapshot, db, async () =>
      imageFile(),
    );
    expect(prepared.markdown).toContain("asset://");
    expect(prepared.assets).toHaveLength(1);
    expect(prepared.html).toContain("data:image/png;base64,");
    expect(prepared.warnings).toHaveLength(1);
    expect(snapshot.markdown).toBe("正文 $x^2$");
  });
  it("平台不支持的外链图片不能静默丢失", async () => {
    const { snapshot } = await fixture();
    snapshot.markdown = "![图](https://example.com/a.png)";
    await expect(prepareContent(snapshot, db)).rejects.toThrow("外链图片");
  });
  it("发布前识别必填项，Markdown 平台详情页按渲染文本核实", async () => {
    const { snapshot, prepared } = await fixture("juejin:article");
    expect(preflight(snapshot, "publish")).toContain("请填写分类");
    prepared.markdown = "**正文**";
    prepared.text = "正文";
    expect(
      matchesContent(
        { ok: true, url: "", title: snapshot.title, body: "正文" },
        snapshot,
        prepared,
        true,
      ),
    ).toBe(true);
    expect(
      matchesContent(
        { ok: true, url: "", title: snapshot.title, body: "被截断" },
        snapshot,
        prepared,
        true,
      ),
    ).toBe(false);
  });
});
describe("Markdown 导入", () => {
  it("保留普通相对链接，只改写图片和图片引用定义", async () => {
    const md = new File(
      [
        "# 测试\n\n![甲](图片.png)\n\n![乙][img]\n\n[img]: 图片.png\n[普通链接][readme]\n[readme]: README.md",
      ],
      "测试.markdown",
    );
    const [article] = await importMarkdownFiles([md, imageFile()], db);
    expect(article?.markdown).toContain("[readme]: README.md");
    expect(article?.imageIds).toHaveLength(1);
    expect(article?.markdown.match(/asset:\/\//g)).toHaveLength(2);
    expect(await db.assets.count()).toBe(1);
  });
  it("保持嵌套目录图片关系，并拒绝越过导入根目录", async () => {
    const md = new File(["![图](./images/图片.png)"], "正文.md");
    Object.defineProperty(md, "webkitRelativePath", { value: "稿件/正文.md" });
    const [article] = await importMarkdownFiles(
      [md, imageFile("图片.png", "稿件/images/图片.png")],
      db,
    );
    expect(article?.imageIds).toHaveLength(1);
    expect(() => normalizePath("../outside.png")).toThrow("超出");
    await expect(
      importMarkdownFiles([new File(["![缺图](missing.png)"], "缺图.md")], db),
    ).rejects.toThrow("找不到");
    expect(await db.articles.count()).toBe(1);
  });
});
describe("登记链接", () => {
  it("校验域名和类型并保留小红书详情页必要签名", () => {
    expect(
      parseRemoteUrl(
        "https://blog.csdn.net/me/article/details/123?utm=x",
        "csdn:article",
      ).url,
    ).toBe("https://blog.csdn.net/me/article/details/123");
    expect(() =>
      parseRemoteUrl("https://blog.csdn.net.evil.test/me/article/details/123"),
    ).toThrow();
    expect(() => parseRemoteUrl("javascript:alert(1)")).toThrow();
    expect(() =>
      parseRemoteUrl("https://juejin.cn/post/123", "csdn:article"),
    ).toThrow();
    expect(
      parseRemoteUrl(
        "https://www.xiaohongshu.com/explore/012345678901234567890123?xsec_token=demo",
        "xiaohongshu:article",
      ).url,
    ).toContain("xsec_token=demo");
  });
});
