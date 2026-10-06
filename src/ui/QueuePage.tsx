import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Play,
  Pause,
  ExternalLink,
  RefreshCw,
  Search,
  Trash2,
  ListChecks,
  ChevronDown,
  MousePointerClick,
} from "lucide-react";
import { db } from "../core/db";
import {
  canStart,
  canRemoveTask,
  canAbandonTask,
  removeTasks,
  hasRemoteActivity,
  stateNames,
} from "../core/tasks";
import { taskStatus } from "../core/distribution";
import { messageOf } from "../core/model";
import {
  Alert,
  Empty,
  PlatformIcon,
  StatusBadge,
  command,
  timeLabel,
  ConfirmDialog,
  untitled,
  useNotify,
} from "./shared";
import type { Task } from "../core/model";
import { isExtension } from "../platforms/browser-adapter";
import { channels, channelFor } from "../platforms/catalog";
const taskGroups = {
  pending: { label: "待处理", states: [] as string[] },
  active: { label: "执行中", states: ["preparing", "submitting", "verifying"] },
  done: {
    label: "历史记录",
    states: ["draft_saved", "published", "cancelled"],
  },
};
type Group = keyof typeof taskGroups;
function inGroup(task: Task, group: Group) {
  const done =
    taskGroups.done.states.includes(task.state) && canRemoveTask(task);
  const active = taskGroups.active.states.includes(task.state);
  return group === "done"
    ? done
    : group === "active"
      ? active
      : !done && !active;
}
const needsVerify = (task: Task) =>
  [
    "uncertain",
    "submitted",
    "reviewing",
    "awaiting_publish",
    "awaiting_review",
  ].includes(task.state) ||
  (["failed", "cancelled"].includes(task.state) && hasRemoteActivity(task));
const badgeOf = (task: Task) =>
  taskStatus(task) ??
  (task.state === "published"
    ? "published"
    : task.state === "draft_saved"
      ? "draft"
      : "muted");
const canClearTask = (task: Task) =>
  canRemoveTask(task) || canAbandonTask(task);

