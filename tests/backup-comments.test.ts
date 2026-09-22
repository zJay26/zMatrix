import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { database, fixture, imageFile } from "./helpers";
import { addAsset } from "../src/core/assets";
import {
  exportBackup,
  inspectBackup,
  restoreBackup,
  directoryBackup,
} from "../src/core/backup";
import { enqueue } from "../src/core/tasks";
import { mergeCommentPage, registerPost } from "../src/core/collection";
import type { RemotePost } from "../src/core/model";
const source = database(),
  target = database();
beforeEach(async () => {
  await source.open();
  await target.open();
});
afterEach(async () => {
  await source.delete();
  await target.delete();
});
const post: RemotePost = {
  id: "remote",
  channel: "csdn:article",
  remoteId: "123",
  title: "正文",
  url: "https://blog.csdn.net/me/article/details/123",
  status: "published",
  registeredAt: 1,
  updatedAt: 1,
};
async function mutateBackup(
  blob: Blob,
  edit: (manifest: any, files: Record<string, Uint8Array>) => void,
) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  edit(manifest, files);
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>]);
}
describe("备份恢复", () => {
  it("更名后的自动备份保留旧版最近备份，并写入新的有效备份", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    const legacy = new Blob(["旧版备份内容"]);
    const written = new Map<string, Blob>();
    const handle = {
      queryPermission: async () => "granted",
      getFileHandle: async (name: string, options?: { create: boolean }) => {
        if (options?.create)
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => {
                written.set(name, blob);
              },
              close: async () => {},
            }),
          };
        if (name === "tonggao-auto.zip") return { getFile: async () => legacy };
        throw new DOMException("absent", "NotFoundError");
      },
    } as unknown as FileSystemDirectoryHandle;
    await directoryBackup(handle, source);
    expect(await written.get("zMatrix-previous.zip")?.text()).toBe(
      "旧版备份内容",
    );
    const current = await inspectBackup(written.get("zMatrix-auto.zip")!);
    expect(current.articles[0]?.id).toBe(f.article.id);
  });
  it("新备份文件权限失败时不退回旧路径掩盖错误", async () => {
    const requested: string[] = [];
    const handle = {
      queryPermission: async () => "granted",
      getFileHandle: async (name: string) => {
        requested.push(name);
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as FileSystemDirectoryHandle;
    await expect(directoryBackup(handle, source)).rejects.toThrow("denied");
    expect(requested).toEqual(["zMatrix-auto.zip"]);
    expect(await source.meta.get("backupCompletedAt")).toBeUndefined();
  });
  it("备份写入期间继续编辑，备份覆盖范围仍停留在快照时间", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    await source.meta.put({ key: "dataChangedAt", value: 10 });
    const handle = {
      queryPermission: async () => "granted",
      getFileHandle: async (_name: string, options?: { create: boolean }) => {
        if (!options?.create) throw new DOMException("absent", "NotFoundError");
        return {
          createWritable: async () => ({
            write: async () => {
              await source.articles.update(f.article.id, {
                markdown: "备份过程中更新",
              });
              await source.meta.put({ key: "dataChangedAt", value: 20 });
            },
            close: async () => {},
          }),
        };
      },
    } as unknown as FileSystemDirectoryHandle;
    await directoryBackup(handle, source);
    expect((await source.meta.get("backupCoveredChangeAt"))?.value).toBe(10);
    expect((await source.meta.get("dataChangedAt"))?.value).toBe(20);
  });
  it("正文、素材、平台版本和任务一并恢复，任务暂停而非自动执行", async () => {
    const f = await fixture();
    const image = await addAsset(imageFile(), source);
    f.article.imageIds.push(image.id);
    f.article.markdown += `\n![图片](asset://${image.id})`;
    await source.articles.put(f.article);
    await source.variants.put(f.variant);
    const [task] = await enqueue([f], "publish", source);
    await source.posts.put({
      ...post,
      articleId: f.article.id,
      snapshot: f.snapshot,
    });
    const backup = await exportBackup(source);
    await restoreBackup(backup, target);
    expect((await target.articles.get(f.article.id))?.markdown).toContain(
      `asset://${image.id}`,
    );
    expect((await target.assets.get(image.id))?.blob.size).toBe(
      image.blob.size,
    );
    expect(await target.variants.get(f.variant.id)).toEqual(f.variant);
    expect((await target.tasks.get(task!.id))?.state).toBe("paused");
    expect((await target.posts.get(post.id))?.snapshot?.title).toBe(
      f.article.title,
    );
  });
  it("校验素材摘要；损坏备份不会留下半份恢复记录", async () => {
    const f = await fixture();
    const image = await addAsset(imageFile(), source);
    f.article.imageIds = [image.id];
    await source.articles.put(f.article);
    const damaged = await mutateBackup(
      await exportBackup(source),
      (_, files) => {
        files[`assets/${image.id}`] = strToU8("损坏");
      },
    );
    await expect(restoreBackup(damaged, target)).rejects.toThrow("素材损坏");
    expect(await target.articles.count()).toBe(0);
    expect(await target.assets.count()).toBe(0);
  });
  it("恢复保留更新的本地稿，合并同一远端文章并重新关联评论", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    await source.posts.put(post);
    await mergeCommentPage(
      post,
      {
        comments: [
          {
            remoteId: "c1",
            author: "读者",
            body: "评论",
            publishedAt: "今天",
            url: post.url,
          },
        ],
        scope: "近期",
        complete: false,
      },
      source,
    );
    await target.articles.put({
      ...f.article,
      revision: 2,
      markdown: "较新的本地内容",
    });
    await target.posts.put({ ...post, id: "existing-local" });
    await restoreBackup(await exportBackup(source), target);
    expect((await target.articles.get(f.article.id))?.markdown).toBe(
      "较新的本地内容",
    );
    expect(await target.posts.count()).toBe(1);
    expect((await target.comments.get("existing-local/c1"))?.postId).toBe(
      "existing-local",
    );
  });
  it("中断提交恢复成待核实，移除旧浏览器标签页 ID", async () => {
    const f = await fixture();
    const [task] = await enqueue([f], "publish", source);
    await source.tasks.update(task!.id, { state: "submitting", tabId: 99 });
    await restoreBackup(await exportBackup(source), target);
    expect(await target.tasks.get(task!.id)).toMatchObject({
      state: "uncertain",
      tabId: undefined,
    });
  });
  it("旧格式保留；未知新格式、外站跳转被拒绝，HTML 清除脚本", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    await enqueue([f], "draft", source);
    const backup = await exportBackup(source);
    expect((await inspectBackup(backup)).version).toBe(1);
    await expect(
      inspectBackup(
        await mutateBackup(backup, (m) => {
          m.version = 999;
        }),
      ),
    ).rejects.toThrow("版本");
    await expect(
      inspectBackup(
        await mutateBackup(backup, (m) => {
          m.tasks[0].editorUrl = "https://evil.example/";
        }),
      ),
    ).rejects.toThrow("对应平台");
    const safe = await inspectBackup(
      await mutateBackup(backup, (m) => {
        m.tasks[0].prepared.html =
          '<script>evil()</script><p onclick="evil()">正文</p>';
      }),
    );
    expect(safe.tasks[0]?.prepared.html).toBe("<p>正文</p>");
  });
  it("备份目录授权失效不损害本地稿件", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    const handle = {
      queryPermission: async () => "denied",
    } as unknown as FileSystemDirectoryHandle;
    await expect(directoryBackup(handle, source)).rejects.toThrow("重新授权");
    expect(await source.articles.get(f.article.id)).toEqual(f.article);
  });
  it("重新打开 v1 数据库仍保留内容", async () => {
    const f = await fixture();
    await source.articles.put(f.article);
    source.close();
    await source.open();
    expect(await source.articles.get(f.article.id)).toEqual(f.article);
    expect(source.verno).toBe(1);
  });
});
describe("登记与评论分页", () => {
  it("登记只保存链接，不重复登记同一平台文章", async () => {
    const one = await registerPost(
      post.url,
      "文章",
      post.channel,
      undefined,
      undefined,
      source,
    );
    const two = await registerPost(
      `${post.url}?utm=x`,
      "重复",
      post.channel,
      undefined,
      undefined,
      source,
    );
    expect(two.id).toBe(one.id);
    expect(await source.posts.count()).toBe(1);
    expect(await source.articles.count()).toBe(0);
  });
  it("分页重叠去重，重新同步保留已读状态和父评论关系", async () => {
    await source.posts.put(post);
    const c1 = {
      remoteId: "c1",
      author: "读者",
      body: "第一条",
      publishedAt: "今天",
      url: post.url,
    };
    await mergeCommentPage(
      post,
      { comments: [c1], nextCursor: "1", scope: "第1页", complete: false },
      source,
    );
    await source.comments.update("remote/c1", { readAt: 42 });
    await mergeCommentPage(
      post,
      {
        comments: [c1, { ...c1, remoteId: "c2", parentId: "c1", body: "回复" }],
        nextCursor: "2",
        scope: "第2页；回复按平台加载",
        complete: false,
      },
      source,
    );
    expect(await source.comments.count()).toBe(2);
    expect((await source.comments.get("remote/c1"))?.readAt).toBe(42);
    expect((await source.comments.get("remote/c2"))?.parentId).toBe("c1");
    expect(await source.commentSync.get("remote")).toMatchObject({
      cursor: "2",
      complete: false,
    });
  });
});
