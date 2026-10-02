import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  FileUp,
  FolderInput,
  LayoutGrid,
  Plus,
  Search,
  Send,
  Table2,
  Trash2,
  RotateCcw,
  BookOpenText,
} from "lucide-react";
import {
  archiveArticles,
  duplicateArticle,
  filterLibrary,
  libraryEntries,
  type LibraryFilter,
} from "../core/library";
import { downloadBlob } from "../core/assets";
import { distributionOf, type ChannelState } from "../core/distribution";
import { messageOf, type Article, type ChannelId } from "../core/model";
import { channels } from "../platforms/catalog";
import {
  Alert,
  Empty,
  ActionMenu,
  ConfirmDialog,
  ChannelChip,
  PlatformIcon,
  Segmented,
  relativeTime,
  untitled,
  useNotify,
} from "./shared";
import { trashArticles, restoreArticles, purgeArticles } from "../core/cleanup";
import { useWorkspace } from "./workspace";

const defaults: LibraryFilter = {
  query: "",
  archived: false,
  channel: "all",
  publication: "all",
  sort: "updated",
};
const pageSize = 24;
export interface LibraryView {
  filter: LibraryFilter;
  layout: "grid" | "list";
  page: number;
}
export const defaultLibraryView: LibraryView = {
  filter: defaults,
  layout: "grid",
  page: 1,
};
const excerpt = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^#\s.*$/m, "")
    .replace(/[#*`>\[\]|-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 130);

export function LibraryPage({
  onOpen,
  onCreate,
  onDistribute,
  view,
  onViewChange,
}: {
  onOpen: (article: Article, channel?: ChannelId) => void;
  onCreate: (sample?: boolean) => void;
  onDistribute: (articleIds: string[]) => void;
  view: LibraryView;
  onViewChange: Dispatch<SetStateAction<LibraryView>>;
}) {
  const data = useWorkspace();
  const notify = useNotify();
  const { filter, layout, page } = view;
  const setFilter = (update: SetStateAction<LibraryFilter>) =>
    onViewChange((current) => ({
      ...current,
      filter: typeof update === "function" ? update(current.filter) : update,
    }));
  const setLayout = (layout: LibraryView["layout"]) =>
    onViewChange((current) => ({ ...current, layout }));
  const setPage = (page: number) =>
    onViewChange((current) => ({ ...current, page }));
  const deferredQuery = useDeferredValue(filter.query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deletion, setDeletion] = useState<{
    ids: string[];
    permanent: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const entries = useMemo(
    () =>
      libraryEntries(
        data?.articles ?? [],
        data?.variants ?? [],
        data?.posts ?? [],
      ),
    [data],
  );
  const filtered = useMemo(
    () => filterLibrary(entries, { ...filter, query: deferredQuery }),
    [entries, filter, deferredQuery],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const states = useMemo(
    () =>
      new Map(
        visible.map(({ article, variants, posts }) => [
          article.id,
          distributionOf(article, variants, posts, data?.tasks ?? []),
        ]),
      ),
    [visible, data],
  );
  // Columns for platforms this workspace actually uses keep the matrix compact.
  const used = useMemo(() => {
    const ids = new Set<ChannelId>([
      ...(data?.variants ?? []).map((v) => v.channel),
      ...(data?.posts ?? []).map((p) => p.channel),
    ]);
    const columns = channels.filter((c) => ids.has(c.id));
    return columns.length ? columns : channels.filter((c) => !c.manual);
  }, [data]);
  const selectedIds = filtered
    .filter((e) => selected.has(e.article.id))
    .map((e) => e.article.id);
  const allVisibleSelected =
    !!visible.length && visible.every((e) => selected.has(e.article.id));
  const count = (trashed: boolean, archived: boolean) =>
    entries.filter(
      (e) =>
        !!e.article.trashedAt === trashed &&
        (trashed || e.article.archived === archived),
    ).length;
  const scope = filter.trashed
    ? "trashed"
    : filter.archived
      ? "archived"
      : "active";
  const updateFilter = (patch: Partial<LibraryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelected(new Set());
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const archive = (ids: string[], value: boolean) =>
    void act(async () => {
      await archiveArticles(ids, value);
      setSelected(new Set());
      notify(`${ids.length} 篇稿件已${value ? "归档" : "移回内容库"}。`, {
        action: {
          label: "撤销",
          run: () => void act(() => archiveArticles(ids, !value)),
        },
      });
    });
  const importFiles = (files: File[]) => {
    if (!files.length) return;
    void act(async () => {
      const { importMarkdownFiles } = await import("../core/import");
      const imported = await importMarkdownFiles(files);
      if (imported.length === 1) onOpen(imported[0]!);
      else notify(`已导入 ${imported.length} 篇稿件。`);
    });
  };
  const exportSelected = () =>
    void act(async () => {
      const { exportArticles } = await import("../core/export");
      downloadBlob(
        await exportArticles(selectedIds),
        `zMatrix-稿件-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      notify(
        `已导出 ${selectedIds.length} 篇稿件，包含母稿、平台版本和配套图片。`,
      );
    });
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const rowActions = (article: Article) =>
    article.trashedAt ? (
      <>
        <button
          className="icon-button"
          disabled={busy}
          title="恢复稿件"
          aria-label={`恢复 ${untitled(article.title)}`}
          onClick={() =>
            void act(async () => {
              await restoreArticles([article.id]);
              notify("稿件已恢复。");
            })
          }
        >
          <RotateCcw size={16} />
        </button>
        <button
          className="icon-button danger-text"
          disabled={busy}
          title="彻底删除"
          aria-label={`彻底删除 ${untitled(article.title)}`}
          onClick={() => setDeletion({ ids: [article.id], permanent: true })}
        >
          <Trash2 size={16} />
        </button>
      </>
    ) : (
      <>
        <button
          className="distribute-button"
          disabled={busy}
          aria-label={`分发 ${untitled(article.title)}`}
          onClick={() => onDistribute([article.id])}
        >
          <Send size={15} />
          分发
        </button>
        <ActionMenu label={`更多 ${untitled(article.title)}`}>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => onOpen(await duplicateArticle(article.id)))
            }
          >
            <Copy size={15} />
            复制稿件
          </button>
          <button
            disabled={busy}
            onClick={() => archive([article.id], !article.archived)}
          >
            {article.archived ? (
              <ArchiveRestore size={15} />
            ) : (
              <Archive size={15} />
            )}
            {article.archived ? "取消归档" : "归档稿件"}
          </button>
          <button
            className="danger-text"
            disabled={busy}
            onClick={() => setDeletion({ ids: [article.id], permanent: false })}
          >
            <Trash2 size={15} />
            删除稿件
          </button>
        </ActionMenu>
      </>
    );
  const chips = (list: ChannelState[]) => {
    const shown = list.filter((state) => state.status !== "none");
    return shown.length ? (
      shown.map((state) => (
        <ChannelChip
          key={state.channel}
          id={state.channel}
          status={state.status}
          label={state.label}
        />
      ))
    ) : (
      <span className="muted">尚未分发</span>
    );
  };

  return (
    <div className="page library-page">
      <div className="page-heading">
        <div>
          <h1>我的内容库</h1>
          <p>母稿与各平台版本集中管理，每篇稿件的平台状态一目了然。</p>
        </div>
        <div className="button-row">
          <ActionMenu
            label="导入稿件"
            trigger={
              <>
                <FileUp size={16} />
                导入
              </>
            }
          >
            <button disabled={busy} onClick={() => file.current?.click()}>
              <FileUp size={16} />
              导入 Markdown
            </button>
            <button disabled={busy} onClick={() => folder.current?.click()}>
              <FolderInput size={16} />
              导入文件夹
            </button>
          </ActionMenu>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onCreate()}
          >
            <Plus size={17} />
            新建稿件
          </button>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="library-toolbar">
        <div className="tabs" aria-label="稿件范围">
          {(
            [
              ["active", "稿件", count(false, false)],
              ["archived", "已归档", count(false, true)],
              ["trashed", "回收站", count(true, false)],
            ] as const
          ).map(([id, label, total]) => (
            <button
              key={id}
              aria-pressed={scope === id}
              className={scope === id ? "active" : ""}
              onClick={() =>
                updateFilter({
                  archived: id === "archived",
                  trashed: id === "trashed",
                })
              }
            >
              {label} <span>{total}</span>
            </button>
          ))}
        </div>
        <div className="library-filters">
          <label className="search-box">
            <Search size={16} />
            <input
              type="search"
              aria-label="搜索稿件"
              placeholder="搜索标题、正文或标签"
              value={filter.query}
              onChange={(e) => updateFilter({ query: e.target.value })}
            />
          </label>
          <select
            aria-label="按平台筛选"
            value={filter.channel}
            onChange={(e) =>
              updateFilter({
                channel: e.target.value as LibraryFilter["channel"],
              })
            }
          >
            <option value="all">全部平台</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="按发布记录筛选"
            value={filter.publication}
            onChange={(e) =>
              updateFilter({
                publication: e.target.value as LibraryFilter["publication"],
              })
            }
          >
            <option value="all">全部发布状态</option>
            <option value="unpublished">未登记发布</option>
            <option value="published">已登记发布</option>
          </select>
          <select
            aria-label="稿件排序"
            value={filter.sort}
            onChange={(e) =>
              updateFilter({ sort: e.target.value as LibraryFilter["sort"] })
            }
          >
            <option value="updated">最近编辑</option>
            <option value="created">最近创建</option>
            <option value="title">标题顺序</option>
          </select>
          <Segmented
            label="显示方式"
            value={layout}
            onChange={setLayout}
            options={[
              {
                id: "grid",
                title: "卡片视图",
                label: <LayoutGrid size={16} aria-label="卡片视图" />,
              },
              {
                id: "list",
                title: "平台矩阵视图",
                label: <Table2 size={16} aria-label="列表视图" />,
              },
            ]}
          />
        </div>
      </div>
      {!!visible.length && (
        <div className={`selection-bar ${selectedIds.length ? "active" : ""}`}>
          <label>
            <input
              type="checkbox"
              aria-label="选择本页稿件"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  for (const { article } of visible)
                    allVisibleSelected
                      ? next.delete(article.id)
                      : next.add(article.id);
                  return next;
                })
              }
            />
            {selectedIds.length ? `已选 ${selectedIds.length} 篇` : "选择本页"}
          </label>
          {!selectedIds.length && (
            <span className="muted filter-count">共 {filtered.length} 篇</span>
          )}
          {!!selectedIds.length && (
            <>
              {selectedIds.length < filtered.length && (
                <button
                  className="text-button"
                  onClick={() =>
                    setSelected(new Set(filtered.map((e) => e.article.id)))
                  }
                >
                  选择全部结果（{filtered.length} 篇）
                </button>
              )}
              {scope === "active" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => onDistribute(selectedIds)}
                >
                  <Send size={15} />
                  分发所选
                </button>
              )}
              <button disabled={busy} onClick={exportSelected}>
                <Download size={15} />
                导出所选
              </button>
              {!filter.trashed && (
                <button
                  disabled={busy}
                  onClick={() => archive(selectedIds, !filter.archived)}
                >
                  <Archive size={15} />
                  {filter.archived ? "取消归档" : "归档所选"}
                </button>
              )}
              {filter.trashed && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await restoreArticles(selectedIds);
                      setSelected(new Set());
                      notify("所选稿件已恢复。");
                    })
                  }
                >
                  <RotateCcw size={15} />
                  恢复所选
                </button>
              )}
              <button
                className="danger-text"
                disabled={busy}
                onClick={() =>
                  setDeletion({ ids: selectedIds, permanent: !!filter.trashed })
                }
              >
                <Trash2 size={15} />
                {filter.trashed ? "彻底删除所选" : "删除所选"}
              </button>
              <button
                className="text-button"
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </>
          )}
          {busy && (
            <span className="muted" role="status">
              正在处理…
            </span>
          )}
        </div>
      )}
      {!data ? (
        <div className="page-loading" role="status">
          正在打开内容库…
        </div>
      ) : !filtered.length ? (
        <Empty
          icon={BookOpenText}
          title={entries.length ? "这里还没有稿件" : "从一篇稿件开始"}
          action={
            entries.length ? (
              <button
                onClick={() => {
                  setFilter(defaults);
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                查看全部稿件
              </button>
            ) : (
              <div className="button-row">
                <button className="primary" onClick={() => onCreate()}>
                  开始写作
                </button>
                <button onClick={() => onCreate(true)}>用示例体验</button>
              </div>
            )
          }
        >
          {entries.length
            ? filter.trashed
              ? "删除的稿件会保留在这里，直到你选择彻底删除。"
              : "可以调整关键词或筛选条件，或查看归档与回收站。"
            : "导入已有 Markdown，或在这里开始写作。标签、摘要只填一次，各平台自动使用。"}
        </Empty>
      ) : layout === "list" ? (
        <div className="matrix-scroll">
          <table className="matrix article-list">
            <thead>
              <tr>
                <th className="matrix-check" />
                <th>稿件</th>
                {used.map((c) => (
                  <th key={c.id} className="matrix-channel" title={c.name}>
                    <PlatformIcon id={c.id} size={18} />
                    <span>{c.short}</span>
                  </th>
                ))}
                <th>最近编辑</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ article }) => {
                const list = states.get(article.id) ?? [];
                return (
                  <tr
                    key={article.id}
                    className={selected.has(article.id) ? "is-selected" : ""}
                  >
                    <td className="matrix-check">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${untitled(article.title)}`}
                        checked={selected.has(article.id)}
                        onChange={() => toggle(article.id)}
                      />
                    </td>
                    <th>
                      <button
                        className="article-link"
                        disabled={!!article.trashedAt}
                        onClick={() => onOpen(article)}
                      >
                        <h2>{untitled(article.title)}</h2>
                      </button>
                    </th>
                    {used.map((c) => {
                      const state = list.find((s) => s.channel === c.id)!;
                      return (
                        <td key={c.id} className="matrix-channel">
                          <button
                            className={`matrix-cell chip-${state.status}`}
                            disabled={!!article.trashedAt}
                            title={`${c.name}：${state.label}，点击编辑此平台版本`}
                            onClick={() => onOpen(article, c.id)}
                          >
                            <i aria-hidden="true" />
                            {state.status === "none" ? "—" : state.label}
                          </button>
                        </td>
                      );
                    })}
                    <td className="muted">{relativeTime(article.updatedAt)}</td>
                    <td className="matrix-actions">
                      <div>{rowActions(article)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="article-grid">
          {visible.map(({ article }) => (
            <article
              key={article.id}
              className={`article-card ${selected.has(article.id) ? "is-selected" : ""}`}
            >
              <div className="article-card-top">
                <input
                  type="checkbox"
                  aria-label={`选择 ${untitled(article.title)}`}
                  checked={selected.has(article.id)}
                  onChange={() => toggle(article.id)}
                />
                <span>
                  {relativeTime(article.updatedAt)} · v{article.revision}
                  {article.imageIds.length
                    ? ` · ${article.imageIds.length} 图`
                    : ""}
                </span>
              </div>
              <button
                className="article-link"
                onClick={() => {
                  if (!article.trashedAt) onOpen(article);
                }}
                disabled={!!article.trashedAt}
              >
                <h2>{untitled(article.title)}</h2>
                <p>
                  {excerpt(article.markdown) ||
                    "还没有正文，继续写下第一句话。"}
                </p>
              </button>
              <div className="article-platforms chip-row">
                {chips(states.get(article.id) ?? [])}
              </div>
              <footer>{rowActions(article)}</footer>
            </article>
          ))}
        </div>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="稿件分页">
          <button
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            上一页
          </button>
          <span>
            第 {currentPage} / {pages} 页 · 每页 {pageSize} 篇
          </span>
          <button
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </button>
        </nav>
      )}
      {deletion && (
        <ConfirmDialog
          title={
            deletion.permanent
              ? `彻底删除 ${deletion.ids.length} 篇稿件？`
              : `删除 ${deletion.ids.length} 篇稿件？`
          }
          confirmLabel={deletion.permanent ? "彻底删除" : "移入回收站"}
          onClose={() => setDeletion(null)}
          onConfirm={async () => {
            if (deletion.permanent) await purgeArticles(deletion.ids);
            else await trashArticles(deletion.ids);
            setSelected(new Set());
            notify(
              deletion.permanent
                ? "稿件已彻底删除，原站文章和独立发布登记仍保留。"
                : "稿件已移入回收站，可随时恢复。未开始的关联任务已取消。",
            );
          }}
        >
          <p>
            {deletion.permanent
              ? "母稿和平台版本将永久删除，无法撤销。原站文章不受影响；仍被其他稿件或发布记录使用的图片会保留。"
              : "稿件和平台版本会保留在回收站，未开始的关联任务会取消。执行中或结果待核实的任务需先处理。"}
          </p>
        </ConfirmDialog>
      )}
      <input
        hidden
        type="file"
        multiple
        accept=".md,.mdown,.markdown,image/*"
        ref={file}
        onChange={(e) => {
          importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        ref={folder}
        onChange={(e) => {
          importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
