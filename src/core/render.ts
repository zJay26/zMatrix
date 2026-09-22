import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import type { Root, RootContent } from "mdast";
import { db, type WorkbenchDB } from "./db";
import { assetIdsIn, wireAsset } from "./assets";
import { addAsset } from "./assets";
import { channelFor } from "../platforms/catalog";
import type { PreparedContent, Snapshot, WireAsset } from "./model";

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSanitize, {
    ...defaultSchema,
    protocols: {
      ...defaultSchema.protocols,
      src: ["https", "http", "asset", "data"],
    },
    attributes: {
      ...defaultSchema.attributes,
      code: [["className", /^language-./, "math-inline", "math-display"]],
      span: [["className", "math-inline", "math-display"]],
    },
  })
  .use(rehypeKatex, { trust: false, strict: "warn" })
  .use(rehypeStringify);
export async function renderMarkdown(
  markdown: string,
  assets: Map<string, string> = new Map(),
) {
  const result = String(await pipeline.process(markdown));
  return result.replace(
    /src="asset:\/\/([a-f0-9]{64})"/g,
    (_all, id: string) =>
      `src="${assets.get(id) ?? ""}" data-missing-asset="${assets.has(id) ? "" : "true"}"`,
  );
}
export async function renderMermaid(container: HTMLElement) {
  const codes = Array.from(
    container.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
  );
  if (!codes.length) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    fontFamily: "Microsoft YaHei, sans-serif",
    suppressErrorRendering: true,
  });
  for (const code of codes) {
    const target = code.parentElement!;
    try {
      const result = await mermaid.render(
        `tg-${crypto.randomUUID()}`,
        code.textContent ?? "",
      );
      target.innerHTML = result.svg;
      target.classList.add("mermaid-rendered");
    } catch (error) {
      const errorMessage = document.createElement("p");
      errorMessage.className = "render-error";
      errorMessage.textContent = `Mermaid 无法渲染：${error instanceof Error ? error.message : "语法错误"}`;
      target.append(errorMessage);
    }
  }
}
export async function waitForImages(container: HTMLElement) {
  await document.fonts.ready;
  await Promise.all(
    Array.from(container.querySelectorAll("img")).map((img) =>
      img.complete
        ? img.naturalWidth
          ? Promise.resolve()
          : Promise.reject(new Error("有图片未能加载"))
        : new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("有图片未能加载"));
          }),
    ),
  );
}
export async function rasterize(html: string): Promise<Blob> {
  const mount = document.createElement("div");
  mount.className = "raster-export-root";
  const host = document.createElement("div");
  host.className = "article-prose raster-surface";
  host.innerHTML = html;
  mount.append(host);
  document.body.append(mount);
  try {
    await renderMermaid(host);
    if (host.querySelector(".render-error"))
      throw new Error("图表语法错误，请修正后再发布。");
    await waitForImages(host);
    if (host.scrollHeight > 6000)
      throw new Error("单个公式、表格或图表过长，请拆分为较小的内容块。");
    const { toBlob } = await import("html-to-image");
    const blob = await toBlob(host, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      cacheBust: false,
    });
    if (!blob) throw new Error("图片生成失败");
    return blob;
  } finally {
    mount.remove();
  }
}
type SpecialNode = RootContent & {
  children?: SpecialNode[];
  lang?: string;
  value?: string;
};
export function conversionRanges(markdown: string, snapshot: Snapshot) {
  const channel = channelFor(snapshot.channel);
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown) as Root;
  const ranges: { start: number; end: number; label: string }[] = [];
  const visit = (node: SpecialNode) => {
    const label =
      (node.type === "math" || node.type === "inlineMath") && !channel.math
        ? "公式"
        : node.type === "code" && node.lang === "mermaid" && !channel.mermaid
          ? "Mermaid 图表"
          : node.type === "table" && !channel.tables
            ? "表格"
            : undefined;
    if (
      label &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      ranges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        label,
      });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of tree.children) visit(node as SpecialNode);
  return ranges;
}
export async function prepareContent(
  snapshot: Snapshot,
  database: WorkbenchDB = db,
  makeImage = rasterize,
): Promise<PreparedContent> {
  let markdown = snapshot.markdown;
  const warnings: string[] = [];
  const generated: WireAsset[] = [];
  for (const range of conversionRanges(markdown, snapshot).sort(
    (a, b) => b.start - a.start,
  )) {
    const segment = markdown.slice(range.start, range.end);
    const html = await renderMarkdown(segment);
    const asset = await addAsset(
      new File([await makeImage(html)], `${range.label}.png`, {
        type: "image/png",
      }),
      database,
    );
    generated.push(await wireAsset(asset));
    markdown =
      markdown.slice(0, range.start) +
      `![${range.label}](asset://${asset.id})` +
      markdown.slice(range.end);
    warnings.unshift(`${range.label}将以图片发布，原始源码仍保留在稿件中。`);
  }
  const ids = [
    ...new Set([
      ...assetIdsIn(markdown),
      ...snapshot.imageIds,
      ...(snapshot.metadata.coverId ? [snapshot.metadata.coverId] : []),
    ]),
  ];
  const assets: WireAsset[] = [];
  for (const id of ids) {
    const asset = await database.assets.get(id);
    if (!asset) throw new Error("有图片缺失，请补齐素材再发布。");
    assets.push(await wireAsset(asset));
  }
  const urls = new Map(assets.map((a) => [a.id, a.dataUrl]));
  if (
    snapshot.channel.startsWith("xiaohongshu:") &&
    assets.some((a) => a.type === "image/gif")
  )
    throw new Error(
      "小红书网页上传不支持 GIF，请改用 PNG、JPEG 或 WebP 素材。",
    );
  let html = await renderMarkdown(markdown, urls);
  if (/<img[^>]+src="https?:/i.test(html))
    throw new Error(
      "稿件包含外链图片，请先导入图片并替换引用，避免发布后失效。",
    );
  const element = document.createElement("div");
  element.innerHTML = html;
  const text = element.textContent ?? "";
  return { markdown, html, text, assets, warnings: [...new Set(warnings)] };
}
export function preflight(
  snapshot: Snapshot,
  mode: "draft" | "publish",
): string[] {
  const errors: string[] = [];
  const channel = channelFor(snapshot.channel);
  if (!snapshot.title.trim()) errors.push("请填写标题");
  const titleLength = Array.from(snapshot.title.trim()).length;
  if (snapshot.channel === "xiaohongshu:article" && titleLength > 64)
    errors.push("小红书长文标题不能超过 64 个字符");
  if (
    snapshot.channel === "csdn:article" &&
    (titleLength < 5 || titleLength > 100)
  )
    errors.push("CSDN 标题需要 5 至 100 个字符");
  if (!snapshot.markdown.trim() && !snapshot.imageIds.length)
    errors.push("请填写正文或添加图片");
  if (
    snapshot.metadata.coverId &&
    !/^[a-f0-9]{64}$/.test(snapshot.metadata.coverId)
  )
    errors.push("封面图片引用不合法");
  if (mode === "publish")
    for (const field of channel.required) {
      if (field === "tags" && !snapshot.metadata.tags.length)
        errors.push("请填写标签");
      if (field === "category" && !snapshot.metadata.category.trim())
        errors.push("请填写分类");
      if (field === "images" && !snapshot.imageIds.length)
        errors.push("图文笔记至少需要一张配图");
    }
  return errors;
}
