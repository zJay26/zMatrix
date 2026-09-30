import { version } from "../../package.json";
import { db } from "./db";
import { exportBackup } from "./backup";
import { sendWorkbenchCommand, RELOAD_EXTENSION } from "./commands";
import { messageOf } from "./model";
import { downloadUpdate, validateUpdatePackage } from "./update-package";
import type { ReleaseInfo } from "./updates";
import { compareVersions } from "./updates";
import {
  applyFileUpdate,
  prepareFileUpdate,
  rollbackFileUpdate,
  verifyUpdateDirectory,
} from "./update-files";
import {
  clearInstallation,
  getInstallation,
  INSTALL_DIRECTORY,
  INSTALL_LOCK,
  patchInstallation,
  type Installation,
} from "./installation-state";

export async function requireDevelopmentInstall() {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime?.id ||
    !window.showDirectoryPicker ||
    !navigator.locks
  )
    throw new Error("请在 Edge 的 zMatrix 扩展中使用安装更新。");
  if (chrome.runtime.getManifest().version !== version)
    throw new Error(RELOAD_EXTENSION);
  if ((await chrome.management.getSelf()).installType !== "development")
    throw new Error("此入口适用于解压安装的扩展，商店安装版请由浏览器更新。");
}
export async function chooseInstallationDirectory() {
  // The picker must be called directly from the user gesture, before asynchronous work.
  const handle = await window.showDirectoryPicker({
    id: "zmatrix-install",
    mode: "readwrite",
  });
  await requireDevelopmentInstall();
  await verifyUpdateDirectory(handle, chrome.runtime.getManifest(), (path) =>
    chrome.runtime.getURL(path),
  );
  await db.meta.put({ key: INSTALL_DIRECTORY, value: handle });
  return handle;
}
async function exclusive<T>(action: () => Promise<T>) {
  return navigator.locks.request(
    INSTALL_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("另一个窗口正在更新，请等待完成。");
      return action();
    },
  );
}
export async function installRelease(
  release: ReleaseInfo,
  root: FileSystemDirectoryHandle,
) {
  if ((await root.requestPermission({ mode: "readwrite" })) !== "granted")
    throw new Error("请授权更新目录后重试。");
  await requireDevelopmentInstall();
  return exclusive(async () => {
    if (compareVersions(release.version, version) <= 0)
      throw new Error("该版本无需安装，请重新检查更新。");
    await verifyUpdateDirectory(root, chrome.runtime.getManifest(), (path) =>
      chrome.runtime.getURL(path),
    );
    const id = crypto.randomUUID();
    await sendWorkbenchCommand({
      type: "beginUpdate",
      id,
      version: release.version,
      currentVersion: version,
    });
    let touchedFiles = false;
    try {
      const bytes = await downloadUpdate(release);
      const { files, manifest } = await validateUpdatePackage(
        bytes,
        release,
        chrome.runtime.getManifest(),
      );
      const browserMajor = Number(
        navigator.userAgent.match(/(?:Edg|Chrome)\/(\d+)/)?.[1],
      );
      if (
        !browserMajor ||
        browserMajor <
          Number(manifest.minimum_chrome_version?.split(".")[0] ?? 0)
      )
        throw new Error("请先升级 Edge 浏览器，再安装这个版本。");
      let record = await patchInstallation(id, { stage: "backup" });
      record = await prepareFileUpdate(
        root,
        record,
        files,
        await exportBackup(),
      );
      await patchInstallation(id, { ...record, stage: "writing" });
      touchedFiles = true;
      await applyFileUpdate(root, files);
      await patchInstallation(id, { stage: "ready" });
      await sendWorkbenchCommand({ type: "finishUpdate", id });
    } catch (error) {
      const record = await getInstallation();
      if (record?.id !== id) throw error;
      if (record.stage === "ready") {
        await patchInstallation(id, {
          error: "文件已经安装，请点击重新加载完成更新。",
        });
        throw error;
      }
      if (touchedFiles) {
        try {
          await rollbackFileUpdate(root, record);
        } catch (rollbackError) {
          await patchInstallation(id, {
            stage: "recovery",
            error: `${messageOf(error)} 恢复尚未完成：${messageOf(rollbackError)}`,
          });
          throw new Error(
            "更新中断，请通过恢复入口恢复上一版程序；工作空间备份已保留。",
          );
        }
      }
      await clearInstallation(id);
      throw new Error(
        `${messageOf(error)}${touchedFiles ? " 已恢复原程序文件。" : " 原程序文件未替换。"}`,
      );
    }
  });
}
export async function recoverInstallation(
  record: Installation,
  root?: FileSystemDirectoryHandle,
) {
  if (
    ["writing", "recovery"].includes(record.stage) &&
    chrome.runtime.getManifest().version !== record.to
  ) {
    if (
      !root ||
      (await root.requestPermission({ mode: "readwrite" })) !== "granted"
    )
      throw new Error("请授权原更新目录以恢复程序。");
  }
  return exclusive(async () => {
    const latest = await getInstallation();
    if (!latest || latest.id !== record.id)
      throw new Error("更新状态已变化，请刷新页面。");
    if (
      latest.stage === "ready" ||
      chrome.runtime.getManifest().version === latest.to
    ) {
      await sendWorkbenchCommand({ type: "finishUpdate", id: latest.id });
      return;
    }
    if (["writing", "recovery"].includes(latest.stage)) {
      await rollbackFileUpdate(root!, latest);
    }
    await clearInstallation(latest.id);
  });
}
