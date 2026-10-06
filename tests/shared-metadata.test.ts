import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { content, database, fixture, imageFile } from "./helpers";
import { saveArticle } from "../src/core/db";
import { addAsset } from "../src/core/assets";
import {
  freezeSnapshot,
  newArticle,
  newVariant,
  resolveMetadata,
  setOverride,
  sha256,
  snapshotDiffers,
} from "../src/core/variants";
import { readiness } from "../src/core/render";
import { duplicateReason, enqueue, patchTask } from "../src/core/tasks";
import { channelState, distributionOf } from "../src/core/distribution";
import { exportBackup, restoreBackup } from "../src/core/backup";
import { ASSET_GRACE_MS, inspectUnusedAssets } from "../src/core/cleanup";
import { exportArticles } from "../src/core/export";
import { copyDraft, filterLibrary, libraryEntries } from "../src/core/library";
import type { RemotePost } from "../src/core/model";

const db = database();
beforeEach(() => db.open());
afterEach(() => db.delete());

describe("通用发布信息", () => {
  it("平台未单独填写时使用母稿的标签、摘要和封面，填写后只影响该平台", () => {
    const article = {
      ...newArticle("标题", "正文"),
      defaults: { tags: ["写作", "工具"], summary: "通用摘要", coverId: "a" },
    };
    const zhihu = newVariant(article, "zhihu:article");
    expect(resolveMetadata(article, zhihu)).toEqual({
      tags: ["写作", "工具"],
      category: "",
      summary: "通用摘要",
      coverId: "a",
    });
    const csdn = newVariant(article, "csdn:article");
    csdn.metadata = {
      tags: ["后端"],
      category: "技术",
      summary: "",
      coverId: "b",
    };
    expect(resolveMetadata(article, csdn)).toEqual({
      tags: ["后端"],
      category: "技术",
      summary: "通用摘要",
      coverId: "b",
    });
    expect(resolveMetadata(article, zhihu).tags).toEqual(["写作", "工具"]);
  });

  it("没有通用信息的旧稿件，内容指纹与之前一致，防重记录继续有效", async () => {
    const { article, variant, snapshot } = await fixture();
    const { imageIds, title, markdown } = article;
    expect(snapshot.fingerprint).toBe(
      await sha256(
        JSON.stringify({
          content: { title, markdown, imageIds },
          metadata: variant.metadata,
        }),
      ),
    );
    expect(snapshotDiffers(snapshot, article, variant)).toBe(false);
  });

  it("修改通用标签会改变各平台的发布内容，并被识别为稿件有更新", async () => {
    const article = newArticle("一篇足够长的标题", "正文");
    const variant = newVariant(article, "juejin:article");
    const before = await freezeSnapshot(article, variant);
    const tagged = { ...article, defaults: { tags: ["写作"], summary: "" } };
    const after = await freezeSnapshot(tagged, variant);
    expect(after.metadata.tags).toEqual(["写作"]);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(snapshotDiffers(before, tagged, variant)).toBe(true);
    expect(readiness(article, variant, "csdn:article", "publish")).toContain(
      "请填写标签",
    );
    expect(readiness(tagged, variant, "csdn:article", "publish")).toEqual([]);
  });

  it("编辑器保存通用信息时不增加母稿版本号，也不会被当作窗口冲突", async () => {
    const article = newArticle("标题", "正文");
    await saveArticle(article, db);
    const tagged = { ...article, defaults: { tags: ["写作"], summary: "" } };
    await saveArticle(tagged, db, { expected: article });
    expect((await db.articles.get(article.id))?.revision).toBe(1);
    expect((await db.articles.get(article.id))?.defaults?.tags).toEqual([
      "写作",
    ]);
    // Another window still holding the untagged row must not overwrite it.
    await expect(
      saveArticle({ ...article, title: "旧窗口" }, db, { expected: article }),
    ).rejects.toThrow("其他窗口");
  });

  it("备份恢复、内容导出、复制和搜索都带上通用信息，通用封面不会被清理", async () => {
    const cover = await addAsset(imageFile("封面.png"), db);
    await db.assets.update(cover.id, {
      createdAt: Date.now() - ASSET_GRACE_MS - 1000,
    });
    const article = {
      ...newArticle("带通用信息的稿件", "正文"),
      defaults: { tags: ["矩阵"], summary: "摘要", coverId: cover.id },
    };
    await db.articles.add(article);
    await db.variants.add(newVariant(article, "zhihu:article"));
    expect((await inspectUnusedAssets(db)).count).toBe(0);

    const files = unzipSync(
      new Uint8Array(
        await (await exportArticles([article.id], db)).arrayBuffer(),
      ),
    );
    const info = (path: string) =>
      JSON.parse(
        strFromU8(
          files[Object.keys(files).find((name) => name.endsWith(path))!]!,
        ),
      );
    expect(info("母稿/稿件信息.json").metadata.tags).toEqual(["矩阵"]);
    expect(info("zhihu-article/稿件信息.json").metadata).toMatchObject({
      tags: ["矩阵"],
      summary: "摘要",
    });

    const copy = await copyDraft(article, await db.variants.toArray(), db);
    expect(copy.defaults).toEqual(article.defaults);
    const entries = libraryEntries(await db.articles.toArray(), [], []);
    expect(
      filterLibrary(entries, {
        query: "矩阵",
        archived: false,
        channel: "all",
        publication: "all",
        sort: "updated",
      }),
    ).toHaveLength(2);

    const backup = await exportBackup(db);
    const restored = database();
    await restored.open();
    try {
      await restoreBackup(backup, restored);
      expect((await restored.articles.get(article.id))?.defaults).toEqual(
        article.defaults,
      );
    } finally {
      await restored.delete();
    }
  });
});

