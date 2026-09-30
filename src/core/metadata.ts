import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, RootContent } from "mdast";

export function parseTags(value: string): string[] {
  return normalizeTags(value.split(/[,，;；\r\n]+/u));
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// Extract prose locally; headings, images, code blocks and formulas are not a summary.
export function extractSummary(markdown: string, limit = 160): string {
  const source = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
  const root = parser.parse(source) as Root;
  const inlineText = (node: RootContent): string => {
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "break") return " ";
    if ("children" in node) return node.children.map(inlineText).join("");
    return "";
  };
  const paragraphs: string[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === "paragraph") {
      const text = inlineText(node).replace(/\s+/gu, " ").trim();
      if (text) paragraphs.push(text);
    } else if (
      ["root", "blockquote", "list", "listItem"].includes(node.type) &&
      "children" in node
    ) {
      node.children.forEach(visit);
    }
  };
  visit(root);
  const characters = Array.from(paragraphs.slice(0, 2).join(" "));
  if (limit <= 0) return "";
  return characters.length <= limit
    ? characters.join("")
    : characters
        .slice(0, Math.max(0, limit - 1))
        .join("")
        .trimEnd() + "…";
}
