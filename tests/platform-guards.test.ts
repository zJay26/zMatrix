import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pageDriver } from "../src/platforms/page-driver";
import { fixture } from "./helpers";
import { channels } from "../src/platforms/catalog";
beforeEach(() => {
  vi.stubGlobal("location", new URL("https://i.cnblogs.com/posts/edit"));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 100, height: 20 },
  ] as unknown as DOMRectList);
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("平台页面保护", () => {
  it.each(channels.filter((c) => !c.manual))(
    "$id 拒绝旧的自动发布命令，即使最终按钮存在",
    async (channel) => {
      vi.stubGlobal("location", new URL(channel.editorUrl));
      document.body.innerHTML =
        "<button>发布</button><button>确认发布</button>";
      const click = vi.fn();
      document.querySelectorAll("button").forEach((e) => (e.onclick = click));
      const result = await pageDriver({
        action: "publish",
        channel: channel.id,
      });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toContain("自动发布已禁用");
      expect(click).not.toHaveBeenCalled();
    },
  );
  it("准备发布核对内容后停在最终按钮前，不触发 click 或 submit", async () => {
    document.body.innerHTML =
      '<form><input id="post-title" value="本地验收稿"><textarea id="md-editor">正文</textarea><button type="submit">发布</button></form>';
    const click = vi.fn();
    const submit = vi.fn();
    document.querySelector("button")!.onclick = click;
    document.querySelector("form")!.onsubmit = submit;
    const f = await fixture("cnblogs:article");
    f.snapshot.metadata.tags = [];
    const result = await pageDriver({
      action: "prepare-publish",
      channel: "cnblogs:article",
      snapshot: f.snapshot,
      content: f.prepared,
    });
    expect(result).toMatchObject({ ok: true, readyToPublish: true });
    expect(click).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("正文一致但分类、封面或必填项未核对时，不宣称已到最终发布步骤", async () => {
    document.body.innerHTML =
      '<input id="post-title" value="本地验收稿"><textarea id="md-editor">正文</textarea><input required value=""><button>发布</button>';
    const f = await fixture("cnblogs:article");
    f.snapshot.metadata.coverId = "a".repeat(64);
    f.snapshot.metadata.category = "技术";
    const result = await pageDriver({
      action: "prepare-publish",
      channel: "cnblogs:article",
      snapshot: f.snapshot,
      content: f.prepared,
    });
    expect(result).toMatchObject({ ok: true, readyToPublish: false });
    expect(result.preparationDetail).toContain("封面");
    expect(result.preparationDetail).toContain("分类");
    expect(result.preparationDetail).toContain("必填字段");
  });
  it("审核说明不是审核状态，不能把提示文字当作提交结果", async () => {
    document.body.innerHTML =
      "<p>审核通过后才会公开，审核中的文章可在后台查看。</p>";
    expect(
      (await pageDriver({ action: "inspect", channel: "cnblogs:article" }))
        .reviewing,
    ).toBe(false);
    document.body.innerHTML = '<div role="status">审核中</div>';
    expect(
      (await pageDriver({ action: "inspect", channel: "cnblogs:article" }))
        .reviewing,
    ).toBe(true);
  });
  it("忽略 aria-hidden 和近乎透明的重复控件，只识别实际可见按钮", async () => {
    document.body.innerHTML =
      '<div aria-hidden="true"><button>发布</button></div><div style="opacity:0.00001"><button>存为草稿</button></div><button>发布</button><button>存为草稿</button>';
    expect(
      await pageDriver({ action: "probe", channel: "cnblogs:article" }),
    ).toMatchObject({ publishControl: true, draftControl: true });
  });
  it("标签页离开目标平台时不填充或提交", async () => {
    vi.stubGlobal("location", new URL("https://example.com"));
    const result = await pageDriver({
      action: "prepare-publish",
      channel: "cnblogs:article",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("离开目标平台");
  });
  it("开通限制应明确返回，不能冒充平台已连接", async () => {
    document.body.innerHTML = "<p>您的账号未开通博客</p>";
    const result = await pageDriver({
      action: "probe",
      channel: "cnblogs:article",
    });
    expect(result.editorFound).toBe(false);
    expect(result.problems).toContain("当前账号未开通博客");
  });
  it("识别实测的存为草稿按钮和带图标的按钮", async () => {
    document.body.innerHTML =
      '<input id="post-title"><textarea id="md-editor"></textarea><button>存为草稿</button><button>发布</button>';
    expect(
      await pageDriver({ action: "probe", channel: "cnblogs:article" }),
    ).toMatchObject({
      editorFound: true,
      draftControl: true,
      publishControl: true,
    });
    vi.stubGlobal("location", new URL("https://editor.csdn.net/md/"));
    document.body.innerHTML =
      '<input class="article-bar__title"><pre class="editor__inner" contenteditable="true"></pre><button>保存草稿 \ue6df</button><button>发布文章</button>';
    expect(
      (await pageDriver({ action: "probe", channel: "csdn:article" }))
        .draftControl,
    ).toBe(true);
  });
  it("编辑器恢复了其他稿件时不覆盖原内容", async () => {
    document.body.innerHTML =
      '<input id="post-title" value="已有稿"><textarea id="md-editor">我的正文</textarea>';
    const f = await fixture("cnblogs:article");
    const result = await pageDriver({
      action: "fill",
      channel: "cnblogs:article",
      snapshot: f.snapshot,
      content: f.prepared,
      taskId: "test",
    });
    expect(result.error).toContain("已有内容");
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("我的正文");
  });
  it("最终按钮不唯一时停止，不根据文字猜测点击", async () => {
    document.body.innerHTML =
      '<input id="post-title" value="本地验收稿"><textarea id="md-editor">正文</textarea><button>发布</button><button>发布</button>';
    const f = await fixture("cnblogs:article");
    const click = vi.fn();
    document
      .querySelectorAll("button")
      .forEach((button) => (button.onclick = click));
    const result = await pageDriver({
      action: "prepare-publish",
      channel: "cnblogs:article",
      snapshot: f.snapshot,
      content: f.prepared,
    });
    expect(result.ok).toBe(true);
    expect(result.readyToPublish).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});
