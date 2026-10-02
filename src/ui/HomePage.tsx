import { useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  CircleCheck,
  FileUp,
  HardDrive,
  ListChecks,
  MessageSquareText,
  PenLine,
  Plug,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { db } from "../core/db";
import { distributionOf, taskStatus } from "../core/distribution";
import { stateNames } from "../core/tasks";
import type { Article, ChannelId } from "../core/model";
import { channelFor, platforms } from "../platforms/catalog";
import {
  ChannelChip,
  PlatformIcon,
  StatusBadge,
  relativeTime,
  untitled,
} from "./shared";
import { connectionOf, usePlatformAccess, useWorkspace } from "./workspace";
import type { Screen } from "./App";
import type { SettingsTab } from "./SettingsPage";

interface Todo {
  key: string;
  icon: LucideIcon;
  tone: "action" | "problem" | "info";
  title: string;
  detail: string;
  action: string;
  run: () => void;
}
export function HomePage({
  onOpen,
  onCreate,
  onImport,
  onDistribute,
  onNavigate,
}: {
  onOpen: (article: Article, channel?: ChannelId) => void;
  onCreate: (sample?: boolean) => void;
  onImport: (files: File[]) => void;
  onDistribute: (articleId: string) => void;
  onNavigate: (screen: Screen, tab?: SettingsTab) => void;
}) {
  const data = useWorkspace();
  const probes = useLiveQuery(() => db.probes.toArray(), [], []);
  const unread = useLiveQuery(
    () => db.comments.filter((c) => !c.readAt).count(),
    [],
    0,
  );
  const directory = useLiveQuery(() => db.meta.get("backupDirectory"));
  const { access } = usePlatformAccess();
  const file = useRef<HTMLInputElement>(null);
  const view = useMemo(() => {
    const articles = (data?.articles ?? [])
      .filter((a) => !a.trashedAt && !a.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const rows = articles.map((article) => ({
      article,
      channels: distributionOf(
        article,
        data?.variants ?? [],
        data?.posts ?? [],
        data?.tasks ?? [],
      ).filter((state) => state.status !== "none"),
    }));
    return { articles, rows };
  }, [data]);
  const tasks = data?.tasks ?? [];
  const posts = data?.posts ?? [];
  const titleOf = (articleId: string, fallback: string) =>
    untitled(data?.articles.find((a) => a.id === articleId)?.title || fallback);
  const todos: Todo[] = [];
  for (const task of [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const status = taskStatus(task);
    if (status !== "action" && status !== "problem") continue;
    todos.push({
      key: task.id,
      icon: status === "action" ? Send : TriangleAlert,
      tone: status,
      title: `「${titleOf(task.snapshot.articleId, task.snapshot.title)}」· ${channelFor(task.channel).short}`,
      detail:
        task.state === "awaiting_publish"
          ? "内容已填好，等你在原站点击发布"
          : `${stateNames[task.state]}${task.error ? `：${task.error}` : ""}`,
      action: "去处理",
      run: () => onNavigate("queue"),
    });
  }
  const waiting = tasks.filter((t) => t.state === "queued").length;
  if (waiting)
    todos.push({
      key: "queued",
      icon: ListChecks,
      tone: "info",
      title: `${waiting} 个分发任务在排队`,
      detail: "加入队列后尚未执行",
      action: "去执行",
      run: () => onNavigate("queue"),
    });
  for (const { article, channels } of view.rows)
    for (const state of channels)
      if (state.status === "outdated")
        todos.push({
          key: `${article.id}/${state.channel}`,
          icon: RefreshCw,
          tone: "info",
          title: `「${untitled(article.title)}」· ${channelFor(state.channel).short}`,
          detail: "发布后稿件又有修改，原站还是旧版本",
          action: "查看稿件",
          run: () => onOpen(article, state.channel),
        });
  for (const platform of platforms) {
    const connection = connectionOf(platform.id, access, probes);
    if (connection.state === "problem")
      todos.push({
        key: `platform-${platform.id}`,
        icon: Plug,
        tone: "problem",
        title: `${platform.name} 账号需要检查`,
        detail: connection.problems.join("；"),
        action: "查看账号",
        run: () => onNavigate("accounts"),
      });
  }
  if (unread)
    todos.push({
      key: "comments",
      icon: MessageSquareText,
      tone: "info",
      title: `${unread} 条未读评论`,
      detail: "来自已登记的文章",
      action: "去查看",
      run: () => onNavigate("data"),
    });
  if (!directory && view.articles.length)
    todos.push({
      key: "backup",
      icon: HardDrive,
      tone: "info",
      title: "还没有设置文件夹备份",
      detail: "稿件只保存在浏览器本地，建议选择一个备份目录",
      action: "去设置",
      run: () => onNavigate("settings", "backup"),
    });
  const published = posts.filter((p) => p.status === "published").length;
  const attention = todos.filter((t) => t.tone !== "info").length;
  const connected = platforms.filter((p) =>
    ["ok", "unchecked"].includes(connectionOf(p.id, access, probes).state),
  ).length;
  const stats = [
    {
      label: "稿件",
      value: view.articles.length,
      hint: `${view.rows.filter((r) => !r.channels.some((c) => c.post)).length} 篇尚未分发`,
      to: "library",
    },
    {
      label: "已发布",
      value: published,
      hint: `覆盖 ${new Set(posts.filter((p) => p.status === "published").map((p) => p.channel.split(":")[0])).size} 个平台`,
      to: "data",
    },
    {
      label: "待你处理",
      value: attention,
      hint: waiting ? `另有 ${waiting} 个任务排队` : "发布确认与异常",
      to: "queue",
    },
    {
      label: "未读评论",
      value: unread,
      hint: "来自已登记文章",
      to: "data",
    },
  ] as const;
  const first = !!data && !data.articles.length;
  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <h1>总览</h1>
          <p>
            {new Date().toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
            {first ? "" : ` · 已连接 ${connected} / ${platforms.length} 个平台`}
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => file.current?.click()}>
            <FileUp size={16} />
            导入 Markdown
          </button>
          <button className="primary" onClick={() => onCreate()}>
            <Plus size={17} />
            新建稿件
          </button>
        </div>
      </div>
      {first ? (
        <section className="onboarding">
          <h2>一份母稿，分发到每个平台</h2>
          <p>
            写好一篇内容，标签、摘要和封面只填一次，再一键送进各平台的草稿箱或发布页。最终发布始终由你在原站确认。
          </p>
          <ol>
            <li>
              <span>1</span>
              <div>
                <h3>连接平台账号</h3>
                <p>授权后使用浏览器里已有的登录状态，不保存密码。</p>
                <button onClick={() => onNavigate("accounts")}>
                  <Plug size={15} />
                  去连接
                </button>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>写稿或导入</h3>
                <p>支持 Markdown 文件及配套图片目录。</p>
                <div className="button-row">
                  <button className="primary" onClick={() => onCreate()}>
                    <PenLine size={15} />
                    开始写作
                  </button>
                  <button onClick={() => onCreate(true)}>用示例体验</button>
                </div>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>分发并跟踪</h3>
                <p>勾选平台后一次分发，在这里查看每篇稿件的平台状态。</p>
              </div>
            </li>
          </ol>
        </section>
      ) : (
        <>
          <div className="stat-grid">
            {stats.map((stat) => (
              <button
                key={stat.label}
                className={`stat-tile ${stat.label === "待你处理" && stat.value ? "warn" : ""}`}
                onClick={() => onNavigate(stat.to)}
              >
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                <small>{stat.hint}</small>
              </button>
            ))}
          </div>
          <div className="home-columns">
            <section className="panel">
              <header>
                <h2>待办</h2>
                {!!todos.length && (
                  <span className="muted">{todos.length} 项</span>
                )}
              </header>
              {todos.length ? (
                <ul className="todo-list">
                  {todos.slice(0, 7).map((todo) => (
                    <li key={todo.key} className={`todo-${todo.tone}`}>
                      <span className="todo-icon">
                        <todo.icon size={16} />
                      </span>
                      <div>
                        <strong>{todo.title}</strong>
                        <p>{todo.detail}</p>
                      </div>
                      <button className="text-button" onClick={todo.run}>
                        {todo.action}
                        <ArrowRight size={14} />
                      </button>
                    </li>
                  ))}
                  {todos.length > 7 && (
                    <li className="todo-more">
                      还有 {todos.length - 7} 项，处理后会依次显示
                    </li>
                  )}
                </ul>
              ) : (
                <div className="panel-empty">
                  <CircleCheck size={22} />
                  <p>没有需要处理的事项</p>
                </div>
              )}
            </section>
            <section className="panel">
              <header>
                <h2>平台账号</h2>
                <button
                  className="text-button"
                  onClick={() => onNavigate("accounts")}
                >
                  管理
                  <ArrowRight size={14} />
                </button>
              </header>
              <ul className="account-list">
                {platforms.map((platform) => {
                  const connection = connectionOf(platform.id, access, probes);
                  const count = posts.filter(
                    (p) =>
                      p.channel.startsWith(`${platform.id}:`) &&
                      p.status === "published",
                  ).length;
                  return (
                    <li key={platform.id}>
                      <PlatformIcon platform={platform.id} size={28} />
                      <div>
                        <strong>{platform.name}</strong>
                        <p>
                          {[
                            connection.account ??
                              (platform.manual ? "人工发布辅助" : ""),
                            count ? `已发布 ${count} 篇` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "暂无发布记录"}
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
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          <section className="panel">
            <header>
              <h2>最近稿件</h2>
              <button
                className="text-button"
                onClick={() => onNavigate("library")}
              >
                全部稿件
                <ArrowRight size={14} />
              </button>
            </header>
            <ul className="recent-list">
              {view.rows.slice(0, 6).map(({ article, channels }) => (
                <li key={article.id}>
                  <button
                    className="article-link"
                    onClick={() => onOpen(article)}
                  >
                    <strong>{untitled(article.title)}</strong>
                    <span>编辑于 {relativeTime(article.updatedAt)}</span>
                  </button>
                  <div className="chip-row">
                    {channels.map((state) => (
                      <ChannelChip
                        key={state.channel}
                        id={state.channel}
                        status={state.status}
                        label={state.label}
                      />
                    ))}
                    {!channels.length && (
                      <span className="muted">尚未分发</span>
                    )}
                  </div>
                  <button onClick={() => onDistribute(article.id)}>
                    <Send size={15} />
                    分发
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <input
        hidden
        type="file"
        multiple
        accept=".md,.mdown,.markdown,image/*"
        ref={file}
        onChange={(e) => {
          onImport(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
