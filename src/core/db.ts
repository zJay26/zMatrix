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
  Variant,
} from "./model";

export class WorkbenchDB extends Dexie {
  articles!: Table<Article>;
  variants!: Table<Variant>;
  assets!: Table<Asset>;
  tasks!: Table<Task>;
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
  }
}
export const db = new WorkbenchDB();
export async function changed(database = db) {
  await database.meta.put({ key: "dataChangedAt", value: Date.now() });
}
export async function getMeta<T>(
  key: string,
  fallback: T,
  database = db,
): Promise<T> {
  return ((await database.meta.get(key))?.value as T | undefined) ?? fallback;
}
export async function saveArticle(article: Article, database = db) {
  await database.transaction(
    "rw",
    database.articles,
    database.meta,
    async () => {
      const previous = await database.articles.get(article.id);
      if (
        previous &&
        (previous.revision > article.revision ||
          (previous.revision === article.revision &&
            JSON.stringify(previous) !== JSON.stringify(article)))
      )
        throw new Error("稿件已在其他窗口更新，请重新打开以免覆盖。");
      await database.articles.put(article);
      await changed(database);
    },
  );
}
export async function saveVariant(variant: Variant, database = db) {
  await database.variants.put(variant);
  await changed(database);
}
