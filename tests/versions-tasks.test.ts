import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { database, fixture } from "./helpers";
import {
  newVariant,
  resolveContent,
  setOverride,
  clearOverride,
  isVariantBehind,
  freezeSnapshot,
  snapshotDiffers,
} from "../src/core/variants";
import { enqueue, canStart, recoverTask, patchTask } from "../src/core/tasks";
import { saveArticle } from "../src/core/db";

const db = database();
beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});
describe("母稿和平台版本", () => {
  it("独立正文不被母稿更新覆盖，未覆盖的标题继续继承", async () => {
    const { article } = await fixture();
    const variant = setOverride(
      newVariant(article, "zhihu:article"),
      "markdown",
      "平台独立正文",
    );
    const updated = {
      ...article,
      title: "新标题",
      markdown: "新母稿",
      revision: 2,
    };
    expect(resolveContent(updated, variant)).toMatchObject({
      title: "新标题",
      markdown: "平台独立正文",
    });
    expect(isVariantBehind(updated, variant)).toBe(true);
    expect(
      resolveContent(updated, clearOverride(variant, "markdown", 2)).markdown,
    ).toBe("新母稿");
  });
  it("排队绑定内容快照，并清理输入中的空标签", async () => {
    const { article, variant } = await fixture();
    variant.metadata.tags = ["技术", ""];
    const snapshot = await freezeSnapshot(article, variant);
    article.markdown = "提交后另写的内容";
    variant.metadata.tags.push("新标签");
    expect(snapshot.markdown).toBe("正文");
    expect(snapshot.metadata.tags).toEqual(["技术"]);
    expect(snapshotDiffers(snapshot, article, variant)).toBe(true);
  });
  it("拒绝另一个窗口以相同版本号覆盖不同内容", async () => {
    const { article } = await fixture();
    await saveArticle(article, db);
    await expect(
      saveArticle({ ...article, title: "冲突" }, db),
    ).rejects.toThrow("其他窗口");
    expect((await db.articles.get(article.id))?.title).toBe(article.title);
  });
});
describe("任务恢复与重复提交", () => {
  it("等待手动发布或核对的任务在重启后保持暂停边界，不能重复执行", async () => {
    const [task] = await enqueue([await fixture()], "publish", db);
    for (const state of ["awaiting_publish", "awaiting_review"] as const) {
      const waiting = { ...task!, state, tabId: 42 };
      expect(recoverTask(waiting).state).toBe(state);
      expect(canStart(waiting)).toBe(false);
    }
  });
  it("同批次重复任务不写入任何记录", async () => {
    const f = await fixture();
    await expect(enqueue([f, f], "publish", db)).rejects.toThrow("已有任务");
    expect(await db.tasks.count()).toBe(0);
  });
  it("已进入提交阶段的任务不允许自动重试", async () => {
    const [task] = await enqueue([await fixture()], "publish", db);
    const submitted = {
      ...task!,
      state: "submitting" as const,
      tabId: 4,
      events: [{ at: 1, message: "准备向平台提交" }],
    };
    const recovered = recoverTask(submitted);
    expect(recovered.state).toBe("uncertain");
    expect(canStart(recovered)).toBe(false);
    expect(canStart({ ...recovered, state: "failed" })).toBe(false);
    expect(recoverTask({ ...task!, state: "preparing" }).state).toBe("paused");
    expect(recoverTask({ ...task!, state: "preparing", tabId: 4 }).state).toBe(
      "uncertain",
    );
  });
  it("已成功的相同发布版本禁止重复排队，草稿和发布分别管理", async () => {
    const f = await fixture();
    const [task] = await enqueue([f], "publish", db);
    await patchTask(
      task!.id,
      { state: "published", remoteId: "42" },
      "核实成功",
      db,
    );
    await expect(enqueue([f], "publish", db)).rejects.toThrow("已有任务");
    await expect(enqueue([f], "draft", db)).resolves.toHaveLength(1);
  });
});
