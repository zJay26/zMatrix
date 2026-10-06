import { defineBackground } from "wxt/utils/define-background";
import { db, changed } from "../core/db";
import { adapterFor } from "../platforms/browser-adapter";
import {
  claimTask,
  claimTaskVerification,
  patchTask,
  recoverTask,
} from "../core/tasks";
import {
  messageOf,
  uid,
  type ChannelId,
  type Task,
  channelIds,
} from "../core/model";
import { refreshPost } from "../core/collection";
import { z } from "zod";
import { MANUAL_PUBLISH_PROTOCOL } from "../core/commands";
import {
  beginInstallation,
  clearInstallation,
  getInstallation,
  patchInstallation,
  verifyInstalledResources,
} from "../core/installation-state";
import {
  handleCnblogsGuardMessage,
  removeCnblogsGuard,
} from "../platforms/cnblogs-guard";
import {
  checkForUpdates,
  syncUpdateAlarm,
  UPDATE_ALARM,
  UPDATE_KEY,
  getUpdateState,
  compareVersions,
} from "../core/updates";

const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("capabilities") }),
  z.object({ type: z.literal("checkUpdates"), manual: z.boolean().optional() }),
  z.object({ type: z.literal("configureUpdates") }),
  z.object({
    type: z.literal("beginUpdate"),
    id: z.string().uuid(),
    version: z.string(),
    currentVersion: z.string(),
  }),
  z.object({ type: z.literal("finishUpdate"), id: z.string().uuid() }),
  z.object({
    type: z.literal("run"),
    ids: z.array(z.string()).max(100),
    manualPublishProtocol: z.literal(MANUAL_PUBLISH_PROTOCOL),
  }),
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
  chrome.tabs.onRemoved.addListener((tabId) => {
    void removeCnblogsGuard(tabId).catch(() => {});
  });
  const automaticUpdateCheck = async () => {
    try {
      await syncUpdateAlarm();
      await checkForUpdates();
    } catch {
      await db.meta
        .put({
          key: UPDATE_KEY,
          value: {
            ...(await getUpdateState()),
            error: "自动检查未完成，请在设置中重试",
          },
        })
        .catch(() => {});
    }
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) void automaticUpdateCheck();
  });
  chrome.runtime.onInstalled.addListener(() => void automaticUpdateCheck());
  chrome.runtime.onStartup.addListener(() => void automaticUpdateCheck());
  void automaticUpdateCheck();
  const owner = uid();
  let running = false;
  let collectionRunning = false;
  let activeCalls = 0;
  let updateStarting = false;
  let pauseRequested = false;
  async function finishInstalledUpdate() {
    const record = await getInstallation();
    if (!record || chrome.runtime.getManifest().version !== record.to)
      return false;
    await verifyInstalledResources(record, (path) =>
      chrome.runtime.getURL(path),
    );
    await clearInstallation(record.id, {
      version: record.to,
      backup: record.backup,
    });
    const url = chrome.runtime.getURL("/workbench.html#updates");
    if (record.tabId !== undefined) {
      const tab = await chrome.tabs.get(record.tabId).catch(() => undefined);
      if (tab?.url?.startsWith(chrome.runtime.getURL("/workbench.html"))) {
        await chrome.tabs.update(record.tabId, { url, active: true });
        return true;
      }
    }
    await chrome.tabs.create({ url });
    return true;
  }
  const initialized = (async () => {
    try {
      await finishInstalledUpdate();
    } catch (error) {
      const record = await getInstallation();
      if (record)
        await patchInstallation(record.id, { error: messageOf(error) });
    }
    if (await getInstallation()) return;
    const tasks = await db.tasks.toArray();
    for (const task of tasks) {
      const recovered = recoverTask(task);
      if (recovered !== task) await db.tasks.put(recovered);
    }
  })();
  chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL("/workbench.html");
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.TAB],
    });
    const existing = contexts.find(
      (context) => context.documentUrl?.split(/[?#]/)[0] === url,
    );
    if (existing && existing.tabId >= 0)
      await chrome.tabs.update(existing.tabId, { active: true });
    else await chrome.tabs.create({ url });
  });
  async function record(
    task: Task,
    receipt: Awaited<ReturnType<ReturnType<typeof adapterFor>["verify"]>>,
  ) {
    await db.transaction("rw", db.tasks, db.posts, db.meta, async () => {
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
    });
  }
  async function run(ids: string[]) {
    if (running) throw new Error("已有发布队列正在执行");
    if (collectionRunning) throw new Error("正在刷新数据，请稍后执行发布");
    running = true;
    pauseRequested = false;
    try {
      await db.meta.delete("queueError");
      for (const id of ids) {
        if (pauseRequested) break;
        let task = await claimTask(id, owner);
        if (!task) continue;
        let mutated = false;
        try {
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
      raw &&
      typeof raw === "object" &&
      "type" in raw &&
      ["cnblogsGuardStatus", "cnblogsGuardRelease"].includes(String(raw.type))
    ) {
      void handleCnblogsGuardMessage(raw, sender).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: messageOf(error) }),
      );
      return true;
    }
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
      if (request.type === "capabilities")
        return {
          ok: true,
          manualPublishProtocol: MANUAL_PUBLISH_PROTOCOL,
          version: chrome.runtime.getManifest().version,
        };
      if (request.type === "checkUpdates") {
        await checkForUpdates({ manual: request.manual });
        return { ok: true };
      }
      if (request.type === "configureUpdates") {
        await syncUpdateAlarm();
        await checkForUpdates();
        return { ok: true };
      }
      await initialized;
      if (request.type === "beginUpdate") {
        if (running || collectionRunning || activeCalls || updateStarting)
          throw new Error("后台仍在处理任务，请完成后再更新。");
        updateStarting = true;
        try {
          if (request.currentVersion !== chrome.runtime.getManifest().version)
            throw new Error("前后台版本不一致，请先重新加载扩展。");
          if (compareVersions(request.version, request.currentVersion) <= 0)
            throw new Error("该版本无需安装，请重新检查更新。");
          const contexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.TAB],
          });
          const pages = contexts.filter(
            (context) =>
              context.documentUrl?.split(/[?#]/)[0] ===
              chrome.runtime.getURL("/workbench.html"),
          );
          if (pages.length !== 1)
            throw new Error(
              "请先保存并关闭其他 zMatrix 工作台标签页，再进行更新。",
            );
          await beginInstallation({
            id: request.id,
            from: request.currentVersion,
            to: request.version,
            stage: "downloading",
            startedAt: Date.now(),
            tabId: pages[0]!.tabId,
          });
          return { ok: true };
        } finally {
          updateStarting = false;
        }
      }
      if (request.type === "finishUpdate") {
        const record = await getInstallation();
        if (!record || record.id !== request.id)
          throw new Error("更新状态已变化，请重新打开工作台。");
        if (await finishInstalledUpdate()) return { ok: true };
        if (record.stage !== "ready")
          throw new Error("安装尚未完成，请先恢复。");
        await verifyInstalledResources(record, (path) =>
          chrome.runtime.getURL(path),
        );
        setTimeout(() => chrome.runtime.reload(), 200);
        return { ok: true };
      }
      if (updateStarting || (await getInstallation()) || updateStarting)
        throw new Error("软件正在更新，请完成更新或恢复后再执行任务。");
      activeCalls++;
      try {
        if (request.type === "pause") {
          pauseRequested = true;
          return { ok: true };
        }
        if (request.type === "run") {
          if (running || collectionRunning)
            throw new Error("已有任务运行，请稍后继续。");
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
          const task = await claimTaskVerification(request.id);
          try {
            const receipt = await adapterFor(task.channel).verify(
              { tabId: task.tabId!, channel: task.channel, taskId: task.id },
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
          } catch (error) {
            await patchTask(task.id, {
              state: task.state,
              step: task.step,
              error: messageOf(error),
            });
            throw error;
          }
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
      } finally {
        activeCalls--;
      }
    })().then(sendResponse, (error) =>
      sendResponse({ ok: false, error: messageOf(error) }),
    );
    return true;
  });
});
