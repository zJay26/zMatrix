import { db, changed, type WorkbenchDB } from "./db";
import { sha256 } from "./variants";
import type { Asset, WireAsset } from "./model";
const mimeByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export async function prepareAsset(
  file: Blob & { name?: string },
): Promise<Asset> {
  const type =
    file.type ||
    mimeByExtension[(file.name ?? "").split(".").pop()?.toLowerCase() ?? ""];
  if (!type || !Object.values(mimeByExtension).includes(type))
    throw new Error("图片只支持 PNG、JPEG、WebP 和 GIF。");
  if (file.size > 30 * 1024 * 1024) throw new Error("单张图片不能超过 30 MB。");
  const bytes = await file.arrayBuffer();
  const id = await sha256(bytes);
  return {
    id,
    name: file.name ?? `${id.slice(0, 12)}.png`,
    type,
    blob: new Blob([bytes], { type }),
    createdAt: Date.now(),
  };
}
export async function addAsset(
  file: Blob & { name?: string },
  database: WorkbenchDB = db,
): Promise<Asset> {
  const asset = await prepareAsset(file);
  return database.transaction(
    "rw",
    database.assets,
    database.meta,
    async () => {
      const existing = await database.assets.get(asset.id);
      if (existing) return existing;
      await database.assets.add(asset);
      await changed(database);
      return asset;
    },
  );
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}
export async function wireAsset(asset: Asset): Promise<WireAsset> {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    dataUrl: await blobDataUrl(asset.blob),
  };
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const assetIdsIn = (markdown: string) => [
  ...new Set(
    [...markdown.matchAll(/asset:\/\/([a-f0-9]{64})/g)].map((m) => m[1]!),
  ),
];
