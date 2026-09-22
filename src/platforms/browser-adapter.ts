import { channelFor, parseRemoteUrl } from "./catalog";
import { pageDriver, type PageRequest, type PageResult } from "./page-driver";
import type { Context, PlatformAdapter, Receipt } from "./interface";
import type {
  ChannelId,
  PreparedContent,
  Probe,
  RemotePost,
  Snapshot,
} from "../core/model";

export const isExtension = () =>
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
export async function connectChannel(channel: ChannelId) {
  if (!isExtension()) throw new Error("请在 Edge 中加载扩展后连接平台。");
  return chrome.permissions.request({ origins: channelFor(channel).origins });
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function requirePermission(channel: ChannelId) {
  if (!isExtension())
    throw new Error("网页预览不能操作平台，请加载 Edge 扩展。");
  if (
    !(await chrome.permissions.contains({
      origins: channelFor(channel).origins,
    }))
  )
    throw new Error("请先在平台设置中连接此平台。");
}
async function ready(tabId: number) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await delay(250);
  }
  throw new Error("平台页面加载超时。");
}
export async function callPage(
  tabId: number,
  request: PageRequest,
): Promise<PageResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: pageDriver,
    args: [request],
  });
  const data = results[0]?.result;
  if (!data || typeof data.ok !== "boolean")
    throw new Error("平台页面没有返回可识别的结果。");
  if (!data.ok) throw new Error(data.error || "平台操作失败");
  return data;
}
function plainCompare(text: string) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s|\u200b/g, "");
}
export function matchesContent(
  result: PageResult,
  snapshot: Snapshot,
  content: PreparedContent,
  publicPage = false,
) {
  if (plainCompare(result.title ?? "") !== plainCompare(snapshot.title))
    return false;
  const source =
    !publicPage && channelFor(snapshot.channel).format === "markdown"
      ? content.markdown
      : content.text;
  if (plainCompare(result.body ?? "") !== plainCompare(source)) return false;
  if (result.localImages) return false;
  const expectedImages =
    snapshot.channel === "xiaohongshu:note"
      ? snapshot.imageIds.length
      : (content.html.match(/<img\b/g)?.length ?? 0);
  if ((result.images ?? 0) < expectedImages) return false;
  return true;
}
export function adapterFor(channel: ChannelId): PlatformAdapter {
  const spec = channelFor(channel);
  async function open(url: string, active: boolean) {
    await requirePermission(channel);
    const tab = await chrome.tabs.create({ url, active });
    if (!tab.id) throw new Error("无法创建平台标签页");
    await ready(tab.id);
    return tab.id;
  }
  async function read<T>(post: RemotePost, fn: (tabId: number) => Promise<T>) {
    const tabId = await open(post.url, false);
    try {
      return await fn(tabId);
    } finally {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
  async function inspect(
    context: Context,
    snapshot: Snapshot,
    content: PreparedContent,
    reopenDraft = false,
  ): Promise<Receipt> {
    const result = await callPage(context.tabId, {
      action: "inspect",
      channel,
      snapshot,
      content,
    });
    if (result.reviewing)
      return {
        status: "reviewing",
        editorUrl: result.url,
        detail: "平台显示审核中。",
      };
    if (result.publicUrl) {
      const parsed = parseRemoteUrl(result.publicUrl, channel);
      const validation =
        parsed.url === result.url
          ? result
          : await read(
              {
                id: "verify",
                channel,
                remoteId: parsed.remoteId,
                url: parsed.url,
                title: snapshot.title,
                status: "published",
                registeredAt: 0,
                updatedAt: 0,
              },
              (tabId) =>
                callPage(tabId, {
                  action: "inspect",
                  channel,
                  snapshot,
                  content,
                }),
            );
      if (matchesContent(validation, snapshot, content, true))
        return {
          status: "published",
          url: parsed.url,
          remoteId: parsed.remoteId,
          detail: "已在文章详情页核对内容。",
        };
      return {
        status: "uncertain",
        url: parsed.url,
        remoteId: parsed.remoteId,
        editorUrl: result.url,
        detail: "已找到文章链接，但正文或图片尚未完整核对。",
      };
    }
    if (result.draftId && reopenDraft) {
      await chrome.tabs.reload(context.tabId);
      await ready(context.tabId);
      const reopened = await callPage(context.tabId, {
        action: "inspect",
        channel,
        snapshot,
        content,
      });
      if (
        reopened.draftId === result.draftId &&
        matchesContent(reopened, snapshot, content)
      )
        return {
          status: "draft_saved",
          editorUrl: result.url,
          remoteId: result.draftId,
          detail: "重新打开草稿后，标题、正文及图片已核对。",
        };
    }
    return {
      status: "uncertain",
      editorUrl: result.url,
      detail: "尚未找到可核实的草稿标识或发布结果，请检查原站。",
    };
  }
  return {
    channel,
    capabilities: {
      format: spec.format,
      math: spec.math,
      mermaid: spec.mermaid,
      tables: spec.tables,
      publishing: spec.manual ? "manual" : "unverified",
      metrics: "unverified",
      comments: "unverified",
    },
    async checkSession(): Promise<Probe> {
      const tabId = await open(spec.editorUrl, true);
      const data = await callPage(tabId, { action: "probe", channel });
      // Keep the editor available when login or account setup is needed.
      return {
        channel,
        checkedAt: Date.now(),
        url: data.url,
        account: data.account,
        editorFound: !!data.editorFound,
        draftControl: !!data.draftControl,
        publishControl: !!data.publishControl,
        problems: data.problems ?? [],
      };
    },
    async prepare(snapshot, content, taskId, onTab) {
      if (spec.manual) throw new Error("LINUX DO 请使用人工发布辅助。");
      const tabId = await open(spec.editorUrl, true);
      await onTab(tabId);
      const probe = await callPage(tabId, { action: "probe", channel });
      if (probe.problems?.length) throw new Error(probe.problems.join("；"));
      await callPage(tabId, {
        action: "fill",
        channel,
        snapshot,
        content,
        taskId,
      });
      return { channel, taskId, tabId };
    },
    async saveDraft(context, snapshot, content) {
      const result = await callPage(context.tabId, {
        action: "save",
        channel,
        snapshot,
        content,
      });
      if (!result.draftId)
        return {
          status: "uncertain",
          editorUrl: result.url,
          detail: "已请求保存，但尚未识别到可重新打开的草稿 ID。",
        };
      return inspect(context, snapshot, content, true);
    },
    async preparePublish(context, snapshot, content) {
      const preparation = await callPage(context.tabId, {
        action: "prepare-publish",
        channel,
        snapshot,
        content,
      });
      return {
        status: preparation.readyToPublish
          ? "awaiting_publish"
          : "awaiting_review",
        editorUrl: preparation.url,
        detail:
          preparation.preparationDetail ??
          "已填充编辑器；发布设置仍待核对。最终发布由你手动完成。",
      };
    },
    verify: (context, snapshot, content, mode = "draft") =>
      inspect(context, snapshot, content, mode === "draft"),
    async fetchMetrics(post) {
      return read(post, async (tabId) => {
        const data = await callPage(tabId, {
          action: "metrics",
          channel,
          remoteId: post.remoteId,
        });
        return { values: data.metrics ?? [], sourceUrl: data.url };
      });
    },
    async fetchComments(post, cursor) {
      return read(post, async (tabId) => {
        const data = await callPage(tabId, {
          action: "comments",
          channel,
          remoteId: post.remoteId,
          cursor,
        });
        if (!data.comments) throw new Error("未返回评论页");
        return data.comments;
      });
    },
  };
}
