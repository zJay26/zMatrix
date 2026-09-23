import { useEffect, useRef, useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpenText,
  ListChecks,
  ChartNoAxesCombined,
  MessageSquareText,
  Settings2,
  Plus,
  FileUp,
  Search,
  ArrowUpRight,
  FileText,
  Archive,
  FolderInput,
} from "lucide-react";
import { db, getMeta, saveArticle } from "../core/db";
import { newArticle } from "../core/variants";
import { importMarkdownFiles } from "../core/import";
import { directoryBackup } from "../core/backup";
import { messageOf, type Article } from "../core/model";
import { EditorPage } from "./EditorPage";
import { QueuePage } from "./QueuePage";
import { DataPage } from "./DataPage";
import { SettingsPage } from "./SettingsPage";
import { Alert, Empty, command, timeLabel } from "./shared";
import { isExtension } from "../platforms/browser-adapter";
import { sampleMarkdown } from "../core/sample";
type Screen = "library" | "queue" | "metrics" | "comments" | "settings";
export function App() {
  const articles = useLiveQuery(
    () => db.articles.orderBy("updatedAt").reverse().toArray(),
    [],
    [],
  );
  const comments = useLiveQuery(() => db.comments.toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const changedAt = useLiveQuery(() => db.meta.get("dataChangedAt"));
  const directory = useLiveQuery(() => db.meta.get("backupDirectory"));
  const backupAt = useLiveQuery(() => db.meta.get("backupCompletedAt"));
  const coveredAt = useLiveQuery(() => db.meta.get("backupCoveredChangeAt"));
  const [screen, setScreen] = useState<Screen>("library");
  const [editing, setEditing] = useState<Article | null>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const backupBusy = useRef(false);
  const flushEditor = useRef<() => Promise<boolean>>(async () => true);
  const onFlushReady = useCallback((flush: () => Promise<boolean>) => {
    flushEditor.current = flush;
  }, []);
  const navigate = async (action: () => void) => {
    if (await flushEditor.current()) action();
  };
  useEffect(() => {
    if (isExtension()) void command({ type: "refresh" }).catch(() => {});
  }, []);
  useEffect(() => {
    if (
      !directory ||
      !changedAt ||
      Number(changedAt.value) <= Number(coveredAt?.value ?? 0)
    )
      return;
    const timer = setTimeout(() => {
      if (backupBusy.current) return;
      backupBusy.current = true;
      void directoryBackup(directory.value as FileSystemDirectoryHandle)
        .then(() => setBackupError(""))
        .catch((e) => setBackupError(messageOf(e)))
        .finally(() => {
          backupBusy.current = false;
        });
    }, 5000);
    return () => clearTimeout(timer);
  }, [changedAt?.value, directory?.value, coveredAt?.value]);
  const create = async (sample = false) => {
    if (!(await flushEditor.current())) return;
    try {
      const article = newArticle(
        sample ? "用一篇稿件，连接每个平台" : "",
        sample ? sampleMarkdown : "",
      );
      await saveArticle(article);
      setEditing(article);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const importFiles = async (files: File[]) => {
    setBusy(true);
    setError("");
    try {
      const imported = await importMarkdownFiles(files);
      if (imported[0]) setEditing(imported[0]);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const nav = [
    { id: "library", name: "内容库", icon: BookOpenText },
    { id: "queue", name: "发布队列", icon: ListChecks },
    { id: "metrics", name: "文章数据", icon: ChartNoAxesCombined },
    { id: "comments", name: "评论收件箱", icon: MessageSquareText },
    { id: "settings", name: "平台与备份", icon: Settings2 },
  ] as const;
  const filtered = articles.filter(
    (a) =>
      a.archived === archived &&
      (a.title + a.markdown).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void navigate(() => {
              setEditing(null);
              setScreen("library");
            });
          }}
        >
          <img
            className="brand-mark"
            src="/icon/zmatrix.svg"
            alt=""
            width={43}
            height={43}
          />
          <span>
            zMatrix<small>自媒体矩阵工作台</small>
          </span>
        </a>
        <button className="new-article" onClick={() => void create()}>
          <Plus size={18} />
          写新稿
        </button>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? "active" : ""}
              onClick={() => {
                void navigate(() => {
                  setEditing(null);
                  setScreen(item.id);
                });
              }}
            >
              <item.icon size={19} />
              <span>{item.name}</span>
              {item.id === "comments" && comments.some((c) => !c.readAt) ? (
                <b>{comments.filter((c) => !c.readAt).length}</b>
              ) : null}
              {item.id === "queue" &&
              tasks.some((t) => t.state === "queued") ? (
                <b>{tasks.filter((t) => t.state === "queued").length}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <span className="online-dot" />
            本地工作空间
          </div>
          <p>
            {backupError
              ? "目录备份需要处理"
              : directory
                ? `备份 ${timeLabel(backupAt?.value as number)}`
                : "建议设置文件夹备份"}
          </p>
          <button
            className="text-button"
            onClick={() => {
              void navigate(() => {
                setEditing(null);
                setScreen("settings");
              });
            }}
          >
            管理备份
            <ArrowUpRight size={13} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        {backupError && <Alert>{backupError}</Alert>}
        {editing ? (
          <EditorPage
            key={editing.id}
            initial={editing}
            onFlushReady={onFlushReady}
            onBack={() => setEditing(null)}
            onQueue={() => {
              setEditing(null);
              setScreen("queue");
            }}
          />
        ) : screen === "library" ? (
          <div className="page library-page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">写作，从这里继续</p>
                <h1>我的内容库</h1>
                <p>一份母稿，各有表达。把写作与发布放在一起。</p>
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
                <button className="primary" onClick={() => void create()}>
                  <Plus size={17} />
                  新建稿件
                </button>
              </div>
            </div>
            {error && <Alert>{error}</Alert>}
            <div className="library-toolbar">
              <div className="tabs">
                <button
                  className={!archived ? "active" : ""}
                  onClick={() => setArchived(false)}
                >
                  全部稿件{" "}
                  <span>{articles.filter((a) => !a.archived).length}</span>
                </button>
                <button
                  className={archived ? "active" : ""}
                  onClick={() => setArchived(true)}
                >
                  已归档
                </button>
              </div>
              <label className="search-box">
                <Search size={17} />
                <input
                  aria-label="搜索稿件"
                  placeholder="搜索标题或正文"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {!filtered.length ? (
              <Empty
                title={
                  query
                    ? "没有找到这篇稿件"
                    : archived
                      ? "还没有归档稿件"
                      : "从一篇稿件开始"
                }
                action={
                  !query && !archived ? (
                    <div className="button-row">
                      <button className="primary" onClick={() => void create()}>
                        开始写作
                      </button>
                      <button onClick={() => void create(true)}>
                        用示例体验
                      </button>
                    </div>
                  ) : null
                }
              >
                {query
                  ? "试试其他关键词。"
                  : archived
                    ? "归档后仍保留素材、平台版本和发布记录。"
                    : "导入已有 Markdown，或在这里开始写作。每个平台都能保留自己的标题、正文与配图。"}
              </Empty>
            ) : (
              <div className="article-grid">
                {filtered.map((article) => (
                  <article key={article.id} className="article-card">
                    <div className="article-card-top">
                      <FileText size={23} />
                      <span>母稿 · v{article.revision}</span>
                      <button
                        className="icon-button"
                        aria-label={
                          article.archived
                            ? `取消归档 ${article.title}`
                            : `归档 ${article.title}`
                        }
                        onClick={() =>
                          void saveArticle({
                            ...article,
                            archived: !article.archived,
                            revision: article.revision + 1,
                            updatedAt: Date.now(),
                          })
                        }
                      >
                        <Archive size={16} />
                      </button>
                    </div>
                    <button
                      className="article-link"
                      onClick={() => setEditing(article)}
                    >
                      <h2>{article.title || "未命名稿件"}</h2>
                      <p>
                        {article.markdown
                          .replace(/[#*`>\[\]]/g, "")
                          .slice(0, 110) || "还没有正文，继续写下第一句话。"}
                      </p>
                    </button>
                    <footer>
                      <span>{timeLabel(article.updatedAt)}</span>
                      <span>
                        {article.imageIds.length} 张配图
                        <ArrowUpRight size={16} />
                      </span>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            <input
              hidden
              type="file"
              multiple
              accept=".md,.markdown,image/*"
              ref={file}
              onChange={(e) => {
                void importFiles(Array.from(e.target.files ?? []));
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
                void importFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
        ) : screen === "queue" ? (
          <QueuePage />
        ) : screen === "metrics" ? (
          <DataPage />
        ) : screen === "comments" ? (
          <DataPage commentsMode />
        ) : (
          <SettingsPage />
        )}
      </main>
    </div>
  );
}
