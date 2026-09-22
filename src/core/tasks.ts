import { db, changed, type WorkbenchDB } from "./db";
import {
  uid,
  type Mode,
  type PreparedContent,
  type Snapshot,
  type Task,
  type TaskState,
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
export function canStart(task: Task) {
  return (
    ["queued", "paused", "failed"].includes(task.state) &&
    !task.remoteId &&
    !task.remoteUrl &&
    !task.events.some((e) => e.message === "准备向平台提交")
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
  await database.transaction("rw", database.tasks, database.meta, async () => {
    const existing = await database.tasks.toArray();
    for (const task of tasks) {
      if (
        existing.some(
          (e) =>
            e.snapshot.fingerprint === task.snapshot.fingerprint &&
            e.channel === task.channel &&
            e.mode === task.mode &&
            !["cancelled", "failed"].includes(e.state),
        )
      )
        throw new Error("相同版本已有任务。请先查看任务记录，避免重复发布。");
      existing.push(task);
    }
    await database.tasks.bulkAdd(tasks);
    await changed(database);
  });
  return tasks;
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
