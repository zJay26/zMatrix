import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Play, Pause, ExternalLink, RefreshCw } from "lucide-react";
import { db } from "../core/db";
import { canStart, patchTask, stateNames } from "../core/tasks";
import { messageOf } from "../core/model";
import { Alert, Empty, PlatformPill, command, timeLabel } from "./shared";
import { isExtension } from "../platforms/browser-adapter";
export function QueuePage() {
  const tasks = useLiveQuery(
    () => db.tasks.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const queueError = useLiveQuery(() => db.meta.get("queueError"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
          <p className="eyebrow">发布进度</p>
          <h1>任务队列</h1>
          <p>稿件版本固定保存。准备发布停在最终提交前，由你在原站手动完成。</p>
        </div>
        <div className="button-row">
          <button onClick={() => void act({ type: "pause" })}>
            <Pause size={16} />
            暂停队列
          </button>
          <button
            className="primary"
            disabled={busy || !tasks.some(canStart)}
            onClick={() =>
              void act({
                type: "run",
                ids: tasks
                  .filter(canStart)
                  .reverse()
                  .map((t) => t.id),
              })
            }
          >
            <Play size={16} />
            执行待处理任务
          </button>
        </div>
      </div>
      {!!(error || queueError?.value) && (
        <Alert>{error || String(queueError?.value)}</Alert>
      )}
      {!tasks.length ? (
        <Empty title="还没有发布任务" action={null}>
          在稿件中打开“发布预览”，选择平台后加入队列。
        </Empty>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <article key={task.id} className="task-card">
              <header>
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
                ].includes(task.state) && (
                  <button
                    onClick={() => void act({ type: "verify", id: task.id })}
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
                {["queued", "paused", "failed"].includes(task.state) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void patchTask(
                        task.id,
                        { state: "cancelled" },
                        "用户取消待执行任务",
                      )
                    }
                  >
                    取消任务
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
    </div>
  );
}
