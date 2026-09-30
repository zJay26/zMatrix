// A UI loaded from replaced files must not send a run request to an old worker.
export const MANUAL_PUBLISH_PROTOCOL = 2;
export const RELOAD_EXTENSION =
  "工作台与扩展后台版本不一致。请先暂停队列，在 Edge 扩展管理中重新加载 zMatrix，再重新打开工作台。";

export async function sendWorkbenchCommand(message: unknown) {
  let request = message;
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "run"
  ) {
    const capabilities = await chrome.runtime
      .sendMessage({ type: "capabilities" })
      .catch(() => null);
    if (
      !capabilities?.ok ||
      capabilities.manualPublishProtocol !== MANUAL_PUBLISH_PROTOCOL ||
      capabilities.version !== chrome.runtime.getManifest().version
    )
      throw new Error(RELOAD_EXTENSION);
    request = { ...message, manualPublishProtocol: MANUAL_PUBLISH_PROTOCOL };
  }
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok)
    throw new Error(response?.error ?? "后台没有响应，请重新加载扩展。");
  return response;
}
