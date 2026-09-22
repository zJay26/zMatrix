import { defineBackground } from "wxt/utils/define-background";
import { db, changed } from "../core/db";
import { adapterFor } from "../platforms/browser-adapter";
import { canStart, patchTask, recoverTask } from "../core/tasks";
import {
  messageOf,
  uid,
  type ChannelId,
  type Task,
  channelIds,
} from "../core/model";
import { refreshPost } from "../core/collection";
import { z } from "zod";

const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), ids: z.array(z.string()).max(100) }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("probe"), channel: z.enum(channelIds) }),
  z.object({ type: z.literal("verify"), id: z.string() }),
  z.object({
    type: z.literal("refresh"),
    postId: z.string().optional(),
    cursor: z.string().optional(),
  }),
]);
export default defineBackground(() => {
  const owner = uid();
  let running = false;
  let collectionRunning = false;
  let pauseRequested = false;
  const initialized = db.tasks.toArray().then(async (tasks) => {
    for (const task of tasks) {
      const recovered = recoverTask(task);
      if (recovered !== task) await db.tasks.put(recovered);
    }
  });
  chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL("/workbench.html");
    const [existing] = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.TAB],
      documentUrls: [url],
    });
    if (existing && existing.tabId >= 0)
      await chrome.tabs.update(existing.tabId, { active: true });
    else await chrome.tabs.create({ url });
  });
  async function record(
    task: Task,
    receipt: Awaited<ReturnType<ReturnType<typeof adapterFor>["verify"]>>,
  ) {
    await patchTask(
      task.id,
      {
        state: receipt.status,
        remoteUrl: receipt.url ?? task.remoteUrl,
        remoteId: receipt.remoteId ?? task.remoteId,
        editorUrl: receipt.editorUrl ?? task.editorUrl,
        error: receipt.status === "uncertain" ? receipt.detail : undefined,
        step: receipt.detail,
      },
      receipt.detail,
    );
    if (
      receipt.remoteId &&
      ["draft_saved", "published", "reviewing", "submitted"].includes(
        receipt.status,
      )
    ) {
      const previous = await db.posts
        .where("[channel+remoteId]")
        .equals([task.channel, receipt.remoteId])
        .first();
      const now = Date.now();
      await db.posts.put({
        id: previous?.id ?? uid(),
        articleId: task.snapshot.articleId,
        channel: task.channel,
        remoteId: receipt.remoteId,
        url: receipt.url ?? receipt.editorUrl ?? task.editorUrl ?? "",
        editorUrl: receipt.editorUrl,
        title: task.snapshot.title,
        status: receipt.status as
          "published" | "draft_saved" | "submitted" | "reviewing",
        snapshot: task.snapshot,
        registeredAt: previous?.registeredAt ?? now,
        updatedAt: now,
      });
      await changed();
    }
  }
  async function run(ids: string[]) {
    if (running) throw new Error("已有发布队列正在执行");
    if (collectionRunning) throw new Error("正在刷新数据，请稍后执行发布");
    running = true;
    pauseRequested = false;
    try {
      for (const id of ids) {
        if (pauseRequested) break;
        let task = await db.tasks.get(id);
        if (!task || !canStart(task)) continue;
        let mutated = false;
        try {
          await db.transaction("rw", db.tasks, async () => {
            const latest = await db.tasks.get(id);
            if (!latest || !canStart(latest))
              throw new Error("任务已被其他执行器领取");
            await db.tasks.update(id, {
              state: "preparing",
              owner,
              updatedAt: Date.now(),
            });
          });
          const adapter = adapterFor(task.channel);
          const context = await adapter.prepare(
            task.snapshot,
            task.prepared,
            id,
            async (tabId) => {
              mutated = true;
              await patchTask(
                id,
                { tabId, step: "填充平台编辑器" },
                "开始准备平台内容",
              );
            },
          );
          if (pauseRequested) {
            await patchTask(
              id,
              { state: "uncertain", step: "已暂停，编辑器中可能存在草稿" },
              "暂停后需要核实草稿",
            );
            break;
          }
          await patchTask(
            id,
            task.mode === "draft"
              ? { state: "submitting", step: "准备向平台保存草稿" }
              : {
                  state: "preparing",
                  step: "检查发布准备，最终提交由用户完成",
                },
            task.mode === "draft"
              ? "准备向平台提交"
              : "停在发布前，不执行最终提交",
          );
          const receipt =
            task.mode === "draft"
              ? await adapter.saveDraft(context, task.snapshot, task.prepared)
              : await adapter.preparePublish(
                  context,
                  task.snapshot,
                  task.prepared,
                );
          task = (await db.tasks.get(id))!;
          await record(task, receipt);
        } catch (error) {
          await patchTask(
            id,
            {
              state: mutated ? "uncertain" : "failed",
              error: messageOf(error),
              step: "执行已停止",
            },
            messageOf(error),
          );
        }
      }
    } finally {
      running = false;
    }
  }
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL("/workbench.html"))
    )
      return;
    const parsed = command.safeParse(raw);
    if (!parsed.success) {
      sendResponse({ ok: false, error: "请求格式无效" });
      return;
    }
    const request = parsed.data;
    void (async () => {
      await initialized;
      if (request.type === "pause") {
        pauseRequested = true;
        return { ok: true };
      }
      if (request.type === "run") {
        if (running || collectionRunning)
          throw new Error("已有任务运行，请稍后继续。");
        await db.meta.delete("queueError");
        void run(request.ids).catch(async (error) => {
          await db.meta.put({ key: "queueError", value: messageOf(error) });
        });
        return { ok: true };
      }
      if (request.type === "probe") {
        if (running) throw new Error("发布进行中，请稍后检查平台");
        const probe = await adapterFor(request.channel).checkSession();
        await db.probes.put(probe);
        return { ok: true };
      }
      if (request.type === "verify") {
        if (running || collectionRunning)
          throw new Error("已有任务运行，请稍后核实。");
        const task = await db.tasks.get(request.id);
        if (!task?.tabId)
          throw new Error("原标签页已不可用，请在原站核实并登记文章链接。");
        const receipt = await adapterFor(task.channel).verify(
          { tabId: task.tabId, channel: task.channel, taskId: task.id },
          task.snapshot,
          task.prepared,
          task.mode,
        );
        if (
          receipt.status === "uncertain" &&
          !receipt.remoteId &&
          !receipt.url &&
          (task.state === "awaiting_publish" ||
            task.state === "awaiting_review")
        ) {
          receipt.status = task.state;
          receipt.detail =
            "尚未核实到发布结果，保留等待状态。最终发布需在原站手动完成。";
        }
        await record(task, receipt);
        return { ok: true };
      }
      if (request.type === "refresh") {
        if (running || collectionRunning)
          return { ok: false, error: "已有任务运行，稍后再刷新。" };
        collectionRunning = true;
        await db.meta.put({ key: "refreshRunning", value: true });
        void (async () => {
          try {
            const posts = request.postId
              ? [await db.posts.get(request.postId)]
              : await db.posts.toArray();
            for (const post of posts) {
              if (post)
                await refreshPost(post, request.cursor, !!request.cursor);
            }
          } finally {
            collectionRunning = false;
            await db.meta.put({ key: "refreshRunning", value: false });
          }
        })().catch(async (error) => {
          await db.meta.put({
            key: "collectionError",
            value: messageOf(error),
          });
        });
        return { ok: true };
      }
      return { ok: false, error: "未处理的请求" };
    })().then(sendResponse, (error) =>
      sendResponse({ ok: false, error: messageOf(error) }),
    );
    return true;
  });
});
