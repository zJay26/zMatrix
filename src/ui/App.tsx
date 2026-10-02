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
  LayoutDashboard,
  Plug,
  Sun,
  Moon,
  MonitorSmartphone,
  HardDrive,
} from "lucide-react";
import { db, saveArticle } from "../core/db";
import { newArticle } from "../core/variants";
import { messageOf, type Article, type ChannelId } from "../core/model";
import { LibraryPage, defaultLibraryView } from "./LibraryPage";
import { HomePage } from "./HomePage";
import { Alert, command, relativeTime, ToastProvider } from "./shared";
import { isExtension } from "../platforms/browser-adapter";
import { getPreferences, savePreferences } from "../core/preferences";
import {
  checkForUpdates,
  dismissUpdate,
  getUpdateState,
  hasUpdate,
} from "../core/updates";
import type { SettingsTab } from "./SettingsPage";
import { getInstallation } from "../core/installation-state";
const UpdateOverlay = lazy(() =>
  import("./UpdateOverlay").then((m) => ({ default: m.UpdateOverlay })),
);

const EditorPage = lazy(() =>
  import("./EditorPage").then((m) => ({ default: m.EditorPage })),
);
const DistributeHost = lazy(() =>
  import("./DistributeHost").then((m) => ({ default: m.DistributeHost })),
);
const BatchDistributeDialog = lazy(() =>
  import("./BatchDistributeDialog").then((m) => ({
    default: m.BatchDistributeDialog,
  })),
);
const QueuePage = lazy(() =>
  import("./QueuePage").then((m) => ({ default: m.QueuePage })),
);
const DataPage = lazy(() =>
  import("./DataPage").then((m) => ({ default: m.DataPage })),
);
const AccountsPage = lazy(() =>
  import("./AccountsPage").then((m) => ({ default: m.AccountsPage })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
export type Screen =
  "home" | "library" | "queue" | "data" | "accounts" | "settings";
const nav = [
  { id: "home", name: "总览", icon: LayoutDashboard },
  { id: "library", name: "内容库", icon: BookOpenText },
  { id: "queue", name: "发布队列", icon: ListChecks },
  { id: "data", name: "数据与互动", icon: ChartNoAxesCombined },
  { id: "accounts", name: "平台账号", icon: Plug },
  { id: "settings", name: "设置", icon: Settings2 },
] as const;
const themes = [
  { id: "system", name: "跟随系统", icon: MonitorSmartphone },
  { id: "light", name: "浅色", icon: Sun },
  { id: "dark", name: "深色", icon: Moon },
] as const;
// Tasks that wait for the creator rather than for the queue.
const attentionStates = [
  "awaiting_publish",
  "awaiting_review",
  "failed",
  "uncertain",
];

export function App() {
  const preferences = useLiveQuery(() => getPreferences());
  const update = useLiveQuery(() => getUpdateState());
  const installation = useLiveQuery(() => getInstallation());
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    location.hash === "#updates" ? "updates" : "general",
  );
  const unreadCount = useLiveQuery(
    () => db.comments.filter((c) => !c.readAt).count(),
    [],
    0,
  );
  const queuedCount = useLiveQuery(
    () =>
      db.tasks
        .where("state")
        .anyOf(["queued", ...attentionStates])
        .count(),
    [],
    0,
  );
  const changedAt = useLiveQuery(() => db.meta.get("dataChangedAt"));
  const directory = useLiveQuery(() => db.meta.get("backupDirectory"));
  const backupAt = useLiveQuery(() => db.meta.get("backupCompletedAt"));
  const coveredAt = useLiveQuery(() => db.meta.get("backupCoveredChangeAt"));
  const [screen, setScreen] = useState<Screen>(
    location.hash === "#updates" ? "settings" : "home",
  );
  const [libraryView, setLibraryView] = useState(defaultLibraryView);
  const [editing, setEditing] = useState<{
    article: Article;
    channel?: ChannelId;
  } | null>(null);
  const [distributing, setDistributing] = useState<string[] | null>(null);
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
  const go = (target: Screen, tab?: SettingsTab) =>
    void navigate(() => {
      setEditing(null);
      setScreen(target);
      if (target === "settings") setSettingsTab(tab ?? "general");
    });
  const open = (article: Article, channel?: ChannelId) => {
    setNewDraftId(null);
    setEditing({ article, channel });
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
  useLayoutEffect(() => {
    if (!preferences) return;
    const system =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-color-scheme: dark)")
        : undefined;
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? system?.matches
            ? "dark"
            : "light"
          : preferences.theme;
    };
    apply();
    system?.addEventListener("change", apply);
    return () => system?.removeEventListener("change", apply);
  }, [preferences?.theme]);
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
      setEditing({ article });
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const importFiles = async (files: File[]) => {
    if (!files.length || !(await flushEditor.current())) return;
    try {
      const { importMarkdownFiles } = await import("../core/import");
      const imported = await importMarkdownFiles(files);
      setError("");
      setScreen("library");
      if (imported.length === 1) open(imported[0]!);
      else setEditing(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const updateAvailable =
    hasUpdate(update) &&
    update?.includePrereleases === preferences?.includePrereleases;
  if (!preferences)
    return (
      <div className="page-loading" role="status">
        正在打开工作台…
      </div>
    );
  const theme = themes.find((item) => item.id === preferences.theme)!;
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length]!;
  return (
    <ToastProvider>
      <div className="app-shell" inert={!!installation}>
        <aside className="sidebar">
          <a
            className="brand"
            aria-label="zMatrix 总览"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              go("home");
            }}
          >
            <img
              className="brand-mark"
              src="/icon/zmatrix.svg"
              alt=""
              width={34}
              height={34}
            />
            <span>
              zMatrix<small>创作工作台</small>
            </span>
          </a>
          <button
            className="new-article primary"
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
              const current = !editing && screen === item.id;
              return (
                <button
                  key={item.id}
                  aria-label={item.name}
                  aria-current={current ? "page" : undefined}
                  className={`${current ? "active" : ""} ${item.id === "accounts" ? "nav-divider" : ""}`}
                  onClick={() => go(item.id)}
                >
                  <item.icon size={18} />
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
            <button
              className={`backup-status ${backupError ? "warn" : ""}`}
              title="管理备份"
              onClick={() => go("settings", "backup")}
            >
              <HardDrive size={16} />
              <span>
                本地工作空间
                <small>
                  {backupError
                    ? "目录备份需要处理"
                    : directory
                      ? `已备份 · ${relativeTime(backupAt?.value as number)}`
                      : "建议设置文件夹备份"}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
            <button
              className="theme-toggle"
              aria-label={`外观：${theme.name}，点击切换为${nextTheme.name}`}
              title={`外观：${theme.name}`}
              onClick={() =>
                void savePreferences({ theme: nextTheme.id }).catch((e) =>
                  setError(messageOf(e)),
                )
              }
            >
              <theme.icon size={16} />
              {theme.name}
            </button>
          </div>
        </aside>
        <main className="main-panel">
          {updateAvailable &&
            update?.release &&
            update.dismissedVersion !== update.release.version && (
              <div className="update-banner" role="status">
                <Download size={17} />
                <span>新版本 v{update.release.version} 已发布</span>
                <button
                  className="text-button"
                  onClick={() => go("settings", "updates")}
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
          {error && <Alert tone="danger">{error}</Alert>}
          {backupError && (
            <Alert>
              {backupError}
              <button
                className="text-button"
                onClick={() => setBackupError("")}
              >
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
                key={editing.article.id}
                initial={editing.article}
                initialChannel={editing.channel}
                isNew={editing.article.id === newDraftId}
                defaultViewMode={preferences.editorLayout}
                onFlushReady={onFlushReady}
                onBack={() => {
                  setEditing(null);
                  setScreen("library");
                }}
                onOpenCopy={(article) => setEditing({ article })}
                onQueue={() => {
                  setEditing(null);
                  setScreen("queue");
                }}
              />
            ) : screen === "home" ? (
              <HomePage
                onOpen={open}
                onCreate={(sample) => void create(sample)}
                onImport={(files) => void importFiles(files)}
                onDistribute={(id) => setDistributing([id])}
                onNavigate={go}
              />
            ) : screen === "library" ? (
              <LibraryPage
                view={libraryView}
                onViewChange={setLibraryView}
                onOpen={open}
                onCreate={(sample) => void create(sample)}
                onDistribute={setDistributing}
              />
            ) : screen === "queue" ? (
              <QueuePage onOpenLibrary={() => go("library")} />
            ) : screen === "data" ? (
              <DataPage />
            ) : screen === "accounts" ? (
              <AccountsPage />
            ) : (
              <SettingsPage
                preferences={preferences}
                tab={settingsTab}
                onTabChange={setSettingsTab}
              />
            )}
            {distributing?.length === 1 && (
              <DistributeHost
                key={distributing[0]}
                articleId={distributing[0]!}
                onClose={() => setDistributing(null)}
                onQueue={() => setScreen("queue")}
                onEdit={(article, channel) => {
                  setDistributing(null);
                  open(article, channel);
                }}
              />
            )}
            {!!distributing && distributing.length > 1 && (
              <BatchDistributeDialog
                articleIds={distributing}
                onClose={() => setDistributing(null)}
                onQueue={() => setScreen("queue")}
                onOpen={(article) => {
                  setDistributing(null);
                  open(article);
                }}
              />
            )}
          </Suspense>
        </main>
      </div>
      {installation && (
        <Suspense
          fallback={
            <div className="page-loading" role="status">
              正在打开更新状态…
            </div>
          }
        >
          <UpdateOverlay installation={installation} />
        </Suspense>
      )}
    </ToastProvider>
  );
}
