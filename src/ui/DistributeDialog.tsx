import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Send,
  FileCheck2,
  LoaderCircle,
  Layers,
  Check,
  Copy,
  ExternalLink,
  Plug,
  PencilLine,
  Undo2,
  ChevronRight,
} from "lucide-react";
import { channels, channelFor } from "../platforms/catalog";
import {
  connectChannel,
  hasChannelAccess,
  isExtension,
} from "../platforms/browser-adapter";
import { db } from "../core/db";
import { freezeSnapshot, newVariant, resolveContent } from "../core/variants";
import { conversionRanges, prepareContent, readiness } from "../core/render";
import { duplicateReason, enqueue } from "../core/tasks";
import { channelState } from "../core/distribution";
import type { ChannelId, Mode, PreparedContent, Snapshot } from "../core/model";
import { messageOf } from "../core/model";
import {
  Modal,
  Alert,
  command,
  PlatformIcon,
  Segmented,
  untitled,
  useNotify,
} from "./shared";
import { MarkdownPreview } from "./Markdown";
import {
  MetadataFields,
  SharedFields,
  type MetadataHandle,
} from "./MetadataFields";
import { CoverPicker } from "./CoverPicker";
import {
  getPublishSelection,
  savePublishSelection,
} from "../core/publish-preferences";
import { emptyDefaults, type Draft } from "./useDraft";

const automatic = channels.filter((channel) => !channel.manual);
const manual = channels.filter((channel) => channel.manual);

