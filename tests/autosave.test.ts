import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveQueue } from "../src/core/autosave";

afterEach(() => vi.useRealTimers());
describe("自动保存队列", () => {
  it("连续输入仅保存同一文档的最新内容，切换页面立即落盘", async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const queue = new SaveQueue(() => {});
    queue.enqueue("master", async () => {
      saved.push("旧内容");
    });
    queue.enqueue("master", async () => {
      saved.push("最新内容");
    });
    queue.enqueue("variant", async () => {
      saved.push("独立版本");
    });
    expect(queue.status.pending).toBe(true);
    expect(saved).toEqual([]);
    expect(await queue.flush()).toBe(true);
    expect(saved).toEqual(["最新内容", "独立版本"]);
    expect(queue.status).toEqual({ pending: false, error: "" });
  });

  it("一次保存失败后不被其他成功写入掩盖，重试写入保留的最新编辑", async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const queue = new SaveQueue(() => {});
    queue.enqueue("master", async () => {
      throw new Error("存储暂不可用");
    });
    queue.enqueue("variant", async () => {
      saved.push("独立版本");
    });
    expect(await queue.flush()).toBe(false);
    queue.enqueue("master", async () => {
      saved.push("失败后继续输入的内容");
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);
    expect(await queue.flush()).toBe(false);
    expect(queue.status.error).toBe("存储暂不可用");
    expect(await queue.retry()).toBe(true);
    expect(saved).toEqual(["失败后继续输入的内容", "独立版本"]);
  });

  it("保存进行中又输入，仍会串行保存新内容且不能提前离开", async () => {
    const saved: string[] = [];
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const queue = new SaveQueue(() => {});
    queue.enqueue("master", async () => {
      await wait;
      saved.push("第一版");
    });
    const flushed = queue.flush();
    queue.enqueue("master", async () => {
      saved.push("第二版");
    });
    expect(queue.status.pending).toBe(true);
    finish();
    expect(await flushed).toBe(true);
    expect(saved).toEqual(["第一版", "第二版"]);
    queue.discard();
  });

  it("停笔后自动保存，不需要手动点击", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    const queue = new SaveQueue(() => {});
    queue.enqueue("master", write);
    await vi.advanceTimersByTimeAsync(349);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledOnce();
    expect(queue.status.pending).toBe(false);
  });
});
