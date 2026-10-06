import { db, changed, type WorkbenchDB } from "./db";
import {
  uid,
  type Mode,
  type PreparedContent,
  type Snapshot,
  type Task,
  type TaskState,
  type TaskReceipt,
} from "./model";

export const stateNames: Record<TaskState, string> = {
  queued: "等待执行",
  paused: "已暂停",
  preparing: "准备内容",
  submitting: "正在提交",
  verifying: "核实结果",
  awaiting_publish: "等待手动发布",
  awaiting_review: "发布设置待核对",
  draft_saved: "草稿已保存",
  submitted: "已提交",
  reviewing: "审核中",
  published: "已发布",
  failed: "失败",
  uncertain: "结果待核实",
  cancelled: "已取消",
};
export const terminalStates: TaskState[] = [
  "draft_saved",
  "published",
  "cancelled",
];
export function hasRemoteActivity(task: Task) {
  return (
    task.tabId !== undefined ||
    !!task.remoteId ||
    !!task.remoteUrl ||
    task.events.some((e) =>
      ["准备向平台提交", "开始准备平台内容"].includes(e.message),
    )
  );
}
export function canStart(task: Task) {
  return (
    ["queued", "paused", "failed"].includes(task.state) &&
    !hasRemoteActivity(task)
  );
}
export function canRemoveTask(task: Task) {
  return (
    canStart(task) ||
    ["draft_saved", "published"].includes(task.state) ||
    (task.state === "cancelled" && !hasRemoteActivity(task))
  );
}
export function canAbandonTask(task: Task) {
  return (
    !["preparing", "submitting", "verifying"].includes(task.state) &&
    !canRemoveTask(task)
  );
}
export function taskReceipt(task: Task): TaskReceipt {
  return {
    id: `${task.channel}/${task.mode}/${task.snapshot.fingerprint}`,
    channel: task.channel,
    mode: task.mode,
    fingerprint: task.snapshot.fingerprint,
    recordedAt: Date.now(),
  };
}
export async function removeTasks(
  ids: string[],
  database = db,
  options: { abandonIds?: string[] } = {},
) {
  return database.transaction(
    "rw",
    database.tasks,
    database.taskReceipts,
    database.meta,
    async () => {
      const tasks = await database.tasks.bulkGet([...new Set(ids)]);
      const abandoned = new Set(options.abandonIds);
      if (
        tasks.some(
          (t) =>
            !t ||
            (!canRemoveTask(t) && !(abandoned.has(t.id) && canAbandonTask(t))),
        )
      )
        throw new Error("部分任务正在执行或结果待核实，请先处理后再清理。");
      for (const task of tasks) {
        if (
          ["draft_saved", "published"].includes(task!.state) ||
          canAbandonTask(task!) ||
          abandoned.has(task!.id)
        )
          await database.taskReceipts.put(taskReceipt(task!));
      }
      await database.tasks.bulkDelete(tasks.map((t) => t!.id));
      await changed(database);
      return tasks.length;
    },
  );
}
export function recoverTask(task: Task): Task {
  if (!["preparing", "submitting", "verifying"].includes(task.state))
    return task;
  const ambiguous = task.state !== "preparing" || !!task.tabId;
  return {
    ...task,
    state: ambiguous ? "uncertain" : "paused",
    owner: undefined,
    updatedAt: Date.now(),
    error: ambiguous
      ? "执行中断。请先核实原站结果，不能直接重发。"
      : "执行中断，可主动继续。",
  };
}
// Why this exact version cannot be queued again, if it cannot.
export function duplicateReason(
  candidate: Pick<Task, "channel" | "mode" | "snapshot">,
  existing: Pick<
    Task,
    | "channel"
    | "mode"
    | "snapshot"
    | "state"
    | "tabId"
    | "remoteId"
    | "remoteUrl"
    | "events"
  >[],
  receipts: Set<string>,
) {
  if (
    receipts.has(
      `${candidate.channel}/${candidate.mode}/${candidate.snapshot.fingerprint}`,
    )
  )
    return "相同版本已有任务防重记录，请核实原站，避免重复发布。";
  if (
    existing.some(
      (e) =>
        e.snapshot.fingerprint === candidate.snapshot.fingerprint &&
        e.channel === candidate.channel &&
        e.mode === candidate.mode &&
        (!["cancelled", "failed"].includes(e.state) ||
          hasRemoteActivity(e as Task)),
    )
  )
    return "相同版本已有任务。请先查看任务记录，避免重复发布。";
  return undefined;
}
export async function enqueue(
  snapshots: { snapshot: Snapshot; prepared: PreparedContent }[],
  mode: Mode,
  database: WorkbenchDB = db,
) {
  const batchId = uid();
  const now = Date.now();
  const tasks: Task[] = snapshots.map(({ snapshot, prepared }) => ({
    id: uid(),
    batchId,
    channel: snapshot.channel,
    mode,
    snapshot: structuredClone(snapshot),
    prepared: structuredClone(prepared),
    state: "queued",
    step: "待开始",
    createdAt: now,
    updatedAt: now,
    events: [],
  }));
  await database.transaction(
    "rw",
    database.tasks,
    database.taskReceipts,
    database.articles,
    database.meta,
    async () => {
      const existing = await database.tasks.toArray();
      const receipts = new Set(
        (await database.taskReceipts.toCollection().primaryKeys()) as string[],
      );
      for (const task of tasks) {
        const article = await database.articles.get(task.snapshot.articleId);
        if (!article || article.trashedAt)
          throw new Error("稿件已删除或在回收站，请返回内容库。");
        const duplicate = duplicateReason(task, existing, receipts);
        if (duplicate) throw new Error(duplicate);
        existing.push(task);
      }
      await database.tasks.bulkAdd(tasks);
      await changed(database);
    },
  );
  return tasks;
}
export async function claimTask(
  id: string,
  owner: string,
  database: WorkbenchDB = db,
) {
  return database.transaction(
    "rw",
    database.tasks,
    database.taskReceipts,
    database.articles,
    database.meta,
    async () => {
      const task = await database.tasks.get(id);
      if (!task || !canStart(task)) return undefined;
      const article = await database.articles.get(task.snapshot.articleId);
      if (!article || article.trashedAt) return undefined;
      if (await database.taskReceipts.get(taskReceipt(task).id)) {
        await database.tasks.update(id, {
          state: "cancelled",
          step: "相同版本已有防重记录，已取消重复任务",
          updatedAt: Date.now(),
        });
        await changed(database);
        return undefined;
      }
      const claimed: Task = {
        ...task,
        state: "preparing",
        owner,
        updatedAt: Date.now(),
      };
      await database.tasks.put(claimed);
      await changed(database);
      return claimed;
    },
  );
}
export async function cancelTask(id: string, database: WorkbenchDB = db) {
  await database.transaction("rw", database.tasks, database.meta, async () => {
    const task = await database.tasks.get(id);
    if (!task || !canStart(task))
      throw new Error(
        "任务已开始执行或需要核实原站结果，不能取消。请刷新队列。",
      );
    await patchTask(
      id,
      { state: "cancelled", step: "用户取消待执行任务" },
      "用户取消待执行任务",
      database,
    );
  });
}
// Claim verification in the same table transaction used by cleanup, so another
// workbench cannot remove a task while its remote result is being checked.
export async function claimTaskVerification(id: string, database = db) {
  return database.transaction("rw", database.tasks, database.meta, async () => {
    const task = await database.tasks.get(id);
    if (!task) throw new Error("任务不存在，请刷新队列。");
    if (["preparing", "submitting", "verifying"].includes(task.state))
      throw new Error("任务正在执行或核实，请稍后再试。");
    if (task.tabId === undefined)
      throw new Error("原标签页已不可用，请在原站核实并登记文章链接。");
    await patchTask(
      id,
      { state: "verifying", step: "正在核实原站结果" },
      undefined,
      database,
    );
    return task;
  });
}
export async function patchTask(
  id: string,
  values: Partial<Task>,
  event?: string,
  database: WorkbenchDB = db,
) {
  await database.transaction("rw", database.tasks, database.meta, async () => {
    const task = await database.tasks.get(id);
    if (!task) throw new Error("任务不存在");
    await database.tasks.put({
      ...task,
      ...values,
      updatedAt: Date.now(),
      events: event
        ? [...task.events, { at: Date.now(), message: event }]
        : task.events,
    });
    await changed(database);
  });
}
