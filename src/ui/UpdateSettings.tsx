import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  Check,
  Download,
  RefreshCw,
  PackageOpen,
  FolderOpen,
} from "lucide-react";
import { version } from "../../package.json";
import {
  checkForUpdates,
  getUpdateState,
  hasUpdate,
  RELEASES_URL,
} from "../core/updates";
import type { Preferences } from "../core/preferences";
import { isExtension } from "../platforms/browser-adapter";
import { messageOf } from "../core/model";
import { Alert, command, timeLabel } from "./shared";
import { db } from "../core/db";
import { INSTALL_DIRECTORY, INSTALL_RESULT } from "../core/installation-state";
import {
  chooseInstallationDirectory,
  installRelease,
} from "../core/update-install";

export function UpdateSettings({
  preferences,
  onChange,
}: {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
}) {
  const state = useLiveQuery(() => getUpdateState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const directoryEntry = useLiveQuery(() => db.meta.get(INSTALL_DIRECTORY));
  const directory = directoryEntry?.value as
    FileSystemDirectoryHandle | undefined;
  const result = useLiveQuery(() => db.meta.get(INSTALL_RESULT));
  const lastUpdate = result?.value as
    { version: string; at: number } | undefined;
  const canInstall = isExtension() && "showDirectoryPicker" in window;
  const installAction = async (action: () => Promise<unknown>) => {
    setInstallBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(messageOf(e));
    } finally {
      setInstallBusy(false);
    }
  };
  const release = state?.release;
  const channelMatches =
    state?.includePrereleases === preferences.includePrereleases;
  const available = channelMatches && hasUpdate(state);
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      if (isExtension()) await command({ type: "checkUpdates", manual: true });
      else await checkForUpdates({ manual: true });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="settings-section update-settings"
      aria-labelledby="updates-heading"
    >
      <div className="section-intro">
        <h2 id="updates-heading">软件更新</h2>
      </div>
      <div className={`update-overview ${available ? "has-update" : ""}`}>
        <div className="update-symbol">
          {available ? <Download size={28} /> : <PackageOpen size={28} />}
        </div>
        <div>
          <h3>
            {busy
              ? "正在检查更新…"
              : available
                ? `发现新版本 v${release!.version}`
                : state?.error
                  ? "暂时无法检查更新"
                  : state?.checkedAt && channelMatches
                    ? release
                      ? "已是最新版本"
                      : "暂无可用版本"
                    : "检查新版本"}
          </h3>
          <p>
            当前版本 v{version}
            <span>·</span>
            {state?.checkedAt
              ? `最近检查 ${timeLabel(state.checkedAt)}`
              : "尚未检查"}
          </p>
        </div>
        <button onClick={() => void check()} disabled={busy}>
          <RefreshCw size={17} className={busy ? "spin" : undefined} />
          {busy ? "检查中" : "检查更新"}
        </button>
      </div>
      {(error || state?.error) && <Alert>{error || state?.error}</Alert>}
      {lastUpdate?.version === version && (
        <div className="update-choice" role="status">
          <Check size={17} />
          <span>
            已完成更新至 v{version} · {timeLabel(lastUpdate.at)}
          </span>
        </div>
      )}
      <label className="preference-row" htmlFor="auto-check-updates">
        <span>
          自动检查更新<span className="setting-value">每 6 小时</span>
        </span>
        <input
          id="auto-check-updates"
          className="switch-input"
          role="switch"
          type="checkbox"
          checked={preferences.autoCheckUpdates}
          onChange={(e) => onChange({ autoCheckUpdates: e.target.checked })}
        />
      </label>
      <label className="preference-row" htmlFor="release-channel">
        <span>接收版本</span>
        <select
          id="release-channel"
          value={preferences.includePrereleases ? "all" : "stable"}
          onChange={(e) =>
            onChange({ includePrereleases: e.target.value === "all" })
          }
        >
          <option value="all">正式版与开发预览</option>
          <option value="stable">仅正式版</option>
        </select>
      </label>
      <div className="preference-row install-directory">
        <span>
          更新目录
          <small>
            {directory
              ? `${directory.name} · 已核对当前扩展`
              : canInstall
                ? "首次设置后，可直接安装更新"
                : "请在 Edge 扩展中设置更新目录"}
          </small>
        </span>
        <button
          disabled={!canInstall || installBusy || busy}
          onClick={() => void installAction(chooseInstallationDirectory)}
        >
          <FolderOpen size={17} />
          {directory ? "更换目录" : "设置目录"}
        </button>
      </div>
      {available && release && (
        <div className="release-panel">
          <div className="release-heading">
            <h3>{release.name}</h3>
            <span className="version-badge">
              {release.prerelease ? "开发预览" : "正式版"}
            </span>
          </div>
          {release.notes && (
            <details className="release-notes">
              <summary>查看更新内容</summary>
              <pre>{release.notes}</pre>
            </details>
          )}
          <div className="button-row">
            {canInstall && directory && release.assetId && release.sha256 && (
              <button
                className="primary"
                disabled={installBusy || busy}
                onClick={() =>
                  void installAction(() => installRelease(release, directory))
                }
              >
                <RefreshCw size={17} />
                立即更新至 v{release.version}
              </button>
            )}
            {release.downloadUrl && (
              <a
                className="button-link"
                href={release.downloadUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Download size={17} />
                仅下载安装包
                {release.size ? (
                  <span>· {(release.size / 1024 / 1024).toFixed(1)} MB</span>
                ) : null}
              </a>
            )}
            <a
              className="button-link"
              href={release.url}
              rel="noreferrer"
              target="_blank"
            >
              打开发布页
              <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      )}
      <div className="update-choice">
        <Check size={17} />
        <span>由你点击“立即更新”，自动下载、备份、安装并重新加载。</span>
      </div>
      <details className="installation-help">
        <summary>如何安装更新</summary>
        <ol>
          <li>首次点击“设置目录”，选择 Edge 当前加载的扩展文件夹。</li>
          <li>
            有新版本时点击“立即更新”。请先保存并关闭其他工作台标签页、处理完发布任务。
          </li>
          <li>
            程序会校验更新包，备份工作空间及程序文件，然后安装并重新加载。目录权限失效时需重新授权；权限范围变化的版本仍须手动更新。
          </li>
          <li>
            0.3.0 及更早版本需先手动升级一次。手动更新时替换原目录文件并在 Edge
            扩展管理中重新加载，不要卸载扩展。
          </li>
        </ol>
      </details>
      <a
        className="release-history"
        href={RELEASES_URL}
        target="_blank"
        rel="noreferrer"
      >
        所有发布版本
        <ArrowUpRight size={15} />
      </a>
    </section>
  );
}
