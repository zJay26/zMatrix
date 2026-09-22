import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "../src/platforms/browser-adapter";
import { fixture } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("手动发布交接", () => {
  it.each([true, false])(
    "准备流程返回交接状态，ready=%s，不调用最终发布命令",
    async (ready) => {
      const executeScript = vi.fn().mockResolvedValue([
        {
          result: {
            ok: true,
            url: "https://i.cnblogs.com/posts/edit/42",
            readyToPublish: ready,
            preparationDetail: "核对记录",
          },
        },
      ]);
      vi.stubGlobal("chrome", { scripting: { executeScript } });
      const f = await fixture("cnblogs:article");
      const result = await adapterFor("cnblogs:article").preparePublish(
        { channel: "cnblogs:article", taskId: "task", tabId: 5 },
        f.snapshot,
        f.prepared,
      );
      expect(result.status).toBe(
        ready ? "awaiting_publish" : "awaiting_review",
      );
      expect(result.remoteId).toBeUndefined();
      expect(executeScript).toHaveBeenCalledTimes(1);
      expect(executeScript.mock.calls[0]![0].args[0].action).toBe(
        "prepare-publish",
      );
    },
  );
  it("核实手动发布结果时不刷新尚未提交的原站页面", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          ok: true,
          url: "https://i.cnblogs.com/posts/edit/42",
          draftId: "42",
          title: "本地验收稿",
          body: "正文",
          images: 0,
        },
      },
    ]);
    const reload = vi.fn();
    vi.stubGlobal("chrome", { scripting: { executeScript }, tabs: { reload } });
    const f = await fixture("cnblogs:article");
    const receipt = await adapterFor("cnblogs:article").verify(
      { channel: "cnblogs:article", taskId: "task", tabId: 5 },
      f.snapshot,
      f.prepared,
      "publish",
    );
    expect(receipt.status).toBe("uncertain");
    expect(reload).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
});
