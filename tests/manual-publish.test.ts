import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "../src/platforms/browser-adapter";
import { fixture } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("手动发布交接", () => {
  it.each([
    "zhihu:article",
    "juejin:article",
    "csdn:article",
    "xiaohongshu:article",
    "xiaohongshu:note",
  ] as const)("%s 填入后直接交接，标签页留给用户", async (channel) => {
    const executeScript = vi
      .fn()
      .mockResolvedValue([{ result: { ok: true, url: "editor" } }]);
    vi.stubGlobal("chrome", {
      runtime: { id: "extension" },
      permissions: { contains: vi.fn(async () => true) },
      tabs: {
        create: vi.fn(async () => ({ id: 5 })),
        get: vi.fn(async () => ({ status: "complete" })),
      },
      scripting: { executeScript },
    });
    const f = await fixture(channel);
    const onTab = vi.fn();
    const result = await adapterFor(channel).fill(
      f.snapshot,
      f.prepared,
      "task",
      onTab,
    );
    expect(onTab).toHaveBeenCalledWith(5);
    expect(result).toMatchObject({ status: "filled", editorUrl: "editor" });
    expect(
      executeScript.mock.calls.map(([call]) => call.args[0].action),
    ).toEqual(["probe", "fill"]);
  });
  it.each(["publish", "draft"] as const)(
    "博客园核实 %s 结果不刷新或提交原站页面",
    async (mode) => {
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
      vi.stubGlobal("chrome", {
        scripting: { executeScript },
        tabs: { reload },
      });
      const f = await fixture("cnblogs:article");
      const receipt = await adapterFor("cnblogs:article").verify(
        { channel: "cnblogs:article", taskId: "task", tabId: 5 },
        f.snapshot,
        f.prepared,
        mode,
      );
      expect(receipt.status).toBe("uncertain");
      expect(reload).not.toHaveBeenCalled();
      expect(executeScript).toHaveBeenCalledTimes(1);
    },
  );
});
