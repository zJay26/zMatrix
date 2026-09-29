import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FolderOpen,
  Download,
  Upload,
  ExternalLink,
  Plug,
  ScanLine,
  SlidersHorizontal,
  RefreshCw,
  Type,
  Check,
} from "lucide-react";
import { db } from "../core/db";
import {
  chooseBackupDirectory,
  directoryBackup,
  exportBackup,
  inspectBackup,
  restoreBackup,
} from "../core/backup";
import { downloadBlob } from "../core/assets";
import { channels } from "../platforms/catalog";
import { connectChannel, isExtension } from "../platforms/browser-adapter";
import { messageOf } from "../core/model";
import { Alert, Modal, PlatformPill, command, timeLabel } from "./shared";
import { version } from "../../package.json";
import {
  defaultPreferences,
  savePreferences,
  type Preferences,
} from "../core/preferences";
import { UpdateSettings } from "./UpdateSettings";
export type SettingsTab = "general" | "platforms" | "backup" | "updates";
const settingsTabs = [
  { id: "general", label: "通用偏好", icon: SlidersHorizontal },
  { id: "platforms", label: "平台连接", icon: Plug },
  { id: "backup", label: "数据备份", icon: FolderOpen },
  { id: "updates", label: "软件更新", icon: RefreshCw },
] as const;
export function SettingsPage({
  preferences,
  tab,
  onTabChange,
}: {
  preferences: Preferences;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const probes = useLiveQuery(() => db.probes.toArray(), [], []);
  const backup = useLiveQuery(() => db.meta.get("backupCompletedAt"));
  const directory = useLiveQuery(() => db.meta.get("backupDirectory"));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{
    file: File;
    articles: number;
    assets: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = () => {
    if (!("showDirectoryPicker" in window)) {
      setError("当前浏览器不支持目录备份，请使用 Edge。");
      return;
    }
    void act(async () => {
      const handle = await chooseBackupDirectory();
      await directoryBackup(handle);
    }, "备份目录已设置，首次备份已完成。");
  };
  const changePreference = (patch: Partial<Preferences>) => {
    setError("");
    void savePreferences(patch)
      .then(async () => {
        if (
          isExtension() &&
          ("autoCheckUpdates" in patch || "includePrereleases" in patch)
        )
          await command({ type: "configureUpdates" });
      })
      .catch((e) => setError(messageOf(e)));
  };
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <h1>设置</h1>
        </div>
        <span className="version-badge">v{version} · 开发预览</span>
      </div>
      <nav className="settings-tabs" aria-label="设置分类">
        {settingsTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : undefined}
            onClick={() => {
              onTabChange(id);
              setError("");
              setNotice("");
            }}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      {!isExtension() && tab === "platforms" && (
        <Alert>平台连接需要在 Edge 扩展中使用。</Alert>
      )}
      {tab === "general" && (
        <>
          <section
            className="settings-section appearance-settings"
            aria-labelledby="appearance-heading"
          >
            <div className="settings-section-heading">
              <h2 id="appearance-heading">
                <Type size={21} />
                字体与阅读
              </h2>
              <span className="settings-saved">
                <Check size={15} />
                自动保存
              </span>
            </div>
            <div className="appearance-grid">
              <div>
                <div className="font-setting">
                  <label htmlFor="interface-font-size">界面字号</label>
                  <output htmlFor="interface-font-size">
                    {preferences.fontSize}
                    <span>px</span>
                  </output>
                  <input
                    id="interface-font-size"
                    type="range"
                    min="14"
                    max="22"
                    step="1"
                    value={preferences.fontSize}
                    onChange={(e) =>
                      changePreference({ fontSize: Number(e.target.value) })
                    }
                  />
                  <div className="range-labels">
                    <span>14</span>
                    <span>标准 16</span>
                    <span>22</span>
                  </div>
                </div>
                <div className="font-setting">
                  <label htmlFor="editor-font-size">编辑与预览字号</label>
                  <output htmlFor="editor-font-size">
                    {preferences.editorFontSize}
                    <span>px</span>
                  </output>
                  <input
                    id="editor-font-size"
                    type="range"
                    min="14"
                    max="26"
                    step="1"
                    value={preferences.editorFontSize}
                    onChange={(e) =>
                      changePreference({
                        editorFontSize: Number(e.target.value),
                      })
                    }
                  />
                  <div className="range-labels">
                    <span>14</span>
                    <span>标准 17</span>
                    <span>26</span>
                  </div>
                </div>
              </div>
              <div className="type-preview" aria-label="字号预览">
                <span className="preview-caption">阅读预览</span>
                <h3>让表达，清晰一点。</h3>
                <p>
                  从一个想法，到一篇好文章。
                  <br />
                  在舒适的节奏里，专注写作。
                </p>
                <div className="type-preview-meta">
                  <span>zMatrix</span>
                  <span>Aa · 你好 · 0123</span>
                </div>
              </div>
            </div>
          </section>
          <section
            className="settings-section"
            aria-labelledby="workspace-heading"
          >
            <div className="section-intro">
              <h2 id="workspace-heading">工作区偏好</h2>
            </div>
            <label className="preference-row" htmlFor="default-library-layout">
              <span>内容库默认视图</span>
              <select
                id="default-library-layout"
                value={preferences.libraryLayout}
                onChange={(e) =>
                  changePreference({
                    libraryLayout: e.target
                      .value as Preferences["libraryLayout"],
                  })
                }
              >
                <option value="grid">卡片视图</option>
                <option value="list">列表视图</option>
              </select>
            </label>
            <label className="preference-row" htmlFor="default-editor-layout">
              <span>编辑器默认视图</span>
              <select
                id="default-editor-layout"
                value={preferences.editorLayout}
                onChange={(e) =>
                  changePreference({
                    editorLayout: e.target.value as Preferences["editorLayout"],
                  })
                }
              >
                <option value="split">编辑与预览</option>
                <option value="source">仅编辑</option>
                <option value="preview">仅预览</option>
              </select>
            </label>
            <label className="preference-row" htmlFor="refresh-on-open">
              <span>打开工作台时刷新文章数据</span>
              <input
                id="refresh-on-open"
                className="switch-input"
                type="checkbox"
                role="switch"
                checked={preferences.refreshOnOpen}
                onChange={(e) =>
                  changePreference({ refreshOnOpen: e.target.checked })
                }
              />
            </label>
            <div className="settings-reset">
              <button
                onClick={() =>
                  changePreference({
                    fontSize: defaultPreferences.fontSize,
                    editorFontSize: defaultPreferences.editorFontSize,
                    libraryLayout: defaultPreferences.libraryLayout,
                    editorLayout: defaultPreferences.editorLayout,
                    refreshOnOpen: defaultPreferences.refreshOnOpen,
                  })
                }
              >
                恢复默认偏好
              </button>
            </div>
          </section>
        </>
      )}
      {tab === "updates" && (
        <UpdateSettings preferences={preferences} onChange={changePreference} />
      )}
      {tab === "platforms" && (
        <section className="settings-section">
          <div className="section-intro">
            <h2>平台连接</h2>
          </div>
          <div className="platform-settings">
            {channels.map((channel) => {
              const probe = probes.find((p) => p.channel === channel.id);
              return (
                <div className="platform-setting" key={channel.id}>
                  <div>
                    <PlatformPill id={channel.id} />
                    <h3>{channel.name}</h3>
                    <p>
                      {channel.manual
                        ? "人工发布辅助"
                        : probe?.problems.length
                          ? probe.problems.join("；")
                          : probe?.editorFound
                            ? "已识别编辑器"
                            : "尚未检查编辑器"}
                    </p>
                    {probe && (
                      <small>
                        检查于 {timeLabel(probe.checkedAt)}
                        {probe.account ? " · " + probe.account : ""}
                      </small>
                    )}
                  </div>
                  <div className="button-row">
                    <a
                      href={channel.editorUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原站
                      <ExternalLink size={14} />
                    </a>
                    <button
                      disabled={busy || !isExtension()}
                      onClick={() => {
                        const permission = connectChannel(channel.id);
                        void act(async () => {
                          if (!(await permission))
                            throw new Error("尚未授予平台权限");
                        }, "平台访问权限已开启。");
                      }}
                    >
                      <Plug size={15} />
                      连接
                    </button>
                    <button
                      disabled={busy || !isExtension() || channel.manual}
                      onClick={() =>
                        void act(() =>
                          command({ type: "probe", channel: channel.id }),
                        )
                      }
                    >
                      <ScanLine size={15} />
                      检查页面
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {tab === "backup" && (
        <section className="settings-section">
          <div className="section-intro">
            <h2>文件夹备份</h2>
          </div>
          <div className="backup-panel">
            <FolderOpen size={34} />
            <div>
              <h3>{directory ? "已选择备份目录" : "尚未设置备份目录"}</h3>
              <p>最近完成：{timeLabel(backup?.value as number | undefined)}</p>
            </div>
            <button onClick={choose} disabled={busy}>
              授权备份目录
            </button>
            <button
              disabled={!directory || busy}
              onClick={() =>
                void act(
                  () =>
                    directoryBackup(
                      directory!.value as FileSystemDirectoryHandle,
                    ),
                  "备份已完成。",
                )
              }
            >
              立即备份
            </button>
          </div>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  async () =>
                    downloadBlob(
                      await exportBackup(),
                      `zMatrix-备份-${new Date().toISOString().slice(0, 10)}.zip`,
                    ),
                  "备份已导出。",
                )
              }
            >
              <Download size={16} />
              导出完整备份
            </button>
            <button disabled={busy} onClick={() => input.current?.click()}>
              <Upload size={16} />
              恢复备份
            </button>
            <input
              type="file"
              accept=".zip"
              hidden
              ref={input}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void act(async () => {
                    const data = await inspectBackup(file);
                    setRestore({
                      file,
                      articles: data.articles.length,
                      assets: data.assets.length,
                    });
                  });
                e.target.value = "";
              }}
            />
          </div>
        </section>
      )}
      {restore && (
        <Modal title="恢复本地备份" onClose={() => setRestore(null)}>
          <div className="form-stack">
            <p>
              已校验 {restore.articles} 篇稿件、{restore.assets} 份素材。
            </p>
            <p>
              恢复时合并缺失记录，已有本地记录保持原样；历史任务不会自动执行。
            </p>
            <p className="muted">
              如果要完整迁移到另一台电脑，请在新的扩展数据目录中恢复。
            </p>
          </div>
          <footer className="modal-actions">
            <button onClick={() => setRestore(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const count = await restoreBackup(restore.file);
                  setRestore(null);
                  setNotice(`已合并 ${count} 条记录。`);
                })
              }
            >
              恢复缺失记录
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
