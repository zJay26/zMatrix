import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Send,
  Images,
  ImagePlus,
  Undo2,
  ExternalLink,
  Copy,
  GitCompareArrows,
  Download,
  Save,
  Plus,
  Trash2,
  PanelRight,
  Check,
  Layers,
  Wrench,
} from "lucide-react";
import { diffLines } from "diff";
import { db, changed } from "../core/db";
import { copyDraft } from "../core/library";
import { channels, channelFor } from "../platforms/catalog";
import {
  freezeSnapshot,
  isVariantBehind,
  newVariant,
  resolveContent,
  resolveMetadata,
  setOverride,
  snapshotDiffers,
} from "../core/variants";
import { addAsset, downloadBlob } from "../core/assets";
import { channelState } from "../core/distribution";
import type { Article, Asset, ChannelId, Content } from "../core/model";
import { messageOf } from "../core/model";
import { MarkdownEditor, MarkdownPreview } from "./Markdown";
import {
  Modal,
  Alert,
  PlatformIcon,
  PlatformPill,
  useBlobUrl,
  ActionMenu,
  ConfirmDialog,
  Segmented,
  StatusBadge,
  useNotify,
} from "./shared";
import { CardStudio } from "./CardStudio";
import { DistributeDialog } from "./DistributeDialog";
import {
  MetadataFields,
  SharedFields,
  type MetadataHandle,
} from "./MetadataFields";
import { emptyDefaults, useDraft, type DraftTarget } from "./useDraft";

