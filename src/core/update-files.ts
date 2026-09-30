import { strToU8, unzipSync } from "fflate";
import { zipFiles } from "./archive";
import {
  BACKUP_FOLDER,
  safeUpdatePath,
  hashUpdateBytes,
  PACKAGE_INDEX,
  type ExtensionManifest,
} from "./update-package";
import { sha256 } from "./variants";
import type { Installation } from "./installation-state";

const missing = (error: unknown) =>
  error instanceof DOMException && error.name === "NotFoundError";
async function fileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
) {
  if (!safeUpdatePath(path)) throw new Error("文件路径无效。");
  const parts = path.split("/");
  let directory = root;
  for (const part of parts.slice(0, -1))
    directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(parts.at(-1)!, { create });
}
export async function readUpdateFile(
  root: FileSystemDirectoryHandle,
  path: string,
) {
  try {
    return new Uint8Array(
      await (await (await fileHandle(root, path)).getFile()).arrayBuffer(),
    );
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
export async function writeUpdateFile(
  root: FileSystemDirectoryHandle,
  path: string,
  bytes: Uint8Array | Blob,
) {
  const file = await fileHandle(root, path, true);
  const writer = await file.createWritable();
  try {
    await writer.write(
      bytes instanceof Blob ? bytes : (bytes as Uint8Array<ArrayBuffer>),
    );
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  const saved = await file.getFile();
  const expected =
    bytes instanceof Blob
      ? await bytes.arrayBuffer()
      : (bytes.slice().buffer as ArrayBuffer);
  if ((await sha256(await saved.arrayBuffer())) !== (await sha256(expected)))
    throw new Error(`文件写入校验失败：${path}`);
}
async function removeUpdateFile(root: FileSystemDirectoryHandle, path: string) {
  if (!safeUpdatePath(path)) throw new Error("文件路径无效。");
  const parts = path.split("/");
  let directory = root;
  try {
    for (const part of parts.slice(0, -1))
      directory = await directory.getDirectoryHandle(part);
    await directory.removeEntry(parts.at(-1)!);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

export async function verifyUpdateDirectory(
  root: FileSystemDirectoryHandle,
  current: ExtensionManifest,
  getUrl: (path: string) => string,
  fetcher = fetch,
) {
  const bytes = await readUpdateFile(root, "manifest.json");
  if (!bytes) throw new Error("请选择包含 manifest.json 的 zMatrix 安装目录。");
  const manifest = JSON.parse(
    new TextDecoder().decode(bytes),
  ) as ExtensionManifest;
  if (
    !current.key ||
    manifest.key !== current.key ||
    manifest.version !== current.version
  )
    throw new Error("目录中的扩展身份或版本与当前工作台不一致。");
  // Equal manifests can belong to different copies. Prove this is the loaded directory.
  const name = `zmatrix-directory-check-${crypto.randomUUID()}.txt`;
  const proof = crypto.randomUUID();
  await writeUpdateFile(root, name, strToU8(proof));
  try {
    const response = await fetcher(getUrl(name), { cache: "no-store" });
    if (!response.ok || (await response.text()) !== proof)
      throw new Error(
        "所选文件夹不是 Edge 当前加载的目录，请在扩展详情中核对路径。",
      );
  } finally {
    await removeUpdateFile(root, name);
  }
}

async function backupDirectory(
  root: FileSystemDirectoryHandle,
  name: string,
  create = false,
) {
  if (!/^update-[a-f0-9-]{36}$/.test(name))
    throw new Error("备份目录记录无效。");
  return (
    await root.getDirectoryHandle(BACKUP_FOLDER, { create })
  ).getDirectoryHandle(name, { create });
}

export async function prepareFileUpdate(
  root: FileSystemDirectoryHandle,
  record: Installation,
  files: Record<string, Uint8Array>,
  workspace: Blob,
) {
  const previous: Record<string, Uint8Array> = {};
  const created: string[] = [];
  const names = Object.keys(files);
  const indexBytes = await readUpdateFile(root, PACKAGE_INDEX);
  if (!indexBytes)
    throw new Error(
      "安装目录缺少文件清单，请先使用完整 Release 包手动更新一次。",
    );
  const index = JSON.parse(new TextDecoder().decode(indexBytes));
  if (
    index.format !== "zmatrix-extension" ||
    index.version !== record.from ||
    !index.files ||
    typeof index.files !== "object"
  )
    throw new Error("原程序文件清单与当前版本不一致。");
  const owned = new Set([...Object.keys(index.files), PACKAGE_INDEX]);
  for (const name of names) {
    const existing = await readUpdateFile(root, name);
    if (existing) {
      if (!owned.has(name))
        throw new Error(`更新文件与目录中的其他文件重名，已停止：${name}`);
      previous[name] = existing;
    } else created.push(name);
  }
  if (!previous["manifest.json"])
    throw new Error("原安装目录缺少 manifest.json。");
  const oldManifest = JSON.parse(
    new TextDecoder().decode(previous["manifest.json"]),
  );
  const targetManifest = JSON.parse(
    new TextDecoder().decode(files["manifest.json"]),
  );
  if (
    oldManifest.version !== record.from ||
    oldManifest.key !== targetManifest.key
  )
    throw new Error("安装目录在下载期间已变化，请重新打开扩展。");
  const backup = `update-${record.id}`;
  const directory = await backupDirectory(root, backup, true);
  const program = await zipFiles(previous);
  await writeUpdateFile(directory, "program.zip", program);
  await writeUpdateFile(directory, "workspace.zip", workspace);
  const hashes = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await hashUpdateBytes(files[name]!)]),
    ),
  );
  const next = {
    ...record,
    backup,
    rollbackSha: await sha256(await program.arrayBuffer()),
    modified: names,
    created,
    hashes,
  };
  await writeUpdateFile(
    directory,
    "recovery.json",
    strToU8(JSON.stringify(next, null, 2)),
  );
  return next;
}
export async function applyFileUpdate(
  root: FileSystemDirectoryHandle,
  files: Record<string, Uint8Array>,
) {
  // Keep the current manifest until every other file has been durably written.
  for (const name of Object.keys(files).filter(
    (name) => name !== "manifest.json",
  ))
    await writeUpdateFile(root, name, files[name]!);
  await writeUpdateFile(root, "manifest.json", files["manifest.json"]!);
}
export async function rollbackFileUpdate(
  root: FileSystemDirectoryHandle,
  record: Installation,
) {
  if (
    !record.backup ||
    !record.rollbackSha ||
    !record.modified ||
    !record.created
  )
    throw new Error("缺少恢复记录。请使用安装目录中的程序备份恢复。");
  const directory = await backupDirectory(root, record.backup);
  const program = await readUpdateFile(directory, "program.zip");
  if (!program || (await hashUpdateBytes(program)) !== record.rollbackSha)
    throw new Error("程序备份校验失败，已停止恢复。");
  const files = unzipSync(program);
  const created = new Set(record.created);
  if (
    record.modified.some((name) => !safeUpdatePath(name)) ||
    record.created.some((name) => !record.modified!.includes(name)) ||
    Object.keys(files).some((name) => !record.modified!.includes(name)) ||
    record.modified.some((name) => !created.has(name) && !files[name]) ||
    !files["manifest.json"] ||
    created.has("manifest.json")
  )
    throw new Error("恢复文件清单无效。");
  const currentBytes = await readUpdateFile(root, "manifest.json");
  if (
    !currentBytes ||
    JSON.parse(new TextDecoder().decode(currentBytes)).key !==
      JSON.parse(new TextDecoder().decode(files["manifest.json"])).key
  )
    throw new Error("当前目录的扩展身份已变化，已停止恢复。");
  for (const name of record.modified.filter(
    (name) => name !== "manifest.json",
  )) {
    if (created.has(name)) await removeUpdateFile(root, name);
    else await writeUpdateFile(root, name, files[name]!);
  }
  await writeUpdateFile(root, "manifest.json", files["manifest.json"]!);
}
