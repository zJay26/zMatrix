import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { database, fixture, imageFile } from "./helpers";
import { WorkbenchDB, saveArticle, saveVariant } from "../src/core/db";
import { addAsset } from "../src/core/assets";
import { newVariant } from "../src/core/variants";
import { enqueue, claimTask, removeTasks, patchTask } from "../src/core/tasks";
import {
  trashArticles,
  restoreArticles,
  purgeArticles,
  removePosts,
  inspectUnusedAssets,
  cleanUnusedAssets,
  removeVariant,
  ASSET_GRACE_MS,
} from "../src/core/cleanup";
import { exportBackup, inspectBackup, restoreBackup } from "../src/core/backup";
import { mergeCommentPage, registerPost } from "../src/core/collection";
import { filterLibrary, libraryEntries } from "../src/core/library";

const db = database();
beforeEach(() => db.open());
afterEach(() => db.delete());
describe("清理与数据保护", () => {
  it("原数据库升级后保留稿件、任务和扩展存储身份", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      articles: "id,updatedAt,archived",
      variants: "id,articleId,channel",
      assets: "id",
      tasks: "id,batchId,state,createdAt",
      posts: "id,articleId,channel,&[channel+remoteId],updatedAt",
      metrics: "postId",
      comments: "id,postId,[postId+remoteId],collectedAt",
      commentSync: "postId",
      meta: "key",
      probes: "channel",
    });
    const f = await fixture();
    await legacy.table("articles").add(f.article);
    legacy.close();
    const upgraded = new WorkbenchDB(name);
    try {
      expect(await upgraded.articles.get(f.article.id)).toEqual(f.article);
      expect(await upgraded.taskReceipts.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
  it("回收站隐藏稿件、保留版本，取消待执行任务，恢复不自动执行", async () => {
    const f = await fixture(undefined, db);
    await db.variants.add(f.variant);
    const [task] = await enqueue([f], "publish", db);
    await trashArticles([f.article.id], db);
    const article = (await db.articles.get(f.article.id))!;
    expect(article.trashedAt).toBeGreaterThan(0);
    expect(await db.variants.get(f.variant.id)).toEqual(f.variant);
    const filter = {
      archived: false,
      query: "",
      channel: "all",
      publication: "all",
      sort: "updated",
    } as const;
    expect(
      filterLibrary(libraryEntries([article], [], []), filter),
    ).toHaveLength(0);
    expect(
      filterLibrary(libraryEntries([article], [], []), {
        ...filter,
        trashed: true,
      }),
    ).toHaveLength(1);
    expect(await claimTask(task!.id, "worker", db)).toBeUndefined();
    await restoreArticles([article.id], db);
    expect((await db.tasks.get(task!.id))?.state).toBe("cancelled");
    expect((await db.articles.get(article.id))?.trashedAt).toBeUndefined();
  });
  it("已被后台领取时整批删除回滚，反过来删除后不能再领取", async () => {
    const f = await fixture(undefined, db),
      other = await fixture(undefined, db);
    const [task] = await enqueue([f], "publish", db);
    await claimTask(task!.id, "worker", db);
    await expect(
      trashArticles([other.article.id, f.article.id], db),
    ).rejects.toThrow("核实");
    expect(
      (await db.articles.get(other.article.id))?.trashedAt,
    ).toBeUndefined();
    await expect(removeTasks([task!.id], db)).rejects.toThrow("核实");
  });
  it.each([
    "failed",
    "cancelled",
    "uncertain",
    "awaiting_publish",
    "awaiting_review",
  ] as const)("%s 有原站活动时不允许清理", async (state) => {
    const f = await fixture(undefined, db);
    const [task] = await enqueue([f], "publish", db);
    await patchTask(task!.id, { state, tabId: 123 }, undefined, db);
    await expect(removeTasks([task!.id], db)).rejects.toThrow("核实");
    expect(await db.tasks.get(task!.id)).toBeDefined();
  });
  it("清理成功任务后仍然防重，备份恢复后保护继续生效", async () => {
    const f = await fixture(undefined, db);
    const [task] = await enqueue([f], "publish", db);
    await patchTask(
      task!.id,
      { state: "published", remoteId: "123" },
      undefined,
      db,
    );
    await removeTasks([task!.id], db);
    expect(await db.tasks.count()).toBe(0);
    await expect(enqueue([f], "publish", db)).rejects.toThrow("已有任务");
    const target = database();
    try {
      await restoreBackup(await exportBackup(db), target);
      await expect(enqueue([f], "publish", target)).rejects.toThrow("已有任务");
      await expect(enqueue([f], "draft", target)).resolves.toHaveLength(1);
    } finally {
      await target.delete();
    }
  });
  it("取消并移除未执行任务后，可以主动重新排队", async () => {
    const f = await fixture(undefined, db);
    const [task] = await enqueue([f], "draft", db);
    await removeTasks([task!.id], db);
    expect(await db.taskReceipts.count()).toBe(0);
    await expect(enqueue([f], "draft", db)).resolves.toHaveLength(1);
  });
  it("旧备份恢复的待执行任务不能绕过清理后的防重凭据", async () => {
    const f = await fixture(undefined, db);
    const [task] = await enqueue([f], "publish", db);
    const oldBackup = await exportBackup(db);
    await patchTask(task!.id, { state: "published" }, undefined, db);
    await removeTasks([task!.id], db);
    await restoreBackup(oldBackup, db);
    expect(await claimTask(task!.id, "worker", db)).toBeUndefined();
    expect((await db.tasks.get(task!.id))?.state).toBe("cancelled");
  });
  it("回收站标记随备份保留，彻底删除保留独立发布记录和素材", async () => {
    const f = await fixture(undefined, db);
    const asset = await addAsset(imageFile(), db);
    f.snapshot.imageIds = [asset.id];
    await registerPost(
      "https://blog.csdn.net/demo/article/details/123",
      f.article.title,
      f.snapshot.channel,
      f.article.id,
      f.snapshot,
      db,
    );
    await db.variants.add(f.variant);
    await trashArticles([f.article.id], db);
    expect(
      (await inspectBackup(await exportBackup(db))).articles[0]?.trashedAt,
    ).toBeGreaterThan(0);
    await purgeArticles([f.article.id], db);
    expect(await db.articles.count()).toBe(0);
    expect(await db.variants.count()).toBe(0);
    expect((await db.posts.toArray())[0]?.articleId).toBeUndefined();
    expect((await db.posts.toArray())[0]?.snapshot).toEqual(f.snapshot);
    expect(await db.assets.count()).toBe(1);
  });
  it("旧编辑窗口不能复活删除稿件或再建平台版本和任务", async () => {
    const f = await fixture(undefined, db);
    await trashArticles([f.article.id], db);
    await expect(
      saveArticle({ ...f.article, revision: 2 }, db, { expected: f.article }),
    ).rejects.toThrow("回收站");
    await expect(
      saveVariant(f.variant, db, { expected: undefined }),
    ).rejects.toThrow("回收站");
    await purgeArticles([f.article.id], db);
    await expect(
      saveArticle({ ...f.article, revision: 2 }, db, { expected: f.article }),
    ).rejects.toThrow("其他窗口");
    await expect(saveVariant(f.variant, db)).rejects.toThrow("删除");
    await expect(enqueue([f], "draft", db)).rejects.toThrow("删除");
  });
  it("移除平台版本要核对最新值，其他窗口的修改不会丢失", async () => {
    const f = await fixture(undefined, db);
    await db.variants.add(f.variant);
    await db.variants.update(f.variant.id, {
      metadata: { ...f.variant.metadata, summary: "其他窗口编辑" },
    });
    await expect(removeVariant(f.variant, db)).rejects.toThrow("其他窗口");
    await trashArticles([f.article.id], db);
    await expect(
      removeVariant((await db.variants.get(f.variant.id))!, db),
    ).rejects.toThrow("回收站");
  });
  it("删除登记同步移除缓存，迟到的评论刷新不会复活记录", async () => {
    const post = await registerPost(
      "https://blog.csdn.net/demo/article/details/123",
      "文章",
      "csdn:article",
      undefined,
      undefined,
      db,
    );
    const page = {
      comments: [
        {
          remoteId: "c1",
          author: "读者",
          body: "留言",
          publishedAt: "今天",
          url: post.url,
        },
      ],
      scope: "当前页",
      complete: true,
    };
    await mergeCommentPage(post, page, db);
    await removePosts([post.id], db);
    await mergeCommentPage(post, page, db);
    expect(await db.posts.count()).toBe(0);
    expect(await db.comments.count()).toBe(0);
    expect(await db.commentSync.count()).toBe(0);
  });
  it("清理保护回收站、封面、正文、任务及发布快照；确认前新增的引用也保留", async () => {
    const f = await fixture(undefined, db);
    const old = Date.now() - ASSET_GRACE_MS - 10000;
    const assets = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        addAsset(new File([String(i)], `p${i}.png`, { type: "image/png" }), db),
      ),
    );
    for (const asset of assets)
      await db.assets.update(asset.id, { createdAt: old });
    await db.articles.update(f.article.id, {
      trashedAt: 1,
      markdown: `![正文](asset://${assets[0]!.id})`,
      imageIds: [assets[1]!.id],
    });
    const variant = newVariant(f.article, "zhihu:article");
    variant.metadata.coverId = assets[2]!.id;
    await db.variants.add(variant);
    await registerPost(
      "https://blog.csdn.net/demo/article/details/123",
      "文章",
      "csdn:article",
      undefined,
      { ...f.snapshot, imageIds: [assets[3]!.id] },
      db,
    );
    const other = await fixture(undefined, db);
    const [task] = await enqueue([other], "draft", db);
    await db.tasks.update(task!.id, {
      prepared: {
        ...other.prepared,
        markdown: `![图](asset://${assets[4]!.id})`,
        assets: [
          { id: assets[5]!.id, name: "a", type: "image/png", dataUrl: "data:" },
        ],
      },
    });
    const before = await inspectUnusedAssets(db);
    expect(before.count).toBe(2);
    await db.articles.update(other.article.id, { imageIds: [assets[6]!.id] });
    expect((await cleanUnusedAssets(before.ids, db)).count).toBe(1);
    expect(await db.assets.count()).toBe(7);
  });
  it("新导入或重新使用的图片有一天保护期", async () => {
    const file = imageFile();
    const asset = await addAsset(file, db);
    expect((await inspectUnusedAssets(db)).count).toBe(0);
    await db.assets.update(asset.id, { createdAt: 1 });
    expect((await inspectUnusedAssets(db)).count).toBe(1);
    await addAsset(file, db);
    expect((await inspectUnusedAssets(db)).count).toBe(0);
  });
});
