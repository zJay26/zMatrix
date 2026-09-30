import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { db } from "../core/db";
import {
  INSTALL_DIRECTORY,
  INSTALL_LOCK,
  installStageNames,
  type Installation,
} from "../core/installation-state";
import { recoverInstallation } from "../core/update-install";
import { messageOf } from "../core/model";
import { Modal, Alert } from "./shared";

export function UpdateOverlay({
  installation,
}: {
  installation: Installation | null;
}) {
  const directory = useLiveQuery(() => db.meta.get(INSTALL_DIRECTORY));
  const [held, setHeld] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!installation) return;
    let active = true;
    const check = async () => {
      const locks = await navigator.locks?.query();
      if (active)
        setHeld(!!locks?.held?.some((lock) => lock.name === INSTALL_LOCK));
    };
    void check();
    const timer = setInterval(() => void check(), 1000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (installation.stage !== "ready")
      window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [installation?.id, installation?.stage]);
  if (!installation) return null;
  const reload =
    installation.stage === "ready" ||
    (typeof chrome !== "undefined" &&
      chrome.runtime?.getManifest().version === installation.to);
  const untouched = ["downloading", "backup"].includes(installation.stage);
  const recover = async () => {
    setBusy(true);
    setError("");
    try {
      await recoverInstallation(
        installation,
        directory?.value as FileSystemDirectoryHandle | undefined,
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`更新至 v${installation.to}`}
      onClose={() => {}}
      dismissible={false}
    >
      <div className="install-progress" role="status" aria-live="polite">
        {held || busy ? (
          <LoaderCircle size={26} className="spin" />
        ) : (
          <RotateCcw size={26} />
        )}
        <strong>
          {held || busy
            ? installStageNames[installation.stage]
            : "上次更新尚未完成"}
        </strong>
      </div>
      <p>
        {held
          ? "请保持此页打开，完成后会自动重新打开工作台。"
          : reload
            ? "安装文件已就绪，继续校验并重新加载即可完成。"
            : untouched
              ? "程序文件尚未替换，可以取消后重试。"
              : "请恢复上一版程序后重试。稿件仍保存在本地。"}
      </p>
      {(error || installation.error) && (
        <Alert>{error || installation.error}</Alert>
      )}
      {installation.backup && (
        <p className="muted install-backup">
          程序与工作空间备份：安装目录 / zmatrix-update-backup /{" "}
          {installation.backup}
        </p>
      )}
      {!held && (
        <footer className="modal-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void recover()}
          >
            {reload
              ? "继续完成更新"
              : untouched
                ? "取消本次更新"
                : "恢复上一版程序"}
          </button>
        </footer>
      )}
    </Modal>
  );
}
