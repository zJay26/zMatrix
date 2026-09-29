import { strToU8 } from "fflate";
import { db, type WorkbenchDB } from "./db";
import { assetIdsIn } from "./assets";
import { zipFiles } from "./archive";
import { resolveContent } from "./variants";
import type { Asset, Content, Metadata } from "./model";

export function safeFilename(title: string) {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 72)
    .replace(/[. ]+$/g, "");
  return !name
    ? "未命名稿件"
    : /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
      ? `_${name}`
      : name;
}
interface ExportDocument {
  path: string;
  content: Content;
  metadata?: Metadata;
}
const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function pack(documents: ExportDocument[], assets: Asset[]) {
  const files: Record<string, Uint8Array> = {};
  const available = new Map(assets.map((a) => [a.id, a]));
  for (const doc of documents) {
    const ids = [
      ...new Set([
        ...assetIdsIn(doc.content.markdown),
        ...doc.content.imageIds,
        ...(doc.metadata?.coverId ? [doc.metadata.coverId] : []),
      ]),
    ];
    const paths = new Map<string, string>();
    for (const id of ids) {
      const asset = available.get(id);
      if (!asset)
        throw new Error(
          `稿件「${doc.content.title || "未命名稿件"}」缺少图片，请先恢复素材后再导出。`,
        );
      const path = `images/${id}.${extensions[asset.type] ?? "png"}`;
      paths.set(id, path);
      const fullPath = `${doc.path}/${path}`;
      if (!files[fullPath])
        files[fullPath] = new Uint8Array(await asset.blob.arrayBuffer());
    }
    files[`${doc.path}/正文.md`] = strToU8(
      doc.content.markdown.replace(
        /asset:\/\/([a-f0-9]{64})/g,
        (_, id: string) => paths.get(id)!,
      ),
    );
    files[`${doc.path}/稿件信息.json`] = strToU8(
      JSON.stringify(
        {
          title: doc.content.title,
          imagePaths: doc.content.imageIds.map((id) => paths.get(id)),
          ...(doc.metadata
            ? {
                metadata: {
                  ...doc.metadata,
                  coverId: undefined,
                  coverPath: doc.metadata.coverId
                    ? paths.get(doc.metadata.coverId)
                    : undefined,
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
  }
  files["使用说明.txt"] = strToU8(
    "每个版本包含正文.md、稿件信息.json 与 images 图片目录。解压后可在任意 Markdown 编辑器打开，或将版本文件夹导入 zMatrix。标题、配图顺序及平台设置保存在稿件信息.json，重新导入 Markdown 时不会自动恢复这些设置。此文件为内容导出；完整工作空间恢复请使用“平台与备份”中的 ZIP 备份。\n",
  );
  return zipFiles(files);
}
async function collectAssets(
  documents: ExportDocument[],
  database: WorkbenchDB,
) {
  const ids = [
    ...new Set(
      documents.flatMap((d) => [
        ...assetIdsIn(d.content.markdown),
        ...d.content.imageIds,
        ...(d.metadata?.coverId ? [d.metadata.coverId] : []),
      ]),
    ),
  ];
  return (await database.assets.bulkGet(ids)).filter((a): a is Asset => !!a);
}
export async function exportCurrentContent(
  content: Content,
  metadata?: Metadata,
  database: WorkbenchDB = db,
) {
  const documents = [{ path: safeFilename(content.title), content, metadata }];
  return pack(documents, await collectAssets(documents, database));
}
export async function exportArticles(
  ids: string[],
  database: WorkbenchDB = db,
) {
  const { documents, assets } = await database.transaction(
    "r",
    database.articles,
    database.variants,
    database.assets,
    async () => {
      const documents: ExportDocument[] = [];
      for (const id of new Set(ids)) {
        const article = await database.articles.get(id);
        if (!article) throw new Error("部分稿件已不存在，请刷新内容库后重试。");
        const root = `${safeFilename(article.title)}-${article.id.slice(0, 8)}`;
        documents.push({ path: `${root}/母稿`, content: article });
        for (const variant of await database.variants
          .where("articleId")
          .equals(id)
          .toArray())
          documents.push({
            path: `${root}/${variant.channel.replace(":", "-")}`,
            content: resolveContent(article, variant),
            metadata: variant.metadata,
          });
      }
      if (!documents.length) throw new Error("请先选择需要导出的稿件。");
      return { documents, assets: await collectAssets(documents, database) };
    },
  );
  return pack(documents, assets);
}