export function DistributeDialog({
  draft,
  onFlush,
  onEditPlatform,
  onClose,
  onCreated,
}: {
  draft: Draft;
  onFlush?: () => Promise<boolean>;
  onEditPlatform: (channel: ChannelId) => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { article, variants } = draft;
  const notify = useNotify();
  const flush = onFlush ?? draft.flush;
  const [selected, setSelected] = useState<ChannelId[]>([]);
  const [mode, setMode] = useState<Mode>("draft");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<ChannelId | "shared">("shared");
  const [pane, setPane] = useState<"settings" | "preview">("settings");
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [duplicates, setDuplicates] = useState<Record<string, string>>({});
  const [conversions, setConversions] = useState<Record<string, string[]>>({});
  const sharedEditor = useRef<MetadataHandle>(null);
  const platformEditor = useRef<MetadataHandle>(null);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const posts = useLiveQuery(
    () => db.posts.where("articleId").equals(article.id).toArray(),
    [article.id],
    [],
  );
  const receipts = useLiveQuery(
    async () =>
      new Set((await db.taskReceipts.toCollection().primaryKeys()) as string[]),
    [],
  );
  const commitFields = () => {
    sharedEditor.current?.flush();
    platformEditor.current?.flush();
  };
  const changeSelection = (next: ChannelId[], nextMode = mode) => {
    commitFields();
    setError("");
    setFailures({});
    setSelected(next);
    setMode(nextMode);
    void savePublishSelection(next, nextMode).catch((e) =>
      setError(messageOf(e)),
    );
  };
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
  const refreshAccess = () => {
    if (!isExtension()) return;
    void Promise.all(
      automatic.map(async (c) => [c.id, await hasChannelAccess(c.id)] as const),
    )
      .then((entries) => setAccess(Object.fromEntries(entries)))
      .catch(() => {});
  };
  useEffect(refreshAccess, []);
  // Exact-version checks need the frozen fingerprint, so they run after edits settle.
  const version = JSON.stringify([article, variants, mode, selected]);
  useEffect(() => {
    let stopped = false;
    const timer = setTimeout(() => {
      void (async () => {
        const same: Record<string, string> = {};
        const converted: Record<string, string[]> = {};
        for (const id of selected) {
          const snapshot = await freezeSnapshot(
            article,
            variants[id] ?? newVariant(article, id),
          );
          const reason = duplicateReason(
            { channel: id, mode, snapshot },
            tasks,
            receipts ?? new Set(),
          );
          if (reason) same[id] = reason;
          const labels = [
            ...new Set(
              conversionRanges(snapshot.markdown, snapshot).map((r) => r.label),
            ),
          ];
          if (labels.length) converted[id] = labels;
        }
        if (!stopped) {
          setDuplicates(same);
          setConversions(converted);
        }
      })().catch(() => {});
    }, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [version, tasks, receipts]);

  const rows = automatic.map((channel) => {
    const variant = variants[channel.id];
    const issues = readiness(article, variant, channel.id, mode);
    const disconnected = isExtension() && access[channel.id] === false;
    const duplicate = duplicates[channel.id];
    return {
      channel,
      variant,
      issues,
      disconnected,
      duplicate,
      failure: failures[channel.id],
      state: channelState(article, channel.id, variant, posts, tasks),
      checked: selected.includes(channel.id),
      ok: !issues.length && !disconnected && !duplicate,
    };
  });
  const chosen = rows.filter((row) => row.checked);
  const going = chosen.filter((row) => row.ok);
  const blocked = chosen.length - going.length;
  const close = async () => {
    if (busy) return;
    commitFields();
    if (await flush()) onClose();
    else setError("发布信息尚未保存，请先处理保存错误。");
  };
  const submit = async (start: boolean) => {
    setBusy(start ? "start" : "queue");
    setError("");
    setFailures({});
    try {
      // A tag still being typed counts: commit it, then judge readiness from
      // the draft itself rather than from the last render.
      commitFields();
      const targets = chosen.filter(
        (row) =>
          !row.disconnected &&
          !row.duplicate &&
          !readiness(
            draft.articleRef.current,
            draft.currentVariant(row.channel.id),
            row.channel.id,
            mode,
          ).length,
      );
      if (!targets.length)
        throw new Error("所选平台还不能分发，请先按左侧各平台的提示补充信息。");
      // Keep a platform version for every platform this article is sent to.
      for (const row of targets)
        if (!variants[row.channel.id])
          draft.changeVariant(row.channel.id, (v) => v);
      if (!(await flush())) throw new Error("稿件尚未保存，请先处理保存错误。");
      const current = draft.articleRef.current;
      const prepared: { snapshot: Snapshot; prepared: PreparedContent }[] = [];
      const failed: Record<string, string> = {};
      for (const row of targets) {
        const id = row.channel.id;
        const variant =
          (await db.variants.get(`${current.id}/${id}`)) ??
          newVariant(current, id);
        const snapshot = await freezeSnapshot(current, variant);
        const problems = readiness(current, variant, id, mode);
        if (problems.length) {
          failed[id] = problems.join("；");
          continue;
        }
        try {
          prepared.push({ snapshot, prepared: await prepareContent(snapshot) });
        } catch (e) {
          failed[id] = messageOf(e);
        }
      }
      if (Object.keys(failed).length) {
        setFailures(failed);
        setFocus(Object.keys(failed)[0] as ChannelId);
        throw new Error(
          "部分平台的内容还不能分发，已在对应平台标出原因。处理后重试，或先取消勾选。",
        );
      }
      const created = await enqueue(prepared, mode);
      if (start) {
        try {
          await command({ type: "run", ids: created.map((t) => t.id) });
        } catch (e) {
          await db.meta.put({ key: "queueError", value: messageOf(e) });
        }
      }
      notify(
        start
          ? `已开始处理 ${created.length} 个平台，进度见发布队列。`
          : `${created.length} 个平台已加入队列。`,
      );
      onCreated();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
    }
  };
  const focused = focus === "shared" ? undefined : channelFor(focus);
  const focusedVariant = focused
    ? (variants[focused.id] ?? newVariant(article, focused.id))
    : undefined;
  const content = resolveContent(article, focusedVariant);
  const defaults = article.defaults ?? emptyDefaults();
  const focusedRow = rows.find((row) => row.channel.id === focus);
  return (
    <Modal
      title={`分发「${untitled(article.title)}」`}
      onClose={() => void close()}
      size="full"
    >
      <div className="distribute">
        <aside className="distribute-side">
          <div className="distribute-mode">
            <span className="field-title">分发方式</span>
            <Segmented
              label="分发方式"
              value={mode}
              disabled={!!busy || !ready}
              onChange={(next) => changeSelection(selected, next)}
              options={[
                {
                  id: "draft",
                  title: "把内容存进各平台的草稿箱",
                  label: (
                    <>
                      <FileCheck2 size={16} />
                      保存草稿
                    </>
                  ),
                },
                {
                  id: "publish",
                  title: "填好内容和发布设置，停在发布按钮前，由你点击发布",
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
          <button
            type="button"
            className={`target shared-target ${focus === "shared" ? "focused" : ""}`}
            onClick={() => {
              commitFields();
              setFocus("shared");
              setPane("settings");
            }}
          >
            <span className="shared-mark">
              <Layers size={15} />
            </span>
            <span className="target-name">
              通用发布信息
              <small>
                {defaults.tags.length
                  ? `${defaults.tags.length} 个标签`
                  : "未填标签"}
                {defaults.summary ? " · 有摘要" : ""}
                {defaults.coverId ? " · 有封面" : ""}
              </small>
            </span>
          </button>
          <div className="publish-selection-bar">
            <span>
              平台
              <span className="muted">
                已选 {selected.length} / {automatic.length}
              </span>
            </span>
            <button
              type="button"
              className="text-button"
              disabled={!!busy || !ready}
              onClick={() =>
                changeSelection(
                  selected.length === automatic.length
                    ? []
                    : automatic.map((channel) => channel.id),
                )
              }
            >
              {selected.length === automatic.length ? "取消全选" : "全选"}
            </button>
          </div>
          <div className="target-grid">
            {rows.map((row) => {
              const id = row.channel.id;
              return (
                <div
                  key={id}
                  className={`target ${row.checked ? "checked" : ""} ${focus === id ? "focused" : ""}`}
                >
                  <label>
                    <input
                      type="checkbox"
                      disabled={!!busy || !ready}
                      checked={row.checked}
                      onChange={(e) => {
                        changeSelection(
                          e.target.checked
                            ? [...selected, id]
                            : selected.filter((item) => item !== id),
                        );
                        if (e.target.checked) setFocus(id);
                      }}
                    />
                    <PlatformIcon id={id} />
                    <span className="target-name">
                      {row.channel.name}
                      {!row.checked ? (
                        <small>
                          {row.state.status === "none" ||
                          row.state.status === "ready"
                            ? Object.keys(row.variant?.overrides ?? {}).length
                              ? "有独立内容"
                              : "跟随母稿"
                            : row.state.label}
                        </small>
                      ) : row.failure ? (
                        <small className="tone-problem" title={row.failure}>
                          无法分发：{row.failure}
                        </small>
                      ) : row.issues.length ? (
                        <small
                          className="tone-action"
                          title={row.issues.join("；")}
                        >
                          需补充：{row.issues.join("；")}
                        </small>
                      ) : row.duplicate ? (
                        <small title={row.duplicate}>
                          此版本已分发过，修改后可再次分发
                        </small>
                      ) : row.disconnected ? (
                        <small className="tone-action">平台尚未连接</small>
                      ) : (
                        <small className="tone-ok">
                          <Check size={12} />
                          就绪
                          {row.state.status !== "none" &&
                          row.state.status !== "ready"
                            ? ` · 当前${row.state.label}`
                            : ""}
                        </small>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="icon-button target-open"
                    aria-label={`查看 ${row.channel.name} 的设置`}
                    title="查看此平台的设置与预览"
                    onClick={() => {
                      commitFields();
                      setFocus(id);
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          {manual.map((channel) => (
            <div className="target manual-target" key={channel.id}>
              <PlatformIcon id={channel.id} />
              <span className="target-name">
                {channel.name}
                <small>人工发布：复制正文后到原站粘贴</small>
              </span>
              <button
                type="button"
                className="icon-button bordered"
                title="复制 Markdown 正文"
                aria-label={`复制 ${channel.name} 的 Markdown 正文`}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      resolveContent(article, variants[channel.id]).markdown,
                    )
                    .then(() => notify("正文已复制，可到原站粘贴。"))
                    .catch((e) => setError(messageOf(e)))
                }
              >
                <Copy size={15} />
              </button>
              <a
                className="icon-button bordered"
                href={channel.editorUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`打开 ${channel.name}`}
                title="打开原站"
              >
                <ExternalLink size={15} />
              </a>
            </div>
          ))}
        </aside>
        <section className="distribute-main">
          {error && <Alert tone="danger">{error}</Alert>}
          {!isExtension() && (
            <Alert tone="info">
              这是本地界面预览：可以检查和排队，实际填入平台需要在 Edge
              扩展中进行。
            </Alert>
          )}
          {focus === "shared" ? (
            <>
              <header className="distribute-heading">
                <span className="shared-mark large">
                  <Layers size={18} />
                </span>
                <div>
                  <h3>通用发布信息</h3>
                  <p className="muted">
                    只需填写一次，所有平台自动使用；个别平台需要不同内容时，再到该平台单独修改。
                  </p>
                </div>
              </header>
              <fieldset className="publish-fields" disabled={!!busy}>
                <SharedFields
                  ref={sharedEditor}
                  defaults={defaults}
                  markdown={article.markdown}
                  onChange={draft.changeDefaults}
                />
                <div className="metadata-field">
                  <div className="metadata-label">
                    <label>通用封面</label>
                  </div>
                  <CoverPicker
                    imageIds={article.imageIds}
                    value={defaults.coverId}
                    onChange={(coverId) =>
                      draft.changeDefaults((previous) => ({
                        ...previous,
                        coverId,
                      }))
                    }
                  />
                </div>
              </fieldset>
            </>
          ) : (
            focused &&
            focusedVariant && (
              <>
                <header className="distribute-heading">
                  <PlatformIcon id={focused.id} size={36} />
                  <div>
                    <h3>{focused.name}</h3>
                    <p className="muted">
                      {focusedRow?.state.status === "none"
                        ? "尚未分发到此平台"
                        : `当前状态：${focusedRow?.state.label}`}
                      {focusedRow?.state.post?.url && (
                        <a
                          href={focusedRow.state.post.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看原文
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </p>
                  </div>
                  <Segmented
                    label="平台详情视图"
                    value={pane}
                    onChange={(next) => {
                      commitFields();
                      setPane(next);
                    }}
                    options={[
                      { id: "settings", label: "发布设置" },
                      { id: "preview", label: "内容预览" },
                    ]}
                  />
                </header>
                {focusedRow?.failure && (
                  <Alert tone="danger">{focusedRow.failure}</Alert>
                )}
                {focusedRow?.duplicate && (
                  <Alert tone="info">{focusedRow.duplicate}</Alert>
                )}
                {focusedRow?.disconnected && (
                  <Alert>
                    尚未授权访问 {focused.short}，分发前需要先连接。
                    <button
                      className="text-button"
                      onClick={() =>
                        void connectChannel(focused.id)
                          .then(refreshAccess)
                          .catch((e) => setError(messageOf(e)))
                      }
                    >
                      <Plug size={14} />
                      立即连接
                    </button>
                  </Alert>
                )}
                {!!focusedRow?.issues.length && (
                  <Alert>
                    分发前需要补充：{focusedRow.issues.join("；")}
                    {focusedRow.issues.includes("请填写标签") && (
                      <button
                        className="text-button"
                        onClick={() => {
                          commitFields();
                          setFocus("shared");
                        }}
                      >
                        <Layers size={14} />
                        填写通用标签，所有平台共用
                      </button>
                    )}
                  </Alert>
                )}
                {!!conversions[focused.id]?.length && (
                  <Alert tone="info">
                    {focused.short} 不支持
                    {conversions[focused.id]!.join("、")}
                    ，分发时会自动转成图片，稿件里的源码保持不变。
                  </Alert>
                )}
                {focused.platform === "cnblogs" && (
                  <Alert tone="info">
                    博客园会自动填入内容；发布和保存草稿都需你在原站亲自点击。
                  </Alert>
                )}
                {pane === "settings" ? (
                  <fieldset className="publish-fields" disabled={!!busy}>
                    <div className="metadata-field">
                      <div className="metadata-label">
                        <label htmlFor="distribute-title">平台标题</label>
                        {focusedVariant.overrides.title !== undefined && (
                          <button
                            type="button"
                            className="text-button follow-reset"
                            onClick={() => draft.reset(focused.id, "title")}
                          >
                            <Undo2 size={13} />
                            跟随母稿标题
                          </button>
                        )}
                      </div>
                      <input
                        id="distribute-title"
                        aria-label="发布平台标题"
                        value={content.title}
                        onChange={(e) =>
                          draft.change(focused.id, "title", e.target.value)
                        }
                      />
                    </div>
                    <MetadataFields
                      key={focused.id}
                      ref={platformEditor}
                      channel={focused.id}
                      metadata={focusedVariant.metadata}
                      inherited={defaults}
                      markdown={content.markdown}
                      onChange={(update) =>
                        draft.changeVariant(focused.id, (v) => ({
                          ...v,
                          metadata: update(v.metadata),
                        }))
                      }
                    />
                    <div className="metadata-field">
                      <div className="metadata-label">
                        <label>封面</label>
                        {!focusedVariant.metadata.coverId &&
                          defaults.coverId && (
                            <span className="field-badge">跟随通用封面</span>
                          )}
                      </div>
                      <CoverPicker
                        imageIds={content.imageIds}
                        value={focusedVariant.metadata.coverId}
                        inherited={defaults.coverId}
                        onChange={(coverId) =>
                          draft.changeVariant(focused.id, (v) => ({
                            ...v,
                            metadata: { ...v.metadata, coverId },
                          }))
                        }
                      />
                    </div>
                    <div className="button-row">
                      <button
                        onClick={() => {
                          commitFields();
                          void flush().then((saved) => {
                            if (saved) onEditPlatform(focused.id);
                            else setError("请先处理未保存的编辑。");
                          });
                        }}
                      >
                        <PencilLine size={15} />
                        单独编辑此平台的正文与配图
                      </button>
                    </div>
                  </fieldset>
                ) : (
                  <div className="publish-preview">
                    <h2>{untitled(content.title)}</h2>
                    <MarkdownPreview value={content.markdown} />
                  </div>
                )}
              </>
            )
          )}
        </section>
      </div>
      <footer className="modal-actions">
        <span className="muted">
          {!selected.length
            ? "勾选要分发的平台"
            : `${going.length} 个平台就绪${blocked ? ` · ${blocked} 个暂不分发` : ""}`}
        </span>
        <button
          className="text-button"
          disabled={!!busy || !ready || !chosen.length}
          onClick={() => void submit(false)}
        >
          加入队列，稍后执行
        </button>
        <button
          className="primary"
          disabled={!!busy || !ready || !chosen.length}
          onClick={() => void submit(true)}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Send size={16} />
          )}
          {busy
            ? "正在准备内容…"
            : mode === "publish"
              ? `准备 ${going.length} 个平台，停在发布前`
              : `保存 ${going.length} 份平台草稿`}
        </button>
      </footer>
    </Modal>
  );
}
