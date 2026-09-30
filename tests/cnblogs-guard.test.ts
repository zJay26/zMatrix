import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "../src/platforms/browser-adapter";
import {
  armCnblogsHandoff,
  cnblogsRules,
  getCnblogsGuard,
  handleCnblogsGuardMessage,
  protectCnblogsTab,
  requireCnblogsGuard,
} from "../src/platforms/cnblogs-guard";
import {
  installCnblogsHandoff,
  cnblogsHandoffToken,
} from "../src/platforms/cnblogs-handoff";
import { pageDriver } from "../src/platforms/page-driver";
import { fixture } from "./helpers";

let rules: chrome.declarativeNetRequest.Rule[];
let stored: Record<string, unknown>;
let calls: string[];
let cleanup: (() => void) | undefined;
const editorUrl = "https://i.cnblogs.com/posts/edit";
const sender = {
  id: "extension",
  frameId: 0,
  url: editorUrl,
  tab: { id: 7 },
} as chrome.runtime.MessageSender;
beforeEach(() => {
  rules = [];
  stored = {};
  calls = [];
  vi.stubGlobal("location", new URL(editorUrl));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (value: object) => {
          Object.assign(stored, structuredClone(value));
        }),
        remove: vi.fn(async (key: string) => {
          delete stored[key];
        }),
      },
    },
    permissions: { contains: vi.fn(async () => true) },
    declarativeNetRequest: {
      getSessionRules: vi.fn(async () => structuredClone(rules)),
      updateSessionRules: vi.fn(
        async (update: {
          addRules?: chrome.declarativeNetRequest.Rule[];
          removeRuleIds?: number[];
        }) => {
          calls.push(update.addRules ? "protect" : "release");
          rules = rules.filter((r) => !update.removeRuleIds?.includes(r.id));
          rules.push(...(update.addRules ?? []));
        },
      ),
    },
    tabs: {
      create: vi.fn(async ({ url }: { url: string }) => {
        calls.push(url);
        return { id: 7 };
      }),
      update: vi.fn(async () => {
        calls.push("navigate");
      }),
      get: vi.fn(async () => ({ id: 7, status: "complete", url: editorUrl })),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => {}),
      executeScript: vi.fn(
        async ({
          func,
          args,
        }: {
          func: unknown;
          args?: [{ action: string }];
        }) => {
          if (func === cnblogsHandoffToken)
            return [{ result: (await getCnblogsGuard(7))?.token }];
          calls.push(args![0].action);
          return [
            { result: { ok: true, url: editorUrl, readyToPublish: true } },
          ];
        },
      ),
    },
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("博客园浏览器提交拦截", () => {
  it("在导航和填充前安装保护，仅精确图片上传接口可写", async () => {
    const f = await fixture("cnblogs:article");
    const adapter = adapterFor("cnblogs:article");
    const context = await adapter.prepare(
      f.snapshot,
      f.prepared,
      "task",
      async () => {},
    );
    expect(calls).toEqual([
      "about:blank",
      "protect",
      "navigate",
      "probe",
      "fill",
    ]);
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ runAt: "document_start", world: "ISOLATED" }),
    ]);
    expect(rules[0]?.condition).toMatchObject({
      tabIds: [7],
      requestDomains: ["cnblogs.com"],
      excludedRequestMethods: ["get", "head", "options"],
      resourceTypes: expect.arrayContaining([
        "main_frame",
        "sub_frame",
        "xmlhttprequest",
        "ping",
        "other",
      ]),
    });
    expect(rules[1]?.condition).toEqual({
      tabIds: [7],
      requestMethods: ["post"],
      urlFilter: "|https://upload.cnblogs.com/v2/images/cors-upload|",
    });
    const receipt = await adapter.preparePublish(
      context,
      f.snapshot,
      f.prepared,
    );
    expect(receipt.status).toBe("awaiting_publish");
    expect(calls).not.toContain("save");
    expect(calls).not.toContain("publish");
    expect(calls).not.toContain("release");
    expect((await getCnblogsGuard(7))?.phase).toBe("ready");
  });
  it("浏览器拒绝安装保护时不打开原站、不填充", async () => {
    vi.mocked(
      chrome.declarativeNetRequest.updateSessionRules,
    ).mockRejectedValue(new Error("permission denied"));
    const f = await fixture("cnblogs:article");
    await expect(
      adapterFor("cnblogs:article").prepare(
        f.snapshot,
        f.prepared,
        "task",
        async () => {},
      ),
    ).rejects.toThrow("permission denied");
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(await getCnblogsGuard(7)).toBeUndefined();
  });
  it("保存草稿也保持拦截并交接原站，不能误报保存成功", async () => {
    await protectCnblogsTab(7, "task");
    const f = await fixture("cnblogs:article");
    const receipt = await adapterFor("cnblogs:article").saveDraft(
      { tabId: 7, taskId: "task", channel: "cnblogs:article" },
      f.snapshot,
      f.prepared,
    );
    expect(receipt.status).toBe("awaiting_review");
    expect(receipt.detail).toContain("尚未保存草稿");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(rules).toHaveLength(2);
  });
  it("重新进入后台仍能读取保护，缺失或被缩小的规则一律拒绝", async () => {
    const guard = await protectCnblogsTab(7, "task");
    expect(await requireCnblogsGuard(7, "task")).toEqual(guard);
    rules[0]!.condition.urlFilter = "/irrelevant";
    await expect(requireCnblogsGuard(7, "task")).rejects.toThrow("未生效");
    rules = [];
    await expect(requireCnblogsGuard(7, "task")).rejects.toThrow("未生效");
    await expect(requireCnblogsGuard(7, "other-task")).rejects.toThrow("缺失");
  });
  it("未就绪、错误令牌、其他扩展和子框架都不能解除", async () => {
    const guard = await protectCnblogsTab(7, "task");
    const request = { type: "cnblogsGuardRelease", token: guard.token };
    expect(await handleCnblogsGuardMessage(request, sender)).toMatchObject({
      ok: false,
    });
    await armCnblogsHandoff(7, "task");
    for (const invalid of [
      { ...sender, id: "other" },
      { ...sender, frameId: 1 },
      { ...sender, url: "https://www.cnblogs.com/" },
      { ...sender, tab: undefined },
    ])
      expect(await handleCnblogsGuardMessage(request, invalid)).toMatchObject({
        ok: false,
      });
    expect(
      await handleCnblogsGuardMessage({ ...request, token: "wrong" }, sender),
    ).toMatchObject({ ok: false });
    expect(rules).toHaveLength(2);
  });
  it("只交还匹配标签页，重复交接拒绝，其他任务继续受保护", async () => {
    const guard = await protectCnblogsTab(7, "task");
    const other = await protectCnblogsTab(8, "other");
    await armCnblogsHandoff(7, "task");
    const request = { type: "cnblogsGuardRelease", token: guard.token };
    expect(await handleCnblogsGuardMessage(request, sender)).toEqual({
      ok: true,
    });
    expect(rules).toEqual(cnblogsRules(8, other.ruleIds));
    expect(await handleCnblogsGuardMessage(request, sender)).toMatchObject({
      ok: false,
    });
  });
  it("发起交接时页面已导航，继续保留拦截", async () => {
    const guard = await protectCnblogsTab(7, "task");
    await armCnblogsHandoff(7, "task");
    vi.mocked(chrome.tabs.get).mockImplementation(
      async () => ({ url: "https://i.cnblogs.com/posts" }) as chrome.tabs.Tab,
    );
    expect(
      await handleCnblogsGuardMessage(
        { type: "cnblogsGuardRelease", token: guard.token },
        sender,
      ),
    ).toMatchObject({ ok: false });
    expect(rules).toHaveLength(2);
  });
});

