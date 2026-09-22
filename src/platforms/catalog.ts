import type { ChannelId, PlatformId } from "../core/model";
export interface Channel {
  id: ChannelId;
  platform: PlatformId;
  name: string;
  short: string;
  color: string;
  editorUrl: string;
  homeUrl: string;
  origins: string[];
  format: "html" | "markdown" | "images";
  math: boolean;
  mermaid: boolean;
  tables: boolean;
  manual: boolean;
  required: string[];
}
export const channels: Channel[] = [
  {
    id: "zhihu:article",
    platform: "zhihu",
    name: "知乎 · 文章",
    short: "知乎",
    color: "#1768d5",
    editorUrl: "https://zhuanlan.zhihu.com/write",
    homeUrl: "https://www.zhihu.com/creator",
    origins: ["https://*.zhihu.com/*"],
    format: "html",
    math: false,
    mermaid: false,
    tables: false,
    manual: false,
    required: [],
  },
  {
    id: "juejin:article",
    platform: "juejin",
    name: "掘金 · 文章",
    short: "掘金",
    color: "#356beb",
    editorUrl: "https://juejin.cn/editor/drafts/new",
    homeUrl: "https://juejin.cn/creator",
    origins: ["https://juejin.cn/*"],
    format: "markdown",
    math: true,
    mermaid: false,
    tables: true,
    manual: false,
    required: ["category", "tags"],
  },
  {
    id: "cnblogs:article",
    platform: "cnblogs",
    name: "博客园 · 文章",
    short: "博客园",
    color: "#395291",
    editorUrl: "https://i.cnblogs.com/posts/edit",
    homeUrl: "https://i.cnblogs.com/",
    origins: ["https://*.cnblogs.com/*"],
    format: "markdown",
    math: false,
    mermaid: false,
    tables: true,
    manual: false,
    required: [],
  },
  {
    id: "csdn:article",
    platform: "csdn",
    name: "CSDN · 文章",
    short: "CSDN",
    color: "#ca513e",
    editorUrl: "https://editor.csdn.net/md/",
    homeUrl: "https://mp.csdn.net/mp_blog/manage/article",
    origins: ["https://*.csdn.net/*"],
    format: "markdown",
    math: true,
    mermaid: true,
    tables: true,
    manual: false,
    required: ["tags"],
  },
  {
    id: "xiaohongshu:article",
    platform: "xiaohongshu",
    name: "小红书 · 长文章",
    short: "小红书长文",
    color: "#d63758",
    editorUrl:
      "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
    homeUrl: "https://creator.xiaohongshu.com/new/note-manager",
    origins: ["https://*.xiaohongshu.com/*"],
    format: "html",
    math: false,
    mermaid: false,
    tables: false,
    manual: false,
    required: [],
  },
  {
    id: "xiaohongshu:note",
    platform: "xiaohongshu",
    name: "小红书 · 图文笔记",
    short: "小红书图文",
    color: "#d63758",
    editorUrl:
      "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image",
    homeUrl: "https://creator.xiaohongshu.com/new/note-manager",
    origins: ["https://*.xiaohongshu.com/*"],
    format: "images",
    math: false,
    mermaid: false,
    tables: false,
    manual: false,
    required: ["images"],
  },
  {
    id: "linuxdo:topic",
    platform: "linuxdo",
    name: "LINUX DO · 话题",
    short: "LINUX DO",
    color: "#98711f",
    editorUrl: "https://linux.do/",
    homeUrl: "https://linux.do/",
    origins: ["https://linux.do/*"],
    format: "markdown",
    math: false,
    mermaid: false,
    tables: true,
    manual: true,
    required: [],
  },
];
export function channelFor(id: ChannelId) {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new Error("未知平台");
  return channel;
}
export const platformNames: Record<PlatformId, string> = {
  zhihu: "知乎",
  juejin: "掘金",
  cnblogs: "博客园",
  csdn: "CSDN",
  xiaohongshu: "小红书",
  linuxdo: "LINUX DO",
};
export function parseRemoteUrl(
  raw: string,
  expected?: ChannelId,
): { channel: ChannelId; remoteId: string; url: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("请输入完整的文章链接。");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("只接受 HTTPS 平台文章链接。");
  let channel: ChannelId | undefined;
  let id: string | undefined;
  if (u.hostname === "zhuanlan.zhihu.com") {
    id = u.pathname.match(/^\/p\/(\d+)\/?$/)?.[1];
    channel = "zhihu:article";
  }
  if (u.hostname === "juejin.cn") {
    id = u.pathname.match(/^\/post\/(\d+)\/?$/)?.[1];
    channel = "juejin:article";
  }
  if (["www.cnblogs.com", "cnblogs.com"].includes(u.hostname)) {
    id = u.pathname.match(/^\/[^/]+\/p\/(\d+)(?:\.html)?\/?$/)?.[1];
    channel = "cnblogs:article";
  }
  if (u.hostname === "blog.csdn.net") {
    id = u.pathname.match(/^\/[^/]+\/article\/details\/(\d+)\/?$/)?.[1];
    channel = "csdn:article";
  }
  if (["www.xiaohongshu.com", "xiaohongshu.com"].includes(u.hostname)) {
    id = u.pathname.match(
      /^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/,
    )?.[1];
    channel = expected?.startsWith("xiaohongshu:")
      ? expected
      : "xiaohongshu:note";
  }
  if (u.hostname === "linux.do") {
    id = u.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/)?.[1];
    channel = "linuxdo:topic";
  }
  if (!channel || !id || (expected && expected !== channel))
    throw new Error("链接不是所选平台的文章详情页。小红书请使用原始详情链接。");
  u.hash = "";
  // Xiaohongshu detail links can require the platform-issued xsec_token; preserve their query.
  if (!channel.startsWith("xiaohongshu:")) u.search = "";
  return { channel, remoteId: id, url: u.href };
}
