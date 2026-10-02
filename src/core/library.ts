import { db, changed, type WorkbenchDB } from "./db";
import {
  clone,
  type Article,
  type ChannelId,
  type RemotePost,
  type Variant,
} from "./model";
import { newArticle } from "./variants";

export type LibrarySort = "updated" | "created" | "title";
export interface LibraryFilter {
  query: string;
  archived: boolean;
  trashed?: boolean;
  channel: ChannelId | "all";
  publication: "all" | "published" | "unpublished";
  sort: LibrarySort;
}
export interface LibraryEntry {
  article: Article;
  variants: Variant[];
  posts: RemotePost[];
}
export function libraryEntries(
  articles: Article[],
  variants: Variant[],
  posts: RemotePost[],
): LibraryEntry[] {
  const entries = new Map(
    articles.map((article) => [
      article.id,
      { article, variants: [] as Variant[], posts: [] as RemotePost[] },
    ]),
  );
  for (const variant of variants)
    entries.get(variant.articleId)?.variants.push(variant);
  for (const post of posts)
    if (post.articleId) entries.get(post.articleId)?.posts.push(post);
  return [...entries.values()];
}
export function filterLibrary(entries: LibraryEntry[], filter: LibraryFilter) {
  const terms = filter.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return entries
    .filter(({ article, variants, posts }) => {
      if (!!article.trashedAt !== !!filter.trashed) return false;
      if (!filter.trashed && article.archived !== filter.archived) return false;
      if (
        filter.channel !== "all" &&
        !variants.some((v) => v.channel === filter.channel) &&
        !posts.some((p) => p.channel === filter.channel)
      )
        return false;
      const published = posts.some((p) => p.status === "published");
      if (filter.publication === "published" && !published) return false;
      if (filter.publication === "unpublished" && published) return false;
      const text = [
        article.title,
        article.markdown,
        ...(article.defaults?.tags ?? []),
        ...variants.flatMap((v) => [
          v.overrides.title ?? "",
          ...v.metadata.tags,
        ]),
      ]
        .join("\n")
        .toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => {
      const delta =
        filter.sort === "title"
          ? (a.article.title || "未命名稿件").localeCompare(
              b.article.title || "未命名稿件",
              "zh-CN",
              { numeric: true },
            )
          : filter.sort === "created"
            ? b.article.createdAt - a.article.createdAt
            : b.article.updatedAt - a.article.updatedAt;
      return delta || a.article.id.localeCompare(b.article.id);
    });
}

export async function archiveArticles(
  ids: string[],
  archived: boolean,
  database: WorkbenchDB = db,
) {
  await database.transaction(
    "rw",
    database.articles,
    database.meta,
    async () => {
      for (const id of new Set(ids)) {
        const article = await database.articles.get(id);
        if (!article) throw new Error("部分稿件已不存在，请刷新内容库后重试。");
        if (article.trashedAt) throw new Error("请先从回收站恢复稿件。");
        // Archiving is organization, not a new content revision.
        await database.articles.update(id, { archived, updatedAt: Date.now() });
      }
      await changed(database);
    },
  );
}

export async function copyDraft(
  article: Article,
  variants: Variant[],
  database: WorkbenchDB = db,
) {
  const copy = {
    ...newArticle(`${article.title || "未命名稿件"} · 副本`, article.markdown),
    imageIds: [...article.imageIds],
    ...(article.defaults ? { defaults: clone(article.defaults) } : {}),
  };
  await database.transaction(
    "rw",
    database.articles,
    database.variants,
    database.meta,
    async () => {
      await database.articles.add(copy);
      await database.variants.bulkAdd(
        variants
          .filter((v) => v.articleId === article.id)
          .map((v) => ({
            ...clone(v),
            id: `${copy.id}/${v.channel}`,
            articleId: copy.id,
            baseRevision: copy.revision,
            updatedAt: copy.updatedAt,
          })),
      );
      await changed(database);
    },
  );
  return copy;
}

export async function duplicateArticle(id: string, database: WorkbenchDB = db) {
  return database.transaction(
    "rw",
    database.articles,
    database.variants,
    database.meta,
    async () => {
      const article = await database.articles.get(id);
      if (!article) throw new Error("稿件已不存在，请刷新内容库。");
      if (article.trashedAt) throw new Error("请先从回收站恢复稿件。");
      return copyDraft(
        article,
        await database.variants.where("articleId").equals(id).toArray(),
        database,
      );
    },
  );
}