describe("稿件在各平台的状态", () => {
  it("按版本、任务和发布记录给出下一步状态", async () => {
    const { article, variant, snapshot } = await fixture("csdn:article", db);
    expect(
      channelState(article, "csdn:article", undefined, [], []).status,
    ).toBe("none");
    expect(channelState(article, "csdn:article", variant, [], []).status).toBe(
      "ready",
    );
    const [task] = await enqueue(
      [{ snapshot, prepared: content }],
      "draft",
      db,
    );
    const queued = await db.tasks.toArray();
    expect(
      channelState(article, "csdn:article", variant, [], queued).status,
    ).toBe("queued");
    await patchTask(task!.id, { state: "awaiting_publish" }, undefined, db);
    const waiting = channelState(
      article,
      "csdn:article",
      variant,
      [],
      await db.tasks.toArray(),
    );
    expect([waiting.status, waiting.label]).toEqual(["action", "等待手动发布"]);

    const post: RemotePost = {
      id: "post",
      articleId: article.id,
      channel: "csdn:article",
      remoteId: "1",
      url: "https://blog.csdn.net/a/article/details/1",
      title: article.title,
      status: "published",
      snapshot,
      registeredAt: Date.now() + 1000,
      updatedAt: Date.now() + 1000,
    };
    // A recorded result is newer than the task that produced it.
    expect(
      channelState(
        article,
        "csdn:article",
        variant,
        [post],
        await db.tasks.toArray(),
      ).status,
    ).toBe("published");
    const edited = { ...article, markdown: "发布后又改了", revision: 2 };
    expect(
      channelState(edited, "csdn:article", variant, [post], []).status,
    ).toBe("outdated");
    expect(
      distributionOf(edited, [variant], [post], []).filter(
        (state) => state.status !== "none",
      ),
    ).toHaveLength(1);
  });

  it("相同版本已在队列或已完成时给出原因，修改后可以再次分发", async () => {
    const { article, variant, snapshot } = await fixture("csdn:article", db);
    await enqueue([{ snapshot, prepared: content }], "draft", db);
    const tasks = await db.tasks.toArray();
    const candidate = { channel: snapshot.channel, mode: "draft" as const };
    expect(
      duplicateReason({ ...candidate, snapshot }, tasks, new Set()),
    ).toContain("相同版本已有任务");
    expect(
      duplicateReason(
        { ...candidate, snapshot },
        [],
        new Set([`csdn:article/draft/${snapshot.fingerprint}`]),
      ),
    ).toContain("防重记录");
    const changed = await freezeSnapshot(
      article,
      setOverride(variant, "title", "换一个标题再发"),
    );
    expect(
      duplicateReason({ ...candidate, snapshot: changed }, tasks, new Set()),
    ).toBeUndefined();
    expect(
      duplicateReason(
        { channel: snapshot.channel, mode: "publish", snapshot },
        tasks,
        new Set(),
      ),
    ).toBeUndefined();
  });
});
