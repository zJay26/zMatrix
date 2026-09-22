import { useEffect, useRef, useState } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { db } from "../core/db";
import { assetIdsIn, blobDataUrl } from "../core/assets";
import { renderMarkdown, renderMermaid } from "../core/render";
import { messageOf } from "../core/model";
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
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Markdown 正文" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
            if (update.selectionSet) {
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
      });
  }, [value]);
  return <div className="markdown-editor" ref={host} />;
}
export function MarkdownPreview({ value }: { value: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const urls = new Map<string, string>();
          for (const id of assetIdsIn(value)) {
            const asset = await db.assets.get(id);
            if (asset) urls.set(id, await blobDataUrl(asset.blob));
          }
          const html = await renderMarkdown(value, urls);
          if (!stopped && host.current) {
            host.current.innerHTML = html;
            await renderMermaid(host.current);
            setError("");
          }
        } catch (error) {
          if (!stopped) setError(messageOf(error));
        }
      })();
    }, 120);
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
