import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, RefreshCw, ExternalLink, CheckCheck } from "lucide-react";
import { db, changed } from "../core/db";
import { channels, platformNames } from "../platforms/catalog";
import { registerPost, updateRegistration } from "../core/collection";
import { removePosts } from "../core/cleanup";
import { platformIds, messageOf, type ChannelId } from "../core/model";
import {
  Alert,
  Empty,
  Modal,
  PlatformPill,
  command,
  timeLabel,
  ActionMenu,
  ConfirmDialog,
} from "./shared";
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
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>数据与互动</h1>
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
      <div className="tabs data-tabs" aria-label="数据与互动视图">
        <button
          className={!commentsMode ? "active" : ""}
          aria-pressed={!commentsMode}
          onClick={() => setCommentsMode(false)}
        >
          文章数据
        </button>
        <button
          className={commentsMode ? "active" : ""}
          aria-pressed={commentsMode}
          onClick={() => setCommentsMode(true)}
        >
          评论 <span>{comments.filter((c) => !c.readAt).length} 未读</span>
        </button>
      </div>
      {!commentsMode && !!visiblePosts.length && (
        <div className="selection-bar">
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
            选择当前结果
          </label>
          {visiblePosts.some((p) => selectedPosts.includes(p.id)) && (
            <button
              className="danger-text"
              onClick={() =>
                setDeletion(
                  visiblePosts
                    .filter((p) => selectedPosts.includes(p.id))
                    .map((p) => p.id),
                )
              }
            >
              删除所选登记
            </button>
          )}
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="filter-bar">
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
              {p.title}
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
              disabled={!visibleComments.length}
            >
              <CheckCheck size={16} />
              当前结果标为已读
            </button>
          </>
        )}
      </div>
      {!posts.length ? (
        <Empty title="让已发布的内容回到同一处">
          工具发布的文章会自动登记。也可以添加历史文章链接，开始跟踪数据与评论。
        </Empty>
      ) : commentsMode ? (
        <>
          <div className="sync-summaries">
            {visiblePosts.map((post) => {
              const info = sync.find((s) => s.postId === post.id);
              return (
                <div key={post.id}>
                  <PlatformPill id={post.channel} />
                  <span>{post.title}</span>
                  <small>
                    {info?.scope ?? "尚未读取"} · {timeLabel(info?.collectedAt)}
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
          </div>
          {!visibleComments.length ? (
            <Empty title={unread ? "没有工具内未读评论" : "还没有已读取的评论"}>
              评论读取范围和失败原因显示在对应文章下方。没有读取到评论不代表原站没有评论。
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
                      <PlatformPill id={post.channel} />
                      <span className="muted">{comment.publishedAt}</span>
                      {!comment.readAt && (
                        <span className="unread-dot" title="工具内未读" />
                      )}
                    </header>
                    <p className="comment-body">{comment.body}</p>
                    <footer>
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
          {visiblePosts.map((post) => {
            const data = metrics.find((m) => m.postId === post.id);
            return (
              <article key={post.id} className="metrics-card">
                <header>
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
                  <PlatformPill id={post.channel} />
                  <a href={post.url} target="_blank" rel="noreferrer">
                    {post.title}
                    <ExternalLink size={14} />
                  </a>
                  <button
                    aria-label={`刷新 ${post.title}`}
                    onClick={() => void refresh(post.id)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <ActionMenu label={`管理登记 ${post.title}`}>
                    <button
                      onClick={() => {
                        setEditingId(post.id);
                        setTitle(post.title);
                        setUrl(post.url);
                        setChannel(post.channel);
                        setArticleId(post.articleId ?? "");
                        setShowRegister(true);
                      }}
                    >
                      修改标题与关联
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => setDeletion([post.id])}
                    >
                      删除本地登记
                    </button>
                  </ActionMenu>
                </header>
                <div className="metrics-values">
                  {data?.values.length ? (
                    data.values.map((value) => (
                      <div key={value.key}>
                        <span>{value.label}</span>
                        <strong title={`原站显示：${value.raw}`}>
                          {value.raw}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">尚无可用指标</p>
                  )}
                </div>
                <footer>
                  <span>采集时间：{timeLabel(data?.collectedAt)}</span>
                  <a
                    href={data?.sourceUrl ?? post.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看来源
                  </a>
                </footer>
                {data?.error && <Alert>{data.error}</Alert>}
              </article>
            );
          })}
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
              文章标题
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="便于你识别的文章名称"
              />
            </label>
            <label>
              原站文章链接
              <input
                type="url"
                disabled={!!editingId}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label>
              关联母稿
              <select
                value={articleId}
                onChange={(e) => setArticleId(e.target.value)}
              >
                <option value="">不关联母稿</option>
                {articles
                  .filter((a) => !a.trashedAt)
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.title || "未命名稿件"}
                    </option>
                  ))}
              </select>
            </label>
            {error && <Alert>{error}</Alert>}
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
