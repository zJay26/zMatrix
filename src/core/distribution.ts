import type { Article, ChannelId, RemotePost, Task, Variant } from "./model";
import { channels } from "../platforms/catalog";
import { stateNames } from "./tasks";
import { snapshotDiffers } from "./variants";

// One article on one platform, reduced to what the creator needs to do next.
export type ChannelStatus =
  | "none" // no platform version yet
  | "ready" // has a version, never distributed
  | "queued"
  | "running"
  | "action" // waiting for the creator on the platform
  | "problem" // failed or needs verification
  | "review" // submitted, waiting for the platform
  | "draft"
  | "outdated" // published, local content changed since
  | "published";
export interface ChannelState {
  channel: ChannelId;
  status: ChannelStatus;
  label: string;
  variant?: Variant;
  post?: RemotePost;
  task?: Task;
}
export const statusLabels: Record<ChannelStatus, string> = {
  none: "未添加",
  ready: "未分发",
  queued: "排队中",
  running: "执行中",
  action: "待你确认",
  problem: "需处理",
  review: "审核中",
  draft: "草稿已存",
  outdated: "有更新",
  published: "已发布",
};
export function taskStatus(task: Task): ChannelStatus | undefined {
  switch (task.state) {
    case "queued":
    case "paused":
      return "queued";
    case "preparing":
    case "submitting":
    case "verifying":
      return "running";
    case "awaiting_publish":
    case "awaiting_review":
      return "action";
    case "failed":
    case "uncertain":
      return "problem";
    case "submitted":
    case "reviewing":
      return "review";
    default:
      return undefined;
  }
}
export function channelState(
  article: Article,
  channel: ChannelId,
  variant: Variant | undefined,
  posts: RemotePost[],
  tasks: Task[],
): ChannelState {
  const task = tasks
    .filter(
      (t) =>
        t.channel === channel &&
        t.snapshot.articleId === article.id &&
        taskStatus(t),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const post = posts
    .filter((p) => p.channel === channel && p.articleId === article.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const base = { channel, variant, post, task };
  if (task && (!post || task.updatedAt >= post.updatedAt)) {
    const status = taskStatus(task)!;
    return {
      ...base,
      status,
      label:
        status === "action" || status === "problem"
          ? stateNames[task.state]
          : statusLabels[status],
    };
  }
  if (post) {
    const status: ChannelStatus =
      post.status === "draft_saved"
        ? "draft"
        : post.status === "published"
          ? post.snapshot && snapshotDiffers(post.snapshot, article, variant)
            ? "outdated"
            : "published"
          : "review";
    return { ...base, task: undefined, status, label: statusLabels[status] };
  }
  const status = variant ? "ready" : "none";
  return { ...base, task: undefined, status, label: statusLabels[status] };
}
export function distributionOf(
  article: Article,
  variants: Variant[],
  posts: RemotePost[],
  tasks: Task[],
): ChannelState[] {
  return channels.map((c) =>
    channelState(
      article,
      c.id,
      variants.find((v) => v.articleId === article.id && v.channel === c.id),
      posts,
      tasks,
    ),
  );
}
