import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  unlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, relative } from "node:path";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { version } from "../package.json";
import { db, WorkbenchDB, saveArticle, INSTALL_KEY } from "../src/core/db";
import { newArticle } from "../src/core/variants";
import { enqueue, claimTask } from "../src/core/tasks";
import { fixture } from "./helpers";
import {
  downloadUpdate,
  hashUpdateBytes,
  PACKAGE_INDEX,
  safeUpdatePath,
  unpackUpdate,
  validateUpdatePackage,
  type ExtensionManifest,
} from "../src/core/update-package";
import {
  applyFileUpdate,
  prepareFileUpdate,
  readUpdateFile,
  rollbackFileUpdate,
  verifyUpdateDirectory,
} from "../src/core/update-files";
import {
  beginInstallation,
  clearInstallation,
  getInstallation,
  INSTALL_DIRECTORY,
  patchInstallation,
  verifyInstalledResources,
  type Installation,
} from "../src/core/installation-state";
import {
  installRelease,
  recoverInstallation,
} from "../src/core/update-install";
import type { ReleaseInfo } from "../src/core/updates";

const commands = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/core/commands", () => ({
  sendWorkbenchCommand: commands.send,
  RELOAD_EXTENSION: "reload required",
}));
const current: ExtensionManifest = {
  name: "zMatrix",
  version,
  manifest_version: 3,
  key: "public-test-identity",
  background: { service_worker: "background.js" },
  permissions: ["storage"],
  host_permissions: ["https://api.github.com/*"],
};
const nextVersion = "9.0.0";
const databases: WorkbenchDB[] = [];
const roots: string[] = [];
let rootPath: string;
let directory: FileSystemDirectoryHandle;
let failWrite: ((name: string) => boolean) | undefined;
let writes: string[];
let packageBytes: Uint8Array;
let release: ReleaseInfo;
let newFiles: Record<string, Uint8Array>;
const record = (): Installation => ({
  id: crypto.randomUUID(),
  from: version,
  to: nextVersion,
  stage: "backup",
  startedAt: Date.now(),
});
const notFound = (e: unknown) => {
  if ((e as { code?: string }).code === "ENOENT")
    throw new DOMException("Missing", "NotFoundError");
  throw e;
};

