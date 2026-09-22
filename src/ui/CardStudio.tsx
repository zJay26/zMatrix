import { useState } from "react";
import { Download, Images, LoaderCircle } from "lucide-react";
import { zipSync } from "fflate";
import { defaultCardOptions, makeCards, type CardOptions } from "../core/cards";
import { downloadBlob } from "../core/assets";
import { messageOf } from "../core/model";
import { Modal, useBlobUrl, Alert } from "./shared";
function CardImage({ blob, index }: { blob: Blob; index: number }) {
  const url = useBlobUrl(blob);
  return <img src={url || undefined} alt={`生成图文第 ${index + 1} 页`} />;
}
export function CardStudio({
  title,
  markdown,
  onClose,
  onUse,
}: {
  title: string;
  markdown: string;
  onClose: () => void;
  onUse: (blobs: Blob[]) => Promise<void>;
}) {
  const [options, setOptions] = useState<CardOptions>({
    ...defaultCardOptions,
    title,
  });
  const [cards, setCards] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(true);
  const change = (patch: Partial<CardOptions>) => {
    setOptions({ ...options, ...patch });
    setDirty(true);
  };
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      setCards(await makeCards(markdown, options));
      setDirty(false);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    const files: Record<string, Uint8Array> = {};
    for (const [index, card] of cards.entries())
      files[`图文-${index + 1}.png`] = new Uint8Array(await card.arrayBuffer());
    downloadBlob(
      new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], {
        type: "application/zip",
      }),
      "zMatrix-图文.zip",
    );
  };
  return (
    <Modal title="把文字排成图文" onClose={onClose} wide>
      <div className="card-studio">
        <aside className="studio-options">
          <label>
            模板
            <select
              value={options.template}
              onChange={(e) =>
                change({ template: e.target.value as CardOptions["template"] })
              }
            >
              <option value="text">简洁文字</option>
              <option value="technical">技术笔记</option>
              <option value="mixed">图文混排</option>
            </select>
          </label>
          <label>
            封面标题
            <input
              value={options.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label>
            主题颜色
            <input
              type="color"
              value={options.color}
              onChange={(e) => change({ color: e.target.value })}
            />
          </label>
          <label>
            字号 · {options.fontSize}px
            <input
              type="range"
              min="16"
              max="32"
              value={options.fontSize}
              onChange={(e) => change({ fontSize: Number(e.target.value) })}
            />
          </label>
          <label>
            边距 · {options.padding}px
            <input
              type="range"
              min="24"
              max="56"
              value={options.padding}
              onChange={(e) => change({ padding: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.cover}
              onChange={(e) => change({ cover: e.target.checked })}
            />
            包含封面页
          </label>
          <p className="muted">
            使用选定文字；未选择时使用当前正文。图片输出为 1080 × 1440。
          </p>
          <button
            className="primary"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Images size={17} />
            )}
            生成预览
          </button>
        </aside>
        <div className="studio-preview">
          {error && <Alert>{error}</Alert>}
          {cards.length ? (
            <div className="card-grid">
              {cards.map((blob, index) => (
                <CardImage key={index} blob={blob} index={index} />
              ))}
            </div>
          ) : (
            <div className="studio-placeholder">
              <Images size={38} />
              <h3>选好版式，生成图文</h3>
              <p>长内容会按页面排版，保留正文顺序。</p>
            </div>
          )}
        </div>
      </div>
      <footer className="modal-actions">
        <span className="muted">
          {cards.length
            ? `${cards.length} 页${dirty ? " · 设置已更改，请重新生成" : ""}`
            : "尚未生成"}
        </span>
        <button
          onClick={() => void download()}
          disabled={!cards.length || dirty || busy}
        >
          <Download size={16} />
          下载图片包
        </button>
        <button
          className="primary"
          disabled={!cards.length || dirty || busy}
          onClick={() => {
            setBusy(true);
            void onUse(cards)
              .then(onClose)
              .catch((e) => {
                setError(messageOf(e));
                setBusy(false);
              });
          }}
        >
          用于小红书图文
        </button>
      </footer>
    </Modal>
  );
}
