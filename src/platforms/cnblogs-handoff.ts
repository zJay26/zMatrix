// Runs in the ISOLATED world at document_start, before the site's click handlers.
// No page script can manufacture Event.isTrusted or call chrome.runtime here.
export function installCnblogsHandoff() {
  type State = { token: string; phase: "filling" | "ready" };
  const scope = window as unknown as { __zmatrixCnblogsHandoff?: State };
  let state: State | undefined;
  let busy = false;
  let banner: HTMLElement | undefined;
  let notice = "zMatrix 正在填充内容，发布保护已开启。";
  const show = (text: string) => {
    notice = text;
    if (!document.body) return;
    if (!banner) {
      banner = document.createElement("div");
      banner.setAttribute("role", "status");
      banner.style.cssText =
        "position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:12px 18px;background:#eef4ff;color:#193969;border:1px solid #a8c2ed;border-radius:10px;font:14px/1.6 sans-serif;pointer-events:none";
      document.body.append(banner);
    }
    banner.textContent = text;
  };
  const labels = [
    "发布",
    "发布文章",
    "确认发布",
    "立即发布",
    "保存草稿",
    "存草稿",
    "存为草稿",
    "保存为草稿",
  ];
  const labelOf = (button: HTMLElement) =>
    (button.textContent || button.getAttribute("value") || "")
      .replace(/[\uE000-\uF8FF]/g, "")
      .trim();
  const capture = (event: MouseEvent) => {
    if (!state) return;
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            'button,[role="button"],input[type="submit"],input[type="button"],a',
          )
        : null;
    if (!button || !labels.includes(labelOf(button))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.isTrusted || event.button !== 0 || busy) return;
    if (state.phase !== "ready") {
      show("内容尚未准备完成，请等待工作台结果。发布保护仍在生效。");
      return;
    }
    if (
      (button as HTMLButtonElement).disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      !button.getClientRects().length ||
      button.closest('[inert],[aria-hidden="true"]')
    )
      return;
    busy = true;
    const intent = labelOf(button);
    void chrome.runtime
      .sendMessage({ type: "cnblogsGuardRelease", token: state.token })
      .then((reply) => {
        if (!reply?.ok)
          throw new Error(
            reply?.error || "无法交还原站操作，请重新加载扩展后重试。",
          );
        state = undefined;
        delete scope.__zmatrixCnblogsHandoff;
        show(`你已选择“${intent}”，操作已交还博客园，请核对原站结果。`);
        // Replay only the exact native control the user just physically clicked.
        // Preparation code and synthetic clicks can never reach this branch.
        if (button.isConnected && labelOf(button) === intent)
          HTMLElement.prototype.click.call(button);
      })
      .catch((error: unknown) =>
        show(
          error instanceof Error
            ? error.message
            : "交接失败，发布保护仍在生效。",
        ),
      )
      .finally(() => {
        busy = false;
      });
  };
  window.addEventListener("click", capture, true);
  const submit = (event: SubmitEvent) => {
    if (state) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener("submit", submit, true);
  const ready = (
    message: { type?: string; token?: string },
    _sender?: chrome.runtime.MessageSender,
    respond?: (reply: unknown) => void,
  ) => {
    if (
      message.type === "cnblogsGuardReady" &&
      state &&
      state.token === message.token
    ) {
      state.phase = "ready";
      show(
        "zMatrix 已停在发布前。只有你点击原站的“发布”或“存为草稿”才会提交。",
      );
      respond?.({ ok: true });
    }
  };
  chrome.runtime.onMessage.addListener(ready);
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      if (state) show(notice);
    },
    { once: true },
  );
  void chrome.runtime
    .sendMessage({ type: "cnblogsGuardStatus" })
    .then((reply) => {
      if (!reply?.ok || !reply.guard) return;
      state = { token: reply.guard.token, phase: reply.guard.phase };
      scope.__zmatrixCnblogsHandoff = state;
      if (state!.phase === "ready")
        ready({ type: "cnblogsGuardReady", token: state!.token });
      else show(notice);
    })
    .catch(() => {}); // The browser rule stays active if the worker cannot reply.
  return () => {
    window.removeEventListener("click", capture, true);
    window.removeEventListener("submit", submit, true);
    chrome.runtime.onMessage.removeListener(ready);
    delete scope.__zmatrixCnblogsHandoff;
    banner?.remove();
  };
}

// Serialized into the same isolated world to verify listener readiness before fill.
export function cnblogsHandoffToken() {
  return (window as unknown as { __zmatrixCnblogsHandoff?: { token: string } })
    .__zmatrixCnblogsHandoff?.token;
}
