import { WorkbenchDB } from "../src/core/db";
import { newArticle, newVariant, freezeSnapshot } from "../src/core/variants";
import type { ChannelId, PreparedContent } from "../src/core/model";
export const database = () => new WorkbenchDB(`test-${crypto.randomUUID()}`);
export const content: PreparedContent = {
  markdown: "正文",
  html: "<p>正文</p>",
  text: "正文",
  assets: [],
  warnings: [],
};
export async function fixture(channel: ChannelId = "csdn:article") {
  const article = newArticle("本地验收稿", "正文");
  const variant = newVariant(article, channel);
  variant.metadata.tags = ["技术"];
  return {
    article,
    variant,
    snapshot: await freezeSnapshot(article, variant),
    prepared: structuredClone(content),
  };
}
export function imageFile(name = "图片.png", path?: string) {
  const file = new File(
    [
      Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      ),
    ],
    name,
    { type: "image/png" },
  );
  if (path) Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}
