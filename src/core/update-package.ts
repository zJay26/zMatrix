import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import { sha256 } from "./variants";
import { compareVersions, type ReleaseInfo } from "./updates";

export const PACKAGE_INDEX = "zmatrix-package.json";
export const BACKUP_FOLDER = "zmatrix-update-backup";
const MAX_ZIP = 32 * 1024 * 1024;
const MAX_CONTENTS = 128 * 1024 * 1024;
const indexSchema = z.object({
  format: z.literal("zmatrix-extension"),
  installer: z.literal(1),
  version: z.string(),
  files: z.record(
    z.string(),
    z.object({
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type ExtensionManifest = chrome.runtime.Manifest & { key?: string };
export const hashUpdateBytes = (bytes: Uint8Array) =>
  sha256(bytes.slice().buffer as ArrayBuffer);

export function safeUpdatePath(path: string) {
  if (path.length > 240 || !path || /[\\\x00-\x1f<>:"|?*]/.test(path))
    return false;
  return path
    .split("/")
    .every(
      (part) =>
        !!part &&
        part !== "." &&
        part !== ".." &&
        !/[. ]$/.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
        ![BACKUP_FOLDER, ".git", "node_modules"].includes(part.toLowerCase()),
    );
}

export function unpackUpdate(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_ZIP)
    throw new Error("更新包大小超出限制。");
  let total = 0;
  const names = new Set<string>();
  return unzipSync(bytes, {
    filter(entry) {
      if (entry.name.endsWith("/")) return false;
      if (!safeUpdatePath(entry.name) || names.has(entry.name.toLowerCase()))
        throw new Error("更新包含不安全或重复的文件路径。");
      names.add(entry.name.toLowerCase());
      total += entry.originalSize;
      if (names.size > 2048 || total > MAX_CONTENTS)
        throw new Error("更新包解压大小超出限制。");
      return true;
    },
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical).sort());
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      ),
    );
  return JSON.stringify(value ?? null);
}

export async function validateUpdatePackage(
  bytes: Uint8Array,
  release: ReleaseInfo,
  current: ExtensionManifest,
) {
  if (!release.sha256 || (await hashUpdateBytes(bytes)) !== release.sha256)
    throw new Error("安装包校验失败，请重新检查更新。");
  if (release.size !== bytes.length) throw new Error("安装包未完整下载。");
  const files = unpackUpdate(bytes);
  const index = indexSchema.parse(
    JSON.parse(strFromU8(files[PACKAGE_INDEX] ?? new Uint8Array())),
  );
  if (index.version !== release.version)
    throw new Error("更新文件清单的版本不匹配。");
  const names = Object.keys(files).filter((name) => name !== PACKAGE_INDEX);
  if (canonical(names) !== canonical(Object.keys(index.files)))
    throw new Error("更新包文件清单不完整。");
  for (const name of names) {
    const expected = index.files[name]!;
    if (
      files[name]!.length !== expected.size ||
      (await hashUpdateBytes(files[name]!)) !== expected.sha256
    )
      throw new Error(`更新文件校验失败：${name}`);
  }
  const manifest = JSON.parse(
    strFromU8(files["manifest.json"] ?? new Uint8Array()),
  ) as ExtensionManifest;
  if (
    manifest.manifest_version !== 3 ||
    !current.key ||
    manifest.key !== current.key ||
    manifest.version !== release.version ||
    compareVersions(manifest.version, current.version) <= 0
  )
    throw new Error("更新包身份或版本不匹配，不能安装。");
  for (const field of [
    "permissions",
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "content_security_policy",
    "externally_connectable",
    "web_accessible_resources",
    "content_scripts",
    "chrome_url_overrides",
  ] as const) {
    if (canonical(manifest[field]) !== canonical(current[field]))
      throw new Error("此版本的扩展权限或运行范围发生变化，请使用手动更新。");
  }
  for (const name of ["workbench.html", manifest.background?.service_worker]) {
    if (!name || !files[name]?.length)
      throw new Error("更新包缺少工作台或后台文件。");
  }
  return { files, manifest };
}

export async function downloadUpdate(release: ReleaseInfo, fetcher = fetch) {
  if (
    !release.assetId ||
    !Number.isSafeInteger(release.assetId) ||
    release.assetId < 1 ||
    !release.sha256 ||
    !release.size ||
    release.size > MAX_ZIP
  )
    throw new Error("此版本没有完整的安装校验信息，请使用下载包手动更新。");
  const response = await fetcher(
    `https://api.github.com/repos/zJay26/zMatrix/releases/assets/${release.assetId}`,
    {
      headers: { Accept: "application/octet-stream" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("content-type")?.includes("json")
  )
    throw new Error("更新包下载失败，请稍后重试。");
  if (response.url) {
    const url = new URL(response.url);
    if (
      url.protocol !== "https:" ||
      !["api.github.com", "release-assets.githubusercontent.com"].includes(
        url.hostname,
      )
    )
      throw new Error("下载来源不匹配。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ZIP || size > release.size)
        throw new Error("下载包大小与发布记录不一致。");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
