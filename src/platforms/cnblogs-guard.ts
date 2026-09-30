// The browser blocks article writes before the editor is navigated to. This
// survives service-worker suspension; only the isolated, trusted-click listener
// can hand the tab back to the user. Image uploads are the sole write exception.
export interface CnblogsGuard {
  taskId: string;
  token: string;
  ruleIds: [number, number];
  phase: "filling" | "ready";
}
const key = (tabId: number) => `cnblogsGuard:${tabId}`;
const scriptId = "zmatrix-cnblogs-handoff";
export const isCnblogsEditor = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://i.cnblogs.com" &&
      /^\/posts\/edit(?:\/\d+)?\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
};

export function cnblogsRules(
  tabId: number,
  ids: [number, number],
): chrome.declarativeNetRequest.Rule[] {
  return [
    {
      id: ids[0],
      priority: 100,
      action: { type: "block" },
      condition: {
        tabIds: [tabId],
        requestDomains: ["cnblogs.com"],
        excludedRequestMethods: ["get", "head", "options"],
        // Omitting resource types would leave top-level POST forms unblocked.
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "stylesheet",
          "script",
          "image",
          "font",
          "object",
          "xmlhttprequest",
          "ping",
          "csp_report",
          "media",
          "websocket",
          "webtransport",
          "webbundle",
          "other",
        ],
      },
    },
    {
      id: ids[1],
      priority: 101,
      action: { type: "allow" },
      condition: {
        tabIds: [tabId],
        requestMethods: ["post"],
        urlFilter: "|https://upload.cnblogs.com/v2/images/cors-upload|",
      },
    },
  ];
}

export async function getCnblogsGuard(
  tabId: number,
): Promise<CnblogsGuard | undefined> {
  return (await chrome.storage.session.get(key(tabId)))[key(tabId)] as
    CnblogsGuard | undefined;
}

export async function protectCnblogsTab(tabId: number, taskId: string) {
  const scripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [scriptId],
  });
  if (!scripts.length)
    await chrome.scripting.registerContentScripts([
      {
        id: scriptId,
        js: ["cnblogs-handoff.js"],
        matches: ["https://i.cnblogs.com/*"],
        runAt: "document_start",
        world: "ISOLATED",
        persistAcrossSessions: false,
      },
    ]);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  let firstId = 1_000_000;
  while (rules.some((rule) => rule.id === firstId || rule.id === firstId + 1))
    firstId += 2;
  const guard: CnblogsGuard = {
    taskId,
    token: crypto.randomUUID(),
    ruleIds: [firstId, firstId + 1],
    phase: "filling",
  };
  await chrome.storage.session.set({ [key(tabId)]: guard });
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: cnblogsRules(tabId, guard.ruleIds),
    });
  } catch (error) {
    await chrome.storage.session.remove(key(tabId));
    throw error;
  }
  return guard;
}

// Compare the full rule, including any conditions that could narrow its scope.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

export async function requireCnblogsGuard(tabId: number, taskId: string) {
  const guard = await getCnblogsGuard(tabId);
  if (!guard || guard.taskId !== taskId)
    throw new Error("博客园发布保护缺失，已停止操作。请新建任务重试。");
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (
    !cnblogsRules(tabId, guard.ruleIds).every((expected) =>
      rules.some((rule) => canonical(rule) === canonical(expected)),
    )
  )
    throw new Error("博客园发布保护未生效，已停止填充和提交。");
  return guard;
}

export async function armCnblogsHandoff(tabId: number, taskId: string) {
  const guard = await requireCnblogsGuard(tabId, taskId);
  const ready: CnblogsGuard = { ...guard, phase: "ready" };
  await chrome.storage.session.set({ [key(tabId)]: ready });
  const reply = await chrome.tabs.sendMessage(tabId, {
    type: "cnblogsGuardReady",
    token: guard.token,
  });
  if (!reply?.ok)
    throw new Error(
      "博客园交接保护未响应，提交仍被拦截。请保留本地稿件后重试。",
    );
}

export async function removeCnblogsGuard(tabId: number) {
  const guard = await getCnblogsGuard(tabId);
  if (!guard) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: guard.ruleIds,
  });
  await chrome.storage.session.remove(key(tabId));
}

export async function handleCnblogsGuardMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("type" in raw) ||
    !["cnblogsGuardStatus", "cnblogsGuardRelease"].includes(String(raw.type))
  )
    return undefined;
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    !isCnblogsEditor(sender.url ?? "")
  )
    return { ok: false, error: "发布保护只接受博客园原站主页面的请求。" };
  const tabId = sender.tab.id;
  const guard = await getCnblogsGuard(tabId);
  if (raw.type === "cnblogsGuardStatus") return { ok: true, guard };
  if (
    !guard ||
    guard.phase !== "ready" ||
    !("token" in raw) ||
    raw.token !== guard.token
  )
    return { ok: false, error: "内容尚未准备完成，发布保护仍在生效。" };
  // Recheck the live tab as well as the sender (the page may have navigated).
  if (!isCnblogsEditor((await chrome.tabs.get(tabId)).url ?? ""))
    return { ok: false, error: "标签页已离开博客园编辑器。" };
  await requireCnblogsGuard(tabId, guard.taskId);
  await removeCnblogsGuard(tabId);
  return { ok: true };
}
