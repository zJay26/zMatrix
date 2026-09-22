// SPDX-License-Identifier: MIT AND Apache-2.0
// Platform editor/upload reference-derived portions: MultiPost Extension contributors.
// See THIRD_PARTY_NOTICES.md for attribution, changes, and Apache-2.0 terms.
import type {
  ChannelId,
  CommentPage,
  Metric,
  PreparedContent,
  Snapshot,
} from "../core/model";
export interface PageRequest {
  action:
    | "probe"
    | "fill"
    | "save"
    | "publish"
    | "prepare-publish"
    | "inspect"
    | "metrics"
    | "comments";
  channel: ChannelId;
  taskId?: string;
  snapshot?: Snapshot;
  content?: PreparedContent;
  cursor?: string;
  remoteId?: string;
}
export interface PageResult {
  ok: boolean;
  error?: string;
  url: string;
  account?: string;
  title?: string;
  body?: string;
  images?: number;
  localImages?: boolean;
  draftId?: string;
  publicId?: string;
  publicUrl?: string;
  reviewing?: boolean;
  editorFound?: boolean;
  draftControl?: boolean;
  publishControl?: boolean;
  readyToPublish?: boolean;
  preparationDetail?: string;
  problems?: string[];
  metrics?: Metric[];
  comments?: CommentPage;
}

