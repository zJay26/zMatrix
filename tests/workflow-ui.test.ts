import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/core/db";
import { App } from "../src/ui/App";
import { MetadataFields } from "../src/ui/MetadataFields";
import { savePreferences } from "../src/core/preferences";
import {
  getPublishSelection,
  normalizePublishSelection,
  savePublishSelection,
} from "../src/core/publish-preferences";
import { fixture } from "./helpers";

vi.mock("../src/ui/Markdown", () => ({
  MarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) =>
    h("textarea", {
      "aria-label": "Markdown 正文",
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
  MarkdownPreview: ({ value }: { value: string }) => h("div", null, value),
}));
let root: Root;
let container: HTMLDivElement;
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
const button = (label: string) => {
  const match = Array.from(container.querySelectorAll("button")).find(
    (el) =>
      el.getAttribute("aria-label") === label ||
      el.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
};
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const input = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await db.open();
  await savePreferences({ autoCheckUpdates: false, refreshOnOpen: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await import("../src/ui/EditorPage");
});
afterEach(async () => {
  await act(async () => root.unmount());
  await db.delete();
  container.remove();
  vi.unstubAllGlobals();
});
async function renderApp() {
  await act(async () => root.render(h(App)));
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain("总览");
  });
}
async function newDraft() {
  await click(button("写新稿"));
  await vi.waitFor(async () => {
    await settle();
    expect(container.querySelector('[aria-label="文章标题"]')).not.toBeNull();
  });
}
describe("精简工作流界面", () => {
  it("空白新稿直接返回不落盘，开始编辑后保存，再打开可继续编辑", async () => {
    await renderApp();
    await newDraft();
    expect(await db.articles.count()).toBe(0);
    await click(button("内容库"));
    expect(await db.articles.count()).toBe(0);
    await newDraft();
    await input(
      container.querySelector('[aria-label="文章标题"]')!,
      "第一份稿件",
    );
    await click(button("内容库"));
    expect((await db.articles.toArray())[0]?.title).toBe("第一份稿件");
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector(".article-link")).not.toBeNull();
    });
    await click(container.querySelector<HTMLButtonElement>(".article-link")!);
    await input(
      container.querySelector('[aria-label="文章标题"]')!,
      "继续修改稿件",
    );
    await click(button("内容库"));
    expect((await db.articles.toArray())[0]?.title).toBe("继续修改稿件");
    expect(await db.articles.count()).toBe(1);
  });
  it("新稿只展示母稿，主动添加平台才显示并保存平台版本", async () => {
    await renderApp();
    await newDraft();
    const labels = Array.from(
      container.querySelectorAll(".version-strip button"),
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual(["母稿", "添加平台"]);
    await click(button("添加平台"));
    const platform = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".platform-picker button"),
    ).find((b) => b.textContent?.includes("知乎"))!;
    await click(platform);
    await click(button("内容库"));
    expect(await db.articles.count()).toBe(1);
    expect((await db.variants.toArray()).map((v) => v.channel)).toEqual([
      "zhihu:article",
    ]);
  });
  it("编辑器与发布面板同时挂载字段时，标签关联不会指向另一份输入", async () => {
    const props = {
      channel: "csdn:article" as const,
      metadata: { tags: [], category: "", summary: "" },
      markdown: "正文",
      onChange: () => {},
    };
    await act(async () =>
      root.render(
        h("div", null, h(MetadataFields, props), h(MetadataFields, props)),
      ),
    );
    await settle();
    const ids = Array.from(
      container.querySelectorAll("input,select,textarea"),
    ).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of Array.from(
      container.querySelectorAll(".metadata-fields"),
    ))
      for (const label of Array.from(field.querySelectorAll("label")))
        expect(field.contains(label.control)).toBe(true);
  });
  it("发布平台与方式记住选择，并过滤手动路径和无效值", async () => {
    expect(
      normalizePublishSelection({
        selected: ["csdn:article", "linuxdo:topic", "csdn:article", "bad"],
      }).selected,
    ).toEqual(["csdn:article"]);
    await savePublishSelection(["csdn:article"], "publish");
    expect(await getPublishSelection()).toEqual({
      selected: ["csdn:article"],
      mode: "publish",
    });
  });
  it("使用记住的平台直接排队后，本篇也保留该平台版本", async () => {
    await fixture(undefined, db);
    await savePublishSelection(["zhihu:article"], "draft");
    await renderApp();
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector(".article-link")).not.toBeNull();
    });
    await click(container.querySelector<HTMLButtonElement>(".article-link")!);
    await click(button("分发到平台"));
    await vi.waitFor(async () => {
      await settle();
      expect(button("加入队列，稍后执行").disabled).toBe(false);
    });
    await click(button("加入队列，稍后执行"));
    await vi.waitFor(async () => {
      await settle();
      expect(await db.tasks.count()).toBe(1);
    });
    expect((await db.variants.toArray()).map((v) => v.channel)).toEqual([
      "zhihu:article",
    ]);
  });
  it("缺失字段在分发面板补齐，未回车的标签直接排队也会保存，并可从界面取消移除", async () => {
    await fixture(undefined, db);
    await renderApp();
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector(".article-link")).not.toBeNull();
    });
    await click(container.querySelector<HTMLButtonElement>(".article-link")!);
    await click(button("分发到平台"));
    await vi.waitFor(async () => {
      await settle();
      expect(
        container.querySelector(".target-grid input:not(:disabled)"),
      ).not.toBeNull();
    });
    await click(
      Array.from(
        container.querySelectorAll<HTMLLabelElement>(".target-grid label"),
      )
        .find((el) => el.textContent?.includes("CSDN"))!
        .querySelector("input")!,
    );
    await click(button("准备发布，手动确认"));
    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain("请填写标签");
    });
    await input(
      container
        .querySelector<HTMLDivElement>('[role="dialog"]')!
        .querySelector<HTMLInputElement>(
          'input[placeholder="输入标签，回车添加"]',
        )!,
      "发布测试",
    );
    await click(button("加入队列，稍后执行"));
    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain("取消并移除");
    });
    expect((await db.variants.toArray())[0]?.metadata.tags).toEqual([
      "发布测试",
    ]);
    expect((await db.tasks.toArray())[0]?.snapshot.metadata.tags).toEqual([
      "发布测试",
    ]);
    await click(button("取消并移除"));
    await click(button("确认移除"));
    await vi.waitFor(async () => {
      await settle();
      expect(await db.tasks.count()).toBe(0);
    });
    expect(await db.articles.count()).toBe(1);
  });
  it("通用标签在分发面板填一次，所选平台全部使用，平台自身不重复保存", async () => {
    await fixture(undefined, db);
    await renderApp();
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector(".article-link")).not.toBeNull();
    });
    await click(container.querySelector<HTMLButtonElement>(".article-link")!);
    await click(button("分发到平台"));
    await vi.waitFor(async () => {
      await settle();
      expect(button("全选").disabled).toBe(false);
    });
    await click(button("全选"));
    await input(
      container
        .querySelector<HTMLDivElement>('[role="dialog"]')!
        .querySelector<HTMLInputElement>(
          'input[placeholder="输入标签，回车添加"]',
        )!,
      "一次填写",
    );
    await click(button("加入队列，稍后执行"));
    await vi.waitFor(async () => {
      await settle();
      expect(await db.tasks.count()).toBe(6);
    });
    expect((await db.articles.toArray())[0]?.defaults?.tags).toEqual([
      "一次填写",
    ]);
    for (const task of await db.tasks.toArray())
      expect(task.snapshot.metadata.tags).toEqual(["一次填写"]);
    for (const variant of await db.variants.toArray())
      expect(variant.metadata.tags).toEqual([]);
    // Every platform of one distribution is shown under a single article card.
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelectorAll(".task-card")).toHaveLength(1);
      expect(container.querySelectorAll(".task-row")).toHaveLength(6);
    });
  });
});
