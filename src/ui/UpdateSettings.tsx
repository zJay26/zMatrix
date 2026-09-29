import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  Check,
  Download,
  RefreshCw,
  PackageOpen,
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
            {release.downloadUrl && (
              <a
                className="button-link primary"
                href={release.downloadUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Download size={17} />
                下载 v{release.version}
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
        <span>发现新版本时提醒，由你决定是否下载。</span>
      </div>
      <details className="installation-help">
        <summary>如何安装更新</summary>
        <ol>
          <li>在“数据备份”中导出一份备份。</li>
          <li>下载扩展包并解压，替换原来的扩展目录，保留相同的扩展身份。</li>
          <li>
            打开 Edge 扩展管理页，点击 zMatrix
            的“重新加载”，再打开工作台。不要卸载扩展，以免清除数据。
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
