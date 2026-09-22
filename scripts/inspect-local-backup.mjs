import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/inspect-local-backup.mjs <exported-zip>",
  );
const root = resolve(import.meta.dirname, "../validation");
await mkdir(root, { recursive: true });
const source = resolve(process.argv[2]);
const bytes = await readFile(source);
const files = unzipSync(bytes);
const data = JSON.parse(strFromU8(files["manifest.json"]));
if (data.format !== "tonggao-backup" || data.version !== 1)
  throw new Error("Unexpected backup format");
const saved = [];
for (const [index, asset] of data.assets.entries()) {
  if (!/^[a-f0-9]{64}$/.test(asset.id)) throw new Error("Invalid asset ID");
  const image = files[`assets/${asset.id}`];
  if (!image || createHash("sha256").update(image).digest("hex") !== asset.id)
    throw new Error("Asset checksum mismatch");
  const ext = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  }[asset.type];
  if (!ext) throw new Error("Unexpected asset type");
  const filename = `exported-card-${index + 1}.${ext}`;
  await writeFile(join(root, filename), image);
  saved.push({
    filename,
    sourceName: asset.name,
    sha256: asset.id,
    bytes: image.length,
  });
}
await copyFile(source, join(root, "local-preview-backup.zip"));
const summary = {
  source,
  createdAt: data.createdAt,
  articles: data.articles.length,
  variants: data.variants.length,
  assets: saved,
  tasks: data.tasks.length,
  posts: data.posts.length,
  backupSha256: createHash("sha256").update(bytes).digest("hex"),
};
await writeFile(
  join(root, "local-preview-backup.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
