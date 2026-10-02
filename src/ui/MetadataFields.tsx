import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, RefreshCw, ExternalLink, TextQuote, Undo2 } from "lucide-react";
import { db } from "../core/db";
import { extractSummary, normalizeTags, parseTags } from "../core/metadata";
import {
  messageOf,
  type ChannelId,
  type Metadata,
  type SharedMetadata,
} from "../core/model";
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

// Tags typed on a platform replace the shared ones for that platform only;
// while a platform has none of its own, the shared tags are shown as inherited.
function TagInput({
  id,
  tags,
  inherited,
  onChange,
  ref,
}: {
  id: string;
  tags: string[];
  inherited?: string[];
  onChange: (update: (previous: string[]) => string[]) => void;
  ref?: Ref<MetadataHandle>;
}) {
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const composing = useRef(false);
  const following = !tags.length && !!inherited?.length;
  const base = (previous: string[]) =>
    previous.length ? previous : (inherited ?? []);
  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };
  const add = (added: string[]) => {
    if (added.length)
      onChange((previous) => normalizeTags([...base(previous), ...added]));
  };
  const commit = () => {
    add(parseTags(draftRef.current));
    updateDraft("");
  };
  useImperativeHandle(ref, () => ({
    flush: commit,
    hasPending: () => !!draftRef.current.trim(),
  }));
  const typeTags = (text: string, complete = false) => {
    const parts = text.split(/[,，;；\r\n]+/u);
    const tail = complete ? "" : (parts.pop() ?? "");
    add(normalizeTags(parts));
    updateDraft(tail);
  };
  const shown = following ? inherited! : tags.filter(Boolean);
  return (
    <div
      className={`tag-input ${following ? "following" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget)
          event.currentTarget.querySelector("input")?.focus();
      }}
    >
      {shown.map((tag, index) => (
        <span className="tag-chip" key={`${tag}-${index}`}>
          <span>{tag}</span>
          <button
            type="button"
            aria-label={`删除标签 ${tag}`}
            onClick={() =>
              onChange((previous) =>
                base(previous).filter((value) => value !== tag),
              )
            }
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder="输入标签，回车添加"
        aria-describedby={`${id}-help`}
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
          if (event.key === "Backspace" && !draftRef.current && !following)
            onChange((previous) => previous.slice(0, -1));
        }}
      />
    </div>
  );
}

function SummaryField({
  id,
  summary,
  inherited,
  markdown,
  onChange,
  label,
  status,
}: {
  id: string;
  summary: string;
  inherited?: string;
  markdown: string;
  onChange: (summary: string) => void;
  label: string;
  status?: ReactNode;
}) {
  const [message, setMessage] = useState("");
  const [previous, setPrevious] = useState<string | null>(null);
  return (
    <div className="metadata-field summary-field">
      <div className="metadata-label">
        <label htmlFor={id}>{label}</label>
        {status}
        <button
          type="button"
          className="text-button extract-summary"
          title="从当前正文提取最多 160 字，可继续编辑"
          disabled={!markdown.trim()}
          onClick={() => {
            const extracted = extractSummary(markdown);
            if (!extracted) {
              setMessage("正文中还没有可提取的文字。");
              return;
            }
            setPrevious(summary);
            onChange(extracted);
            setMessage("已从当前正文提取，可继续编辑。");
          }}
        >
          <TextQuote size={15} />
          从正文提取
        </button>
      </div>
      <textarea
        id={id}
        rows={3}
        value={summary}
        placeholder={
          inherited ? `跟随通用摘要：${inherited}` : "用一两句话介绍这篇内容"
        }
        onChange={(event) => {
          onChange(event.target.value);
          setPrevious(null);
          setMessage("");
        }}
      />
      {message && (
        <div className="field-help" role="status">
          <span>{message}</span>
          {previous !== null && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onChange(previous);
                setPrevious(null);
                setMessage("已恢复提取前的摘要。");
              }}
            >
              <Undo2 size={13} />
              撤销提取
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Written once on the master; every platform uses them unless it sets its own.
export function SharedFields({
  defaults,
  markdown,
  onChange,
  ref,
}: {
  defaults: SharedMetadata;
  markdown: string;
  onChange: (update: (previous: SharedMetadata) => SharedMetadata) => void;
  ref?: Ref<MetadataHandle>;
}) {
  const scope = useId();
  return (
    <div className="metadata-fields shared-fields">
      <div className="metadata-field">
        <div className="metadata-label">
          <label htmlFor={`${scope}-tags`}>通用标签</label>
        </div>
        <TagInput
          id={`${scope}-tags`}
          ref={ref}
          tags={defaults.tags}
          onChange={(update) =>
            onChange((previous) => ({
              ...previous,
              tags: update(previous.tags),
            }))
          }
        />
        <p className="field-help" id={`${scope}-tags-help`}>
          所有平台共用，逗号或回车分隔。
        </p>
      </div>
      <SummaryField
        id={`${scope}-summary`}
        label="通用摘要"
        summary={defaults.summary}
        markdown={markdown}
        onChange={(summary) =>
          onChange((previous) => ({ ...previous, summary }))
        }
      />
    </div>
  );
}

export function MetadataFields({
  channel,
  metadata,
  markdown,
  onChange,
  inherited,
  ref,
}: {
  channel: ChannelId;
  metadata: Metadata;
  markdown: string;
  onChange: (update: (previous: Metadata) => Metadata) => void;
  inherited?: SharedMetadata;
  ref?: Ref<MetadataHandle>;
}) {
  const spec = channelFor(channel);
  const fieldScope = useId();
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
  const candidates = normalizeTags([...fields.categories, ...remoteCategories]);
  const localCategories = [
    ...new Set([metadata.category, ...history].filter(Boolean)),
  ].filter((name) => !candidates.includes(name));
  const categoryId = `${fieldScope}-category-${channel}`;
  const tagsId = `${fieldScope}-tags-${channel}`;
  const summaryId = `${fieldScope}-summary-${channel}`;
  const ownTags = metadata.tags.filter(Boolean);
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
              className="icon-button bordered"
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
          {!!inherited?.tags.length && !!ownTags.length && (
            <button
              type="button"
              className="text-button follow-reset"
              onClick={() =>
                onChange((previous) => ({ ...previous, tags: [] }))
              }
            >
              <Undo2 size={13} />
              跟随通用标签
            </button>
          )}
        </div>
        <TagInput
          id={tagsId}
          ref={ref}
          tags={metadata.tags}
          inherited={inherited?.tags}
          onChange={(update) =>
            onChange((previous) => ({
              ...previous,
              tags: update(previous.tags),
            }))
          }
        />
        <p className="field-help" id={`${tagsId}-help`}>
          {!ownTags.length && inherited?.tags.length
            ? "正在使用通用标签；在此修改后仅对本平台生效。"
            : "支持中英文逗号、回车；重复标签自动合并。"}
        </p>
      </div>
      <SummaryField
        id={summaryId}
        label="摘要"
        status={<FieldStatus onSite={fields.summaryOnSite} />}
        summary={metadata.summary}
        inherited={inherited?.summary}
        markdown={markdown}
        onChange={(summary) =>
          onChange((previous) => ({ ...previous, summary }))
        }
      />
    </div>
  );
}
