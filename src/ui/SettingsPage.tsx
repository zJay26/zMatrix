import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FolderOpen,
  Download,
  Upload,
  ExternalLink,
  Plug,
  ScanLine,
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
export function SettingsPage() {
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
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">连接与保管</p>
          <h1>平台与备份</h1>
          <p>登录保留在浏览器，稿件和素材保留在本机。</p>
        </div>
        <span className="version-badge">v{version} · 开发预览</span>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      {!isExtension() && (
        <Alert>
          当前为网页界面预览。平台操作需要加载 Edge
          扩展；此处的本地数据与扩展数据相互独立。
        </Alert>
      )}
      <section className="settings-section">
        <div className="section-intro">
          <h2>平台连接</h2>
          <p>连接时只申请该平台的访问权限。“检查页面”只读，不填稿、不发布。</p>
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
                          ? "已识别编辑器 · 发布结果尚待实测"
                          : "尚未检查编辑器"}
                  </p>
                  <small>
                    {probe
                      ? `检查于 ${timeLabel(probe.checkedAt)}${probe.account ? " · " + probe.account : ""}`
                      : "草稿、发布、数据、评论分别验收"}
                  </small>
                </div>
                <div className="button-row">
                  <a href={channel.editorUrl} target="_blank" rel="noreferrer">
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
      <section className="settings-section">
        <div className="section-intro">
          <h2>文件夹备份</h2>
          <p>
            本地自动保存独立运行。目录备份保留当前与上一份自动备份，手动导出生成独立文件。
          </p>
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
      <section className="settings-section">
        <div className="section-intro">
          <h2>验收状态</h2>
          <p>
            当前验收为 6 条草稿保存与 6
            条发布前准备流程。最终发布由你在原站手动完成；五站数据与评论另行验证。
          </p>
        </div>
        <p className="muted">
          首次打开工作台刷新已登记文章；关闭后不定期采集。来源指标缺失时保留为空，不补零。
        </p>
      </section>
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
