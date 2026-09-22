import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

// Backups are files supplied by the user, not trusted executable content.
const safeHtml = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    ...defaultSchema,
    protocols: { ...defaultSchema.protocols, src: ["data", "asset"] },
  })
  .use(rehypeStringify);
export async function sanitizePreparedHtml(html: string) {
  return String(await safeHtml.process(html));
}
