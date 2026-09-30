import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, RefreshCw, ExternalLink, TextQuote, Undo2 } from "lucide-react";
import { db } from "../core/db";
import { extractSummary, normalizeTags, parseTags } from "../core/metadata";
import { messageOf, type ChannelId, type Metadata } from "../core/model";
import { channelFor } from "../platforms/catalog";
import { metadataFor } from "../platforms/metadata";
import {
  isExtension,
  readCategoryCandidates,
} from "../platforms/browser-adapter";

export interface MetadataHandle {
  flush: () => void;
  hasPending: () => boolean;
}

function FieldStatus({
  required = false,
  onSite = true,
}: {
  required?: boolean;
  onSite?: boolean;
}) {
  return (
    <span className="field-status">
      <span className={required ? "field-badge required" : "field-badge"}>
        {required ? "发布必填" : "选填"}
      </span>
      {onSite && <span className="field-badge on-site">需到原站设置</span>}
    </span>
  );
}

export function MetadataFields({
  channel,
  metadata,
  markdown,
  onChange,
  ref,
}: {
  channel: ChannelId;
  metadata: Metadata;
  markdown: string;
  onChange: (update: (previous: Metadata) => Metadata) => void;
  ref?: Ref<MetadataHandle>;
}) {
  const spec = channelFor(channel);
  const fields = metadataFor(channel);
  const history = useLiveQuery(
    async () => {
      const variants = await db.variants
        .where("channel")
        .equals(channel)
        .toArray();
      return normalizeTags(
        variants.map((variant) => variant.metadata.category),
      );
    },
    [channel],
    [],
  );
  const [remoteCategories, setRemoteCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState("");
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const composing = useRef(false);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [previousSummary, setPreviousSummary] = useState<string | null>(null);
  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };
  const commit = () => {
    const tags = parseTags(draftRef.current);
    if (tags.length)
      onChange((previous) => ({
        ...previous,
        tags: normalizeTags([...previous.tags, ...tags]),
      }));
    updateDraft("");
  };
  useImperativeHandle(ref, () => ({
    flush: commit,
    hasPending: () => !!draftRef.current.trim(),
  }));
  const typeTags = (text: string, complete = false) => {
    const parts = text.split(/[,，;；\r\n]+/u);
    const tail = complete ? "" : (parts.pop() ?? "");
    const tags = normalizeTags(parts);
    if (tags.length)
      onChange((previous) => ({
        ...previous,
        tags: normalizeTags([...previous.tags, ...tags]),
      }));
    updateDraft(tail);
  };
  const candidates = normalizeTags([...fields.categories, ...remoteCategories]);
  const localCategories = [
    ...new Set([metadata.category, ...history].filter(Boolean)),
  ].filter((name) => !candidates.includes(name));
  const categoryId = `category-${channel}`;
  const tagsId = `tags-${channel}`;
  const summaryId = `summary-${channel}`;
  return (
    <div className="metadata-fields">
      <div className="metadata-field">
        <div className="metadata-label">
          <label htmlFor={categoryId}>{fields.categoryLabel}</label>
          <FieldStatus required={spec.required.includes("category")} />
        </div>
        <div className="category-control">
          <select
            id={categoryId}
            value={metadata.category}
            aria-describedby={`${categoryId}-help`}
            onChange={(event) => {
              const category = event.target.value;
              onChange((previous) => ({ ...previous, category }));
            }}
          >
            <option value="">
              {candidates.length || localCategories.length
                ? "请选择分类"
                : "暂无候选，请到原站设置"}
            </option>
            {!!candidates.length && (
              <optgroup
                label={fields.categories.length ? "平台分类" : "从原站读取"}
              >
                {candidates.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
            {!!localCategories.length && (
              <optgroup label="本地已保存（需原站确认）">
                {localCategories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {fields.readCategories && (
            <button
              type="button"
              className="icon-button"
              disabled={loading || !isExtension()}
              aria-label="读取原站分类"
              title={
                isExtension()
                  ? "读取已打开原站的分类选项"
                  : "请在 Edge 扩展中读取原站分类"
              }
              onClick={() => {
                setLoading(true);
                setCategoryMessage("");
                void readCategoryCandidates(channel)
                  .then((names) => {
                    setRemoteCategories(names);
                    setCategoryMessage(`已读取 ${names.length} 个分类`);
                  })
                  .catch((error) => setCategoryMessage(messageOf(error)))
                  .finally(() => setLoading(false));
              }}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          )}
        </div>
        <div className="field-help" id={`${categoryId}-help`}>
          <span>{fields.categoryHelp}</span>
          <a href={spec.editorUrl} target="_blank" rel="noreferrer">
            打开原站
            <ExternalLink size={12} />
          </a>
        </div>
        {categoryMessage && (
          <p className="field-help" role="status">
            {categoryMessage}
          </p>
        )}
      </div>
      <div className="metadata-field">
        <div className="metadata-label">
          <label htmlFor={tagsId}>标签</label>
          <FieldStatus required={spec.required.includes("tags")} />
        </div>
        <div
          className="tag-input"
          onClick={(event) => {
            if (event.target === event.currentTarget)
              event.currentTarget.querySelector("input")?.focus();
          }}
        >
          {metadata.tags.filter(Boolean).map((tag, index) => (
            <span className="tag-chip" key={`${tag}-${index}`}>
              <span>{tag}</span>
              <button
                type="button"
                aria-label={`删除标签 ${tag}`}
                onClick={() =>
                  onChange((previous) => ({
                    ...previous,
                    tags: previous.tags.filter((value) => value !== tag),
                  }))
                }
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <input
            id={tagsId}
            value={draft}
            placeholder="输入标签，回车添加"
            aria-describedby={`${tagsId}-help`}
            onChange={(event) =>
              composing.current
                ? updateDraft(event.target.value)
                : typeTags(event.target.value)
            }
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              typeTags(event.currentTarget.value);
            }}
            onBlur={commit}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (!/[,，;；\r\n]/u.test(text)) return;
              event.preventDefault();
              const input = event.currentTarget;
              typeTags(
                draftRef.current.slice(0, input.selectionStart ?? 0) +
                  text +
                  draftRef.current.slice(
                    input.selectionEnd ?? draftRef.current.length,
                  ),
                true,
              );
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                composing.current ||
                event.keyCode === 229
              )
                return;
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Backspace" && !draftRef.current)
                onChange((previous) => ({
                  ...previous,
                  tags: previous.tags.slice(0, -1),
                }));
            }}
          />
        </div>
        <p className="field-help" id={`${tagsId}-help`}>
          支持中英文逗号、回车；重复标签自动合并。
        </p>
      </div>
      <div className="metadata-field summary-field">
        <div className="metadata-label">
          <label htmlFor={summaryId}>摘要</label>
          <FieldStatus onSite={fields.summaryOnSite} />
          <button
            type="button"
            className="text-button extract-summary"
            title="从当前平台正文提取最多 160 字，可继续编辑"
            disabled={!markdown.trim()}
            onClick={() => {
              const summary = extractSummary(markdown);
              if (!summary) {
                setSummaryMessage("正文中还没有可提取的文字。");
                return;
              }
              setPreviousSummary(metadata.summary);
              onChange((previous) => ({ ...previous, summary }));
              setSummaryMessage("已从当前正文提取，可继续编辑。");
            }}
          >
            <TextQuote size={15} />
            从正文提取
          </button>
        </div>
        <textarea
          id={summaryId}
          rows={2}
          value={metadata.summary}
          placeholder="用一两句话介绍这篇内容"
          onChange={(event) => {
            const summary = event.target.value;
            onChange((previous) => ({ ...previous, summary }));
            setPreviousSummary(null);
            setSummaryMessage("");
          }}
        />
        {summaryMessage && (
          <div className="field-help" role="status">
            <span>{summaryMessage}</span>
            {previousSummary !== null && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const summary = previousSummary;
                  onChange((previous) => ({ ...previous, summary }));
                  setPreviousSummary(null);
                  setSummaryMessage("已恢复提取前的摘要。");
                }}
              >
                <Undo2 size={13} />
                撤销提取
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
