import { afterEach, describe, expect, it, vi } from "vitest";
import { extractSummary, normalizeTags, parseTags } from "../src/core/metadata";
import { readPageCategories } from "../src/platforms/metadata";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("平台信息输入", () => {
  it("接受中英文分隔符，保留多词和 C#，去掉重复与空标签", () => {
    expect(parseTags(" React，TypeScript;react；C#\n游戏 开发,, ")).toEqual([
      "React",
      "TypeScript",
      "C#",
      "游戏 开发",
    ]);
    expect(normalizeTags(["React", " react ", "", "Vue"])).toEqual([
      "React",
      "Vue",
    ]);
  });
  it("从正文提取文字而不混入标题、素材地址、代码、表格或公式", () => {
    expect(
      extractSummary(
        "---\nauthor: private\n---\n# 标题\n\n![封面](asset://secret)\n\n```js\nsecret()\n```\n\n$$x+y$$\n\n使用 **React** 和 [TypeScript](https://example.com) 编写 `组件`。\n\n|甲|乙|\n|--|--|\n|1|2|\n\n支持扩展。",
      ),
    ).toBe("使用 React 和 TypeScript 编写 组件。 支持扩展。");
  });
  it("只含图片或代码时返回空，截断不拆坏 emoji", () => {
    expect(
      extractSummary("![图](asset://id)\n\n```mermaid\ngraph LR\nA-->B\n```"),
    ).toBe("");
    expect(extractSummary("🐱".repeat(170))).toBe("🐱".repeat(159) + "…");
  });
  it("分类读取只取可见的分类控件，忽略标签、占位和其他人的公开博客", () => {
    vi.stubGlobal("location", new URL("https://i.cnblogs.com/posts/edit"));
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      { width: 100 },
    ] as unknown as DOMRectList);
    document.body.innerHTML =
      '<label for="categories">个人分类</label><select id="categories"><option value="">请选择</option><option value="1">游戏开发</option><option value="2" disabled>停用</option></select><label for="tags">标签</label><select id="tags"><option value="x">不是分类</option></select><fieldset style="display:none"><legend>分类</legend><select><option value="3">隐藏分类</option></select></fieldset>';
    expect(readPageCategories("cnblogs:article")).toEqual(["游戏开发"]);
    vi.stubGlobal("location", new URL("https://www.cnblogs.com/someone/"));
    expect(readPageCategories("cnblogs:article")).toEqual([]);
  });
});
