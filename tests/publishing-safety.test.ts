import { afterEach, describe, expect, it, vi } from "vitest";
import { pageDriver } from "../src/platforms/page-driver";
import { canStart, claimTask, enqueue } from "../src/core/tasks";
import {
  MANUAL_PUBLISH_PROTOCOL,
  sendWorkbenchCommand,
} from "../src/core/commands";
import { fixture, database } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("博客园页面写入保护", () => {
  it.each(["fill", "save", "prepare-publish"] as const)(
    "%s 在任何页面写入与事件发生前拒绝",
    async (action) => {
      vi.stubGlobal("location", new URL("https://i.cnblogs.com/posts/edit"));
      document.body.innerHTML =
        '<form><input id="post-title"><textarea id="md-editor"></textarea><button>存为草稿</button><button>发布</button></form>';
      const changed = vi.fn();
      const submitted = vi.fn();
      document.querySelector("input")!.addEventListener("input", changed);
      document.querySelector("form")!.addEventListener("submit", submitted);
      const f = await fixture("cnblogs:article");
      const result = await pageDriver({
        action,
        channel: "cnblogs:article",
        snapshot: f.snapshot,
        content: f.prepared,
      });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/受保护|手动点击/);
      expect(document.querySelector("input")!.value).toBe("");
      expect(changed).not.toHaveBeenCalled();
      expect(submitted).not.toHaveBeenCalled();
    },
  );
  it("恢复博客园排队，但有远端活动的旧任务仍不允许重跑", async () => {
    const db = database();
    try {
      const [task] = await enqueue(
        [await fixture("cnblogs:article")],
        "publish",
        db,
      );
      expect(canStart(task!)).toBe(true);
      const legacy = { ...task!, tabId: 42 };
      await db.tasks.put(legacy);
      expect(canStart(legacy)).toBe(false);
      expect(await claimTask(legacy.id, "test", db)).toBeUndefined();
      expect(await db.tasks.get(legacy.id)).toEqual(legacy);
    } finally {
      await db.delete();
    }
  });
});

describe("前后台发布协议核对", () => {
  it.each([
    null,
    { ok: true },
    { ok: true, manualPublishProtocol: 0, version: "0.2.0" },
    {
      ok: true,
      manualPublishProtocol: MANUAL_PUBLISH_PROTOCOL,
      version: "0.1.2",
    },
  ])("不向不兼容的后台发送 run：%j", async (capabilities) => {
    const sendMessage = vi.fn().mockResolvedValue(capabilities);
    vi.stubGlobal("chrome", {
      runtime: { sendMessage, getManifest: () => ({ version: "0.2.0" }) },
    });
    await expect(
      sendWorkbenchCommand({ type: "run", ids: ["old-task"] }),
    ).rejects.toThrow("重新加载");
    expect(sendMessage.mock.calls).toEqual([[{ type: "capabilities" }]]);
  });
  it("匹配的后台收到带协议号的请求，暂停请求始终可用", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      manualPublishProtocol: MANUAL_PUBLISH_PROTOCOL,
      version: "0.2.0",
    });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage, getManifest: () => ({ version: "0.2.0" }) },
    });
    await sendWorkbenchCommand({ type: "run", ids: ["task"] });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "run",
      ids: ["task"],
      manualPublishProtocol: MANUAL_PUBLISH_PROTOCOL,
    });
    await sendWorkbenchCommand({ type: "pause" });
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "pause" });
  });
});
