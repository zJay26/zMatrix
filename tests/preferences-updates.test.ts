import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchDB } from "../src/core/db";
import {
  defaultPreferences,
  getPreferences,
  normalizePreferences,
  savePreferences,
} from "../src/core/preferences";
import {
  checkForUpdates,
  compareVersions,
  dismissUpdate,
  getUpdateState,
  hasUpdate,
  latestRelease,
  syncUpdateAlarm,
  UPDATE_ALARM,
  UPDATE_API,
  UPDATE_INTERVAL,
  UPDATE_KEY,
} from "../src/core/updates";

const databases: WorkbenchDB[] = [];
const database = () => {
  const db = new WorkbenchDB(`preferences-update-test-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
};
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

function release(version = "0.2.0", prerelease = false) {
  return {
    tag_name: `v${version}`,
    name: `zMatrix ${version}`,
    body: "新功能\n改进字号",
    html_url: `https://github.com/zJay26/zMatrix/releases/tag/v${version}`,
    published_at: "2026-09-26T10:00:00Z",
    draft: false,
    prerelease,
    assets: [
      {
        name: `zMatrix-edge-${version}.zip`,
        size: 1024,
        browser_download_url: `https://github.com/zJay26/zMatrix/releases/download/v${version}/zMatrix-edge-${version}.zip`,
      },
    ],
  };
}
const response = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }) as Response;
const network = (data: unknown = [release()], status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(response(data, status));

describe("常用设置", () => {
  it("首次打开使用更大字号，并能在重新打开数据库后恢复偏好", async () => {
    const db = database();
    expect(await getPreferences(db)).toEqual(defaultPreferences);
    await savePreferences(
      {
        fontSize: 20,
        editorFontSize: 23,
        libraryLayout: "list",
        editorLayout: "source",
        autoCheckUpdates: false,
      },
      db,
    );
    db.close();
    await db.open();
    expect(await getPreferences(db)).toMatchObject({
      fontSize: 20,
      editorFontSize: 23,
      libraryLayout: "list",
      editorLayout: "source",
      autoCheckUpdates: false,
    });
    expect(await db.articles.count()).toBe(0);
  });
  it("并发更改不同设置不会相互覆盖，也不会触发稿件备份", async () => {
    const db = database();
    await Promise.all([
      savePreferences({ fontSize: 18 }, db),
      savePreferences({ refreshOnOpen: false }, db),
    ]);
    expect(await getPreferences(db)).toMatchObject({
      fontSize: 18,
      refreshOnOpen: false,
    });
    expect(await db.meta.get("dataChangedAt")).toBeUndefined();
  });
  it("损坏和旧设置回退到可用范围", () => {
    expect(normalizePreferences(null)).toEqual(defaultPreferences);
    expect(
      normalizePreferences({
        fontSize: 100,
        editorFontSize: -1,
        libraryLayout: "broken",
        refreshOnOpen: "false",
        autoCheckUpdates: false,
      }),
    ).toMatchObject({
      fontSize: 22,
      editorFontSize: 14,
      libraryLayout: "grid",
      refreshOnOpen: true,
      autoCheckUpdates: false,
    });
    expect(normalizePreferences({ fontSize: NaN }).fontSize).toBe(16);
  });
});

describe("版本选择与下载入口", () => {
  it.each([
    ["0.10.0", "0.9.9", 1],
    ["v1.0.0", "1.0.0", 0],
    ["1.0.0-beta.10", "1.0.0-beta.2", 1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0+build1", "1.0.0+build2", 0],
  ])("按版本语义比较 %s 和 %s", (a, b, result) =>
    expect(compareVersions(a, b)).toBe(result),
  );
  it("适配当前数字版本号的 GitHub 预发布标记，不误将源码包当成扩展", () => {
    const preview = release("0.3.0", true);
    preview.assets.unshift({
      name: "zMatrix-source-0.3.0.zip",
      size: 123,
      browser_download_url:
        "https://github.com/zJay26/zMatrix/releases/download/v0.3.0/zMatrix-source-0.3.0.zip",
    });
    const data = [
      release("0.1.2"),
      preview,
      { ...release("9.0.0"), draft: true },
    ];
    expect(latestRelease(data, true)).toMatchObject({
      version: "0.3.0",
      prerelease: true,
      downloadUrl: preview.assets[1]!.browser_download_url,
    });
    expect(latestRelease(data, false)?.version).toBe("0.1.2");
  });
  it("正式频道排除预发布后缀和没有发布时间的版本", () => {
    expect(
      latestRelease(
        [release("1.0.0-beta.1"), { ...release("3.0.0"), published_at: null }],
        false,
      ),
    ).toBeUndefined();
  });
  it("拒绝外部站点、其他仓库和其他版本的下载地址", () => {
    for (const url of [
      "https://example.org/update.zip",
      "javascript:alert(1)",
      "https://github.com/other/repo/releases/download/v0.2.0/zMatrix-edge-0.2.0.zip",
      "https://github.com/zJay26/zMatrix/releases/download/v0.1.2/zMatrix-edge-0.2.0.zip",
    ]) {
      const value = release();
      value.assets[0]!.browser_download_url = url;
      expect(latestRelease([value], true)?.downloadUrl).toBeUndefined();
    }
    expect(
      latestRelease(
        [
          {
            ...release(),
            html_url:
              "https://github.com.evil.org/zJay26/zMatrix/releases/tag/v0.2.0",
          },
        ],
        true,
      ),
    ).toBeUndefined();
  });
  it("相同或更旧版本不提示升级，损坏响应不能假报最新版", () => {
    expect(
      hasUpdate({ release: latestRelease([release("0.1.2")], true) }, "0.1.2"),
    ).toBe(false);
    expect(
      hasUpdate({ release: latestRelease([release("0.1.2")], true) }, "0.2.0"),
    ).toBe(false);
    expect(() => latestRelease({ message: "Not found" }, true)).toThrow();
    expect(() => latestRelease([{ tag_name: "v1.0.0" }], true)).toThrow();
  });
});

describe("自动检测与用户选择", () => {
  it("只请求版本元数据，不请求下载地址；六小时内不重复自动检查", async () => {
    const db = database(),
      fetcher = network();
    const first = await checkForUpdates({ database: db, fetcher, now: 1000 });
    expect(hasUpdate(first, "0.1.2")).toBe(true);
    await checkForUpdates({ database: db, fetcher, now: 1001 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      UPDATE_API,
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    );
    await checkForUpdates({
      database: db,
      fetcher,
      now: 1000 + UPDATE_INTERVAL,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("关闭自动检查后不联网，但仍可手动检查", async () => {
    const db = database(),
      fetcher = network();
    await savePreferences({ autoCheckUpdates: false }, db);
    await checkForUpdates({ database: db, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    await checkForUpdates({ database: db, fetcher, manual: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("切换发布频道立即刷新，失败保留上次结果并明确报错", async () => {
    const db = database(),
      fetcher = network([release("0.3.0", true)]);
    await checkForUpdates({ database: db, fetcher, now: 1000 });
    await savePreferences({ includePrereleases: false }, db);
    await checkForUpdates({ database: db, fetcher, now: 1001 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await getUpdateState(db)).release).toBeUndefined();
    const failed = await checkForUpdates({
      database: db,
      fetcher: network({}, 403),
      manual: true,
      now: 1002,
    });
    expect(failed.error).toContain("受限");
    expect(failed.checkedAt).toBe(1001);
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    expect(
      (
        await checkForUpdates({
          database: db,
          fetcher: offline,
          manual: true,
          now: 1003,
        })
      ).error,
    ).toContain("网络");
    expect(
      (
        await checkForUpdates({
          database: db,
          fetcher: network({}, 404),
          manual: true,
          now: 1004,
        })
      ).error,
    ).toContain("404");
  });
  it("切换为仅正式版时，即使检查失败也不展示缓存的预览版下载", async () => {
    const db = database();
    await checkForUpdates({
      database: db,
      fetcher: network([release("0.3.0", true)]),
      now: 1000,
    });
    await savePreferences({ includePrereleases: false }, db);
    const result = await checkForUpdates({
      database: db,
      fetcher: network({}, 500),
      now: 1001,
    });
    expect(result.error).toBeTruthy();
    expect(result.release).toBeUndefined();
    expect(result.checkedAt).toBeUndefined();
    expect(hasUpdate(result)).toBe(false);
  });
  it("失败也遵守自动检测间隔，避免网络故障或限流时反复请求", async () => {
    const db = database(),
      fetcher = network({}, 500);
    await checkForUpdates({ database: db, fetcher, now: 1000 });
    await checkForUpdates({ database: db, fetcher, now: 1001 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await getUpdateState(db)).checkedAt).toBeUndefined();
  });
  it("多窗口只执行一个检查，服务进程中断后的租约可以恢复", async () => {
    const db = database();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = checkForUpdates({ database: db, fetcher, now: 1000 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await checkForUpdates({ database: db, fetcher, manual: true, now: 1001 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await dismissUpdate("0.2.0", db);
    resolve(response([release()]));
    await first;
    expect((await getUpdateState(db)).dismissedVersion).toBe("0.2.0");
    expect(await db.meta.get("updateCheckLease")).toBeUndefined();
    await db.meta.put({
      key: "updateCheckLease",
      value: { owner: "expired", at: 1000 },
    });
    expect(
      (
        await checkForUpdates({
          database: db,
          fetcher: network([release("0.4.0")]),
          manual: true,
          now: 32_000,
        })
      ).release?.version,
    ).toBe("0.4.0");
  });
  it("稍后提醒持久化，但不会屏蔽下一版，也不会影响手动查看", async () => {
    const db = database();
    await checkForUpdates({ database: db, fetcher: network(), now: 1000 });
    await dismissUpdate("0.2.0", db);
    const state = await checkForUpdates({
      database: db,
      fetcher: network([release("0.3.0")]),
      manual: true,
      now: 1001,
    });
    expect(state.dismissedVersion).toBe("0.2.0");
    expect(state.release?.version).toBe("0.3.0");
    expect(hasUpdate(state, "0.1.2")).toBe(true);
  });
  it("重建丢失的后台闹钟，已有闹钟不延期，关闭时清除", async () => {
    const db = database();
    const alarms = {
      get: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      clear: vi.fn(),
    };
    await syncUpdateAlarm(db, alarms as unknown as typeof chrome.alarms);
    expect(alarms.create).toHaveBeenCalledWith(UPDATE_ALARM, {
      periodInMinutes: 360,
    });
    alarms.get.mockResolvedValue({ name: UPDATE_ALARM });
    await syncUpdateAlarm(db, alarms as unknown as typeof chrome.alarms);
    expect(alarms.create).toHaveBeenCalledTimes(1);
    await savePreferences({ autoCheckUpdates: false }, db);
    await syncUpdateAlarm(db, alarms as unknown as typeof chrome.alarms);
    expect(alarms.clear).toHaveBeenCalledWith(UPDATE_ALARM);
    expect(await db.meta.get(UPDATE_KEY)).toBeUndefined();
  });
});
