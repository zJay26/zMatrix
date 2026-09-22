import { renderMarkdown, renderMermaid, waitForImages } from "./render";
import { blobDataUrl } from "./assets";
import { db } from "./db";
export interface CardOptions {
  template: "text" | "technical" | "mixed";
  color: string;
  fontSize: number;
  padding: number;
  cover: boolean;
  title: string;
}
export const defaultCardOptions: CardOptions = {
  template: "text",
  color: "#355beb",
  fontSize: 22,
  padding: 36,
  cover: true,
  title: "",
};
export function textFragments(text: string, max: number): string[] {
  const chars = Array.from(text);
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += max)
    pieces.push(chars.slice(i, i + max).join(""));
  return pieces;
}
function elementTextLength(element: Element) {
  return (element.textContent ?? "").length;
}
function cloneSlice(element: Element, start: number, end: number): HTMLElement {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Node | undefined;
  let endNode: Node | undefined;
  let startOffset = 0,
    endOffset = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const length = n.textContent?.length ?? 0;
    if (!startNode && start < offset + length) {
      startNode = n;
      startOffset = start - offset;
    }
    if (end <= offset + length) {
      endNode = n;
      endOffset = end - offset;
      break;
    }
    offset += length;
  }
  const clone = element.cloneNode(false) as HTMLElement;
  if (!startNode || !endNode) return clone;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  clone.append(range.cloneContents());
  return clone;
}
function splitBlock(
  block: HTMLElement,
  body: HTMLElement,
  maxHeight: number,
): HTMLElement[] {
  if (block.tagName === "TABLE") {
    const head = block.querySelector("thead");
    const rows = Array.from(block.querySelectorAll("tbody > tr"));
    const parts: HTMLElement[] = [];
    let current = document.createElement("table");
    if (head) current.append(head.cloneNode(true));
    let group = document.createElement("tbody");
    current.append(group);
    for (const row of rows) {
      group.append(row.cloneNode(true));
      body.replaceChildren(current);
      if (body.scrollHeight > maxHeight && group.children.length > 1) {
        group.lastElementChild!.remove();
        parts.push(current);
        current = document.createElement("table");
        if (head) current.append(head.cloneNode(true));
        group = document.createElement("tbody");
        group.append(row.cloneNode(true));
        current.append(group);
      }
    }
    if (group.children.length) parts.push(current);
    return parts;
  }
  const length = elementTextLength(block);
  if (length < 2) return [block];
  const parts: HTMLElement[] = [];
  let offset = 0;
  while (offset < length) {
    let low = offset + 1,
      high = length,
      best = offset;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = cloneSlice(block, offset, mid);
      body.replaceChildren(slice);
      if (body.scrollHeight <= maxHeight) {
        best = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (best === offset)
      throw new Error("字号或边距过大，内容无法放入图文页面。");
    // Do not split a UTF-16 surrogate pair across image pages.
    const text = block.textContent ?? "";
    if (best < length && /[\uD800-\uDBFF]/.test(text[best - 1] ?? "")) best--;
    if (best <= offset) throw new Error("页面无法容纳当前字符。");
    parts.push(cloneSlice(block, offset, best));
    offset = best;
  }
  return parts;
}
export async function makeCards(
  markdown: string,
  options: CardOptions,
): Promise<Blob[]> {
  const assets = await db.assets.toArray();
  const urls = new Map<string, string>();
  for (const a of assets) urls.set(a.id, await blobDataUrl(a.blob));
  const scratch = document.createElement("div");
  scratch.className = "card-export-root";
  document.body.append(scratch);
  const page = () => {
    const shell = document.createElement("section");
    shell.className = `image-card template-${options.template}`;
    shell.style.setProperty("--card-accent", options.color);
    shell.style.setProperty("--card-font-size", `${options.fontSize}px`);
    shell.style.setProperty(
      "--body-height",
      `${720 - options.padding * 2 - 90}px`,
    );
    shell.style.padding = `${options.padding}px`;
    const header = document.createElement("header");
    header.textContent = options.title || "我的笔记";
    const body = document.createElement("div");
    body.className = "card-body article-prose";
    const footer = document.createElement("footer");
    shell.append(header, body, footer);
    scratch.append(shell);
    return { shell, body, footer };
  };
  const source = document.createElement("div");
  source.innerHTML = await renderMarkdown(markdown, urls);
  scratch.append(source);
  const pages: ReturnType<typeof page>[] = [];
  try {
    await renderMermaid(source);
    if (source.querySelector(".render-error"))
      throw new Error("请先修正 Mermaid 图表语法。");
    await waitForImages(source);
    const blocks = Array.from(source.children) as HTMLElement[];
    source.remove();
    if (options.cover) {
      const cover = page();
      cover.shell.classList.add("cover-card");
      const heading = document.createElement("h1");
      heading.textContent = options.title || "我的笔记";
      cover.body.append(heading);
      pages.push(cover);
    }
    let current = page();
    const maxHeight = 720 - options.padding * 2 - 90;
    for (const block of blocks) {
      current.body.append(block.cloneNode(true));
      if (current.body.scrollHeight <= maxHeight) continue;
      current.body.lastElementChild!.remove();
      if (current.body.children.length) {
        pages.push(current);
        current = page();
      }
      current.body.append(block.cloneNode(true));
      if (current.body.scrollHeight <= maxHeight) continue;
      current.body.replaceChildren();
      const pieces = splitBlock(block, current.body, maxHeight);
      current.body.replaceChildren();
      for (let i = 0; i < pieces.length; i++) {
        current.body.append(pieces[i]!);
        if (current.body.scrollHeight > maxHeight)
          throw new Error("单个图片或表格行过高，请缩小字号或拆分内容。");
        if (i < pieces.length - 1) {
          pages.push(current);
          current = page();
        }
      }
    }
    if (current.body.children.length) pages.push(current);
    else current.shell.remove();
    if (!pages.length) throw new Error("请选择要生成图片的文字。");
    const { toBlob } = await import("html-to-image");
    const result: Blob[] = [];
    for (const [index, p] of pages.entries()) {
      p.footer.textContent = `${String(index + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`;
      await waitForImages(p.shell);
      const blob = await toBlob(p.shell, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      if (!blob) throw new Error("图文生成失败");
      result.push(blob);
    }
    return result;
  } finally {
    scratch.remove();
  }
}
