import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "../src/core/db";
import { enqueue, patchTask } from "../src/core/tasks";
import { QueuePage } from "../src/ui/QueuePage";
import { fixture } from "./helpers";

let root: Root, container: HTMLDivElement;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
const button = (text: string, scope: ParentNode = container) => {
  const result = Array.from(scope.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
};
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await settle();
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await db.open();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await db.delete();
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(h(QueuePage)));
  await vi.waitFor(async () => {
    await settle();
    expect(container.querySelector(".task-row")).not.toBeNull();
  });
}
it("等待手动发布可单条放弃跟踪，取消确认不删，确认后保留稿件及防重", async () => {
  const f = await fixture(undefined, db);
  const [task] = await enqueue([f], "publish", db);
  await patchTask(task!.id, { state: "awaiting_publish", tabId: 123 });
  await render();
  await click(button("放弃跟踪并移除"));
  let dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("1 条任务的原站结果尚未确认");
  expect(dialog.textContent).toContain("不会撤回或删除原站内容");
  expect(dialog.textContent).toContain("相同版本仍不能重复排队");
  await click(button("取消", dialog));
  expect(await db.tasks.count()).toBe(1);
  await click(button("放弃跟踪并移除"));
  dialog = container.querySelector('[role="dialog"]')!;
  await click(button("放弃跟踪并移除", dialog));
  await vi.waitFor(async () => expect(await db.tasks.count()).toBe(0));
  expect(await db.articles.count()).toBe(1);
  expect(await db.taskReceipts.count()).toBe(1);
});
it("混选待执行和待核实任务可批量清理，仅后者保留防重", async () => {
  const first = await fixture(undefined, db);
  const second = await fixture("zhihu:article", db);
  const tasks = await enqueue([first, second], "publish", db);
  await patchTask(tasks[1]!.id, { state: "uncertain" });
  await render();
  await click(
    container.querySelector<HTMLInputElement>(
      '[aria-label="选择本页可清理任务"]',
    )!,
  );
  await click(button("移除所选（2）"));
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("1 条任务的原站结果尚未确认");
  await click(button("放弃跟踪并移除", dialog));
  await vi.waitFor(async () => expect(await db.tasks.count()).toBe(0));
  expect(await db.taskReceipts.count()).toBe(1);
  await expect(enqueue([first], "publish", db)).resolves.toHaveLength(1);
  await expect(enqueue([second], "publish", db)).rejects.toThrow("防重记录");
});
it("打开确认后任务开始核实，确认移除报错且保留任务", async () => {
  const [task] = await enqueue([await fixture(undefined, db)], "publish", db);
  await patchTask(task!.id, { state: "uncertain" });
  await render();
  await click(button("放弃跟踪并移除"));
  await act(async () => patchTask(task!.id, { state: "verifying" }));
  await settle();
  await click(
    button("放弃跟踪并移除", container.querySelector('[role="dialog"]')!),
  );
  expect(container.querySelector('[role="dialog"]')!.textContent).toContain(
    "正在执行",
  );
  expect(await db.tasks.count()).toBe(1);
  expect(await db.taskReceipts.count()).toBe(0);
  await click(button("取消", container.querySelector('[role="dialog"]')!));
  const active = Array.from(container.querySelectorAll(".tabs button")).find(
    (el) => el.textContent?.startsWith("执行中"),
  )!;
  await click(active as HTMLElement);
  expect(container.querySelector(".task-row input[type=checkbox]")).toBeNull();
  expect(container.textContent).not.toContain("放弃跟踪并移除");
});
