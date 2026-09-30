import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpenText,
  ListChecks,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  ArrowUpRight,
  Download,
  X,
} from "lucide-react";
import { db, saveArticle } from "../core/db";
import { newArticle } from "../core/variants";
import { messageOf, type Article } from "../core/model";
import { LibraryPage, defaultLibraryView } from "./LibraryPage";
import { Alert, command, timeLabel } from "./shared";
import { isExtension } from "../platforms/browser-adapter";
import { getPreferences } from "../core/preferences";
import {
  checkForUpdates,
  dismissUpdate,
  getUpdateState,
  hasUpdate,
} from "../core/updates";
import type { SettingsTab } from "./SettingsPage";

const EditorPage = lazy(() =>
  import("./EditorPage").then((m) => ({ default: m.EditorPage })),
);
const QueuePage = lazy(() =>
  import("./QueuePage").then((m) => ({ default: m.QueuePage })),
);
const DataPage = lazy(() =>
  import("./DataPage").then((m) => ({ default: m.DataPage })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
type Screen = "library" | "queue" | "data" | "settings";

export function App() {
  const preferences = useLiveQuery(() => getPreferences());
  const update = useLiveQuery(() => getUpdateState());
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const unreadCount = useLiveQuery(
    () => db.comments.filter((c) => !c.readAt).count(),
    [],
    0,
  );
  const queuedCount = useLiveQuery(
    () => db.tasks.where("state").equals("queued").count(),
    [],
    0,
  );
  const changedAt = useLiveQuery(() => db.meta.get("dataChangedAt"));
  const directory = useLiveQuery(() => db.meta.get("backupDirectory"));
  const backupAt = useLiveQuery(() => db.meta.get("backupCompletedAt"));
  const coveredAt = useLiveQuery(() => db.meta.get("backupCoveredChangeAt"));
  const [screen, setScreen] = useState<Screen>("library");
  const [libraryView, setLibraryView] = useState(defaultLibraryView);
  const [editing, setEditing] = useState<Article | null>(null);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [backupRound, setBackupRound] = useState(0);
  const backupBusy = useRef(false);
  const flushEditor = useRef<() => Promise<boolean>>(async () => true);
  const refreshed = useRef(false);
  const onFlushReady = useCallback((flush: () => Promise<boolean>) => {
    flushEditor.current = flush;
  }, []);
  const navigate = async (action: () => void) => {
    if (await flushEditor.current()) {
      setError("");
      action();
    }
  };
  useEffect(() => {
    if (!preferences || refreshed.current) return;
    refreshed.current = true;
    if (preferences.refreshOnOpen && isExtension())
      void command({ type: "refresh" }).catch(() => {});
  }, [preferences]);
  useLayoutEffect(() => {
    if (!preferences) return;
    document.documentElement.style.fontSize = `${preferences.fontSize}px`;
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${preferences.editorFontSize}px`,
    );
  }, [preferences?.fontSize, preferences?.editorFontSize]);
  useEffect(() => {
    if (preferences)
      setLibraryView((view) => ({
        ...view,
        layout: preferences.libraryLayout,
      }));
  }, [preferences?.libraryLayout]);
  useEffect(() => {
    // Extension checks run in the service worker; the browser preview checks while open.
    if (isExtension() || !preferences?.autoCheckUpdates) return;
    const check = () => void checkForUpdates().catch(() => {});
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [preferences?.autoCheckUpdates, preferences?.includePrereleases]);
  useEffect(() => {
    if (
      !directory ||
      !changedAt ||
      Number(changedAt.value) <= Number(coveredAt?.value ?? 0) ||
      backupError
    )
      return;
    const timer = setTimeout(() => {
      if (backupBusy.current) return;
      backupBusy.current = true;
      void import("../core/backup")
        .then((m) =>
          m.directoryBackup(directory.value as FileSystemDirectoryHandle),
        )
        .then(() => setBackupError(""))
        .catch((e) => setBackupError(messageOf(e)))
        .finally(() => {
          backupBusy.current = false;
          setBackupRound((n) => n + 1);
        });
    }, 5000);
    return () => clearTimeout(timer);
  }, [
    changedAt?.value,
    directory?.value,
    coveredAt?.value,
    backupRound,
    backupError,
  ]);
  useEffect(() => setBackupError(""), [directory?.value, backupAt?.value]);
  const create = async (sample = false) => {
    if (!(await flushEditor.current())) return;
    try {
      const markdown = sample
        ? (await import("../core/sample")).sampleMarkdown
        : "";
      const article = newArticle(
        sample ? "用一篇稿件，连接每个平台" : "",
        markdown,
      );
      if (sample) await saveArticle(article);
      setNewDraftId(sample ? null : article.id);
      setError("");
      setScreen("library");
      setEditing(article);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const nav = [
    { id: "library", name: "内容库", icon: BookOpenText },
    { id: "queue", name: "发布队列", icon: ListChecks },
    { id: "data", name: "数据与互动", icon: ChartNoAxesCombined },
    { id: "settings", name: "设置", icon: Settings2 },
  ] as const;
  const updateAvailable =
    hasUpdate(update) &&
    update?.includePrereleases === preferences?.includePrereleases;
  if (!preferences)
    return (
      <div className="page-loading" role="status">
        正在打开工作台…
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="zMatrix 内容库"
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
            zMatrix<small>创作工作台</small>
          </span>
        </a>
        <button
          className="new-article"
          aria-label="写新稿"
          onClick={() => void create()}
        >
          <Plus size={18} />
          写新稿
        </button>
        <nav aria-label="工作台导航">
          {nav.map((item) => {
            const count =
              item.id === "data"
                ? unreadCount
                : item.id === "queue"
                  ? queuedCount
                  : 0;
            return (
              <button
                key={item.id}
                aria-label={item.name}
                aria-current={screen === item.id ? "page" : undefined}
                className={`${screen === item.id ? "active" : ""} ${item.id === "settings" ? "settings-nav" : ""}`}
                onClick={() =>
                  void navigate(() => {
                    setEditing(null);
                    setScreen(item.id);
                    if (item.id === "settings") setSettingsTab("general");
                  })
                }
              >
                <item.icon size={19} />
                <span>{item.name}</span>
                {!!count && <b>{count}</b>}
                {item.id === "settings" && updateAvailable && (
                  <i className="nav-update-dot" aria-label="有新版本" />
                )}
              </button>
            );
          })}
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
            onClick={() =>
              void navigate(() => {
                setEditing(null);
                setScreen("settings");
                setSettingsTab("backup");
              })
            }
          >
            管理备份
            <ArrowUpRight size={13} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        {updateAvailable &&
          update?.release &&
          update.dismissedVersion !== update.release.version && (
            <div className="update-banner" role="status">
              <Download size={18} />
              <span>新版本 v{update.release.version} 已发布</span>
              <button
                className="text-button"
                onClick={() =>
                  void navigate(() => {
                    setEditing(null);
                    setScreen("settings");
                    setSettingsTab("updates");
                  })
                }
              >
                查看更新
                <ArrowUpRight size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="关闭此版本提醒"
                title="关闭此版本提醒"
                onClick={() =>
                  void dismissUpdate(update.release!.version).catch((e) =>
                    setError(messageOf(e)),
                  )
                }
              >
                <X size={17} />
              </button>
            </div>
          )}
        {error && <Alert>{error}</Alert>}
        {backupError && (
          <Alert>
            {backupError}
            <button className="text-button" onClick={() => setBackupError("")}>
              重试目录备份
            </button>
          </Alert>
        )}
        <Suspense
          fallback={
            <div className="page-loading" role="status">
              正在打开工作区…
            </div>
          }
        >
          {editing ? (
            <EditorPage
              key={editing.id}
              initial={editing}
              isNew={editing.id === newDraftId}
              defaultViewMode={preferences.editorLayout}
              onFlushReady={onFlushReady}
              onBack={() => setEditing(null)}
              onOpenCopy={setEditing}
              onQueue={() => {
                setEditing(null);
                setScreen("queue");
              }}
            />
          ) : screen === "library" ? (
            <LibraryPage
              view={libraryView}
              onViewChange={setLibraryView}
              onOpen={(article) => {
                setNewDraftId(null);
                setEditing(article);
              }}
              onCreate={(sample) => void create(sample)}
            />
          ) : screen === "queue" ? (
            <QueuePage />
          ) : screen === "data" ? (
            <DataPage />
          ) : (
            <SettingsPage
              preferences={preferences}
              tab={settingsTab}
              onTabChange={setSettingsTab}
            />
          )}
        </Suspense>
      </main>
    </div>
  );
}
