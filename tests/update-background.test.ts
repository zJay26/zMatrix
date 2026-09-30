import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/core/db";
import {
  getInstallation,
  beginInstallation,
} from "../src/core/installation-state";
import { sha256 } from "../src/core/variants";
import { version } from "../package.json";

const adapter = vi.hoisted(() => ({ checkSession: vi.fn() }));
vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: unknown) => fn,
}));
vi.mock("../src/platforms/browser-adapter", () => ({
  adapterFor: () => adapter,
}));
vi.mock("../src/core/updates", async (original) => ({
  ...(await original<typeof import("../src/core/updates")>()),
  checkForUpdates: vi.fn(),
  syncUpdateAlarm: vi.fn(),
}));
import startBackground from "../src/entrypoints/background";

let handler: (
  message: unknown,
  sender: object,
  respond: (value: { ok: boolean; error?: string }) => void,
) => void;
let contexts: { documentUrl: string; tabId: number }[];
let liveVersion: string;
const base = "chrome-extension://self/workbench.html";
const event = () => ({ addListener: vi.fn() });
const call = (message: unknown) =>
  new Promise<{ ok: boolean; error?: string }>((respond) =>
    handler(message, { id: "self", url: base }, respond),
  );
const begin = () =>
  call({
    type: "beginUpdate",
    id: crypto.randomUUID(),
    version: "9.0.0",
    currentVersion: version,
  });

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  liveVersion = version;
  contexts = [{ documentUrl: base, tabId: 7 }];
  adapter.checkSession.mockReset();
  adapter.checkSession.mockResolvedValue({ channel: "zhihu:article" });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "self",
      getManifest: () => ({ version: liveVersion }),
      getURL: (path: string) =>
        `chrome-extension://self/${path.replace(/^\//, "")}`,
      ContextType: { TAB: "TAB" },
      getContexts: vi.fn(async () => contexts),
      onMessage: {
        addListener: (fn: typeof handler) => {
          handler = fn;
        },
      },
      onInstalled: event(),
      onStartup: event(),
      reload: vi.fn(),
    },
    tabs: {
      onRemoved: event(),
      get: vi.fn(async () => ({ id: 7, url: base })),
      update: vi.fn(),
      create: vi.fn(),
    },
    alarms: { onAlarm: event() },
    action: { onClicked: event() },
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("更新的后台协调", () => {
  it("工具栏复用更新完成后的工作台页，后台拒绝同版本安装", async () => {
    contexts = [{ documentUrl: `${base}#updates`, tabId: 7 }];
    (startBackground as unknown as () => void)();
    const onClick = vi.mocked(chrome.action.onClicked.addListener).mock
      .calls[0]![0];
    await onClick({} as chrome.tabs.Tab);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(
      await call({
        type: "beginUpdate",
        id: crypto.randomUUID(),
        version,
        currentVersion: version,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("无需安装") });
    expect(await getInstallation()).toBeNull();
  });
  it("多个工作台页必须先保存关闭，哈希地址仍算工作台", async () => {
    contexts.push({ documentUrl: `${base}#updates`, tabId: 8 });
    (startBackground as unknown as () => void)();
    expect(await begin()).toMatchObject({
      ok: false,
      error: expect.stringContaining("其他"),
    });
    expect(await getInstallation()).toBeNull();
  });
  it("平台探测未结束时拒绝开始更新，完成后锁住新的后台操作", async () => {
    let resolve!: (result: object) => void;
    adapter.checkSession.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    (startBackground as unknown as () => void)();
    const pending = call({ type: "probe", channel: "zhihu:article" });
    await vi.waitFor(() => expect(adapter.checkSession).toHaveBeenCalled());
    expect(await begin()).toMatchObject({
      ok: false,
      error: expect.stringContaining("处理任务"),
    });
    resolve({ channel: "zhihu:article" });
    await pending;
    expect(await begin()).toMatchObject({ ok: true });
    expect(
      await call({ type: "probe", channel: "zhihu:article" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("正在更新") });
    expect(adapter.checkSession).toHaveBeenCalledTimes(1);
  });
  it("新后台启动后校验真实扩展资源，确认版本并重新打开原工作台页", async () => {
    await beginInstallation({
      id: crypto.randomUUID(),
      from: version,
      to: "9.0.0",
      stage: "ready",
      startedAt: Date.now(),
      tabId: 7,
      hashes: { "background.js": await sha256("new worker") },
    });
    liveVersion = "9.0.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("new worker")),
    );
    (startBackground as unknown as () => void)();
    await vi.waitFor(async () => expect(await getInstallation()).toBeNull());
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: `${base}#updates`,
      active: true,
    });
    expect((await db.meta.get("extensionUpdateResult"))?.value).toMatchObject({
      version: "9.0.0",
    });
  });
  it("校验不通过保留恢复记录，不误报更新成功", async () => {
    await beginInstallation({
      id: crypto.randomUUID(),
      from: version,
      to: "9.0.0",
      stage: "ready",
      startedAt: Date.now(),
      hashes: { "background.js": await sha256("expected") },
    });
    liveVersion = "9.0.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad bytes")),
    );
    (startBackground as unknown as () => void)();
    await vi.waitFor(async () =>
      expect((await getInstallation())?.error).toContain("校验"),
    );
    expect(await db.meta.get("extensionUpdateResult")).toBeUndefined();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
