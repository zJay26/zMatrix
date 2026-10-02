import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  RefreshCw,
  ExternalLink,
  CheckCheck,
  ChartNoAxesCombined,
  MessageSquareText,
} from "lucide-react";
import { db, changed } from "../core/db";
import {
  channels,
  channelFor,
  parseRemoteUrl,
  platformNames,
} from "../platforms/catalog";
import { registerPost, updateRegistration } from "../core/collection";
import { removePosts } from "../core/cleanup";
import {
  platformIds,
  messageOf,
  type ChannelId,
  type RemotePost,
} from "../core/model";
import {
  Alert,
  Empty,
  Modal,
  PlatformIcon,
  PlatformPill,
  StatusBadge,
  command,
  relativeTime,
  ActionMenu,
  ConfirmDialog,
  untitled,
} from "./shared";

// Platforms name the same idea differently; totals group them by meaning.
const totals = [
  { label: "阅读", keys: ["views"] },
  { label: "点赞", keys: ["likes", "like_count", "vote"] },
  { label: "评论", keys: ["comments"] },
  { label: "收藏", keys: ["collects"] },
];
const compact = (value: number) =>
  value >= 10000
    ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)} 万`
    : value.toLocaleString();
export function DataPage() {
  const [commentsMode, setCommentsMode] = useState(false);
  const posts = useLiveQuery(
    () => db.posts.orderBy("updatedAt").reverse().toArray(),
    [],
    [],
  );
  const metrics = useLiveQuery(() => db.metrics.toArray(), [], []);
  const comments = useLiveQuery(
    () => db.comments.orderBy("collectedAt").reverse().toArray(),
    [],
    [],
  );
  const sync = useLiveQuery(() => db.commentSync.toArray(), [], []);
  const articles = useLiveQuery(() => db.articles.toArray(), [], []);
  const refreshing = useLiveQuery(() => db.meta.get("refreshRunning"));
  const [platform, setPlatform] = useState("all");
  const [articleFilter, setArticleFilter] = useState("all");
  const [unread, setUnread] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<string[] | null>(null);
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<ChannelId>("zhihu:article");
  const [articleId, setArticleId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visiblePosts = posts.filter(
    (p) =>
      (platform === "all" || p.channel.startsWith(platform + ":")) &&
      (articleFilter === "all" || p.id === articleFilter),
  );
  const ids = new Set(visiblePosts.map((p) => p.id));
  const visibleComments = comments.filter(
    (c) => ids.has(c.postId) && (!unread || !c.readAt),
  );
  const unreadCount = comments.filter((c) => !c.readAt).length;
  // The same article on several platforms is read as one row group.
  const groups: { key: string; title: string; posts: RemotePost[] }[] = [];
  for (const post of visiblePosts) {
    const article = post.articleId
      ? articles.find((a) => a.id === post.articleId)
      : undefined;
    const key = article?.id ?? post.id;
    const group = groups.find((item) => item.key === key);
    if (group) group.posts.push(post);
    else
      groups.push({
        key,
        title: article ? untitled(article.title) : post.title,
        posts: [post],
      });
  }
  // Sum a metric over the posts that report it; platforms without it are left out.
  const sum = (list: RemotePost[], keys: string[]) => {
    let value = 0;
    let reported = 0;
    for (const post of list) {
      const own = (
        metrics.find((m) => m.postId === post.id)?.values ?? []
      ).filter((metric) => keys.includes(metric.key));
      if (own.length) reported++;
      for (const metric of own) value += metric.value;
    }
    return reported ? { value, reported } : undefined;
  };
  const refresh = async (postId?: string, cursor?: string) => {
    try {
      setError("");
      await command({ type: "refresh", postId, cursor });
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const register = async () => {
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("请填写文章标题");
      if (editingId)
        await updateRegistration(editingId, title, articleId || undefined);
      else
        await registerPost(url, title.trim(), channel, articleId || undefined);
      setShowRegister(false);
      setUrl("");
      setTitle("");
      void refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const markAll = async () => {
    await db.transaction("rw", db.comments, db.meta, async () => {
      for (const comment of visibleComments)
        await db.comments.update(comment.id, { readAt: Date.now() });
      await changed();
    });
  };
  const edit = (post: RemotePost) => {
    setEditingId(post.id);
    setTitle(post.title);
    setUrl(post.url);
    setChannel(post.channel);
    setArticleId(post.articleId ?? "");
    setShowRegister(true);
  };
  const chosen = visiblePosts
    .filter((p) => selectedPosts.includes(p.id))
    .map((p) => p.id);
  return (
    <div className="page data-page">
      <div className="page-heading">
        <div>
          <h1>数据与互动</h1>
          <p>已发布文章在各平台的公开数据和评论，按稿件汇总。</p>
        </div>
        <div className="button-row">
          <button disabled={!!refreshing?.value} onClick={() => void refresh()}>
            <RefreshCw size={16} className={refreshing?.value ? "spin" : ""} />
            {refreshing?.value ? "正在刷新" : "刷新数据与评论"}
          </button>
          <button
            className="primary"
            onClick={() => {
              setEditingId(null);
              setUrl("");
              setTitle("");
              setArticleId("");
              setShowRegister(true);
            }}
          >
            <Plus size={17} />
            登记文章
          </button>
        </div>
      </div>
      {error && !showRegister && <Alert tone="danger">{error}</Alert>}
      {!!posts.length && (
        <div className="stat-grid">
          {totals.map((total) => {
            const result = sum(visiblePosts, total.keys);
            return (
              <div className="stat-tile" key={total.label}>
                <span>{total.label}</span>
                <strong>{result ? compact(result.value) : "—"}</strong>
                <small>
                  {result ? `${result.reported} 篇提供此数据` : "暂无数据"}
                </small>
              </div>
            );
          })}
        </div>
      )}
      <div className="library-toolbar">
        <div className="tabs data-tabs" aria-label="数据与互动视图">
          <button
            className={!commentsMode ? "active" : ""}
            aria-pressed={!commentsMode}
            onClick={() => setCommentsMode(false)}
          >
            文章数据 <span>{posts.length}</span>
          </button>
          <button
            className={commentsMode ? "active" : ""}
            aria-pressed={commentsMode}
            onClick={() => setCommentsMode(true)}
          >
            评论 <span>{unreadCount} 未读</span>
          </button>
        </div>
        <div className="library-filters">
          <select
            aria-label="筛选平台"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">全部平台</option>
            {platformIds.map((id) => (
              <option value={id} key={id}>
                {platformNames[id]}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选文章"
            value={articleFilter}
            onChange={(e) => setArticleFilter(e.target.value)}
          >
            <option value="all">全部已登记文章</option>
            {posts.map((p) => (
              <option value={p.id} key={p.id}>
                {channelFor(p.channel).short} · {p.title}
              </option>
            ))}
          </select>
          {commentsMode && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={unread}
                  onChange={(e) => setUnread(e.target.checked)}
                />
                仅未读
              </label>
              <button
                onClick={() => void markAll()}
                disabled={!visibleComments.some((c) => !c.readAt)}
              >
                <CheckCheck size={16} />
                全部标为已读
              </button>
            </>
          )}
        </div>
      </div>
      {!commentsMode && !!visiblePosts.length && (
        <div className={`selection-bar ${chosen.length ? "active" : ""}`}>
          <label>
            <input
              type="checkbox"
              aria-label="选择当前文章登记"
              checked={visiblePosts.every((p) => selectedPosts.includes(p.id))}
              onChange={(e) =>
                setSelectedPosts(
                  e.target.checked ? visiblePosts.map((p) => p.id) : [],
                )
              }
            />
            {chosen.length ? `已选 ${chosen.length} 条` : "选择当前结果"}
          </label>
          {!!chosen.length && (
            <button className="danger-text" onClick={() => setDeletion(chosen)}>
              删除所选登记
            </button>
          )}
        </div>
      )}
      {!posts.length ? (
        <Empty icon={ChartNoAxesCombined} title="让已发布的内容回到同一处">
          工具发布的文章会自动登记。也可以添加历史文章链接，开始跟踪数据与评论。
        </Empty>
      ) : commentsMode ? (
        <>
          <details className="sync-summaries disclosure">
            <summary>
              评论读取范围{" "}
              <span className="muted">{visiblePosts.length} 篇</span>
            </summary>
            {visiblePosts.map((post) => {
              const info = sync.find((s) => s.postId === post.id);
              return (
                <div key={post.id}>
                  <PlatformPill id={post.channel} />
                  <span>{post.title}</span>
                  <small>
                    {info?.scope ?? "尚未读取"} ·{" "}
                    {relativeTime(info?.collectedAt)}
                  </small>
                  {info?.error && <p className="warning-text">{info.error}</p>}
                  {info?.cursor && (
                    <button onClick={() => void refresh(post.id, info.cursor)}>
                      加载较早评论
                    </button>
                  )}
                </div>
              );
            })}
          </details>
          {!visibleComments.length ? (
            <Empty
              icon={MessageSquareText}
              title={unread ? "没有工具内未读评论" : "还没有已读取的评论"}
            >
              评论读取范围和失败原因显示在上方“评论读取范围”中。没有读取到评论不代表原站没有评论。
            </Empty>
          ) : (
            <div className="comments-list">
              {visibleComments.map((comment) => {
                const post = posts.find((p) => p.id === comment.postId)!;
                return (
                  <article
                    className={`comment-card ${comment.readAt ? "read" : ""}`}
                    key={comment.id}
                  >
                    <header>
                      <span className="comment-avatar">
                        {comment.author.slice(0, 1)}
                      </span>
                      <strong>{comment.author}</strong>
                      {!comment.readAt && (
                        <span className="unread-dot" title="工具内未读" />
                      )}
                      <span className="muted">{comment.publishedAt}</span>
                    </header>
                    <p className="comment-body">{comment.body}</p>
                    <footer>
                      <PlatformPill id={post.channel} />
                      <span>{post.title}</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          void db
                            .transaction(
                              "rw",
                              db.comments,
                              db.meta,
                              async () => {
                                await db.comments.update(comment.id, {
                                  readAt: comment.readAt
                                    ? undefined
                                    : Date.now(),
                                });
                                await changed();
                              },
                            )
                            .catch((e) => setError(messageOf(e)))
                        }
                      >
                        {comment.readAt ? "标为未读" : "标为已读"}
                      </button>
                      <a href={comment.url} target="_blank" rel="noreferrer">
                        原站回复
                        <ExternalLink size={14} />
                      </a>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="metrics-list">
          {groups.map((group) => (
            <article key={group.key} className="metrics-card">
              <header>
                <h3>{group.title}</h3>
                <span className="muted">
                  {group.posts.length} 个平台
                  {totals
                    .map((total) => {
                      const result = sum(group.posts, total.keys);
                      return result
                        ? ` · ${total.label} ${compact(result.value)}`
                        : "";
                    })
                    .join("")}
                </span>
              </header>
              {group.posts.map((post) => {
                const data = metrics.find((m) => m.postId === post.id);
                return (
                  <div className="metrics-row" key={post.id}>
                    <input
                      type="checkbox"
                      aria-label={`选择登记 ${post.title}`}
                      checked={selectedPosts.includes(post.id)}
                      onChange={(e) =>
                        setSelectedPosts(
                          e.target.checked
                            ? [...selectedPosts, post.id]
                            : selectedPosts.filter((id) => id !== post.id),
                        )
                      }
                    />
                    <PlatformIcon id={post.channel} size={26} />
                    <div className="metrics-row-title">
                      <a href={post.url} target="_blank" rel="noreferrer">
                        {post.title}
                        <ExternalLink size={13} />
                      </a>
                      <small>
                        {channelFor(post.channel).name}
                        {post.status !== "published" && (
                          <StatusBadge
                            status={
                              post.status === "draft_saved" ? "draft" : "review"
                            }
                          >
                            {post.status === "draft_saved" ? "草稿" : "审核中"}
                          </StatusBadge>
                        )}
                        {data?.collectedAt
                          ? ` · 采集于 ${relativeTime(data.collectedAt)}`
                          : ""}
                      </small>
                    </div>
                    <div className="metrics-values">
                      {data?.values.length ? (
                        data.values.map((value) => (
                          <div key={value.key}>
                            <strong title={`原站显示：${value.raw}`}>
                              {value.raw}
                            </strong>
                            <span>{value.label}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          {post.status === "draft_saved"
                            ? "草稿不读取数据"
                            : "尚无可用指标"}
                        </p>
                      )}
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`刷新 ${post.title}`}
                      title="刷新这篇文章的数据与评论"
                      disabled={!!refreshing?.value}
                      onClick={() => void refresh(post.id)}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <ActionMenu label={`管理登记 ${post.title}`}>
                      <button onClick={() => edit(post)}>修改标题与关联</button>
                      {data?.sourceUrl && (
                        <a
                          href={data.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看数据来源
                        </a>
                      )}
                      <button
                        className="danger-text"
                        onClick={() => setDeletion([post.id])}
                      >
                        删除本地登记
                      </button>
                    </ActionMenu>
                    {data?.error && <Alert>{data.error}</Alert>}
                  </div>
                );
              })}
            </article>
          ))}
        </div>
      )}
      {showRegister && (
        <Modal
          title={editingId ? "修改文章登记" : "登记已有文章"}
          onClose={() => setShowRegister(false)}
        >
          <div className="form-stack">
            <label>
              平台
              <select
                value={channel}
                disabled={!!editingId}
                onChange={(e) => setChannel(e.target.value as ChannelId)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              原站文章链接
              <input
                type="url"
                disabled={!!editingId}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  // Pasting a link is enough to pick its platform.
                  try {
                    setChannel(
                      parseRemoteUrl(
                        e.target.value,
                        channel.startsWith("xiaohongshu:") &&
                          e.target.value.includes("xiaohongshu.com")
                          ? channel
                          : undefined,
                      ).channel,
                    );
                  } catch {
                    // Keep the chosen platform; registering reports the problem.
                  }
                }}
                placeholder="粘贴文章详情页链接，自动识别平台"
              />
            </label>
            <label>
              文章标题
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="便于你识别的文章名称"
              />
            </label>
            <label>
              关联母稿
              <select
                value={articleId}
                onChange={(e) => {
                  setArticleId(e.target.value);
                  const article = articles.find((a) => a.id === e.target.value);
                  if (article && !title.trim()) setTitle(article.title);
                }}
              >
                <option value="">不关联母稿</option>
                {articles
                  .filter((a) => !a.trashedAt)
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {untitled(a.title)}
                    </option>
                  ))}
              </select>
            </label>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
          <footer className="modal-actions">
            <button onClick={() => setShowRegister(false)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void register()}
            >
              {editingId ? "保存修改" : "登记文章"}
            </button>
          </footer>
        </Modal>
      )}
      {deletion && (
        <ConfirmDialog
          title={`删除 ${deletion.length} 条本地登记？`}
          confirmLabel="删除登记"
          onClose={() => setDeletion(null)}
          onConfirm={async () => {
            await removePosts(deletion);
            setSelectedPosts([]);
            setArticleFilter("all");
          }}
        >
          <p>
            将停止跟踪，并清除这些文章在工具内的指标和评论缓存。原站文章、原站评论和本地稿件不会删除。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
