import { db, changed } from "./db";
import { assetIdsIn } from "./assets";
import { canRemoveTask, canStart, removeTasks } from "./tasks";
import type { Content, Snapshot, Variant } from "./model";

export async function trashArticles(ids: string[], database = db) {
  return database.transaction("rw", database.tables, async () => {
    const selected = new Set(ids);
    const articles = await database.articles.bulkGet([...selected]);
    if (articles.some((a) => !a || a.trashedAt))
      throw new Error("稿件状态已变化，请刷新内容库。");
    const tasks = (await database.tasks.toArray()).filter((t) =>
      selected.has(t.snapshot.articleId),
    );
    if (tasks.some((t) => !canRemoveTask(t)))
      throw new Error(
        "稿件有关联任务正在执行或结果待核实，请先到发布队列处理。",
      );
    for (const task of tasks.filter(canStart))
      await database.tasks.update(task.id, {
        state: "cancelled",
        step: "稿件移入回收站，已取消待执行任务",
        updatedAt: Date.now(),
      });
    for (const article of articles)
      await database.articles.update(article!.id, {
        trashedAt: Date.now(),
        updatedAt: Date.now(),
      });
    await changed(database);
  });
}

export async function restoreArticles(ids: string[], database = db) {
  return database.transaction(
    "rw",
    database.articles,
    database.meta,
    async () => {
      for (const id of new Set(ids)) {
        const article = await database.articles.get(id);
        if (!article?.trashedAt)
          throw new Error("稿件已不在回收站，请刷新后重试。");
        await database.articles.update(id, {
          trashedAt: undefined,
          archived: false,
          updatedAt: Date.now(),
        });
      }
      await changed(database);
    },
  );
}

export async function purgeArticles(ids: string[], database = db) {
  return database.transaction("rw", database.tables, async () => {
    const selected = new Set(ids);
    const articles = await database.articles.bulkGet([...selected]);
    if (articles.some((a) => !a?.trashedAt))
      throw new Error("只有回收站中的稿件可以彻底删除。");
    const tasks = (await database.tasks.toArray()).filter((t) =>
      selected.has(t.snapshot.articleId),
    );
    await removeTasks(
      tasks.map((t) => t.id),
      database,
    );
    for (const id of selected) {
      await database.variants.where("articleId").equals(id).delete();
      // Remote tracking and its frozen snapshot remain independent of the local draft.
      await database.posts
        .where("articleId")
        .equals(id)
        .modify({ articleId: undefined });
    }
    await database.articles.bulkDelete([...selected]);
    await changed(database);
  });
}

export async function removeVariant(expected: Variant, database = db) {
  return database.transaction(
    "rw",
    database.variants,
    database.articles,
    database.meta,
    async () => {
      const article = await database.articles.get(expected.articleId);
      if (!article || article.trashedAt)
        throw new Error("稿件已删除或在回收站，请返回内容库。");
      const stored = await database.variants.get(expected.id);
      if (JSON.stringify(stored) !== JSON.stringify(expected))
        throw new Error("平台版本已在其他窗口更新，请重新打开后再移除。");
      await database.variants.delete(expected.id);
      await changed(database);
    },
  );
}

export async function removePosts(ids: string[], database = db) {
  return database.transaction("rw", database.tables, async () => {
    const posts = await database.posts.bulkGet([...new Set(ids)]);
    const tasks = await database.tasks.toArray();
    if (
      posts.some(
        (p) =>
          p &&
          tasks.some(
            (t) =>
              t.channel === p.channel &&
              t.remoteId === p.remoteId &&
              !canRemoveTask(t),
          ),
      )
    )
      throw new Error("文章仍有关联任务待核实，请先处理任务。");
    for (const post of posts) {
      if (!post) continue;
      await database.comments.where("postId").equals(post.id).delete();
      await database.metrics.delete(post.id);
      await database.commentSync.delete(post.id);
      await database.posts.delete(post.id);
    }
    await changed(database);
  });
}

export const ASSET_GRACE_MS = 24 * 60 * 60 * 1000;
async function unusedAssets(database: typeof db, now: number) {
  const referenced = new Set<string>();
  const content = (item: Partial<Content>) => {
    item.imageIds?.forEach((id) => referenced.add(id));
    assetIdsIn(item.markdown ?? "").forEach((id) => referenced.add(id));
  };
  const snapshot = (item: Snapshot) => {
    content(item);
    if (item.metadata.coverId) referenced.add(item.metadata.coverId);
  };
  for (const article of await database.articles.toArray()) {
    content(article);
    if (article.defaults?.coverId) referenced.add(article.defaults.coverId);
  }
  for (const variant of await database.variants.toArray()) {
    content(variant.overrides);
    if (variant.metadata.coverId) referenced.add(variant.metadata.coverId);
  }
  for (const task of await database.tasks.toArray()) {
    snapshot(task.snapshot);
    content(task.prepared);
    task.prepared.assets.forEach((asset) => referenced.add(asset.id));
  }
  for (const post of await database.posts.toArray())
    if (post.snapshot) snapshot(post.snapshot);
  return (await database.assets.toArray()).filter(
    (asset) =>
      !referenced.has(asset.id) &&
      asset.createdAt < now - ASSET_GRACE_MS &&
      (asset.protectedUntil ?? 0) < now,
  );
}
export async function inspectUnusedAssets(database = db) {
  return database.transaction("r", database.tables, async () => {
    const assets = await unusedAssets(database, Date.now());
    return {
      ids: assets.map((a) => a.id),
      count: assets.length,
      bytes: assets.reduce((n, a) => n + a.blob.size, 0),
    };
  });
}
export async function cleanUnusedAssets(ids: string[], database = db) {
  return database.transaction("rw", database.tables, async () => {
    const selected = new Set(ids);
    const assets = (await unusedAssets(database, Date.now())).filter((a) =>
      selected.has(a.id),
    );
    await database.assets.bulkDelete(assets.map((a) => a.id));
    if (assets.length) await changed(database);
    return {
      count: assets.length,
      bytes: assets.reduce((n, a) => n + a.blob.size, 0),
    };
  });
}
