import { db, changed, type WorkbenchDB } from "./db";
import {
  uid,
  messageOf,
  type CommentPage,
  type RemotePost,
  type Snapshot,
} from "./model";
import { parseRemoteUrl } from "../platforms/catalog";
import { adapterFor } from "../platforms/browser-adapter";

export async function registerPost(
  url: string,
  title: string,
  channel: RemotePost["channel"],
  articleId?: string,
  snapshot?: Snapshot,
  database: WorkbenchDB = db,
) {
  const parsed = parseRemoteUrl(url, channel);
  const existing = await database.posts
    .where("[channel+remoteId]")
    .equals([channel, parsed.remoteId])
    .first();
  if (existing) return existing;
  const post: RemotePost = {
    id: uid(),
    channel,
    remoteId: parsed.remoteId,
    url: parsed.url,
    title,
    articleId,
    snapshot,
    status: "published",
    registeredAt: Date.now(),
    updatedAt: Date.now(),
  };
  await database.posts.add(post);
  await changed(database);
  return post;
}
export async function mergeCommentPage(
  post: RemotePost,
  page: CommentPage,
  database: WorkbenchDB = db,
) {
  const now = Date.now();
  await database.transaction(
    "rw",
    database.comments,
    database.commentSync,
    database.meta,
    async () => {
      for (const incoming of page.comments) {
        const id = `${post.id}/${incoming.remoteId}`;
        const existing = await database.comments.get(id);
        await database.comments.put({
          ...incoming,
          id,
          postId: post.id,
          collectedAt: now,
          readAt: existing?.readAt,
        });
      }
      await database.commentSync.put({
        postId: post.id,
        sourceUrl: post.url,
        collectedAt: now,
        lastAttemptAt: now,
        cursor: page.nextCursor,
        scope: page.scope,
        complete: page.complete,
      });
      await changed(database);
    },
  );
}
export async function refreshPost(
  post: RemotePost,
  cursor?: string,
  commentsOnly = false,
) {
  if (post.status === "draft_saved") return;
  const adapter = adapterFor(post.channel);
  const now = Date.now();
  if (!commentsOnly) {
    try {
      const metrics = await adapter.fetchMetrics(post);
      if (!metrics.values.length) throw new Error("平台未返回可用指标");
      await db.metrics.put({
        postId: post.id,
        ...metrics,
        collectedAt: now,
        lastAttemptAt: now,
      });
    } catch (error) {
      const old = await db.metrics.get(post.id);
      await db.metrics.put({
        ...old,
        postId: post.id,
        values: old?.values ?? [],
        sourceUrl: old?.sourceUrl ?? post.url,
        collectedAt: old?.collectedAt ?? 0,
        lastAttemptAt: now,
        error: messageOf(error),
      });
    }
  }
  try {
    await mergeCommentPage(post, await adapter.fetchComments(post, cursor));
  } catch (error) {
    const old = await db.commentSync.get(post.id);
    await db.commentSync.put({
      ...old,
      postId: post.id,
      sourceUrl: old?.sourceUrl ?? post.url,
      collectedAt: old?.collectedAt ?? 0,
      lastAttemptAt: now,
      scope: old?.scope ?? "尚未成功读取",
      complete: old?.complete ?? false,
      error: messageOf(error),
    });
  }
  await changed();
}