type ViewMode = "split" | "source" | "preview";
function AssetThumbnail({
  asset,
  onInsert,
  onRemove,
  cover,
  onCover,
}: {
  asset: Asset;
  onInsert: () => void;
  onRemove: () => void;
  cover: boolean;
  onCover: () => void;
}) {
  const url = useBlobUrl(asset.blob);
  return (
    <div className={`asset-tile ${cover ? "is-cover" : ""}`}>
      <img src={url || undefined} alt={asset.name} />
      {cover && <b>封面</b>}
      <span title={asset.name}>{asset.name}</span>
      <div>
        <button onClick={onInsert}>插入</button>
        <button className={cover ? "selected" : ""} onClick={onCover}>
          {cover ? "取消封面" : "设封面"}
        </button>
        <button aria-label={`移除配图 ${asset.name}`} onClick={onRemove}>
          ×
        </button>
      </div>
    </div>
  );
}
export function EditorPage({
  initial,
  onBack,
  onQueue,
  onFlushReady,
  onOpenCopy,
  defaultViewMode = "split",
  isNew = false,
  initialChannel,
}: {
  initial: Article;
  onBack: () => void;
  onQueue: () => void;
  onFlushReady: (flush: () => Promise<boolean>) => void;
  onOpenCopy: (article: Article) => void;
  defaultViewMode?: ViewMode;
  isNew?: boolean;
  initialChannel?: ChannelId;
}) {
  const draft = useDraft(initial, isNew);
  const { article, variants, saveStatus, saveQueue } = draft;
  const notify = useNotify();
  const [selected, setSelected] = useState<DraftTarget>(
    initialChannel ?? "master",
  );
  const uploads = useRef(new Set<Promise<void>>());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [inspector, setInspector] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [studio, setStudio] = useState(false);
  const [publish, setPublish] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [addPlatform, setAddPlatform] = useState(false);
  const [removePlatform, setRemovePlatform] = useState<ChannelId | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const metadataEditor = useRef<MetadataHandle>(null);
  const variant =
    selected === "master"
      ? undefined
      : (variants[selected] ?? newVariant(article, selected));
  const content = resolveContent(article, variant);
  const defaults = article.defaults ?? emptyDefaults();
  const coverId = variant
    ? (variant.metadata.coverId ?? defaults.coverId)
    : defaults.coverId;
  const assets = useLiveQuery(
    () => db.assets.bulkGet(content.imageIds),
    [content.imageIds.join(",")],
    [],
  );
  const posts = useLiveQuery(
    () => db.posts.where("articleId").equals(initial.id).toArray(),
    [initial.id],
    [],
  );
  const tasks = useLiveQuery(
    () =>
      db.tasks
        .filter((task) => task.snapshot.articleId === initial.id)
        .toArray(),
    [initial.id],
    [],
  );
  const change = <K extends keyof Content>(key: K, value: Content[K]) =>
    draft.change(selected, key, value);
  const setCover = (id: string) => {
    if (variant)
      draft.changeVariant(variant.channel, (v) => ({
        ...v,
        metadata: {
          ...v.metadata,
          coverId: v.metadata.coverId === id ? undefined : id,
        },
      }));
    else
      draft.changeDefaults((previous) => ({
        ...previous,
        coverId: previous.coverId === id ? undefined : id,
      }));
  };
  const doImportImages = async (files: File[]) => {
    try {
      const imported = [];
      for (const file of files) imported.push(await addAsset(file));
      const current = draft.contentOf(selected);
      change("imageIds", [
        ...new Set([...current.imageIds, ...imported.map((a) => a.id)]),
      ]);
      change(
        "markdown",
        current.markdown +
          "\n\n" +
          imported
            .map((a) => `![${a.name.replaceAll("]", "")}](asset://${a.id})`)
            .join("\n\n"),
      );
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const importImages = (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const job = doImportImages(files).finally(() => {
      uploads.current.delete(job);
      setUploading(uploads.current.size > 0);
    });
    uploads.current.add(job);
  };
  const flush = async () => {
    metadataEditor.current?.flush();
    while (uploads.current.size) await Promise.all([...uploads.current]);
    return draft.flush();
  };
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        saveQueue.status.pending ||
        saveQueue.status.error ||
        metadataEditor.current?.hasPending() ||
        uploads.current.size
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveQueue]);
  useEffect(() => {
    onFlushReady(flush);
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      onFlushReady(async () => true);
      window.removeEventListener("keydown", keydown);
    };
  }, [onFlushReady, saveQueue]);
  const switchPage = async (action: () => void) => {
    if (await flush()) action();
  };
  const select = (target: DraftTarget) =>
    void switchPage(() => {
      setSelection("");
      setSelected(target);
    });
  const exportContent = async () => {
    setExporting(true);
    setError("");
    try {
      const { exportCurrentContent, safeFilename } =
        await import("../core/export");
      downloadBlob(
        await exportCurrentContent(
          content,
          variant
            ? resolveMetadata(article, variant)
            : article.defaults
              ? { category: "", ...article.defaults }
              : undefined,
        ),
        `${safeFilename(content.title)}.zip`,
      );
      notify("当前版本已导出，包含 Markdown、稿件信息和配套图片。");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setExporting(false);
    }
  };
  const addable = channels.filter((c) => !variants[c.id]);
  const characters = content.markdown.length;
  return (
    <div className="editor-page">
      <div className="editor-top">
        <button className="ghost" onClick={() => void switchPage(onBack)}>
          <ArrowLeft size={18} />
          内容库
        </button>
        <span className="save-state" role="status">
          <i
            className={saveStatus.pending || saveStatus.error ? "pending" : ""}
          />
          {saveStatus.error
            ? "尚有未保存的编辑"
            : saveStatus.pending || uploading
              ? "正在保存…"
              : draft.saved
                ? "本地已保存"
                : "开始编辑后自动保存"}
        </span>
        <Segmented
          label="编辑视图"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { id: "source", label: "专注写作" },
            { id: "split", label: "双栏对照" },
            { id: "preview", label: "阅读预览" },
          ]}
        />
        <button
          className={`icon-button bordered ${inspector ? "selected" : ""}`}
          aria-pressed={inspector}
          aria-label="发布信息侧栏"
          title={inspector ? "收起发布信息侧栏" : "展开发布信息侧栏"}
          onClick={() => setInspector(!inspector)}
        >
          <PanelRight size={17} />
        </button>
        <ActionMenu
          label="稿件工具"
          trigger={
            <>
              <Wrench size={16} />
              工具
            </>
          }
        >
          <button onClick={() => setStudio(true)}>
            <Images size={17} />
            制作图文
          </button>
          <button
            disabled={exporting || uploading}
            onClick={() => void exportContent()}
          >
            <Download size={16} />
            导出当前版本
          </button>
          {variant && (
            <button
              className="danger-text"
              onClick={() => setRemovePlatform(variant.channel)}
            >
              <Trash2 size={16} />
              移除此平台版本
            </button>
          )}
        </ActionMenu>
        <button
          className="primary"
          onClick={() => void switchPage(() => setPublish(true))}
        >
          <Send size={16} />
          分发到平台
        </button>
      </div>
      <div className="version-strip" aria-label="稿件版本">
        <button
          className={selected === "master" ? "active master-tab" : "master-tab"}
          onClick={() => select("master")}
          disabled={uploading}
        >
          母稿
        </button>
        {channels
          .filter((c) => variants[c.id] || selected === c.id)
          .map((c) => {
            const state = channelState(
              article,
              c.id,
              variants[c.id],
              posts,
              tasks,
            );
            return (
              <button
                key={c.id}
                className={selected === c.id ? "active" : ""}
                onClick={() => select(c.id)}
                disabled={!draft.ready || uploading}
              >
                <PlatformIcon id={c.id} size={18} />
                {c.short}
                <small>
                  {Object.keys(variants[c.id]?.overrides ?? {}).length
                    ? "独立编辑"
                    : "跟随母稿"}
                </small>
                {state.status !== "none" && state.status !== "ready" && (
                  <i
                    className={`state-dot dot-${state.status}`}
                    title={state.label}
                  />
                )}
              </button>
            );
          })}
        <button
          className="add-tab"
          disabled={uploading || !draft.ready}
          onClick={() => setAddPlatform(true)}
        >
          <Plus size={16} />
          添加平台
        </button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {saveStatus.error && (
        <Alert tone="danger">
          <p>{saveStatus.error}</p>
          <div className="button-row">
            <button onClick={() => void saveQueue.retry()}>重试保存</button>
            <button
              disabled={exporting || uploading}
              onClick={() => {
                setExporting(true);
                const articleAtStart = draft.articleRef.current;
                const variantsAtStart = draft.localRef.current;
                void copyDraft(articleAtStart, Object.values(variants))
                  .then((copy) => {
                    if (
                      draft.articleRef.current !== articleAtStart ||
                      draft.localRef.current !== variantsAtStart
                    ) {
                      notify(
                        "副本已保存到内容库。另存期间又有新的编辑，请再次另存以保留最新内容。",
                      );
                      return;
                    }
                    saveQueue.discard();
                    onOpenCopy(copy);
                  })
                  .catch((e) => setError(messageOf(e)))
                  .finally(() => setExporting(false));
              }}
            >
              <Save size={15} />
              另存为新稿
            </button>
          </div>
          <p>
            当前编辑仍保留在此页面。另存会复制母稿和平台版本，原稿保持原样。
          </p>
        </Alert>
      )}
      <div className={`editor-body ${inspector ? "with-inspector" : ""}`}>
        <div className="editor-main">
          {isVariantBehind(article, variant) && (
            <div className="version-notice">
              母稿已更新，此平台的独立内容保持原样。
              <button onClick={() => setShowDiff(true)}>
                <GitCompareArrows size={15} />
                查看差异
              </button>
              <button
                onClick={() =>
                  draft.putVariant({
                    ...variant!,
                    baseRevision: article.revision,
                    updatedAt: Date.now(),
                  })
                }
              >
                已核对，保留此版本
              </button>
            </div>
          )}
          <div className="title-row">
            <input
              className="article-title"
              aria-label="文章标题"
              placeholder="给这篇稿件起个标题"
              value={content.title}
              onChange={(e) => change("title", e.target.value)}
            />
            {variant?.overrides.title !== undefined && (
              <button
                className="text-button"
                title="标题重新跟随母稿"
                onClick={() => draft.reset(selected, "title")}
              >
                <Undo2 size={15} />
                跟随母稿
              </button>
            )}
          </div>
          {variant && channelFor(variant.channel).manual && (
            <div className="manual-tools">
              <span>LINUX DO 人工发布辅助</span>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(content.markdown)
                    .then(() => notify("正文已复制，可到原站粘贴。"))
                    .catch((e) => setError(messageOf(e)));
                }}
              >
                <Copy size={15} />
                复制 Markdown
              </button>
              <a href="https://linux.do/" target="_blank" rel="noreferrer">
                打开原站
                <ExternalLink size={14} />
              </a>
            </div>
          )}
          <div className={`writing-grid writing-${viewMode}`}>
            <section className="source-pane" hidden={viewMode === "preview"}>
              <header>
                <span>Markdown 源码</span>
                <div>
                  <button
                    className="text-button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImagePlus size={15} />
                    插入图片
                  </button>
                  {variant?.overrides.markdown !== undefined && (
                    <button
                      className="text-button"
                      onClick={() => draft.reset(selected, "markdown")}
                    >
                      <Undo2 size={15} />
                      正文跟随母稿
                    </button>
                  )}
                </div>
              </header>
              <MarkdownEditor
                key={selected}
                value={content.markdown}
                onChange={(v) => change("markdown", v)}
                onSelect={setSelection}
                onPasteImage={(files) => void importImages(files)}
              />
            </section>
            <section className="preview-pane" hidden={viewMode === "source"}>
              <header>
                <span>内容预览</span>
                <span>
                  {variant ? channelFor(variant.channel).short : "母稿"}
                </span>
              </header>
              {viewMode !== "source" && (
                <MarkdownPreview value={content.markdown} />
              )}
            </section>
          </div>
          <footer className="editor-status">
            <span>
              {characters.toLocaleString()} 字符 · 约{" "}
              {Math.max(
                1,
                Math.ceil(content.markdown.replace(/\s/g, "").length / 500),
              )}{" "}
              分钟阅读
            </span>
            <span>
              {content.imageIds.length} 张配图 · 母稿 v{article.revision}
            </span>
          </footer>
        </div>
        {inspector && (
          <aside className="inspector" aria-label="发布信息">
            <section>
              <h3>
                {variant ? (
                  <>
                    <PlatformIcon id={variant.channel} size={18} />
                    {channelFor(variant.channel).short} 发布设置
                  </>
                ) : (
                  <>
                    <Layers size={17} />
                    通用发布信息
                  </>
                )}
              </h3>
              <p className="muted">
                {variant
                  ? "未单独填写的标签、摘要和封面会自动使用通用信息。"
                  : "填写一次，所有平台共用；切换到平台页签可单独调整。"}
              </p>
              {variant ? (
                <MetadataFields
                  key={variant.channel}
                  ref={metadataEditor}
                  channel={variant.channel}
                  metadata={variant.metadata}
                  inherited={defaults}
                  markdown={content.markdown}
                  onChange={(update) =>
                    draft.changeVariant(variant.channel, (v) => ({
                      ...v,
                      metadata: update(v.metadata),
                    }))
                  }
                />
              ) : (
                <SharedFields
                  key="master"
                  ref={metadataEditor}
                  defaults={defaults}
                  markdown={content.markdown}
                  onChange={draft.changeDefaults}
                />
              )}
            </section>
            <section className="attachments">
              <header>
                <h3>
                  配图 <span>{content.imageIds.length}</span>
                </h3>
                {variant?.overrides.imageIds !== undefined && (
                  <button
                    className="text-button"
                    onClick={() => draft.reset(selected, "imageIds")}
                  >
                    <Undo2 size={13} />
                    配图跟随母稿
                  </button>
                )}
              </header>
              <div className="asset-grid">
                {assets
                  .flatMap((a) => (a ? [a] : []))
                  .map((a) => (
                    <AssetThumbnail
                      key={a.id}
                      asset={a}
                      cover={coverId === a.id}
                      onCover={() => setCover(a.id)}
                      onInsert={() =>
                        change(
                          "markdown",
                          content.markdown +
                            `\n\n![${a.name.replaceAll("]", "")}](asset://${a.id})`,
                        )
                      }
                      onRemove={() =>
                        change(
                          "imageIds",
                          content.imageIds.filter((id) => id !== a.id),
                        )
                      }
                    />
                  ))}
                <button
                  className="add-asset"
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus size={20} />
                  添加图片
                </button>
              </div>
            </section>
            {!!posts.length && (
              <section className="publication-list">
                <h3>
                  发布记录 <span>{posts.length}</span>
                </h3>
                {posts.map((post) => {
                  const current = variants[post.channel];
                  const behind =
                    post.snapshot &&
                    snapshotDiffers(post.snapshot, article, current);
                  return (
                    <div className="publication-row" key={post.id}>
                      <PlatformPill id={post.channel} />
                      <StatusBadge
                        status={
                          behind
                            ? "outdated"
                            : post.status === "published"
                              ? "published"
                              : post.status === "draft_saved"
                                ? "draft"
                                : "review"
                        }
                      >
                        {behind
                          ? "稿件有更新"
                          : post.status === "published"
                            ? "已发布"
                            : post.status === "draft_saved"
                              ? "草稿"
                              : "审核中"}
                      </StatusBadge>
                      <a href={post.url} target="_blank" rel="noreferrer">
                        查看原文
                        <ExternalLink size={13} />
                      </a>
                      {behind && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void (async () => {
                              try {
                                const snapshot = await freezeSnapshot(
                                  article,
                                  current ?? newVariant(article, post.channel),
                                );
                                await db.transaction(
                                  "rw",
                                  db.posts,
                                  db.meta,
                                  async () => {
                                    await db.posts.update(post.id, {
                                      snapshot,
                                      updatedAt: Date.now(),
                                    });
                                    await changed();
                                  },
                                );
                              } catch (e) {
                                setError(messageOf(e));
                              }
                            })()
                          }
                        >
                          <Check size={13} />
                          已在原站更新，登记当前版本
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </aside>
        )}
      </div>
      <input
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        ref={fileInput}
        onChange={(e) => {
          void importImages(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {studio && (
        <CardStudio
          title={content.title}
          markdown={selection || content.markdown}
          onClose={() => setStudio(false)}
          onUse={async (blobs) => {
            const ids = [];
            for (const [i, blob] of blobs.entries()) {
              ids.push(
                (
                  await addAsset(
                    Object.assign(blob, { name: `图文-${i + 1}.png` }),
                  )
                ).id,
              );
            }
            draft.putVariant(
              setOverride(
                draft.currentVariant("xiaohongshu:note"),
                "imageIds",
                ids,
              ),
            );
            if (!(await draft.flush()))
              throw new Error(
                "图文已加入当前编辑，但尚未保存成功。请处理保存提示。",
              );
            setSelected("xiaohongshu:note");
          }}
        />
      )}
      {publish && (
        <DistributeDialog
          draft={draft}
          onFlush={flush}
          onEditPlatform={(id) => {
            setPublish(false);
            setSelected(id);
          }}
          onClose={() => setPublish(false)}
          onCreated={onQueue}
        />
      )}
      {addPlatform && (
        <Modal title="添加平台版本" onClose={() => setAddPlatform(false)}>
          <p className="modal-lead">
            平台版本默认跟随母稿；添加后可以单独调整标题、正文、配图和分类。直接“分发到平台”也会自动添加。
          </p>
          <div className="platform-picker">
            {addable.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  void switchPage(() => {
                    draft.putVariant(draft.currentVariant(c.id));
                    setSelected(c.id);
                    setAddPlatform(false);
                  })
                }
              >
                <PlatformIcon id={c.id} size={26} />
                <span>
                  {c.name}
                  <small>{c.manual ? "人工发布辅助" : "从母稿开始"}</small>
                </span>
              </button>
            ))}
          </div>
          {!addable.length && <p className="modal-lead">已添加全部平台。</p>}
          {addable.length > 1 && (
            <footer className="modal-actions">
              <button
                onClick={() =>
                  void switchPage(() => {
                    for (const c of addable)
                      draft.putVariant(draft.currentVariant(c.id));
                    setAddPlatform(false);
                  })
                }
              >
                <Plus size={15} />
                全部添加
              </button>
            </footer>
          )}
        </Modal>
      )}
      {removePlatform && (
        <ConfirmDialog
          title="移除此平台版本？"
          confirmLabel="移除版本"
          onClose={() => setRemovePlatform(null)}
          onConfirm={async () => {
            if (!(await flush())) throw new Error("请先处理未保存的编辑。");
            await draft.dropVariant(removePlatform);
            setSelected("master");
          }}
        >
          <p>
            将清除这一平台的独立内容和发布设置。母稿与原站内容保留，之后可以重新添加平台。
          </p>
        </ConfirmDialog>
      )}
      {showDiff && variant && (
        <Modal
          title="母稿与平台版本差异"
          onClose={() => setShowDiff(false)}
          wide
        >
          <div className="form-stack">
            <h3>标题</h3>
            <p>母稿：{article.title || "未填写"}</p>
            <p>平台版本：{content.title || "未填写"}</p>
            <details>
              <summary>
                配图对比（母稿 {article.imageIds.length} 张 · 平台{" "}
                {content.imageIds.length} 张）
              </summary>
              <h4>母稿配图</h4>
              <MarkdownPreview
                value={article.imageIds
                  .map((id) => `![母稿配图](asset://${id})`)
                  .join("\n\n")}
              />
              <h4>平台配图</h4>
              <MarkdownPreview
                value={content.imageIds
                  .map((id) => `![平台配图](asset://${id})`)
                  .join("\n\n")}
              />
            </details>
            <h3>正文</h3>
          </div>
          <div className="diff-body">
            {diffLines(article.markdown, content.markdown).map((part, i) => (
              <pre
                key={i}
                className={
                  part.added ? "diff-added" : part.removed ? "diff-removed" : ""
                }
              >
                {part.value}
              </pre>
            ))}
          </div>
          <footer className="modal-actions">
            <span className="muted">绿色为平台版本内容，红色为母稿内容。</span>
            <button onClick={() => setShowDiff(false)}>保留编辑，返回</button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
