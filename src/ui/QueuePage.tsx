import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Play,
  Pause,
  ExternalLink,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { db } from "../core/db";
import {
  canStart,
  canRemoveTask,
  removeTasks,
  hasRemoteActivity,
  stateNames,
} from "../core/tasks";
import { messageOf } from "../core/model";
import {
  Alert,
  Empty,
  PlatformPill,
  command,
  timeLabel,
  ConfirmDialog,
} from "./shared";
import type { Task } from "../core/model";
import { isExtension } from "../platforms/browser-adapter";
import { channels } from "../platforms/catalog";
const taskGroups = {
  pending: { label: "待处理", states: [] as string[] },
  active: { label: "执行中", states: ["preparing", "submitting", "verifying"] },
  done: {
    label: "历史记录",
    states: ["draft_saved", "published", "cancelled"],
  },
};
function inGroup(task: Task, group: keyof typeof taskGroups) {
  const done =
    taskGroups.done.states.includes(task.state) && canRemoveTask(task);
  const active = taskGroups.active.states.includes(task.state);
  return group === "done"
    ? done
    : group === "active"
      ? active
      : !done && !active;
}
export function QueuePage() {
  const tasks = useLiveQuery(
    () => db.tasks.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const queueError = useLiveQuery(() => db.meta.get("queueError"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<keyof typeof taskGroups>("pending");
  const [selected, setSelected] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
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
  const runnable = filtered.filter(canStart);
  const removable = filtered.filter(canRemoveTask);
  const selectedIds = removable
    .filter((t) => selected.includes(t.id))
    .map((t) => t.id);
  const visibleRemovable = removable.filter((t) =>
    filtered.slice(0, limit).some((v) => v.id === t.id),
  );
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
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>任务队列</h1>
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
            onClick={() =>
              void act({
                type: "run",
                ids: [...runnable].reverse().map((t) => t.id),
              })
            }
          >
            <Play size={16} />
            执行筛选内任务（{runnable.length}）
          </button>
        </div>
      </div>
      {!!(error || queueError?.value) && (
        <Alert>{error || String(queueError?.value)}</Alert>
      )}
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      <div className="queue-filters">
        <div className="tabs" aria-label="任务状态">
          {Object.entries(taskGroups).map(([id, item]) => (
            <button
              key={id}
              aria-pressed={group === id}
              className={group === id ? "active" : ""}
              onClick={() => {
                setGroup(id as keyof typeof taskGroups);
                setLimit(30);
              }}
            >
              {item.label}
              <span>
                {
                  tasks.filter((t) => inGroup(t, id as keyof typeof taskGroups))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="library-filters">
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
        </div>
      </div>
      {!!removable.length && (
        <div className="selection-bar">
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
            选择本页
          </label>
          {!!selectedIds.length && (
            <button
              className="danger-text"
              onClick={() => setDeletion(selectedIds)}
            >
              <Trash2 size={15} />
              移除所选（{selectedIds.length}）
            </button>
          )}
          {group === "done" && (
            <button
              className="text-button"
              onClick={() => setDeletion(removable.map((t) => t.id))}
            >
              清理当前筛选的历史（{removable.length}）
            </button>
          )}
        </div>
      )}
      {!tasks.length ? (
        <Empty title="还没有发布任务" action={null}>
          在稿件中打开“发布预览”，选择平台后加入队列。
        </Empty>
      ) : !filtered.length ? (
        <Empty
          title={group === "pending" ? "当前没有待处理任务" : "没有匹配的任务"}
        >
          已结束的任务可在“历史记录”查看或清理。
        </Empty>
      ) : (
        <div className="task-list">
          {filtered.slice(0, limit).map((task) => (
            <article key={task.id} className="task-card">
              <header>
                {canRemoveTask(task) && (
                  <input
                    type="checkbox"
                    aria-label={`选择任务 ${task.snapshot.title}`}
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
                <PlatformPill id={task.channel} />
                <span className={`status status-${task.state}`}>
                  {stateNames[task.state]}
                </span>
                <span className="muted">
                  {task.mode === "draft" ? "保存草稿" : "准备发布 · 手动确认"} ·{" "}
                  {timeLabel(task.createdAt)}
                </span>
              </header>
              <h3>{task.snapshot.title}</h3>
              <p>{task.step}</p>
              {task.error && <Alert>{task.error}</Alert>}
              <div className="task-actions">
                {task.tabId && isExtension() && (
                  <button
                    onClick={() => {
                      void chrome.tabs
                        .update(task.tabId!, { active: true })
                        .catch(() =>
                          setError(
                            "原标签页已关闭。请先在原站草稿箱核实，避免重新创建相同内容。",
                          ),
                        );
                    }}
                  >
                    <ExternalLink size={14} />
                    回到原标签页
                  </button>
                )}
                {canStart(task) && (
                  <button
                    disabled={busy}
                    onClick={() => void act({ type: "run", ids: [task.id] })}
                  >
                    <Play size={14} />
                    执行此任务
                  </button>
                )}
                {[
                  "uncertain",
                  "submitted",
                  "reviewing",
                  "awaiting_publish",
                  "awaiting_review",
                ].includes(task.state) ||
                (["failed", "cancelled"].includes(task.state) &&
                  hasRemoteActivity(task)) ? (
                  <button
                    disabled={busy}
                    onClick={() => void act({ type: "verify", id: task.id })}
                  >
                    <RefreshCw size={14} />
                    核实原站结果
                  </button>
                ) : null}
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
                {canRemoveTask(task) && (
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => setDeletion([task.id])}
                  >
                    <Trash2 size={14} />
                    {canStart(task) ? "取消并移除" : "删除记录"}
                  </button>
                )}
              </div>
              <details>
                <summary>查看执行记录 · 版本 {task.snapshot.revision}</summary>
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
            </article>
          ))}
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
          title={`移除 ${deletion.length} 条任务记录？`}
          confirmLabel="确认移除"
          onClose={() => setDeletion(null)}
          onConfirm={async () => {
            await removeTasks(deletion);
            setSelected([]);
            setNotice("任务记录已移除，原站内容和发布登记不受影响。");
          }}
        >
          <p>
            未开始的任务将取消，已结束的记录会从列表移除。已完成内容的防重复发布保护仍然保留。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
