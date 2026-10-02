import { useEffect, useRef, useState } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { Bold, Italic, Heading2, List, Quote, Code, Link } from "lucide-react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { db } from "../core/db";
import { assetIdsIn, blobDataUrl } from "../core/assets";
import { renderMarkdown, renderMermaid } from "../core/render";
import { messageOf } from "../core/model";
const externalUpdate = Annotation.define<boolean>();
// Colors come from the stylesheet so the source view follows the app theme.
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--syntax-heading)", fontWeight: "700" },
  { tag: tags.strong, color: "var(--syntax-strong)", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--syntax-link)" },
  { tag: tags.monospace, color: "var(--syntax-code)" },
  { tag: tags.quote, color: "var(--syntax-quote)" },
  {
    tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
    color: "var(--syntax-meta)",
  },
]);
type Format =
  "bold" | "italic" | "heading" | "list" | "quote" | "code" | "link";
function format(view: EditorView, kind: Format) {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const wrappers = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    code: ["`", "`"],
    link: ["[", "](https://example.com)"],
  } as const;
  if (kind === "heading" || kind === "list" || kind === "quote") {
    const from = view.state.doc.lineAt(range.from).from;
    const to = view.state.doc.lineAt(range.to).to;
    const prefix = kind === "heading" ? "## " : kind === "list" ? "- " : "> ";
    const insert = view.state
      .sliceDoc(from, to)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + prefix.length, head: from + insert.length },
    });
  } else {
    const [before, after] = wrappers[kind];
    const text = selected || "文字";
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: before + text + after,
      },
      selection: {
        anchor: range.from + before.length,
        head: range.from + before.length + text.length,
      },
    });
  }
  view.focus();
}
export function MarkdownEditor({
  value,
  onChange,
  onSelect,
  onPasteImage,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
  onPasteImage: (files: File[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSelect, onPasteImage });
  callbacks.current = { onChange, onSelect, onPasteImage };
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([
            {
              key: "Mod-b",
              run: (view) => {
                format(view, "bold");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: (view) => {
                format(view, "italic");
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(highlightStyle),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Markdown 正文" }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((t) => t.annotation(externalUpdate))
            )
              callbacks.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const range = update.state.selection.main;
              callbacks.current.onSelect(
                update.state.sliceDoc(range.from, range.to),
              );
            }
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const files = Array.from(event.clipboardData?.files ?? []).filter(
                (file) => file.type.startsWith("image/"),
              );
              if (files.length) {
                event.preventDefault();
                callbacks.current.onPasteImage(files);
                return true;
              }
              return false;
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: [
          externalUpdate.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
  }, [value]);
  const formats = [
    { id: "bold", name: "加粗（Ctrl+B）", icon: Bold },
    { id: "italic", name: "斜体（Ctrl+I）", icon: Italic },
    { id: "heading", name: "二级标题", icon: Heading2 },
    { id: "list", name: "无序列表", icon: List },
    { id: "quote", name: "引用", icon: Quote },
    { id: "code", name: "行内代码", icon: Code },
    { id: "link", name: "插入链接", icon: Link },
  ] as const;
  return (
    <>
      <div className="format-toolbar" role="toolbar" aria-label="Markdown 格式">
        {formats.map((item) => (
          <button
            key={item.id}
            title={item.name}
            aria-label={item.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (editor.current) format(editor.current, item.id);
            }}
          >
            <item.icon size={16} />
          </button>
        ))}
        <span>Markdown</span>
      </div>
      <div className="markdown-editor" ref={host} />
    </>
  );
}
export function MarkdownPreview({ value }: { value: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const cachedImages = useRef(new Map<string, string>());
  useEffect(() => {
    let stopped = false;
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const ids = assetIdsIn(value);
          const urls = new Map<string, string>();
          const assets = await db.assets.bulkGet(ids);
          await Promise.all(
            assets.map(async (asset) => {
              if (asset)
                urls.set(
                  asset.id,
                  cachedImages.current.get(asset.id) ??
                    (await blobDataUrl(asset.blob)),
                );
            }),
          );
          const html = await renderMarkdown(value, urls);
          if (stopped) return;
          const rendered = document.createElement("div");
          rendered.innerHTML = html;
          await renderMermaid(rendered);
          if (!stopped && host.current) {
            cachedImages.current = urls;
            host.current.replaceChildren(...Array.from(rendered.childNodes));
            setError("");
          }
        } catch (error) {
          if (!stopped) setError(messageOf(error));
        }
      })();
    }, 200);
    return () => {
      stopped = true;
      clearTimeout(timeout);
    };
  }, [value]);
  return (
    <>
      {error && <p className="error-text">{error}</p>}
      <div className="article-prose preview-content" ref={host} />
    </>
  );
}
