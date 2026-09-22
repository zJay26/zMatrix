import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { db, changed, type WorkbenchDB } from "./db";
import { addAsset, assetIdsIn } from "./assets";
import { newArticle } from "./variants";
import type { Article } from "./model";

interface LinkNode {
  type: string;
  identifier?: string;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: LinkNode[];
}
export function walk(node: LinkNode, fn: (node: LinkNode) => void) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}
export function normalizePath(path: string): string {
  const result: string[] = [];
  for (const p of path.replaceAll("\\", "/").split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!result.length) throw new Error("图片引用超出导入目录。");
      result.pop();
    } else result.push(p);
  }
  return result.join("/");
}
export async function importMarkdownFiles(
  files: File[],
  database: WorkbenchDB = db,
): Promise<Article[]> {
  const markdownFiles = files.filter((f) =>
    /\.(?:md|mdown|markdown)$/i.test(f.name),
  );
  if (!markdownFiles.length)
    throw new Error("请选择 Markdown 文件，或包含 Markdown 和图片的文件夹。");
  const articles: Article[] = [];
  const indexed = files.map((file) => ({
    file,
    path: normalizePath(file.webkitRelativePath || file.name),
  }));
  for (const file of markdownFiles) {
    let markdown = await file.text();
    if (markdown.length > 2_000_000)
      throw new Error("单篇 Markdown 内容过大。");
    const filePath = normalizePath(file.webkitRelativePath || file.name);
    const base = filePath.split("/").slice(0, -1).join("/");
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(markdown) as LinkNode;
    const references: LinkNode[] = [];
    const imageReferences = new Set<string>();
    walk(tree, (n) => {
      if (n.type === "imageReference" && n.identifier)
        imageReferences.add(n.identifier);
    });
    walk(tree, (n) => {
      if (
        (n.type === "image" ||
          (n.type === "definition" &&
            imageReferences.has(n.identifier ?? ""))) &&
        n.url &&
        !/^(?:https?:|data:|asset:)/i.test(n.url)
      )
        references.push(n);
    });
    const replacements: { start: number; end: number; text: string }[] = [];
    for (const ref of references) {
      const decoded = decodeURIComponent(ref.url!);
      const target = normalizePath([base, decoded].filter(Boolean).join("/"));
      let matches = indexed.filter((x) => x.path === target);
      if (!matches.length)
        matches = indexed.filter((x) => x.path === normalizePath(decoded));
      if (matches.length !== 1)
        throw new Error(
          `找不到配套图片「${decoded}」。请连同图片文件夹一起导入。`,
        );
      const asset = await addAsset(matches[0]!.file, database);
      const start = ref.position?.start.offset;
      const end = ref.position?.end.offset;
      if (start === undefined || end === undefined)
        throw new Error("无法定位图片引用。");
      const original = markdown.slice(start, end);
      const encoded = original.includes(ref.url!) ? ref.url! : decoded;
      const offset = original.lastIndexOf(encoded);
      if (offset < 0) throw new Error(`无法解析图片引用：${decoded}`);
      replacements.push({
        start: start + offset,
        end: start + offset + encoded.length,
        text: `asset://${asset.id}`,
      });
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start))
      markdown =
        markdown.slice(0, replacement.start) +
        replacement.text +
        markdown.slice(replacement.end);
    const article = newArticle(
      markdown.match(/^#\s+(.+)$/m)?.[1] ??
        file.name.replace(/\.(?:md|mdown|markdown)$/i, ""),
      markdown,
    );
    article.imageIds = assetIdsIn(markdown);
    articles.push(article);
  }
  await database.articles.bulkAdd(articles);
  await changed(database);
  return articles;
}
