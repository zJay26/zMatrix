import Dexie, { type Table } from "dexie";
import type {
  Article,
  Asset,
  Comment,
  CommentSync,
  Meta,
  Metrics,
  Probe,
  RemotePost,
  Task,
  TaskReceipt,
  Variant,
} from "./model";

export class WorkbenchDB extends Dexie {
  articles!: Table<Article>;
  variants!: Table<Variant>;
  assets!: Table<Asset>;
  tasks!: Table<Task>;
  taskReceipts!: Table<TaskReceipt>;
  posts!: Table<RemotePost>;
  metrics!: Table<Metrics>;
  comments!: Table<Comment>;
  commentSync!: Table<CommentSync>;
  meta!: Table<Meta>;
  probes!: Table<Probe>;
  // Stable storage identity: renaming the product must not create an empty database.
  constructor(name = "tonggao-workbench") {
    super(name);
    this.version(1).stores({
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
    this.version(2).stores({
      taskReceipts: "id",
    });
  }
}
export const db = new WorkbenchDB();
export const INSTALL_KEY = "extensionInstallation";
export async function assertNotInstalling(database = db) {
  if (await database.meta.get(INSTALL_KEY))
    throw new Error("软件正在更新，请完成更新或恢复后再操作。");
}
export async function changed(database = db) {
  await assertNotInstalling(database);
  await database.meta.put({ key: "dataChangedAt", value: Date.now() });
}
export async function getMeta<T>(
  key: string,
  fallback: T,
  database = db,
): Promise<T> {
  return ((await database.meta.get(key))?.value as T | undefined) ?? fallback;
}
interface SaveGuard<T> {
  expected: T | undefined;
}
function checkExpected<T>(previous: T | undefined, guard?: SaveGuard<T>) {
  if (guard && JSON.stringify(previous) !== JSON.stringify(guard.expected))
    throw new Error(
      "稿件已在其他窗口更新。请保留当前编辑，另存为新稿后再打开最新版本。",
    );
}
export async function saveArticle(
  article: Article,
  database = db,
  guard?: SaveGuard<Article>,
) {
  await database.transaction(
    "rw",
    database.articles,
    database.meta,
    async () => {
      const previous = await database.articles.get(article.id);
      if (previous?.trashedAt)
        throw new Error("稿件已在回收站，请先恢复后再编辑。");
      checkExpected(previous, guard);
      // A guarded save has already proven which row it replaces, so it may keep
      // the revision (shared publishing details are not a content revision).
      if (
        previous &&
        (previous.revision > article.revision ||
          (!guard &&
            previous.revision === article.revision &&
            JSON.stringify(previous) !== JSON.stringify(article)))
      )
        throw new Error("稿件已在其他窗口更新，请重新打开以免覆盖。");
      await database.articles.put(article);
      await changed(database);
    },
  );
}
export async function saveVariant(
  variant: Variant,
  database = db,
  guard?: SaveGuard<Variant>,
) {
  await database.transaction(
    "rw",
    database.variants,
    database.articles,
    database.meta,
    async () => {
      const article = await database.articles.get(variant.articleId);
      if (!article || article.trashedAt)
        throw new Error("稿件已删除或在回收站，请返回内容库。");
      checkExpected(await database.variants.get(variant.id), guard);
      await database.variants.put(variant);
      await changed(database);
    },
  );
}