// Uses real temporary Windows files; only the browser handle/permission interface is adapted.
function diskDirectory(path: string): FileSystemDirectoryHandle {
  return {
    name: basename(path),
    kind: "directory",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const child = join(path, name);
      try {
        if (options?.create) await mkdir(child, { recursive: true });
        await stat(child);
      } catch (e) {
        return notFound(e);
      }
      return diskDirectory(child);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const child = join(path, name);
      try {
        await stat(child);
      } catch (e) {
        if (options?.create && (e as { code?: string }).code === "ENOENT")
          await writeFile(child, "");
        else return notFound(e);
      }
      return {
        name,
        kind: "file",
        getFile: async () => new File([await readFile(child)], name),
        async createWritable() {
          let pending: Uint8Array;
          return {
            async write(value: Blob | Uint8Array) {
              pending =
                value instanceof Blob
                  ? new Uint8Array(await value.arrayBuffer())
                  : value;
            },
            async close() {
              const rel = relative(rootPath, child).replaceAll("\\", "/");
              if (failWrite?.(rel))
                throw new DOMException(
                  "Injected write failure",
                  "NotAllowedError",
                );
              await writeFile(child, pending!);
              writes.push(rel);
            },
            async abort() {},
          };
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string) {
      try {
        await unlink(join(path, name));
      } catch (e) {
        notFound(e);
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

async function bundle(
  manifest: ExtensionManifest = { ...current, version: nextVersion },
) {
  const files = {
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "background.js": strToU8("new worker"),
    "workbench.html": strToU8("new workspace"),
    "chunks/new.js": strToU8("new chunk"),
  };
  const index = {
    format: "zmatrix-extension",
    installer: 1,
    version: manifest.version,
    files: Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([name, bytes]) => [
          name,
          { size: bytes.length, sha256: await hashUpdateBytes(bytes) },
        ]),
      ),
    ),
  };
  const all = { ...files, [PACKAGE_INDEX]: strToU8(JSON.stringify(index)) };
  const bytes = zipSync(all);
  const info: ReleaseInfo = {
    version: manifest.version,
    name: "update",
    notes: "",
    url: "https://github.com/zJay26/zMatrix/releases/tag/v9.0.0",
    publishedAt: "2026-09-30",
    prerelease: true,
    assetId: 123,
    size: bytes.length,
    sha256: await hashUpdateBytes(bytes),
  };
  return { files: all, bytes, info };
}
function fetchFromDisk(): typeof fetch {
  return vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).startsWith("https://api.github.com/"))
      return new Response(packageBytes.slice().buffer as ArrayBuffer, {
        headers: { "content-type": "application/octet-stream" },
      });
    const path = new URL(String(url)).pathname.slice(1);
    const bytes = await readUpdateFile(directory, path);
    return new Response(
      bytes ? (bytes.slice().buffer as ArrayBuffer) : "missing",
      { status: bytes ? 200 : 404 },
    );
  });
}
beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), "zmatrix-update-test-"));
  roots.push(rootPath);
  writes = [];
  failWrite = undefined;
  directory = diskDirectory(rootPath);
  await writeFile(join(rootPath, "manifest.json"), JSON.stringify(current));
  await writeFile(join(rootPath, "background.js"), "old worker");
  await writeFile(join(rootPath, "workbench.html"), "old workspace");
  await writeFile(join(rootPath, "personal-note.txt"), "keep me");
  await writeFile(
    join(rootPath, PACKAGE_INDEX),
    JSON.stringify({
      format: "zmatrix-extension",
      version,
      files: { "manifest.json": {}, "background.js": {}, "workbench.html": {} },
    }),
  );
  const generated = await bundle();
  packageBytes = generated.bytes;
  release = generated.info;
  newFiles = generated.files;
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      getManifest: () => current,
      getURL: (name: string) => `chrome-extension://test-extension/${name}`,
    },
    management: { getSelf: async () => ({ installType: "development" }) },
  });
  vi.stubGlobal("fetch", fetchFromDisk());
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    value: vi.fn(async () => directory),
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _: string,
        _options: unknown,
        fn: (lock: object) => unknown,
      ) => fn({}),
    },
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Chrome/156.0.0.0 Edg/156.0.0.0",
  });
  commands.send.mockReset();
  commands.send.mockImplementation(async (request) => {
    if (request.type === "beginUpdate")
      await beginInstallation({
        id: request.id,
        from: request.currentVersion,
        to: request.version,
        stage: "downloading",
        startedAt: Date.now(),
      });
    return { ok: true };
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(db.tables.map((table) => table.clear()));
  await Promise.all(databases.splice(0).map((entry) => entry.delete()));
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("更新来源与文件校验", () => {
  it("通过 GitHub 附件 API 下载，并核对包和全部文件", async () => {
    const fetcher = fetchFromDisk();
    const bytes = await downloadUpdate(release, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/zJay26/zMatrix/releases/assets/123",
      expect.objectContaining({
        credentials: "omit",
        headers: { Accept: "application/octet-stream" },
      }),
    );
    expect(
      (await validateUpdatePackage(bytes, release, current)).manifest.version,
    ).toBe(nextVersion);
  });
  it("拒绝损坏包、不完整下载和缺少校验信息的发布", async () => {
    await expect(
      validateUpdatePackage(
        packageBytes,
        { ...release, sha256: "0".repeat(64) },
        current,
      ),
    ).rejects.toThrow("校验失败");
    await expect(
      validateUpdatePackage(packageBytes, { ...release, size: 1 }, current),
    ).rejects.toThrow("未完整");
    await expect(
      downloadUpdate({ ...release, sha256: undefined }),
    ).rejects.toThrow("手动更新");
  });
  it("文件内部损坏即使外层包哈希匹配也不安装", async () => {
    const changed = { ...newFiles, "background.js": strToU8("changed") };
    const bytes = zipSync(changed);
    await expect(
      validateUpdatePackage(
        bytes,
        {
          ...release,
          size: bytes.length,
          sha256: await hashUpdateBytes(bytes),
        },
        current,
      ),
    ).rejects.toThrow("文件校验失败");
  });
  it.each([
    "../outside",
    "/absolute",
    "foo\\bar",
    "a/../../b",
    "manifest.json:stream",
    "NUL.txt",
    "dir./x",
    "zmatrix-update-backup/secret",
    ".git/config",
  ])("拒绝不安全路径 %s", (name) => expect(safeUpdatePath(name)).toBe(false));
  it("拒绝 Windows 大小写冲突和额外未列出的文件", async () => {
    expect(() =>
      unpackUpdate(zipSync({ "a.js": strToU8("a"), "A.js": strToU8("b") })),
    ).toThrow("重复");
    const bytes = zipSync({ ...newFiles, "extra.js": strToU8("extra") });
    await expect(
      validateUpdatePackage(
        bytes,
        {
          ...release,
          size: bytes.length,
          sha256: await hashUpdateBytes(bytes),
        },
        current,
      ),
    ).rejects.toThrow("清单");
  });
  it("拒绝更换扩展身份、降级和权限范围变化", async () => {
    for (const manifest of [
      { ...current, version: nextVersion, key: "another-key" },
      { ...current, version: "0.0.1" },
      { ...current, version: nextVersion, host_permissions: ["<all_urls>"] },
    ]) {
      const pkg = await bundle(manifest);
      await expect(
        validateUpdatePackage(pkg.bytes, pkg.info, current),
      ).rejects.toThrow(/身份|版本|权限/);
    }
  });
  it("下载流超出元数据声明时立即停止", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array(2048), {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await expect(
      downloadUpdate({ ...release, size: 20 }, fetcher),
    ).rejects.toThrow("大小");
  });
});

describe("实际文件安装与中断恢复", () => {
  it("新版本文件与用户额外文件重名时不覆盖，缺少清单时要求手动升级", async () => {
    await expect(
      prepareFileUpdate(
        directory,
        record(),
        { ...newFiles, "personal-note.txt": strToU8("replace") },
        new Blob(["backup"]),
      ),
    ).rejects.toThrow("重名");
    expect(await readFile(join(rootPath, "personal-note.txt"), "utf8")).toBe(
      "keep me",
    );
    await unlink(join(rootPath, PACKAGE_INDEX));
    await expect(
      prepareFileUpdate(directory, record(), newFiles, new Blob(["backup"])),
    ).rejects.toThrow("完整 Release");
  });
  it("相同身份的另一份目录不能冒充当前加载目录，验证标记会清理", async () => {
    await verifyUpdateDirectory(
      directory,
      current,
      (path) => `chrome-extension://test-extension/${path}`,
      fetchFromDisk(),
    );
    await expect(
      verifyUpdateDirectory(
        directory,
        current,
        (path) => `chrome-extension://test-extension/${path}`,
        vi.fn().mockResolvedValue(new Response("wrong")),
      ),
    ).rejects.toThrow("当前加载");
    await expect(
      (await import("node:fs/promises"))
        .readdir(rootPath)
        .then((names) =>
          names.some((n) => n.startsWith("zmatrix-directory-check")),
        ),
    ).resolves.toBe(false);
  });
  it("备份落盘后写入全部文件，manifest 最后提交，保留额外文件", async () => {
    const plan = await prepareFileUpdate(
      directory,
      record(),
      newFiles,
      new Blob(["workspace backup"]),
    );
    expect(strFromU8((await readUpdateFile(directory, "background.js"))!)).toBe(
      "old worker",
    );
    await applyFileUpdate(directory, newFiles);
    expect(writes.at(-1)).toBe("manifest.json");
    expect(await readFile(join(rootPath, "personal-note.txt"), "utf8")).toBe(
      "keep me",
    );
    expect(
      (
        await readFile(
          join(
            rootPath,
            "zmatrix-update-backup",
            plan.backup!,
            "workspace.zip",
          ),
        )
      ).toString(),
    ).toBe("workspace backup");
    await verifyInstalledResources(
      plan,
      (path) => `chrome-extension://test-extension/${path}`,
      fetchFromDisk(),
    );
  });
  it("中断后从持久备份恢复覆盖文件并移除新文件，其他文件保留", async () => {
    const plan = await prepareFileUpdate(
      directory,
      record(),
      newFiles,
      new Blob(["workspace"]),
    );
    failWrite = (name) => name === "manifest.json";
    await expect(applyFileUpdate(directory, newFiles)).rejects.toThrow(
      "Injected",
    );
    failWrite = undefined;
    await rollbackFileUpdate(
      diskDirectory(rootPath),
      JSON.parse(JSON.stringify(plan)),
    );
    expect(await readFile(join(rootPath, "background.js"), "utf8")).toBe(
      "old worker",
    );
    expect(await readUpdateFile(directory, "chunks/new.js")).toBeUndefined();
    expect(
      JSON.parse(await readFile(join(rootPath, "manifest.json"), "utf8"))
        .version,
    ).toBe(version);
    expect(await readFile(join(rootPath, "personal-note.txt"), "utf8")).toBe(
      "keep me",
    );
  });
  it("损坏恢复包不会覆盖程序，加载后的文件不匹配也不会确认成功", async () => {
    const plan = await prepareFileUpdate(
      directory,
      record(),
      newFiles,
      new Blob(["workspace"]),
    );
    await writeFile(
      join(rootPath, "zmatrix-update-backup", plan.backup!, "program.zip"),
      "broken",
    );
    await expect(rollbackFileUpdate(directory, plan)).rejects.toThrow(
      "备份校验失败",
    );
    await expect(
      verifyInstalledResources(
        plan,
        (path) => `chrome-extension://test-extension/${path}`,
        fetchFromDisk(),
      ),
    ).rejects.toThrow("校验");
  });
});

describe("点击更新与工作空间保护", () => {
  it("点击更新完成下载、数据备份、写入和重载请求，保存原有数据", async () => {
    const article = newArticle("原有稿件", "不要丢失");
    await saveArticle(article);
    await installRelease(release, directory);
    const pending = await getInstallation();
    expect(pending?.stage).toBe("ready");
    expect(commands.send).toHaveBeenLastCalledWith({
      type: "finishUpdate",
      id: pending!.id,
    });
    expect(await db.articles.get(article.id)).toEqual(article);
    expect(await readFile(join(rootPath, "background.js"), "utf8")).toBe(
      "new worker",
    );
    expect(
      (
        await readFile(
          join(
            rootPath,
            "zmatrix-update-backup",
            pending!.backup!,
            "workspace.zip",
          ),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it("写入失败自动恢复原程序并解除更新状态", async () => {
    let once = true;
    failWrite = (name) =>
      name === "workbench.html" && once && ((once = false), true);
    await expect(installRelease(release, directory)).rejects.toThrow("已恢复");
    expect(await getInstallation()).toBeNull();
    expect(await readFile(join(rootPath, "background.js"), "utf8")).toBe(
      "old worker",
    );
    expect(commands.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "finishUpdate" }),
    );
  });
  it("恢复也失败时持久保留恢复入口，授权恢复后可以继续工作", async () => {
    failWrite = (name) => name === "workbench.html";
    await expect(installRelease(release, directory)).rejects.toThrow(
      "恢复入口",
    );
    expect((await getInstallation())?.stage).toBe("recovery");
    failWrite = undefined;
    await recoverInstallation((await getInstallation())!, directory);
    expect(await getInstallation()).toBeNull();
    expect(await readFile(join(rootPath, "background.js"), "utf8")).toBe(
      "old worker",
    );
  });
  it("权限拒绝或另一个更新持锁时不改文件", async () => {
    await expect(
      installRelease(release, {
        ...directory,
        requestPermission: async () => "denied",
      } as FileSystemDirectoryHandle),
    ).rejects.toThrow("授权");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _: string,
          _opts: unknown,
          fn: (lock: null) => unknown,
        ) => fn(null),
      },
    });
    await expect(installRelease(release, directory)).rejects.toThrow(
      "另一个窗口",
    );
    expect(writes).toEqual([]);
  });
  it("活动或待确认任务阻止更新，等待执行任务保留且不能抢占更新", async () => {
    const database = new WorkbenchDB(`install-gate-${crypto.randomUUID()}`);
    databases.push(database);
    const item = await fixture("zhihu:article", database);
    const [task] = await enqueue([item], "draft", database);
    await database.tasks.update(task!.id, {
      state: "awaiting_publish",
      tabId: 9,
    });
    await expect(beginInstallation(record(), database)).rejects.toThrow(
      "发布任务",
    );
    await database.tasks.update(task!.id, {
      state: "queued",
      tabId: undefined,
    });
    const installation = record();
    await beginInstallation(installation, database);
    await expect(claimTask(task!.id, "worker", database)).rejects.toThrow(
      "正在更新",
    );
    expect((await database.tasks.get(task!.id))?.state).toBe("queued");
    await expect(
      saveArticle(newArticle("新的编辑", ""), database),
    ).rejects.toThrow("正在更新");
    expect(await database.articles.count()).toBe(1);
    await clearInstallation(installation.id, undefined, database);
    expect((await claimTask(task!.id, "worker", database))?.state).toBe(
      "preparing",
    );
  });
  it("中断在下载或备份阶段可以取消，完成文件写入后只请求重载", async () => {
    let installation = record();
    await beginInstallation(installation);
    await recoverInstallation(installation);
    expect(await getInstallation()).toBeNull();
    installation = { ...record(), stage: "ready" };
    await beginInstallation(installation);
    await recoverInstallation(installation);
    expect(commands.send).toHaveBeenLastCalledWith({
      type: "finishUpdate",
      id: installation.id,
    });
  });
});
