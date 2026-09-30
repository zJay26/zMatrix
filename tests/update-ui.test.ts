import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "../src/core/db";
import { defaultPreferences } from "../src/core/preferences";
import { INSTALL_DIRECTORY } from "../src/core/installation-state";
import { UPDATE_KEY } from "../src/core/updates";
import { UpdateSettings } from "../src/ui/UpdateSettings";
const installer = vi.hoisted(() => ({
  installRelease: vi.fn(),
  chooseInstallationDirectory: vi.fn(),
}));
vi.mock("../src/core/update-install", () => installer);
let root: Root, container: HTMLDivElement;
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
const buttons = () => Array.from(container.querySelectorAll("button"));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { id: "self" } });
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    value: vi.fn(),
  });
  installer.installRelease.mockReset().mockResolvedValue(undefined);
  installer.chooseInstallationDirectory
    .mockReset()
    .mockResolvedValue(undefined);
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.meta.put({
    key: UPDATE_KEY,
    value: {
      checkedAt: Date.now(),
      includePrereleases: true,
      release: {
        version: "9.0.0",
        name: "zMatrix 9.0.0",
        assetId: 10,
        sha256: "a".repeat(64),
        size: 100,
        downloadUrl:
          "https://github.com/zJay26/zMatrix/releases/download/v9.0.0/zMatrix-edge-9.0.0.zip",
        url: "https://github.com/zJay26/zMatrix/releases/tag/v9.0.0",
        prerelease: true,
      },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      h(UpdateSettings, { preferences: defaultPreferences, onChange: vi.fn() }),
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain("发现新版本 v9.0.0");
  });
}
it("未授权目录时提供设置入口，显示更新不会自动下载或安装", async () => {
  await render();
  expect(
    buttons().some((button) => button.textContent?.includes("立即更新至")),
  ).toBe(false);
  expect(installer.installRelease).not.toHaveBeenCalled();
  expect(installer.chooseInstallationDirectory).not.toHaveBeenCalled();
  await act(async () =>
    buttons()
      .find((button) => button.textContent === "设置目录")!
      .click(),
  );
  expect(installer.chooseInstallationDirectory).toHaveBeenCalledOnce();
});
it("已有目录时点击立即更新才启动，重复点击在执行期间禁用", async () => {
  await db.meta.put({ key: INSTALL_DIRECTORY, value: { name: "edge-mv3" } });
  let resolve!: () => void;
  installer.installRelease.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await render();
  const install = buttons().find(
    (button) => button.textContent === "立即更新至 v9.0.0",
  )!;
  expect(installer.installRelease).not.toHaveBeenCalled();
  await act(async () => install.click());
  expect(installer.installRelease).toHaveBeenCalledWith(
    expect.objectContaining({ version: "9.0.0" }),
    { name: "edge-mv3" },
  );
  expect(install.disabled).toBe(true);
  await act(async () => resolve());
});
it("网页预览仍提供手动下载，不能安装扩展文件", async () => {
  vi.stubGlobal("chrome", undefined);
  await render();
  expect(container.textContent).toContain("请在 Edge 扩展中设置更新目录");
  expect(
    buttons().find((button) => button.textContent === "设置目录")?.disabled,
  ).toBe(true);
  expect(
    container.querySelector('a[href*="zMatrix-edge-9.0.0.zip"]'),
  ).not.toBeNull();
});
