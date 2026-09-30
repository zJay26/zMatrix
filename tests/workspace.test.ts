import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { database, imageFile } from "./helpers";
import { saveArticle, saveVariant } from "../src/core/db";
import { newArticle, newVariant, setOverride } from "../src/core/variants";
import { importMarkdownFiles } from "../src/core/import";
import { addAsset } from "../src/core/assets";
import {
  archiveArticles,
  duplicateArticle,
  filterLibrary,
  libraryEntries,
  type LibraryFilter,
} from "../src/core/library";
import {
  exportArticles,
  exportCurrentContent,
  safeFilename,
} from "../src/core/export";
import { strFromU8, unzipSync } from "fflate";

const db = database();
beforeEach(() => db.open());
afterEach(() => db.delete());

describe("多窗口保存与导入完整性", () => {
  it("两个窗口首次创建同一平台版本时，后写入者不能覆盖先保存的内容", async () => {
    const article = newArticle();
    await db.articles.add(article);
    const variant = newVariant(article, "zhihu:article");
    await saveVariant(setOverride(variant, "title", "先写入"), db, {
      expected: undefined,
    });
    await expect(
      saveVariant(setOverride(variant, "title", "后写入"), db, {
        expected: undefined,
      }),
    ).rejects.toThrow("其他窗口");
    expect((await db.variants.get(variant.id))?.overrides.title).toBe("先写入");
  });

  it("同时添加相同图片只保留一个二进制记录", async () => {
    const file = imageFile();
    const [first, second] = await Promise.all([
      addAsset(file, db),
      addAsset(file, db),
    ]);
    expect(first.id).toBe(second.id);
    expect(await db.assets.count()).toBe(1);
  });

  it("旧窗口继续输入更高版本号，也不能覆盖另一个窗口的正文", async () => {
    const base = newArticle("初稿", "原文");
    await saveArticle(base, db);
    await saveArticle({ ...base, markdown: "另一个窗口", revision: 2 }, db);
    await expect(
      saveArticle({ ...base, markdown: "旧窗口继续输入", revision: 3 }, db, {
        expected: base,
      }),
    ).rejects.toThrow("其他窗口");
    expect((await db.articles.get(base.id))?.markdown).toBe("另一个窗口");
  });

  it("平台版本也拒绝基于过期内容的覆盖", async () => {
    const article = newArticle();
    await db.articles.add(article);
    const base = newVariant(article, "csdn:article");
    await saveVariant(base, db);
    await saveVariant(setOverride(base, "title", "其他窗口的标题"), db);
    await expect(
      saveVariant(setOverride(base, "markdown", "过期窗口的正文"), db, {
        expected: base,
      }),
    ).rejects.toThrow("其他窗口");
    expect((await db.variants.get(base.id))?.overrides.title).toBe(
      "其他窗口的标题",
    );
  });

  it("第二篇导入失败时，第一篇及其图片均不留下半成品", async () => {
    const first = new File(["# 第一篇\n![图片](photo.png)"], "first.md");
    const second = new File(["![缺失](missing.png)"], "second.md");
    await expect(
      importMarkdownFiles([first, second, imageFile("photo.png")], db),
    ).rejects.toThrow("找不到配套图片");
    expect(await db.articles.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
    expect(await db.meta.get("dataChangedAt")).toBeUndefined();
  });
});

describe("内容库与可携带导出", () => {
  it("复制包含独立版本和图片引用，不继承原稿的发布记录", async () => {
    const asset = await addAsset(imageFile(), db);
    const article = {
      ...newArticle("原稿", `![图片](asset://${asset.id})`),
      imageIds: [asset.id],
      archived: true,
    };
    const variant = setOverride(
      newVariant(article, "csdn:article"),
      "title",
      "独立标题",
    );
    await db.articles.add(article);
    await db.variants.add(variant);
    await db.posts.add({
      id: "post",
      articleId: article.id,
      channel: "csdn:article",
      remoteId: "1",
      url: "https://blog.csdn.net/demo/article/details/1",
      title: "原稿",
      status: "published",
      registeredAt: 1,
      updatedAt: 1,
    });
    const copy = await duplicateArticle(article.id, db);
    expect(copy).toMatchObject({
      title: "原稿 · 副本",
      revision: 1,
      archived: false,
      imageIds: [asset.id],
    });
    expect(copy.id).not.toBe(article.id);
    expect(
      (await db.variants.where("articleId").equals(copy.id).first())?.overrides
        .title,
    ).toBe("独立标题");
    expect(await db.posts.where("articleId").equals(copy.id).count()).toBe(0);
    expect(await db.assets.count()).toBe(1);
  });

  it("批量归档读取最新内容；缺失记录使整批回滚，归档不制造版本差异", async () => {
    const article = newArticle("最新内容");
    await db.articles.add(article);
    await expect(
      archiveArticles([article.id, "missing"], true, db),
    ).rejects.toThrow("已不存在");
    expect((await db.articles.get(article.id))?.archived).toBe(false);
    await archiveArticles([article.id], true, db);
    expect(await db.articles.get(article.id)).toMatchObject({
      title: "最新内容",
      archived: true,
      revision: 1,
    });
    await archiveArticles([article.id], false, db);
    expect((await db.articles.get(article.id))?.archived).toBe(false);
  });

  it("多词搜索可组合平台独立标题和标签，发布状态仅按登记记录筛选", () => {
    const article = newArticle("母稿");
    const variant = setOverride(
      newVariant(article, "csdn:article"),
      "title",
      "TypeScript 实践",
    );
    variant.metadata.tags = ["工具"];
    const entries = libraryEntries([article], [variant], []);
    const filter: LibraryFilter = {
      query: " TYPESCRIPT 工具 ",
      archived: false,
      channel: "csdn:article",
      publication: "unpublished",
      sort: "title",
    };
    expect(filterLibrary(entries, filter)).toHaveLength(1);
    expect(
      filterLibrary(entries, { ...filter, publication: "published" }),
    ).toHaveLength(0);
    expect(
      filterLibrary(entries, { ...filter, channel: "zhihu:article" }),
    ).toHaveLength(0);
  });

  it("导出每个平台的实际内容并携带图片，Markdown 可以连同目录重新导入", async () => {
    const asset = await addAsset(imageFile(), db);
    const article = {
      ...newArticle("含图母稿", `# 含图母稿\n![图片](asset://${asset.id})`),
      imageIds: [asset.id],
    };
    const variant = setOverride(
      newVariant(article, "zhihu:article"),
      "markdown",
      `# 独立正文\n![图片](asset://${asset.id})`,
    );
    variant.metadata.coverId = asset.id;
    await db.articles.add(article);
    await db.variants.add(variant);
    const zip = unzipSync(
      new Uint8Array(
        await (await exportArticles([article.id], db)).arrayBuffer(),
      ),
    );
    const source = Object.keys(zip).find((path) =>
      path.endsWith("母稿/正文.md"),
    )!;
    const platform = Object.keys(zip).find((path) =>
      path.endsWith("zhihu-article/正文.md"),
    )!;
    expect(strFromU8(zip[source]!)).toContain(`images/${asset.id}.png`);
    expect(strFromU8(zip[platform]!)).toContain("独立正文");
    expect(strFromU8(zip[platform]!)).not.toContain("asset://");
    const folder = source.slice(0, -"正文.md".length);
    const files = Object.entries(zip)
      .filter(
        ([path]) =>
          path.startsWith(folder) &&
          (path.endsWith(".md") || path.endsWith(".png")),
      )
      .map(([path, bytes]) => {
        const f = new File(
          [bytes as Uint8Array<ArrayBuffer>],
          path.split("/").at(-1)!,
          { type: path.endsWith(".png") ? "image/png" : "text/markdown" },
        );
        Object.defineProperty(f, "webkitRelativePath", { value: path });
        return f;
      });
    const [restored] = await importMarkdownFiles(files, db);
    expect(restored?.markdown).toBe(article.markdown);
    expect(restored?.imageIds).toEqual([asset.id]);
    expect(await db.assets.count()).toBe(1);
  });

  it("缺失素材不能导出成假完整文件，Windows 文件名可安全保存", async () => {
    await expect(
      exportCurrentContent(
        { title: "丢图", markdown: "", imageIds: ["a".repeat(64)] },
        undefined,
        db,
      ),
    ).rejects.toThrow("缺少图片");
    expect(safeFilename("CON.txt")).toBe("_CON.txt");
    expect(safeFilename("题/目:*?. ")).toBe("题_目___");
  });
});
