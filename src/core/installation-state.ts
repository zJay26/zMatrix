import { db, getMeta, INSTALL_KEY } from "./db";
import { canRemoveTask } from "./tasks";
import { safeUpdatePath } from "./update-package";
import { sha256 } from "./variants";

export const INSTALL_DIRECTORY = "extensionDirectory";
export const INSTALL_RESULT = "extensionUpdateResult";
export const INSTALL_LOCK = "zmatrix-install-extension";
export type InstallStage =
  "downloading" | "backup" | "writing" | "ready" | "recovery";
export interface Installation {
  id: string;
  from: string;
  to: string;
  stage: InstallStage;
  startedAt: number;
  tabId?: number;
  backup?: string;
  rollbackSha?: string;
  modified?: string[];
  created?: string[];
  hashes?: Record<string, string>;
  error?: string;
}
export const installStageNames: Record<InstallStage, string> = {
  downloading: "正在下载并校验更新包",
  backup: "正在备份工作空间和程序",
  writing: "正在安装新版本",
  ready: "安装完成，正在重新加载",
  recovery: "更新未完成，需要恢复",
};
export const getInstallation = (database = db) =>
  getMeta<Installation | null>(INSTALL_KEY, null, database);
export async function beginInstallation(record: Installation, database = db) {
  await database.transaction("rw", database.tables, async () => {
    if (await getInstallation(database))
      throw new Error("有尚未完成的更新，请先恢复。");
    if ((await database.tasks.toArray()).some((task) => !canRemoveTask(task)))
      throw new Error(
        "有发布任务正在执行、等待人工确认或结果待核实，请先到发布队列处理。",
      );
    await database.meta.put({ key: INSTALL_KEY, value: record });
  });
}
export async function patchInstallation(
  id: string,
  patch: Partial<Installation>,
  database = db,
) {
  return database.transaction("rw", database.meta, async () => {
    const record = await getInstallation(database);
    if (!record || record.id !== id)
      throw new Error("更新状态已变化，请重新打开工作台。");
    const next = { ...record, ...patch, id };
    await database.meta.put({ key: INSTALL_KEY, value: next });
    return next;
  });
}
export async function clearInstallation(
  id: string,
  result?: { version: string; backup?: string },
  database = db,
) {
  await database.transaction("rw", database.meta, async () => {
    if ((await getInstallation(database))?.id !== id)
      throw new Error("更新状态已变化。");
    if (result)
      await database.meta.put({
        key: INSTALL_RESULT,
        value: { ...result, at: Date.now() },
      });
    await database.meta.delete(INSTALL_KEY);
  });
}
export async function verifyInstalledResources(
  record: Installation,
  getUrl: (path: string) => string,
  fetcher = fetch,
) {
  if (!record.hashes || !Object.keys(record.hashes).length)
    throw new Error("缺少安装校验记录，请恢复更新。");
  const entries = Object.entries(record.hashes);
  // Bound concurrent file reads while verifying the actual extension origin after reload.
  for (let i = 0; i < entries.length; i += 8)
    await Promise.all(
      entries.slice(i, i + 8).map(async ([path, digest]) => {
        if (!safeUpdatePath(path) || !/^[a-f0-9]{64}$/.test(digest))
          throw new Error("安装记录包含无效文件。");
        const response = await fetcher(getUrl(path), { cache: "no-store" });
        if (
          !response.ok ||
          (await sha256(await response.arrayBuffer())) !== digest
        )
          throw new Error(`更新文件未通过重新加载校验：${path}`);
      }),
    );
}