// Serialized by chrome.scripting into the selected page. All runtime helpers must stay inside.
export async function pageDriver(request: PageRequest): Promise<PageResult> {
  const result = (fields: Partial<PageResult>): PageResult => ({
    ok: true,
    url: location.href,
    ...fields,
  });
  try {
    const platform = request.channel.split(":")[0]!;
    const domains: Record<string, string[]> = {
      zhihu: ["zhihu.com"],
      juejin: ["juejin.cn"],
      cnblogs: ["cnblogs.com"],
      csdn: ["csdn.net"],
      xiaohongshu: ["xiaohongshu.com"],
      linuxdo: ["linux.do"],
    };
    if (
      !domains[platform]?.some(
        (d) => location.hostname === d || location.hostname.endsWith(`.${d}`),
      )
    )
      throw new Error("标签页已离开目标平台，操作停止。");
    if (request.action === "publish")
      throw new Error("自动发布已禁用。请在原站手动完成最终发布。");
    const visible = (e: Element) => {
      if (
        !(e as HTMLElement).getClientRects().length ||
        e.closest('[aria-hidden="true"], [inert]')
      )
        return false;
      for (
        let current: Element | null = e;
        current;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          (style.opacity !== "" && Number(style.opacity) < 0.05)
        )
          return false;
      }
      return true;
    };
    const normalized = (value: string) =>
      (value ?? "").replace(/\s+/g, "").replace(/\u200b/g, "");
    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const wait = async <T>(
      find: () => T | undefined | null | false,
      timeout = 15000,
    ): Promise<T> => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = find();
        if (found) return found;
        await pause(250);
      }
      throw new Error("等待平台页面超时，请检查登录状态或平台是否改版。");
    };
    const first = (selectors: string[]) => {
      for (const selector of selectors) {
        const e = Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        ).find(visible);
        if (e) return e;
      }
      return undefined;
    };
    const button = (labels: string[], root: ParentNode = document) => {
      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button,[role="button"],input[type="submit"],a',
        ),
      ).filter(
        (e) =>
          visible(e) &&
          labels.includes(
            (e.textContent || e.getAttribute("value") || "")
              .replace(/[\uE000-\uF8FF]/g, "")
              .trim(),
          ),
      );
      if (candidates.length === 1) return candidates[0];
      return undefined;
    };
    const click = (e: HTMLElement | undefined) => {
      if (!e)
        throw new Error("未找到唯一且可识别的操作按钮，已停止以避免误操作。");
      const label = (e.textContent || e.getAttribute("value") || "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .trim();
      if (
        [
          "发布",
          "发布文章",
          "确认发布",
          "立即发布",
          "确定并发布",
          "发布笔记",
        ].includes(label)
      )
        throw new Error("最终发布按钮必须由用户手动点击。");
      if (
        (e as HTMLButtonElement).disabled ||
        e.getAttribute("aria-disabled") === "true"
      )
        throw new Error("平台按钮不可用，请检查必填字段或账号限制。");
      e.click();
    };
    const pageText = document.body.innerText;
    const problems: string[] = [];
    if (/您的账号未开通博客/.test(pageText))
      problems.push("当前账号未开通博客");
    if (
      document.querySelector('iframe[src*="bindweixin"]') ||
      /请您在发文前，完成微信绑定/.test(pageText)
    )
      problems.push("CSDN 要求完成微信绑定");
    if (
      /\/login|\/signin|passport\./.test(location.href) ||
      (!request.remoteId && /短信登录|密码登录|扫码登录/.test(pageText))
    )
      problems.push("请先在原站登录");
    const titleSelectors: Record<string, string[]> = {
      zhihu: ['textarea[placeholder="请输入标题（最多 100 个字）"]'],
      juejin: ["input.title-input"],
      cnblogs: ["input#post-title"],
      csdn: ["input.article-bar__title"],
      xiaohongshu: [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
      ],
      linuxdo: [],
    };
    const editorSelectors: Record<string, string[]> = {
      zhihu: ['.public-DraftEditor-content[contenteditable="true"]'],
      juejin: [".CodeMirror"],
      cnblogs: ["textarea#md-editor"],
      csdn: ['pre.editor__inner[contenteditable="true"]'],
      xiaohongshu: [
        '.tiptap[contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        '[contenteditable="true"]',
      ],
      linuxdo: [],
    };
    const title = () => first(titleSelectors[platform] ?? []);
    const editor = () => first(editorSelectors[platform] ?? []);
    const cm = (element: HTMLElement | undefined) =>
      (
        element as unknown as
          | {
              CodeMirror?: {
                getValue: () => string;
                setValue: (s: string) => void;
              };
            }
          | undefined
      )?.CodeMirror;
    const value = (element: HTMLElement | undefined) =>
      element
        ? (cm(element)?.getValue() ??
          (element as HTMLInputElement).value ??
          element.innerText)
        : "";
    const account = Array.from(document.querySelectorAll("[aria-label]"))
      .map(
        (e) => e.getAttribute("aria-label")?.match(/^点击打开(.+)的主页$/)?.[1],
      )
      .find(Boolean);
    const saveLabels = [
      "保存草稿",
      "存草稿",
      "存为草稿",
      "暂存离开",
      "保存为草稿",
    ];
    const publishLabels = ["发布", "发布文章", "确认发布", "立即发布"];
    if (request.action === "probe")
      return result({
        account,
        editorFound: !!editor(),
        draftControl:
          !!button(saveLabels) ||
          (/自动保存|· 草稿|已保存/.test(pageText) && !!editor()),
        publishControl: !!button(publishLabels),
        problems,
      });
    if (problems.length) throw new Error(problems.join("；"));
    const nativeSet = (element: HTMLElement, text: string) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        const proto =
          element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
          element,
          text,
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (!document.execCommand("insertText", false, text))
          throw new Error("平台编辑器不接受文本插入。");
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          }),
        );
      }
    };
    const snapshot = request.snapshot;
    const content = request.content;
    if (request.action === "fill") {
      if (!snapshot || !content) throw new Error("缺少任务内容");
      if (platform === "linuxdo")
        throw new Error("LINUX DO 仅提供人工发布辅助");
      if (request.channel === "xiaohongshu:article") {
        const entrance = await wait(() => title() || button(["新的创作"]));
        if (entrance.tagName === "BUTTON") click(entrance);
      }
      if (request.channel === "xiaohongshu:note") {
        const tabs = Array.from(
          document.querySelectorAll<HTMLElement>("span.title"),
        ).filter((e) => visible(e) && e.textContent?.trim() === "上传图文");
        if (tabs.length === 1) click(tabs[0]);
        const input = await wait(() =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input.upload-input[type="file"]',
            ),
          ).find((e) => !e.accept || e.accept.includes("image")),
        );
        const transfer = new DataTransfer();
        for (const id of snapshot.imageIds) {
          const asset = content.assets.find((a) => a.id === id);
          if (!asset) throw new Error("配图缺失");
          const bytes = await (await fetch(asset.dataUrl)).blob();
          transfer.items.add(
            new File([bytes], asset.name, { type: asset.type }),
          );
        }
        if (!transfer.files.length) throw new Error("请添加图文配图");
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const titleInput = await wait(title);
      const bodyEditor = await wait(editor);
      let defaultHash = 2166136261;
      const initialBody = value(bodyEditor);
      for (let i = 0; i < initialBody.length; i++) {
        defaultHash ^= initialBody.charCodeAt(i);
        defaultHash = Math.imul(defaultHash, 16777619);
      }
      const untouchedCsdnSample =
        platform === "csdn" &&
        value(titleInput) === "【无标题】" &&
        initialBody.length === 4956 &&
        defaultHash >>> 0 === 1542977423;
      if (
        (value(titleInput).trim() || initialBody.trim()) &&
        !untouchedCsdnSample &&
        document.documentElement.dataset.tonggaoTask !== request.taskId
      )
        throw new Error(
          "平台恢复了已有内容。请先在该标签页清空或处理原稿，再重新检查；工具不会覆盖已有稿件。",
        );
      document.documentElement.dataset.tonggaoTask = request.taskId;
      let markdown = content.markdown;
      let html = content.html;
      if (platform === "cnblogs") {
        for (const asset of content.assets) {
          if (!markdown.includes(`asset://${asset.id}`)) continue;
          const blob = await (await fetch(asset.dataUrl)).blob();
          const form = new FormData();
          form.append(
            "image",
            new File([blob], asset.name, { type: asset.type }),
          );
          const xsrf = document.cookie
            .split("; ")
            .find((c) => c.startsWith("XSRF-TOKEN="))
            ?.slice(11);
          const response = await fetch(
            "https://upload.cnblogs.com/v2/images/cors-upload",
            {
              method: "POST",
              body: form,
              credentials: "include",
              headers: xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {},
              signal: AbortSignal.timeout(25000),
            },
          );
          if (!response.ok)
            throw new Error(`图片上传失败 HTTP ${response.status}`);
          const data = await response.json();
          if (
            typeof data.imageUrl !== "string" ||
            !data.imageUrl.startsWith("https://")
          )
            throw new Error("图片上传未返回有效地址");
          markdown = markdown.split(`asset://${asset.id}`).join(data.imageUrl);
        }
      } else if (platform === "juejin" || platform === "csdn") {
        // Let the site's editor handle the real file paste and expose its uploaded URL.
        for (const asset of content.assets) {
          if (!markdown.includes(`asset://${asset.id}`)) continue;
          const before = value(bodyEditor);
          bodyEditor.focus();
          const file = new File(
            [await (await fetch(asset.dataUrl)).blob()],
            asset.name,
            { type: asset.type },
          );
          const transfer = new DataTransfer();
          transfer.items.add(file);
          const pasteTarget =
            bodyEditor.querySelector("textarea") ?? bodyEditor;
          pasteTarget.dispatchEvent(
            new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            }),
          );
          const uploaded = await wait(() => {
            const after = value(bodyEditor);
            const urls = Array.from(after.matchAll(/https:\/\/[^\s)]+/g)).map(
              (m) => m[0],
            );
            return urls.find((url) => !before.includes(url));
          }, 30000);
          markdown = markdown.split(`asset://${asset.id}`).join(uploaded);
        }
      }
      nativeSet(titleInput, snapshot.title);
      if (cm(bodyEditor)) cm(bodyEditor)!.setValue(markdown);
      else if (bodyEditor instanceof HTMLTextAreaElement)
        nativeSet(bodyEditor, markdown);
      else if (platform === "csdn") nativeSet(bodyEditor, markdown);
      else {
        bodyEditor.focus();
        const transfer = new DataTransfer();
        transfer.setData("text/html", html);
        transfer.setData("text/plain", content.text);
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(bodyEditor);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const pasted = bodyEditor.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
        if (pasted && !document.execCommand("insertHTML", false, html))
          throw new Error("平台未接受富文本内容。");
      }
      await wait(
        () =>
          normalized(value(title())) === normalized(snapshot.title) &&
          normalized(value(editor())).length > 0,
      );
      if (platform === "cnblogs" && snapshot.metadata.summary) {
        const summary = first(["textarea#summary"]);
        if (summary) nativeSet(summary, snapshot.metadata.summary);
      }
      return result({ title: value(title()), body: value(editor()), account });
    }
    const inspect = () => {
      const bodyEditor = editor();
      const heading = first([
        "h1.Post-Title",
        "h1.article-title",
        "h1.title-article",
        "#cb_post_title_url",
        ".title#detail-title",
        ".title",
      ]);
      const publicBody = first([
        ".Post-RichText",
        ".article-content",
        "#cnblogs_post_body",
        "#content_views",
        ".note-text",
      ]);
      let draftId: string | undefined;
      let publicId: string | undefined;
      if (platform === "juejin") {
        draftId = location.pathname.match(/\/editor\/drafts\/(\d+)/)?.[1];
        publicId = location.pathname.match(/\/post\/(\d+)/)?.[1];
      }
      if (platform === "zhihu") {
        draftId =
          location.pathname.match(/\/p\/(\d+)\/edit/)?.[1] ??
          new URL(location.href).searchParams.get("draftId") ??
          undefined;
        if (!bodyEditor) publicId = location.pathname.match(/\/p\/(\d+)/)?.[1];
      }
      if (platform === "cnblogs") {
        draftId = location.pathname.match(/\/posts\/edit\/(\d+)/)?.[1];
        publicId = location.pathname.match(/\/p\/(\d+)\.html/)?.[1];
      }
      if (platform === "csdn") {
        draftId =
          new URL(location.href).searchParams.get("articleId") ?? undefined;
        publicId = location.pathname.match(/\/article\/details\/(\d+)/)?.[1];
      }
      if (platform === "xiaohongshu") {
        publicId = location.pathname.match(
          /\/(?:explore|discovery\/item)\/([a-f0-9]{24})/,
        )?.[1];
        draftId =
          new URL(location.href).searchParams.get("draftId") ?? undefined;
      }
      const root = bodyEditor ?? publicBody;
      const rawBody = root ? value(root) : "";
      const markdownEditor =
        !!bodyEditor && ["juejin", "csdn", "cnblogs"].includes(platform);
      const markdownImages = Array.from(
        rawBody.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g),
      ).map((match) => match[1]!);
      const images = Array.from(root?.querySelectorAll("img") ?? []);
      const remoteLinks = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[href]"),
      ).filter((a) => /查看文章|查看笔记|查看发布/.test(a.innerText));
      return result({
        title: value(title()) || heading?.innerText,
        body: root ? value(root) : undefined,
        draftId,
        publicId,
        publicUrl: publicId
          ? location.href
          : remoteLinks.length === 1
            ? remoteLinks[0]!.href
            : undefined,
        images: markdownEditor ? markdownImages.length : images.length,
        localImages: markdownEditor
          ? markdownImages.some((url) => !/^https:\/\//i.test(url))
          : images.some((img) => /^(?:data:|blob:|asset:)/.test(img.src)),
        reviewing: Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="status"], .publish-result, .article-status, .note-status',
          ),
        ).some(
          (node) =>
            visible(node) &&
            /^(?:内容|文章|笔记)?审核中[。！!]?$/u.test(node.innerText.trim()),
        ),
      });
    };
    if (request.action === "inspect") return inspect();
    if (request.action === "save") {
      const save = button(saveLabels);
      if (save) click(save);
      else if (!["zhihu", "juejin"].includes(platform))
        throw new Error("未识别到保存草稿入口，不能把填充内容当作草稿已保存。");
      await pause(1800);
      return inspect();
    }
    if (request.action === "prepare-publish") {
      if (!snapshot || !content) throw new Error("缺少发布版本");
      if (normalized(value(title())) !== normalized(snapshot.title))
        throw new Error("平台标题与预览版本不一致，停止发布。");
      const compare = (text: string) =>
        normalized(text.replace(/!\[[^\]]*\]\([^)]*\)/g, ""));
      const bodyText = compare(value(editor()));
      const expected = compare(
        platform === "juejin" || platform === "csdn" || platform === "cnblogs"
          ? content.markdown
          : content.text,
      );
      if (!bodyText || bodyText !== expected)
        throw new Error("平台正文与预览版本不一致，停止发布。");
      const imageState = inspect();
      const expectedImages =
        request.channel === "xiaohongshu:note"
          ? snapshot.imageIds.length
          : (content.html.match(/<img\b/g)?.length ?? 0);
      if (imageState.localImages || (imageState.images ?? 0) < expectedImages)
        throw new Error("图片尚未完整上传或无法核对，停止发布。");
      // Never infer that an ambiguous "发布" button only opens another dialog.
      // Other native publish settings need evidence before their routes can be marked ready.
      const pending: string[] = [];
      if (snapshot.metadata.coverId) pending.push("所选封面尚未完成上传核对");
      if (snapshot.metadata.category) pending.push("所选分类尚未完成核对");
      if (snapshot.metadata.tags.length) pending.push("所选标签尚未完成核对");
      if (
        snapshot.metadata.summary &&
        (platform !== "cnblogs" ||
          normalized(value(first(["textarea#summary"]))) !==
            normalized(snapshot.metadata.summary))
      )
        pending.push("摘要尚未完成核对");
      if (platform !== "cnblogs")
        pending.push("该平台的最终发布设置流程尚待实测");
      const final = button(publishLabels);
      if (!final) pending.push("尚未识别到唯一的最终发布按钮");
      else if (
        (final as HTMLButtonElement).disabled ||
        final.getAttribute("aria-disabled") === "true"
      )
        pending.push("平台发布按钮尚不可用");
      const invalid = Array.from(
        document.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >("input[required],textarea[required],select[required]"),
      ).some((e) => visible(e) && !e.disabled && !e.validity.valid);
      if (invalid) pending.push("原站仍有未完成的必填字段");
      return result({
        ...imageState,
        readyToPublish: !pending.length,
        preparationDetail: pending.length
          ? `内容已核对；${pending.join("；")}。未点击发布，尚不算发布前流程验收通过。`
          : "标题、正文、配图和可见必填字段已核对，已停在最终发布按钮前。请在此标签页手动发布。",
      });
    }
    if (platform === "linuxdo" && request.remoteId) {
      const response = await fetch(
        `/t/${encodeURIComponent(request.remoteId)}.json`,
        { credentials: "include", signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw new Error(`读取话题失败 HTTP ${response.status}`);
      const topic = await response.json();
      if (request.action === "metrics")
        return result({
          metrics: [
            {
              key: "views",
              label: "浏览",
              value: topic.views,
              raw: String(topic.views),
            },
            {
              key: "like_count",
              label: "点赞",
              value: topic.like_count,
              raw: String(topic.like_count),
            },
            {
              key: "posts_count",
              label: "帖子数（含主帖）",
              value: topic.posts_count,
              raw: String(topic.posts_count),
            },
          ].filter((m) => typeof m.value === "number"),
        });
      const ids: number[] = topic.post_stream?.stream ?? [];
      const end = request.cursor ? Number(request.cursor) : ids.length;
      const start = Math.max(1, end - 20);
      const selected = ids.slice(start, end);
      let posts = topic.post_stream?.posts ?? [];
      if (selected.length) {
        const query = new URLSearchParams();
        for (const id of selected) query.append("post_ids[]", String(id));
        const res = await fetch(
          `/t/${encodeURIComponent(request.remoteId)}/posts.json?${query}`,
          { credentials: "include", signal: AbortSignal.timeout(20000) },
        );
        if (!res.ok) throw new Error(`读取回复失败 HTTP ${res.status}`);
        posts = (await res.json()).post_stream?.posts ?? [];
      }
      return result({
        comments: {
          comments: posts
            .filter((p: { post_number: number }) => p.post_number > 1)
            .map(
              (p: {
                id: number;
                reply_to_post_number?: number;
                username: string;
                cooked: string;
                created_at: string;
                post_number: number;
              }) => {
                const doc = new DOMParser().parseFromString(
                  p.cooked,
                  "text/html",
                );
                return {
                  remoteId: String(p.id),
                  parentId: p.reply_to_post_number
                    ? String(p.reply_to_post_number)
                    : undefined,
                  author: p.username,
                  body: doc.body.textContent ?? "",
                  publishedAt: p.created_at,
                  url: `https://linux.do/t/${request.remoteId}/${p.post_number}`,
                };
              },
            ),
          nextCursor: start > 1 ? String(start) : undefined,
          scope: "最近 20 条回复；旧回复按需加载",
          complete: start <= 1,
        },
      });
    }
    const specs: Record<
      string,
      {
        metrics: [string, string, string][];
        root: string;
        comments: string;
        author: string;
        body: string;
        date: string;
      }
    > = {
      zhihu: {
        metrics: [
          ["vote", "赞同", ".Post-Main button.VoteButton--up"],
          ["comments", "评论", ".Post-Main button.ContentItem-action"],
        ],
        root: ".Post-Main",
        comments: ".CommentItemV2,.CommentItem",
        author: ".UserLink-link",
        body: ".CommentItemV2-content,.CommentItem-content",
        date: ".CommentItemV2-time,.CommentItem-time",
      },
      juejin: {
        metrics: [
          ["views", "阅读", ".article .views-count"],
          ["likes", "点赞", ".article-suspended-panel .panel-btn[data-badge]"],
        ],
        root: ".article-area",
        comments: ".comment-list .item",
        author: ".user-name,.username",
        body: ".content",
        date: ".time",
      },
      cnblogs: {
        metrics: [
          ["views", "阅读", "#post_view_count"],
          ["likes", "推荐", "#digg_count"],
          ["comments", "评论", "#post_comment_count"],
        ],
        root: "#main",
        comments: ".feedbackItem",
        author: ".comment_date + a",
        body: ".blog_comment_body",
        date: ".comment_date",
      },
      csdn: {
        metrics: [
          ["views", "阅读量", ".article-header-box .read-count"],
          ["likes", "点赞", ".tool-box .tool-item-huadian .count"],
          ["comments", "评论", ".tool-box .tool-item-comment .count"],
        ],
        root: ".blog-content-box",
        comments: ".comment-list-box .comment-list-item",
        author: ".user-name",
        body: ".comment-content",
        date: ".date",
      },
      xiaohongshu: {
        metrics: [
          ["likes", "点赞", ".interact-container .like-wrapper .count"],
          ["collects", "收藏", ".interact-container .collect-wrapper .count"],
          ["comments", "评论", ".interact-container .chat-wrapper .count"],
        ],
        root: ".note-detail-mask",
        comments: ".comment-item",
        author: ".author .name",
        body: ".content",
        date: ".date",
      },
    };
    const spec = specs[platform];
    if (!spec) throw new Error("该平台暂未接入读取功能");
    if (request.action === "metrics") {
      const metrics: Metric[] = [];
      for (const [key, label, selector] of spec.metrics) {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        ).filter(visible);
        const el = candidates.find(
          (e) =>
            platform !== "zhihu" ||
            key !== "comments" ||
            /评论/.test(e.innerText),
        );
        if (!el) continue;
        const raw = el.getAttribute("data-badge") ?? el.innerText;
        const match = raw
          .replaceAll(",", "")
          .match(/(\d+(?:\.\d+)?)\s*(万|亿|[kKwW])?/);
        if (!match) continue;
        const multiplier =
          match[2] === "亿"
            ? 1e8
            : match[2] === "万" || /[wW]/.test(match[2] ?? "")
              ? 1e4
              : /[kK]/.test(match[2] ?? "")
                ? 1e3
                : 1;
        metrics.push({ key, label, value: Number(match[1]) * multiplier, raw });
      }
      if (!metrics.length)
        throw new Error(
          "当前详情页没有可识别的文章指标。需验证此平台的数据页适配，旧数据已保留。",
        );
      return result({ metrics });
    }
    if (request.action === "comments") {
      const pages = Number(request.cursor ?? 0);
      if (!Number.isInteger(pages) || pages < 0 || pages > 50)
        throw new Error("评论页码无效，或超出一次加载范围。");
      for (let page = 0; page < pages; page++) {
        const next = button([
          "下一页",
          "加载更多评论",
          "查看更多评论",
          "展开更多评论",
        ]);
        if (!next)
          throw new Error("未识别到继续加载评论的入口，请在原站查看历史讨论。");
        click(next);
        await pause(700);
      }
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(spec.comments),
      ).filter(visible);
      const comments: CommentPage["comments"] = [];
      for (const node of nodes) {
        const body = node.querySelector<HTMLElement>(spec.body)?.innerText;
        const author = node.querySelector<HTMLElement>(spec.author)?.innerText;
        const remoteId =
          node.getAttribute("data-comment-id") ||
          node.getAttribute("data-id") ||
          node.id?.replace(/^comment[_-]/, "") ||
          node
            .querySelector('[id^="comment_body_"]')
            ?.id.replace("comment_body_", "");
        if (!body || !author || !remoteId) continue;
        comments.push({
          remoteId,
          author,
          body,
          publishedAt:
            node.querySelector<HTMLElement>(spec.date)?.innerText ?? "",
          url: location.href,
        });
      }
      if (!comments.length)
        throw new Error(
          "尚未读取到带稳定标识的评论；这不表示评论数为零。请在原站检查评论区域。",
        );
      const more = !!button([
        "下一页",
        "加载更多评论",
        "查看更多评论",
        "展开更多评论",
      ]);
      return result({
        comments: {
          comments,
          nextCursor: more
            ? String(Number(request.cursor ?? 0) + 1)
            : undefined,
          scope: "当前页面已加载评论；未自动遍历历史回复",
          complete: false,
        },
      });
    }
    throw new Error("不支持的页面操作");
  } catch (error) {
    return {
      ok: false,
      url: location.href,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
