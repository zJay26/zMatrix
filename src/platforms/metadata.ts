import type { ChannelId } from "../core/model";

// Verified against the platform's public category endpoint on 2026-09-29:
// https://api.juejin.cn/tag_api/v1/query_category_briefs
const juejinCategories = [
  "后端",
  "前端",
  "Android",
  "iOS",
  "人工智能",
  "开发工具",
  "代码人生",
  "阅读",
];

export function metadataFor(channel: ChannelId) {
  const platform = channel.split(":")[0];
  return {
    categoryLabel:
      platform === "csdn"
        ? "分类专栏"
        : platform === "cnblogs"
          ? "个人分类"
          : "分类",
    categories: platform === "juejin" ? juejinCategories : [],
    readCategories: ["csdn", "cnblogs", "linuxdo"].includes(platform!),
    categoryHelp:
      platform === "juejin"
        ? "选择平台分类，发布时仍需在原站确认。"
        : ["csdn", "cnblogs"].includes(platform!)
          ? "在原站展开分类选项后读取，也可选择本地用过的分类。"
          : "分类以原站可选项为准。",
    summaryOnSite: platform !== "cnblogs",
  };
}

// Serialized into an already open, authorized editor. Reading never opens a
// publish dialog, clicks a control, changes a field or submits a draft.
export function readPageCategories(channel: ChannelId): string[] {
  const platform = channel.split(":")[0];
  const allowed: Record<string, string[]> = {
    csdn: ["editor.csdn.net", "mp.csdn.net"],
    cnblogs: ["i.cnblogs.com"],
    linuxdo: ["linux.do"],
  };
  if (
    location.protocol !== "https:" ||
    !allowed[platform!]?.includes(location.hostname)
  )
    return [];
  const visible = (element: Element) => {
    if (
      !element.getClientRects().length ||
      element.closest('[aria-hidden="true"], [inert]')
    )
      return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        (style.opacity !== "" && Number(style.opacity) < 0.05)
      )
        return false;
    }
    return true;
  };
  const categoryName =
    /^(?:个人分类|分类专栏|文章分类|选择分类|选择分类专栏|分类|类别|category|categories)[：:\s*]*$/iu;
  const roots = new Set<Element>();
  for (const label of document.querySelectorAll(
    "label,legend,[aria-label],.form-item-title,.el-form-item__label,.ant-form-item-label",
  )) {
    if (
      !visible(label) ||
      !categoryName.test(
        label.getAttribute("aria-label") || label.textContent?.trim() || "",
      )
    )
      continue;
    if (label instanceof HTMLLabelElement && label.control) {
      roots.add(label.control);
      continue;
    }
    const group =
      label.closest(
        "fieldset,[role=group],.el-form-item,.ant-form-item,.form-item",
      ) ?? label.parentElement;
    if (group && group !== document.body && group.tagName !== "FORM")
      roots.add(group);
  }
  // Controls that expose their purpose through a name/id rather than a label.
  for (const control of document.querySelectorAll("select,[role=combobox]")) {
    if (
      visible(control) &&
      /categor/iu.test(
        `${control.id} ${control.getAttribute("name") || ""} ${control.getAttribute("aria-label") || ""}`,
      )
    )
      roots.add(control);
  }
  const result = new Set<string>();
  const add = (text: string | null) => {
    const name = text?.replace(/\s+/gu, " ").trim();
    if (
      name &&
      name.length <= 100 &&
      !/^(?:请选择.*|选择分类.*|全部.*|未分类|无分类|暂无.*|不选择.*|新建.*|创建.*|添加.*|管理.*|搜索.*|取消|确定|保存)$/u.test(
        name,
      )
    )
      result.add(name);
  };
  for (const root of roots) {
    const candidates = [
      root,
      ...root.querySelectorAll("select,[role=option],label"),
    ];
    // Native select options have no client rect even while their select is visible.
    for (const item of candidates) {
      if (!visible(item)) continue;
      if (item instanceof HTMLSelectElement) {
        for (const option of item.options)
          if (!option.disabled && option.value) add(option.textContent);
      } else if (
        item.getAttribute("role") === "option" &&
        item.getAttribute("aria-disabled") !== "true"
      )
        add(item.textContent);
      else if (
        item instanceof HTMLLabelElement &&
        item.querySelector('input[type="checkbox"],input[type="radio"]')
      )
        add(item.textContent);
      // A combobox may place its visible listbox outside the form field.
      for (const id of (
        item.getAttribute("aria-controls") ||
        item.getAttribute("aria-owns") ||
        ""
      ).split(/\s+/u)) {
        const list = document.getElementById(id);
        if (!list || !visible(list)) continue;
        for (const option of list.querySelectorAll('[role="option"]'))
          if (
            visible(option) &&
            option.getAttribute("aria-disabled") !== "true"
          )
            add(option.textContent);
      }
    }
  }
  return [...result].slice(0, 200);
}