describe("原站可信点击交接", () => {
  it.each([true, false])(
    "可信点击入口只在后台成功交还后重放一次，后台成功=%s",
    async (allowed) => {
      document.body.innerHTML = "<form><button>发布</button></form>";
      const order: string[] = [];
      const listeners = vi.spyOn(window, "addEventListener");
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(
        async (message: unknown) => {
          if ((message as { type?: string })?.type === "cnblogsGuardStatus")
            return { ok: true, guard: { token: "secret", phase: "ready" } };
          order.push("request-release");
          return { ok: allowed, error: "交接失败" };
        },
      );
      cleanup = installCnblogsHandoff();
      await Promise.resolve();
      const button = document.querySelector("button")!;
      button.onclick = () => {
        order.push("native-click");
      };
      document.querySelector("form")!.onsubmit = (event) => {
        event.preventDefault();
        order.push("submit");
      };
      const listener = listeners.mock.calls.find(
        ([type]) => type === "click",
      )![1] as EventListener;
      const event = {
        target: button,
        isTrusted: true,
        button: 0,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      };
      // Unit-test the trusted browser event branch; synthetic DOM events remain untrusted.
      listener(event as unknown as Event);
      listener(event as unknown as Event); // A second click during the async handoff is ignored.
      await vi.waitFor(() =>
        expect(order).toEqual(
          allowed
            ? ["request-release", "native-click", "submit"]
            : ["request-release"],
        ),
      );
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(cnblogsHandoffToken()).toBe(allowed ? undefined : "secret");
    },
  );
  it("页面脚本的 click 和 submit 不能解除保护或触发表单", async () => {
    document.body.innerHTML = "<form><button>发布</button></form>";
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async () => ({
      ok: true,
      guard: { token: "secret", phase: "ready" },
    }));
    cleanup = installCnblogsHandoff();
    await Promise.resolve();
    const posted = vi.fn();
    document.querySelector("button")!.onclick = posted;
    document.querySelector("form")!.onsubmit = posted;
    document.querySelector("button")!.click();
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(posted).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "cnblogsGuardStatus",
    });
  });
  it("受保护的新稿可以填入并核对，期间不点任何保存或发布按钮", async () => {
    document.body.innerHTML =
      '<form><input id="post-title"><textarea id="md-editor"></textarea><button>发布</button><button>存为草稿</button></form>';
    const click = vi.fn();
    document.querySelectorAll("button").forEach((b) => {
      b.onclick = click;
    });
    const f = await fixture("cnblogs:article");
    f.snapshot.metadata.tags = [];
    const request = {
      channel: "cnblogs:article" as const,
      snapshot: f.snapshot,
      content: f.prepared,
      taskId: "task",
      protectedCnblogs: true,
    };
    expect(await pageDriver({ ...request, action: "fill" })).toMatchObject({
      ok: true,
      title: f.snapshot.title,
      body: "正文",
    });
    expect(
      await pageDriver({ ...request, action: "prepare-publish" }),
    ).toMatchObject({ ok: true, readyToPublish: true });
    expect(click).not.toHaveBeenCalled();
    expect(await pageDriver({ ...request, action: "save" })).toMatchObject({
      ok: false,
    });
    vi.stubGlobal("location", new URL("https://i.cnblogs.com/posts/edit/42"));
    expect(await pageDriver({ ...request, action: "fill" })).toMatchObject({
      ok: false,
    });
  });
});
