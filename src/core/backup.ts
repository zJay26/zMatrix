import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { z } from "zod";
import { db, changed, type WorkbenchDB } from "./db";
import {
  channelIds,
  taskStates,
  type Article,
  type Asset,
  type Comment,
  type CommentSync,
  type Metrics,
  type RemotePost,
  type Task,
  type Variant,
} from "./model";
import { sha256 } from "./variants";
import { recoverTask } from "./tasks";
import type { Table } from "dexie";
import { assetIdsIn, wireAsset } from "./assets";
import { channelFor } from "../platforms/catalog";
import { sanitizePreparedHtml } from "./sanitize";

const text = z.string();
const timestamp = z.number().finite().nonnegative();
const id = z.string().min(1);
const channel = z.enum(channelIds);
const content = {
  title: text,
  markdown: text,
  imageIds: z.array(text.regex(/^[a-f0-9]{64}$/)),
};
const metadata = z.object({
  tags: z.array(text),
  category: text,
  summary: text,
  coverId: text.optional(),
});
const snapshot = z.object({
  ...content,
  articleId: id,
  revision: z.number().int().positive(),
  channel,
  metadata,
  createdAt: timestamp,
  fingerprint: id,
});
const schema = z.object({
  format: z.literal("tonggao-backup"),
  version: z.literal(1),
  createdAt: timestamp,
  articles: z.array(
    z.object({
      ...content,
      id,
      revision: z.number().int().positive(),
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: z.boolean(),
    }),
  ),
  variants: z.array(
    z.object({
      id,
      articleId: id,
      channel,
      baseRevision: z.number(),
      overrides: z.object(content).partial(),
      metadata,
      updatedAt: timestamp,
    }),
  ),
  assets: z.array(
    z.object({
      id: text.regex(/^[a-f0-9]{64}$/),
      name: text,
      type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      createdAt: timestamp,
    }),
  ),
  posts: z.array(
    z.object({
      id,
      articleId: id.optional(),
      channel,
      remoteId: id,
      url: text.url(),
      editorUrl: text.url().optional(),
      title: text,
      status: z.enum(["draft_saved", "submitted", "reviewing", "published"]),
      snapshot: snapshot.optional(),
      registeredAt: timestamp,
      updatedAt: timestamp,
    }),
  ),
  tasks: z.array(
    z.object({
      id,
      batchId: id,
      channel,
      mode: z.enum(["draft", "publish"]),
      snapshot,
      prepared: z.object({
        markdown: text,
        html: text,
        text,
        assets: z.array(
          z.object({ id, name: text, type: text, dataUrl: text }),
        ),
        warnings: z.array(text),
      }),
      state: z.enum(taskStates),
      step: text,
      createdAt: timestamp,
      updatedAt: timestamp,
      tabId: z.number().optional(),
      editorUrl: text.optional(),
      remoteUrl: text.optional(),
      remoteId: text.optional(),
      error: text.optional(),
      owner: text.optional(),
      account: text.optional(),
      events: z.array(z.object({ at: timestamp, message: text })),
    }),
  ),
  metrics: z.array(
    z.object({
      postId: id,
      values: z.array(
        z.object({
          key: text,
          label: text,
          value: z.number().finite().nonnegative(),
          raw: text,
        }),
      ),
      sourceUrl: text,
      collectedAt: timestamp,
      lastAttemptAt: timestamp,
      error: text.optional(),
    }),
  ),
  comments: z.array(
    z.object({
      id,
      postId: id,
      remoteId: id,
      parentId: text.optional(),
      author: text,
      body: text,
      publishedAt: text,
      url: text,
      collectedAt: timestamp,
      readAt: timestamp.optional(),
    }),
  ),
  commentSync: z.array(
    z.object({
      postId: id,
      sourceUrl: text,
      collectedAt: timestamp,
      lastAttemptAt: timestamp,
      cursor: text.optional(),
      scope: text,
      complete: z.boolean(),
      error: text.optional(),
    }),
  ),
});
export async function exportBackup(
  database: WorkbenchDB = db,
  onSnapshot?: (changedAt: number) => void,
): Promise<Blob> {
  const records = await database.transaction(
    "r",
    database.tables,
    async () => ({
      articles: await database.articles.toArray(),
      variants: await database.variants.toArray(),
      assets: await database.assets.toArray(),
      posts: await database.posts.toArray(),
      tasks: await database.tasks.toArray(),
      metrics: await database.metrics.toArray(),
      comments: await database.comments.toArray(),
      commentSync: await database.commentSync.toArray(),
      changedAt: Number((await database.meta.get("dataChangedAt"))?.value ?? 0),
    }),
  );
  onSnapshot?.(records.changedAt);
  const files: Record<string, Uint8Array> = {};
  for (const asset of records.assets)
    files[`assets/${asset.id}`] = new Uint8Array(
      await asset.blob.arrayBuffer(),
    );
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "tonggao-backup",
      version: 1,
      createdAt: Date.now(),
      ...records,
      assets: records.assets.map(({ blob, ...asset }) => asset),
    }),
  );
  if (typeof Worker === "undefined")
    return new Blob([zipSync(files, { level: 3 }) as Uint8Array<ArrayBuffer>], {
      type: "application/zip",
    });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./zip-worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("备份压缩超时，本地数据仍保留。"));
    }, 60000);
    worker.onmessage = (
      event: MessageEvent<{ bytes?: Uint8Array<ArrayBuffer>; error?: string }>,
    ) => {
      finish();
      if (event.data.bytes)
        resolve(new Blob([event.data.bytes], { type: "application/zip" }));
      else reject(new Error(event.data.error ?? "备份压缩失败"));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("备份压缩进程未能运行，本地数据仍保留。"));
    };
    worker.postMessage(files);
  });
}
export async function inspectBackup(blob: Blob) {
  if (blob.size > 200 * 1024 * 1024)
    throw new Error("备份文件超过 200 MB，当前恢复器不接受该大小。");
  let size = 0;
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
    filter: (entry) => {
      size += entry.originalSize;
      if (size > 512 * 1024 * 1024)
        throw new Error("备份解压后超过安全容量限制。");
      return (
        entry.name === "manifest.json" ||
        /^assets\/[a-f0-9]{64}$/.test(entry.name)
      );
    },
  });
  if (!files["manifest.json"])
    throw new Error("不是有效的 zMatrix 备份：缺少 manifest.json。");
  const parsed = schema.safeParse(
    JSON.parse(strFromU8(files["manifest.json"])),
  );
  if (!parsed.success)
    throw new Error("备份结构不合法或版本不受支持，现有数据没有修改。");
  const data = parsed.data;
  const assets: Asset[] = [];
  const seen = new Set<string>();
  for (const asset of data.assets) {
    const bytes = files[`assets/${asset.id}`];
    if (!bytes || (await sha256(bytes.slice().buffer)) !== asset.id)
      throw new Error(`素材损坏或缺失：${asset.name}`);
    assets.push({
      ...asset,
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.type }),
    });
    seen.add(asset.id);
  }
  const referenced = [
    ...data.articles.flatMap((a) => a.imageIds),
    ...data.variants.flatMap((v) => [
      ...(v.overrides.imageIds ?? []),
      ...(v.metadata.coverId ? [v.metadata.coverId] : []),
    ]),
    ...data.articles.flatMap((a) => assetIdsIn(a.markdown)),
    ...data.variants.flatMap((v) => assetIdsIn(v.overrides.markdown ?? "")),
    ...data.tasks.flatMap((t) => [
      ...t.snapshot.imageIds,
      ...assetIdsIn(t.snapshot.markdown),
      ...assetIdsIn(t.prepared.markdown),
      ...(t.snapshot.metadata.coverId ? [t.snapshot.metadata.coverId] : []),
      ...t.prepared.assets.map((a) => a.id),
    ]),
    ...data.posts.flatMap((p) =>
      p.snapshot
        ? [
            ...p.snapshot.imageIds,
            ...assetIdsIn(p.snapshot.markdown),
            ...(p.snapshot.metadata.coverId
              ? [p.snapshot.metadata.coverId]
              : []),
          ]
        : [],
    ),
  ];
  if (referenced.some((ref) => !seen.has(ref)))
    throw new Error("备份存在未包含的素材引用。");
  for (const list of [
    data.articles,
    data.variants,
    data.posts,
    data.tasks,
    data.comments,
    data.assets,
  ])
    if (new Set(list.map((r) => r.id)).size !== list.length)
      throw new Error("备份包含重复 ID。");
  const assertUrl = (raw: string, target: (typeof channelIds)[number]) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("备份中的平台链接不合法。");
    }
    const domain = new URL(channelFor(target).editorUrl).hostname.replace(
      /^(?:zhuanlan|i|editor|creator)\./,
      "",
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    )
      throw new Error("备份中的链接不属于对应平台。");
  };
  const posts = new Map(data.posts.map((p) => [p.id, p]));
  for (const post of data.posts) {
    assertUrl(post.url, post.channel);
    if (post.editorUrl) assertUrl(post.editorUrl, post.channel);
  }
  for (const item of [...data.metrics, ...data.comments, ...data.commentSync]) {
    const post = posts.get(item.postId);
    if (!post) throw new Error("备份包含未关联文章的数据记录。");
    assertUrl("sourceUrl" in item ? item.sourceUrl : item.url, post.channel);
  }
  for (const task of data.tasks) {
    if (task.channel !== task.snapshot.channel)
      throw new Error("备份中的任务平台与快照不一致。");
    if (task.editorUrl) assertUrl(task.editorUrl, task.channel);
    if (task.remoteUrl) assertUrl(task.remoteUrl, task.channel);
    task.prepared.html = await sanitizePreparedHtml(task.prepared.html);
    // Recreate uploaded bytes from the checksum-validated asset store.
    task.prepared.assets = await Promise.all(
      task.prepared.assets.map((a) =>
        wireAsset(assets.find((stored) => stored.id === a.id)!),
      ),
    );
  }
  return { ...data, assets };
}
export async function restoreBackup(blob: Blob, database: WorkbenchDB = db) {
  const data = await inspectBackup(blob);
  // Restore is an atomic merge; existing local rows win. It never silently replaces newer work.
  let count = 0;
  await database.transaction("rw", database.tables, async () => {
    const merge = async <T>(table: Table<T>, rows: T[], key: keyof T) => {
      const existing = new Set(await table.toCollection().primaryKeys());
      const fresh = rows.filter((row) => {
        if (existing.has(row[key])) return false;
        existing.add(row[key]);
        return true;
      });
      if (fresh.length) await table.bulkAdd(fresh);
      count += fresh.length;
    };
    const postIds = new Map<string, string>();
    const posts = await database.posts.toArray();
    for (const post of data.posts) {
      const existing = posts.find(
        (p) => p.channel === post.channel && p.remoteId === post.remoteId,
      );
      postIds.set(post.id, existing?.id ?? post.id);
      if (!existing) posts.push(post);
    }
    await merge(database.articles, data.articles, "id");
    await merge(database.variants, data.variants, "id");
    await merge(database.assets, data.assets, "id");
    await merge(database.posts, posts, "id");
    await merge(
      database.tasks,
      data.tasks.map((t) => ({
        ...recoverTask(t as Task),
        state: ["queued", "paused"].includes(t.state)
          ? ("paused" as const)
          : recoverTask(t as Task).state,
        tabId: undefined,
        owner: undefined,
      })),
      "id",
    );
    await merge(
      database.metrics,
      data.metrics.map((m) => ({ ...m, postId: postIds.get(m.postId)! })),
      "postId",
    );
    await merge(
      database.comments,
      data.comments.map((c) => ({
        ...c,
        postId: postIds.get(c.postId)!,
        id: `${postIds.get(c.postId)!}/${c.remoteId}`,
      })),
      "id",
    );
    await merge(
      database.commentSync,
      data.commentSync.map((s) => ({ ...s, postId: postIds.get(s.postId)! })),
      "postId",
    );
    await changed(database);
  });
  return count;
}
export async function chooseBackupDirectory() {
  const handle = await window.showDirectoryPicker({
    id: "tonggao-backup",
    mode: "readwrite",
  });
  await db.meta.put({ key: "backupDirectory", value: handle });
  return handle;
}
export async function directoryBackup(
  handle: FileSystemDirectoryHandle,
  database: WorkbenchDB = db,
) {
  if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted")
    throw new Error(
      "备份目录需要重新授权。本地内容已保留，请点击“授权备份目录”。",
    );
  let coveredChangeAt = 0;
  const blob = await exportBackup(database, (timestamp) => {
    coveredChangeAt = timestamp;
  });
  try {
    const previous = await handle
      .getFileHandle("zMatrix-auto.zip")
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotFoundError")
          return handle.getFileHandle("tonggao-auto.zip");
        throw error;
      });
    const previousFile = await previous.getFile();
    const keep = await handle.getFileHandle("zMatrix-previous.zip", {
      create: true,
    });
    const stream = await keep.createWritable();
    await stream.write(previousFile);
    await stream.close();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError"))
      throw error;
  }
  const file = await handle.getFileHandle("zMatrix-auto.zip", { create: true });
  const writer = await file.createWritable();
  await writer.write(blob);
  await writer.close();
  await database.meta.bulkPut([
    { key: "backupCompletedAt", value: Date.now() },
    { key: "backupCoveredChangeAt", value: coveredChangeAt },
  ]);
}
