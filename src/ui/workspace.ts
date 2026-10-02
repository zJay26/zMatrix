import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../core/db";
import { channels, platforms } from "../platforms/catalog";
import { hasChannelAccess, isExtension } from "../platforms/browser-adapter";
import type { ChannelId, PlatformId, Probe, TaskState } from "../core/model";

// Finished tasks carry large prepared payloads and no longer affect what an
// article needs next, so overview screens only read the unfinished ones.
export const openTaskStates: TaskState[] = [
  "queued",
  "paused",
  "preparing",
  "submitting",
  "verifying",
  "awaiting_publish",
  "awaiting_review",
  "submitted",
  "reviewing",
  "failed",
  "uncertain",
];
export function useWorkspace() {
  return useLiveQuery(() =>
    db.transaction(
      "r",
      db.articles,
      db.variants,
      db.posts,
      db.tasks,
      async () => ({
        articles: await db.articles.toArray(),
        variants: await db.variants.toArray(),
        posts: await db.posts.toArray(),
        tasks: await db.tasks.where("state").anyOf(openTaskStates).toArray(),
      }),
    ),
  );
}
export function usePlatformAccess() {
  const [access, setAccess] = useState<Partial<Record<ChannelId, boolean>>>({});
  const refresh = useCallback(() => {
    if (!isExtension()) return;
    void Promise.all(
      channels.map(async (c) => [c.id, await hasChannelAccess(c.id)] as const),
    )
      .then((entries) => setAccess(Object.fromEntries(entries)))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  return { access, refresh };
}
export type ConnectionState =
  "preview" | "disconnected" | "unchecked" | "problem" | "ok";
export const connectionLabels: Record<ConnectionState, string> = {
  preview: "预览模式",
  disconnected: "未连接",
  unchecked: "已授权，待检查",
  problem: "需要处理",
  ok: "连接正常",
};
// A platform account is healthy only when every automatic path found its editor.
export function connectionOf(
  platform: PlatformId,
  access: Partial<Record<ChannelId, boolean>>,
  probes: Probe[],
) {
  const spec = platforms.find((item) => item.id === platform)!;
  const own = probes.filter((p) =>
    spec.channels.some((c) => c.id === p.channel),
  );
  const latest = [...own].sort((a, b) => b.checkedAt - a.checkedAt)[0];
  const problems = own.flatMap((p) => p.problems);
  const state: ConnectionState = !isExtension()
    ? "preview"
    : !access[spec.channels[0]!.id]
      ? "disconnected"
      : spec.manual
        ? "ok"
        : problems.length
          ? "problem"
          : own.some((p) => p.editorFound)
            ? "ok"
            : "unchecked";
  return {
    state,
    label: state === "ok" && spec.manual ? "已授权" : connectionLabels[state],
    account: own.find((p) => p.account)?.account,
    checkedAt: latest?.checkedAt,
    problems,
  };
}
