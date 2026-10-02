import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  FileCheck2,
  LoaderCircle,
  Minus,
  Send,
  TriangleAlert,
} from "lucide-react";
import { db, saveVariant } from "../core/db";
import { channels } from "../platforms/catalog";
import { isExtension } from "../platforms/browser-adapter";
import { freezeSnapshot, newVariant } from "../core/variants";
import { prepareContent, readiness } from "../core/render";
import { duplicateReason, enqueue } from "../core/tasks";
import {
  getPublishSelection,
  savePublishSelection,
} from "../core/publish-preferences";
import {
  messageOf,
  type Article,
  type ChannelId,
  type Mode,
} from "../core/model";
import {
  Alert,
  Modal,
  PlatformIcon,
  Segmented,
  command,
  untitled,
  useNotify,
} from "./shared";
import { usePlatformAccess } from "./workspace";

const automatic = channels.filter((channel) => !channel.manual);
const cellKey = (articleId: string, channel: ChannelId) =>
  `${articleId}/${channel}`;

// Send several articles to the same set of platforms in one step.
export function BatchDistributeDialog({
  articleIds,
  onClose,
  onQueue,
  onOpen,
}: {
  articleIds: string[];
  onClose: () => void;
  onQueue: () => void;
  onOpen: (article: Article) => void;
}) {
  const notify = useNotify();
  const { access } = usePlatformAccess();
  const data = useLiveQuery(
    () =>
      db.transaction(
        "r",
        db.articles,
        db.variants,
        db.tasks,
        db.taskReceipts,
        async () => ({
          articles: (await db.articles.bulkGet(articleIds)).filter(
            (a): a is Article => !!a && !a.trashedAt,
          ),
          variants: await db.variants
            .where("articleId")
            .anyOf(articleIds)
            .toArray(),
          tasks: await db.tasks.toArray(),
          receipts: new Set(
            (await db.taskReceipts.toCollection().primaryKeys()) as string[],
          ),
        }),
      ),
    [articleIds.join(",")],
  );
  const [selected, setSelected] = useState<ChannelId[]>([]);
  const [mode, setMode] = useState<Mode>("draft");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  useEffect(() => {
    let mounted = true;
    void getPublishSelection()
      .then((value) => {
        if (!mounted) return;
        setSelected(value.selected);
        setMode(value.mode);
      })
      .catch((e) => mounted && setError(messageOf(e)))
      .finally(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, []);
  const choose = (next: ChannelId[], nextMode = mode) => {
    setSelected(next);
    setMode(nextMode);
    setFailures({});
    void savePublishSelection(next, nextMode).catch((e) =>
      setError(messageOf(e)),
    );
  };
  const variantOf = (article: Article, channel: ChannelId) =>
    data?.variants.find(
      (v) => v.articleId === article.id && v.channel === channel,
    );
  useEffect(() => {
    if (!data) return;
    let stopped = false;
    void (async () => {
      const same: Record<string, string> = {};
      for (const article of data.articles)
        for (const channel of selected) {
          const snapshot = await freezeSnapshot(
            article,
            variantOf(article, channel) ?? newVariant(article, channel),
          );
          const reason = duplicateReason(
            { channel, mode, snapshot },
            data.tasks,
            data.receipts,
          );
          if (reason) same[cellKey(article.id, channel)] = reason;
        }
      if (!stopped) setDuplicates(same);
    })().catch(() => {});
    return () => {
      stopped = true;
    };
  }, [data, selected.join(","), mode]);
  const columns = automatic.filter((c) => selected.includes(c.id));
  const cell = (article: Article, channel: ChannelId) => {
    const key = cellKey(article.id, channel);
    const issues = readiness(
      article,
      variantOf(article, channel),
      channel,
      mode,
    );
    const reason = failures[key]
      ? failures[key]
      : issues.length
        ? issues.join("；")
        : duplicates[key]
          ? "此版本已分发过"
          : isExtension() && access[channel] === false
            ? "平台未连接"
            : "";
    return {
      key,
      reason,
      failed: !!failures[key],
      skipped: !!duplicates[key] && !issues.length && !failures[key],
      ok: !reason,
    };
  };
  const articles = data?.articles ?? [];
  const total = articles.length * columns.length;
  const going = articles.flatMap((article) =>
    columns
      .filter((c) => cell(article, c.id).ok)
      .map((c) => ({ article, channel: c.id })),
  );
  const submit = async (start: boolean) => {
    setBusy(start ? "start" : "queue");
    setError("");
    const failed: Record<string, string> = {};
    const created: string[] = [];
    let done = 0;
    try {
      for (const article of articles) {
        const targets = going.filter((item) => item.article.id === article.id);
        if (!targets.length) continue;
        const prepared = [];
        for (const { channel } of targets) {
          const key = cellKey(article.id, channel);
          try {
            let variant = await db.variants.get(key);
            if (!variant) {
              variant = newVariant(article, channel);
              await saveVariant(variant, db, { expected: undefined });
            }
            const snapshot = await freezeSnapshot(article, variant);
            prepared.push({
              snapshot,
              prepared: await prepareContent(snapshot),
            });
          } catch (e) {
            failed[key] = messageOf(e);
          }
          setBusy(`正在准备内容 ${++done} / ${going.length}`);
        }
        if (!prepared.length) continue;
        try {
          created.push(...(await enqueue(prepared, mode)).map((t) => t.id));
        } catch (e) {
          for (const { snapshot } of prepared)
            failed[cellKey(article.id, snapshot.channel)] = messageOf(e);
        }
      }
      if (start && created.length) {
        try {
          await command({ type: "run", ids: created });
        } catch (e) {
          await db.meta.put({ key: "queueError", value: messageOf(e) });
        }
      }
      setFailures(failed);
      if (created.length)
        notify(
          `已创建 ${created.length} 个分发任务${start ? "并开始处理" : ""}。`,
        );
      if (Object.keys(failed).length)
        setError(
          `${Object.keys(failed).length} 项未能加入队列，原因已标在表格中。其余任务已创建。`,
        );
      else if (created.length) {
        onQueue();
        onClose();
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <Modal
      title={`批量分发 ${articles.length} 篇稿件`}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="batch-options">
        <div>
          <span className="field-title">分发方式</span>
          <Segmented
            label="分发方式"
            value={mode}
            disabled={!!busy || !ready}
            onChange={(next) => choose(selected, next)}
            options={[
              {
                id: "draft",
                label: (
                  <>
                    <FileCheck2 size={16} />
                    保存草稿
                  </>
                ),
              },
              {
                id: "publish",
                label: (
                  <>
                    <Send size={16} />
                    准备发布，手动确认
                  </>
                ),
              },
            ]}
          />
        </div>
        <div>
          <span className="field-title">
            平台
            <button
              className="text-button"
              disabled={!!busy || !ready}
              onClick={() =>
                choose(
                  selected.length === automatic.length
                    ? []
                    : automatic.map((c) => c.id),
                )
              }
            >
              {selected.length === automatic.length ? "取消全选" : "全选"}
            </button>
          </span>
          <div className="platform-toggles">
            {automatic.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!!busy || !ready}
                aria-pressed={selected.includes(c.id)}
                className={selected.includes(c.id) ? "selected" : ""}
                onClick={() =>
                  choose(
                    selected.includes(c.id)
                      ? selected.filter((id) => id !== c.id)
                      : [...selected, c.id],
                  )
                }
              >
                <PlatformIcon id={c.id} size={18} />
                {c.short}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!columns.length ? (
        <p className="modal-lead">先选择要分发到的平台。</p>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix batch-matrix">
            <thead>
              <tr>
                <th>稿件</th>
                {columns.map((c) => (
                  <th key={c.id}>
                    <PlatformIcon id={c.id} size={18} />
                    {c.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id}>
                  <th>
                    <button
                      className="text-button"
                      title="打开稿件补充信息"
                      disabled={!!busy}
                      onClick={() => onOpen(article)}
                    >
                      {untitled(article.title)}
                    </button>
                  </th>
                  {columns.map((c) => {
                    const state = cell(article, c.id);
                    return (
                      <td key={c.id} title={state.reason || "就绪"}>
                        {state.ok ? (
                          <span className="cell-ok">
                            <Check size={15} />
                            就绪
                          </span>
                        ) : state.skipped ? (
                          <span className="cell-skip">
                            <Minus size={15} />
                            已分发
                          </span>
                        ) : (
                          <span
                            className={state.failed ? "cell-fail" : "cell-warn"}
                          >
                            <TriangleAlert size={14} />
                            {state.reason}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="modal-lead muted">
        缺少信息的项目会跳过。点击稿件标题可打开补充；在稿件里填写“通用发布信息”后，所有平台都会使用。
      </p>
      <footer className="modal-actions">
        <span className="muted">
          {busy && busy.startsWith("正在")
            ? busy
            : `${going.length} / ${total} 项就绪`}
        </span>
        <button
          className="text-button"
          disabled={!!busy || !going.length}
          onClick={() => void submit(false)}
        >
          加入队列，稍后执行
        </button>
        <button
          className="primary"
          disabled={!!busy || !going.length}
          onClick={() => void submit(true)}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Send size={16} />
          )}
          {mode === "publish"
            ? `准备 ${going.length} 项，停在发布前`
            : `保存 ${going.length} 份平台草稿`}
        </button>
      </footer>
    </Modal>
  );
}
