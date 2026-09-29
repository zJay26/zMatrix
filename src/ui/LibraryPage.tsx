import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Copy,
  Download,
  FileText,
  FileUp,
  FolderInput,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
} from "lucide-react";
import { db } from "../core/db";
import {
  archiveArticles,
  duplicateArticle,
  filterLibrary,
  libraryEntries,
  type LibraryFilter,
} from "../core/library";
import { downloadBlob } from "../core/assets";
import { messageOf, type Article } from "../core/model";
import { channels } from "../platforms/catalog";
import { Alert, Empty, PlatformPill, timeLabel } from "./shared";

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

export function LibraryPage({
  onOpen,
  onCreate,
  view,
  onViewChange,
}: {
  onOpen: (article: Article) => void;
  onCreate: (sample?: boolean) => void;
  view: LibraryView;
  onViewChange: Dispatch<SetStateAction<LibraryView>>;
}) {
  const data = useLiveQuery(() =>
    db.transaction("r", db.articles, db.variants, db.posts, async () => ({
      articles: await db.articles.toArray(),
      variants: await db.variants.toArray(),
      posts: await db.posts.toArray(),
    })),
  );
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{ ids: string[]; archived: boolean } | null>(
    null,
  );
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
  const selectedIds = filtered
    .filter((e) => selected.has(e.article.id))
    .map((e) => e.article.id);
  const allVisibleSelected =
    !!visible.length && visible.every((e) => selected.has(e.article.id));
  const active = entries.filter((e) => !e.article.archived);
  const published = active.filter((e) =>
    e.posts.some((p) => p.status === "published"),
  ).length;
  const updateFilter = (patch: Partial<LibraryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelected(new Set());
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
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
      setUndo({ ids, archived: !value });
      setSelected(new Set());
      setNotice(`${ids.length} 篇稿件已${value ? "归档" : "移回内容库"}。`);
    });
  const importFiles = (files: File[]) => {
    if (!files.length) return;
    void act(async () => {
      const { importMarkdownFiles } = await import("../core/import");
      const imported = await importMarkdownFiles(files);
      if (imported[0]) onOpen(imported[0]);
    });
  };
  const exportSelected = () =>
    void act(async () => {
      const { exportArticles } = await import("../core/export");
      downloadBlob(
        await exportArticles(selectedIds),
        `zMatrix-稿件-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      setNotice(
        `已导出 ${selectedIds.length} 篇稿件，包含母稿、平台版本和配套图片。`,
      );
      setUndo(null);
    });

  return (
    <div className="page library-page">
      <div className="page-heading">
        <div>
          <h1>我的内容库</h1>
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={() => folder.current?.click()}>
            <FolderInput size={16} />
            导入文件夹
          </button>
          <button disabled={busy} onClick={() => file.current?.click()}>
            <FileUp size={16} />
            导入 Markdown
          </button>
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
      <div className="library-summary" aria-label="内容概览">
        <span>
          <strong>{active.length}</strong> 篇稿件
        </span>
        <span>
          <strong>{active.reduce((n, e) => n + e.variants.length, 0)}</strong>{" "}
          份平台版本
        </span>
        <span>
          <strong>{published}</strong> 篇已登记发布
        </span>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <div className="success-notice library-feedback" role="status">
          <span>{notice}</span>
          {undo && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await archiveArticles(undo.ids, undo.archived);
                  setUndo(null);
                  setNotice("已撤销归档操作。");
                })
              }
            >
              撤销
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="library-toolbar">
        <div className="tabs" aria-label="稿件范围">
          <button
            aria-pressed={!filter.archived}
            className={!filter.archived ? "active" : ""}
            onClick={() => updateFilter({ archived: false })}
          >
            全部稿件 <span>{active.length}</span>
          </button>
          <button
            aria-pressed={filter.archived}
            className={filter.archived ? "active" : ""}
            onClick={() => updateFilter({ archived: true })}
          >
            已归档 <span>{entries.length - active.length}</span>
          </button>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input
            type="search"
            aria-label="搜索稿件"
            placeholder="搜索标题、正文或平台标签"
            value={filter.query}
            onChange={(e) => updateFilter({ query: e.target.value })}
          />
        </label>
      </div>
      <div className="library-filters">
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
        <span className="muted filter-count">{filtered.length} 篇</span>
        <div className="view-switch" aria-label="显示方式">
          <button
            aria-label="卡片视图"
            aria-pressed={layout === "grid"}
            className={layout === "grid" ? "selected" : ""}
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            aria-label="列表视图"
            aria-pressed={layout === "list"}
            className={layout === "list" ? "selected" : ""}
            onClick={() => setLayout("list")}
          >
            <List size={17} />
          </button>
        </div>
      </div>
      {!!visible.length && (
        <div className="selection-bar">
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
            选择本页
          </label>
          {!!selectedIds.length && (
            <>
              <span className="muted">已选 {selectedIds.length} 篇</span>
              <button disabled={busy} onClick={exportSelected}>
                <Download size={15} />
                导出所选
              </button>
              <button
                disabled={busy}
                onClick={() => archive(selectedIds, !filter.archived)}
              >
                <Archive size={15} />
                {filter.archived ? "取消归档" : "归档所选"}
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
            ? "可以调整关键词或筛选条件。归档的稿件仍保留所有版本和素材。"
            : "导入已有 Markdown，或在这里开始写作。每个平台都能保留自己的标题、正文与配图。"}
        </Empty>
      ) : (
        <div
          className={`article-grid ${layout === "list" ? "article-list" : ""}`}
        >
          {visible.map(({ article, variants, posts }) => {
            const linkedChannels = [
              ...new Set([
                ...variants.map((v) => v.channel),
                ...posts.map((p) => p.channel),
              ]),
            ];
            return (
              <article
                key={article.id}
                className={`article-card ${selected.has(article.id) ? "is-selected" : ""}`}
              >
                <div className="article-card-top">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${article.title || "未命名稿件"}`}
                    checked={selected.has(article.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        next.has(article.id)
                          ? next.delete(article.id)
                          : next.add(article.id);
                        return next;
                      })
                    }
                  />
                  <FileText size={20} />
                  <span>母稿 · v{article.revision}</span>
                  <div className="article-card-actions">
                    <button
                      className="icon-button"
                      disabled={busy}
                      title="复制母稿与平台版本"
                      aria-label={`复制 ${article.title || "未命名稿件"}`}
                      onClick={() =>
                        void act(async () =>
                          onOpen(await duplicateArticle(article.id)),
                        )
                      }
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      title={article.archived ? "取消归档" : "归档稿件"}
                      aria-label={`${article.archived ? "取消归档" : "归档"} ${article.title || "未命名稿件"}`}
                      onClick={() => archive([article.id], !article.archived)}
                    >
                      {article.archived ? (
                        <ArchiveRestore size={15} />
                      ) : (
                        <Archive size={15} />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  className="article-link"
                  onClick={() => onOpen(article)}
                >
                  <h2>{article.title || "未命名稿件"}</h2>
                  <p>
                    {article.markdown
                      .replace(/[#*`>\[\]]/g, "")
                      .slice(0, 130) || "还没有正文，继续写下第一句话。"}
                  </p>
                </button>
                <div className="article-platforms">
                  {linkedChannels.slice(0, 3).map((id) => (
                    <PlatformPill key={id} id={id} />
                  ))}
                  {linkedChannels.length > 3 && (
                    <span className="muted">+{linkedChannels.length - 3}</span>
                  )}
                  {!linkedChannels.length && (
                    <span className="muted">等待第一份平台版本</span>
                  )}
                  {posts.some((p) => p.status === "published") && (
                    <span className="published-mark">已发布</span>
                  )}
                </div>
                <footer>
                  <span>{timeLabel(article.updatedAt)}</span>
                  <span>
                    {article.imageIds.length} 张配图
                    <ArrowUpRight size={15} />
                  </span>
                </footer>
              </article>
            );
          })}
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