export function QueuePage({ onOpenLibrary }: { onOpenLibrary?: () => void }) {
  const tasks = useLiveQuery(
    () => db.tasks.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const queueError = useLiveQuery(() => db.meta.get("queueError"));
  const notify = useNotify();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<{
    ids: string[];
    abandonIds: string[];
  } | null>(null);
  const [channel, setChannel] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const filtered = tasks.filter(
    (task) =>
      inGroup(task, group) &&
      (channel === "all" || task.channel === channel) &&
      task.snapshot.title
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const shown = filtered.slice(0, limit);
  // One distribution of one article is shown as a single card.
  const batches: { id: string; tasks: Task[] }[] = [];
  for (const task of shown) {
    const batch = batches.find((item) => item.id === task.batchId);
    if (batch) batch.tasks.push(task);
    else batches.push({ id: task.batchId, tasks: [task] });
  }
  const order = (task: Task) =>
    channels.findIndex((item) => item.id === task.channel);
  for (const batch of batches) batch.tasks.sort((a, b) => order(a) - order(b));
  const runnable = filtered.filter(canStart);
  const removable = filtered.filter(canClearTask);
  const selectedIds = removable
    .filter((t) => selected.includes(t.id))
    .map((t) => t.id);
  const visibleRemovable = shown.filter(canClearTask);
  const requestDeletion = (ids: string[]) =>
    setDeletion({
      ids,
      abandonIds: tasks
        .filter((task) => ids.includes(task.id) && canAbandonTask(task))
        .map((task) => task.id),
    });
  useEffect(() => setSelected([]), [group, channel, query]);
  const act = async (message: unknown) => {
    setBusy(true);
    setError("");
    try {
      await command(message);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const run = (list: Task[]) =>
    void act({
      type: "run",
      ids: [...list].reverse().map((t) => t.id),
    });
  const focusTab = (task: Task) =>
    void chrome.tabs
      .update(task.tabId!, { active: true })
      .catch(() =>
        setError(
          "原标签页已关闭。请先在原站草稿箱核实，避免重新创建相同内容。",
        ),
      );
  const waiting = tasks.filter((t) => t.state === "awaiting_publish").length;
  return (
    <div className="page queue-page">
      <div className="page-heading">
        <div>
          <h1>发布队列</h1>
          <p>任务逐个执行；最终发布始终由你在原站点击确认。</p>
        </div>
        <div className="button-row">
          <button
            disabled={busy || !tasks.some((t) => inGroup(t, "active"))}
            onClick={() => void act({ type: "pause" })}
          >
            <Pause size={16} />
            暂停队列
          </button>
          <button
            className="primary"
            disabled={busy || !runnable.length}
            onClick={() => run(runnable)}
          >
            <Play size={16} />
            执行筛选内任务（{runnable.length}）
          </button>
        </div>
      </div>
      {!!(error || queueError?.value) && (
        <Alert tone="danger">{error || String(queueError?.value)}</Alert>
      )}
      {!!waiting && group === "pending" && (
        <Alert tone="info">
          {waiting}{" "}
          个平台已填好内容，正停在发布按钮前。到原站确认并点击发布后，回来点“核实原站结果”完成登记。
        </Alert>
      )}
      <div className="library-toolbar">
        <div className="tabs" aria-label="任务状态">
          {(Object.keys(taskGroups) as Group[]).map((id) => (
            <button
              key={id}
              aria-pressed={group === id}
              className={group === id ? "active" : ""}
              onClick={() => {
                setGroup(id);
                setLimit(30);
              }}
            >
              {taskGroups[id].label}
              <span>{tasks.filter((t) => inGroup(t, id)).length}</span>
            </button>
          ))}
        </div>
        <div className="library-filters">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索任务"
              placeholder="搜索任务标题"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(30);
              }}
            />
          </label>
          <select
            aria-label="任务平台"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setLimit(30);
            }}
          >
            <option value="all">全部平台</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!!removable.length && (
        <div className={`selection-bar ${selectedIds.length ? "active" : ""}`}>
          <label>
            <input
              type="checkbox"
              aria-label="选择本页可清理任务"
              checked={
                !!visibleRemovable.length &&
                visibleRemovable.every((t) => selected.includes(t.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [
                        ...new Set([
                          ...selected,
                          ...visibleRemovable.map((t) => t.id),
                        ]),
                      ]
                    : selected.filter(
                        (id) => !visibleRemovable.some((t) => t.id === id),
                      ),
                )
              }
            />
            {selectedIds.length ? `已选 ${selectedIds.length} 项` : "选择本页"}
          </label>
          {!!selectedIds.length && (
            <button
              className="danger-text"
              disabled={busy}
              onClick={() => requestDeletion(selectedIds)}
            >
              <Trash2 size={15} />
              移除所选（{selectedIds.length}）
            </button>
          )}
          {group === "done" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => requestDeletion(removable.map((t) => t.id))}
            >
              清理当前筛选的历史（{removable.length}）
            </button>
          )}
        </div>
      )}
      {!tasks.length ? (
        <Empty
          icon={ListChecks}
          title="还没有发布任务"
          action={
            onOpenLibrary ? (
              <button onClick={onOpenLibrary}>去内容库选择稿件</button>
            ) : null
          }
        >
          在内容库或稿件中点击“分发”，勾选平台后即可创建任务。
        </Empty>
      ) : !filtered.length ? (
        <Empty
          icon={ListChecks}
          title={group === "pending" ? "当前没有待处理任务" : "没有匹配的任务"}
        >
          已结束的任务可在“历史记录”查看或清理。
        </Empty>
      ) : (
        <div className="task-list">
          {batches.map((batch) => {
            const first = batch.tasks[0]!;
            const startable = batch.tasks.filter(canStart);
            return (
              <article key={batch.id} className="task-card">
                <header>
                  <div>
                    <h3>{untitled(first.snapshot.title)}</h3>
                    <span className="muted">
                      {first.mode === "draft"
                        ? "保存草稿"
                        : "准备发布 · 手动确认"}{" "}
                      · {timeLabel(first.createdAt)} · 版本{" "}
                      {first.snapshot.revision}
                    </span>
                  </div>
                  {startable.length > 1 && (
                    <button disabled={busy} onClick={() => run(startable)}>
                      <Play size={14} />
                      执行这 {startable.length} 个平台
                    </button>
                  )}
                </header>
                <ul className="task-rows">
                  {batch.tasks.map((task) => (
                    <li key={task.id} className="task-row">
                      <div className="task-row-main">
                        {canClearTask(task) && (
                          <input
                            type="checkbox"
                            aria-label={`选择任务 ${task.snapshot.title} ${channelFor(task.channel).short}`}
                            checked={selected.includes(task.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, task.id]
                                  : selected.filter((id) => id !== task.id),
                              )
                            }
                          />
                        )}
                        <PlatformIcon id={task.channel} size={26} />
                        <div className="task-row-text">
                          <strong>
                            {channelFor(task.channel).name}
                            <StatusBadge status={badgeOf(task)}>
                              {stateNames[task.state]}
                            </StatusBadge>
                          </strong>
                          <p>{task.step}</p>
                        </div>
                        <div className="task-actions">
                          {task.tabId && isExtension() && (
                            <button
                              className={
                                task.state === "awaiting_publish"
                                  ? "primary"
                                  : ""
                              }
                              onClick={() => focusTab(task)}
                            >
                              <MousePointerClick size={14} />
                              {task.state === "awaiting_publish"
                                ? "去原站发布"
                                : "回到原标签页"}
                            </button>
                          )}
                          {canStart(task) && (
                            <button disabled={busy} onClick={() => run([task])}>
                              <Play size={14} />
                              {task.state === "failed" ? "重试" : "执行此任务"}
                            </button>
                          )}
                          {needsVerify(task) && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act({ type: "verify", id: task.id })
                              }
                            >
                              <RefreshCw size={14} />
                              核实原站结果
                            </button>
                          )}
                          {(task.remoteUrl || task.editorUrl) && (
                            <a
                              href={task.remoteUrl || task.editorUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开原站
                              <ExternalLink size={14} />
                            </a>
                          )}
                          {canClearTask(task) && (
                            <button
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => requestDeletion([task.id])}
                            >
                              <Trash2 size={14} />
                              {canAbandonTask(task)
                                ? "放弃跟踪并移除"
                                : canStart(task)
                                  ? "取消并移除"
                                  : "删除记录"}
                            </button>
                          )}
                        </div>
                      </div>
                      {task.error && <Alert>{task.error}</Alert>}
                      {!!task.events.length && (
                        <details>
                          <summary>
                            <ChevronDown size={14} />
                            执行记录（{task.events.length}）
                          </summary>
                          <ul className="events">
                            {task.events.map((e, i) => (
                              <li key={i}>
                                <time>{timeLabel(e.at)}</time>
                                {e.message}
                              </li>
                            ))}
                          </ul>
                          <p className="muted">
                            内容指纹 {task.snapshot.fingerprint.slice(0, 16)}
                          </p>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
      {filtered.length > limit && (
        <div className="pagination">
          <button onClick={() => setLimit((n) => n + 30)}>再显示 30 条</button>
          <span>
            已显示 {limit} / {filtered.length} 条
          </span>
        </div>
      )}
      {deletion && (
        <ConfirmDialog
          title={`移除 ${deletion.ids.length} 条任务记录？`}
          confirmLabel={
            deletion.abandonIds.length ? "放弃跟踪并移除" : "确认移除"
          }
          onClose={() => setDeletion(null)}
          onConfirm={async () => {
            await removeTasks(deletion.ids, db, {
              abandonIds: deletion.abandonIds,
            });
            setSelected([]);
            notify("任务记录已移除，原站内容和发布登记不受影响。");
          }}
        >
          {!!deletion.abandonIds.length && (
            <p>
              其中 {deletion.abandonIds.length}{" "}
              条任务的原站结果尚未确认。移除后将放弃这些任务的结果核实，无法再从队列继续处理。
            </p>
          )}
          <p>
            仅移除本地任务记录，不会撤回或删除原站内容，也不会关闭原站标签页。内容库稿件和发布登记保留。
          </p>
          <p>
            未开始的任务将取消，可重新加入队列。已完成或放弃跟踪的任务保留防重复发布保护，相同版本仍不能重复排队。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
