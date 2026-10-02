import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ExternalLink,
  LoaderCircle,
  Plug,
  ScanLine,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { db } from "../core/db";
import { platforms, type Channel } from "../platforms/catalog";
import {
  connectAllChannels,
  connectChannel,
  disconnectChannel,
  isExtension,
} from "../platforms/browser-adapter";
import { messageOf, type ChannelId, type PlatformId } from "../core/model";
import {
  ActionMenu,
  Alert,
  ConfirmDialog,
  PlatformIcon,
  StatusBadge,
  command,
  relativeTime,
  useNotify,
} from "./shared";
import { connectionOf, usePlatformAccess, useWorkspace } from "./workspace";

const formats = { html: "富文本", markdown: "Markdown", images: "图片笔记" };
const converts = (channel: Channel) =>
  [
    !channel.math && "公式",
    !channel.tables && "表格",
    !channel.mermaid && "Mermaid 图表",
  ].filter(Boolean);

export function AccountsPage() {
  const probes = useLiveQuery(() => db.probes.toArray(), [], []);
  const data = useWorkspace();
  const { access, refresh } = usePlatformAccess();
  const notify = useNotify();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [disconnect, setDisconnect] = useState<PlatformId | null>(null);
  const extension = isExtension();
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy("");
      refresh();
    }
  };
  const probe = (channel: ChannelId) => command({ type: "probe", channel });
  const checkable = platforms.flatMap((platform) =>
    platform.channels.filter((c) => !c.manual && access[c.id]),
  );
  const connected = platforms.filter((p) => access[p.channels[0]!.id]).length;
  return (
    <div className="page accounts-page">
      <div className="page-heading">
        <div>
          <h1>平台账号</h1>
          <p>
            {extension
              ? `已连接 ${connected} / ${platforms.length} 个平台。连接后使用浏览器里已有的登录状态。`
              : "平台连接需要在 Edge 扩展中使用，这里展示的是本地界面预览。"}
          </p>
        </div>
        <div className="button-row">
          <button
            disabled={!extension || !!busy || !checkable.length}
            title="依次打开各平台写作页，检查登录状态和编辑器"
            onClick={() =>
              void act("check-all", async () => {
                for (const channel of checkable) await probe(channel.id);
                notify(`已检查 ${checkable.length} 个内容路径。`);
              })
            }
          >
            {busy === "check-all" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ScanLine size={16} />
            )}
            检查全部
          </button>
          <button
            className="primary"
            disabled={!extension || !!busy || connected === platforms.length}
            onClick={() => {
              // The permission prompt must start inside the click itself.
              const granted = connectAllChannels();
              void act("connect-all", async () => {
                if (!(await granted)) throw new Error("尚未授予平台权限");
                notify("已连接全部平台。");
              });
            }}
          >
            <Plug size={16} />
            一键连接全部
          </button>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="account-grid">
        {platforms.map((platform) => {
          const connection = connectionOf(platform.id, access, probes);
          const granted = !!access[platform.channels[0]!.id];
          const posts = (data?.posts ?? []).filter((p) =>
            p.channel.startsWith(`${platform.id}:`),
          );
          const open = (data?.tasks ?? []).filter((t) =>
            t.channel.startsWith(`${platform.id}:`),
          ).length;
          return (
            <article className="account-card" key={platform.id}>
              <header>
                <PlatformIcon platform={platform.id} size={40} />
                <div>
                  <h2>{platform.name}</h2>
                  <p>
                    {connection.account ??
                      (platform.manual
                        ? "人工发布辅助"
                        : granted
                          ? "检查后显示账号"
                          : "尚未连接")}
                  </p>
                </div>
                <StatusBadge
                  status={
                    connection.state === "ok"
                      ? "ok"
                      : connection.state === "problem"
                        ? "problem"
                        : connection.state === "unchecked"
                          ? "review"
                          : "muted"
                  }
                >
                  {connection.label}
                </StatusBadge>
              </header>
              <dl className="account-stats">
                <div>
                  <dt>已发布</dt>
                  <dd>
                    {posts.filter((p) => p.status === "published").length}
                  </dd>
                </div>
                <div>
                  <dt>草稿</dt>
                  <dd>
                    {posts.filter((p) => p.status === "draft_saved").length}
                  </dd>
                </div>
                <div>
                  <dt>进行中任务</dt>
                  <dd>{open}</dd>
                </div>
              </dl>
              <ul className="account-channels">
                {platform.channels.map((channel) => {
                  const result = probes.find((p) => p.channel === channel.id);
                  const converted = converts(channel);
                  return (
                    <li key={channel.id}>
                      <div>
                        <strong>
                          {channel.name.split(" · ")[1]}
                          <span className="field-badge">
                            {formats[channel.format]}
                          </span>
                        </strong>
                        <p
                          className={
                            result?.problems.length ? "warning-text" : ""
                          }
                        >
                          {channel.manual
                            ? "复制正文后到原站粘贴发布"
                            : result?.problems.length
                              ? result.problems.join("；")
                              : result?.editorFound
                                ? `编辑器正常 · ${relativeTime(result.checkedAt)}检查`
                                : "尚未检查登录与编辑器"}
                        </p>
                        {!channel.manual && !!converted.length && (
                          <p className="muted">
                            {converted.join("、")}自动转为图片
                          </p>
                        )}
                      </div>
                      {!channel.manual && (
                        <button
                          disabled={!extension || !granted || !!busy}
                          title="打开写作页，检查登录状态和编辑器"
                          onClick={() =>
                            void act(channel.id, () => probe(channel.id))
                          }
                        >
                          {busy === channel.id ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <ScanLine size={15} />
                          )}
                          检查
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <footer>
                {granted ? (
                  <a
                    className="button-link"
                    href={platform.homeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    创作中心
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <button
                    className="primary"
                    disabled={!extension || !!busy}
                    onClick={() => {
                      const permission = connectChannel(
                        platform.channels[0]!.id,
                      );
                      void act(platform.id, async () => {
                        if (!(await permission))
                          throw new Error("尚未授予平台权限");
                        notify(`${platform.name} 已连接。`);
                      });
                    }}
                  >
                    <Plug size={15} />
                    连接
                  </button>
                )}
                <a
                  className="button-link"
                  href={platform.channels[0]!.editorUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  写作页
                  <ExternalLink size={14} />
                </a>
                {granted && (
                  <ActionMenu label={`更多 ${platform.name}`}>
                    <button
                      className="danger-text"
                      onClick={() => setDisconnect(platform.id)}
                    >
                      <Unplug size={15} />
                      断开连接
                    </button>
                  </ActionMenu>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      <p className="privacy-note">
        <ShieldCheck size={16} />
        zMatrix
        只在你连接的平台页面上操作，使用浏览器已有的登录状态，不保存平台密码，也不导出
        Cookie。断开连接后可随时重新授权。
      </p>
      {disconnect && (
        <ConfirmDialog
          title={`断开 ${platforms.find((p) => p.id === disconnect)!.name}？`}
          confirmLabel="断开连接"
          onClose={() => setDisconnect(null)}
          onConfirm={async () => {
            const platform = platforms.find((p) => p.id === disconnect)!;
            if (
              (data?.tasks ?? []).some((t) =>
                t.channel.startsWith(`${platform.id}:`),
              )
            )
              throw new Error(
                "该平台还有未结束的发布任务，请先到发布队列处理。",
              );
            await disconnectChannel(platform.channels[0]!.id);
            await db.probes.bulkDelete(platform.channels.map((c) => c.id));
            refresh();
          }}
        >
          <p>
            将撤销对该平台页面的访问权限，并清除本地的检查结果。稿件、发布记录和原站内容都不受影响。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
