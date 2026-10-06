/* zMatrix 宣传视频时间线。
   renderAt(t) 是 t 的纯函数：同一个 t 永远得到同一帧，供 render.mjs 逐帧截图。
   URL 参数：lang=zh|en  fmt=h|v  t=<秒>（静帧） play=1（实时预览） */
const Q = new URLSearchParams(location.search);
const LANG = Q.get("lang") === "en" ? "en" : "zh";
const V = Q.get("fmt") === "v";
const W = V ? 1080 : 1920;
const H = V ? 1920 : 1080;
const DUR = 54;
const L = (zh, en) => (LANG === "zh" ? zh : en);
const F = (h, v) => (V ? v : h);

const stage = document.getElementById("stage");
stage.style.width = W + "px";
stage.style.height = H + "px";
stage.className = V ? "fmt-v" : "fmt-h";
document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";

/* ── helpers ─────────────────────────────────────────── */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, k) => a + (b - a) * k;
const E = {
  lin: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  out5: (t) => 1 - (1 - t) ** 5,
  in: (t) => t * t * t,
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
};
const p = (t, a, b, e = E.out) => e(clamp((t - a) / (b - a)));
// keys: [[t, v...], ...]；key 末尾为 "cut" 时直接跳变
function track(keys, t, e = E.io) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const n = typeof a[a.length - 1] === "string" ? a.length - 2 : a.length - 1;
  if (!b || t <= a[0] || b[b.length - 1] === "cut") return a.slice(1, n + 1);
  const k = e(clamp((t - a[0]) / (b[0] - a[0])));
  return a.slice(1, n + 1).map((v, j) => mix(v, b[j + 1], k));
}
const tr1 = (keys, t, e) => track(keys, t, e)[0];
function el(cls, html = "", parent = stage, tag = "div") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}
function put(e, x, y, o = 1, s = 1, r = 0, extra = "") {
  if (o <= 0.003) return void (e.style.display = "none");
  e.style.display = "";
  e.style.opacity = o > 0.997 ? 1 : o.toFixed(3);
  e.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) translate(-50%,-50%) ${extra} rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
}
const rnd = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const glyph = (g, c, size) =>
  `<span class="glyph" style="background:${c};width:${size}px;height:${size}px;font-size:${size * 0.52}px">${g}</span>`;
const CHECK = (s = 20) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 1054 1054" fill="none" style="overflow:visible">
<g class="pc"><path fill="#2D64E8" d="M377 161H539C589 161 629 201 629 251V328C629 347 624 353 606 353H500C418 353 358 398 358 442C358 481 383 501 440 490C524 474 600 437 676 437C723 437 754 442 756 459C763 479 726 506 675 547C604 601 547 628 455 628H275C207 628 162 583 162 515V379C162 260 258 161 377 161Z"/></g>
<g class="pc"><path fill="#25A982" d="M795 161H942L1092 305V537C1092 591 1052 628 993 628H863C785 628 732 645 693 686C658 723 633 782 631 860C584 867 533 867 514 851C488 829 514 797 548 768L880 515C923 482 947 450 947 419C947 378 915 353 853 353H690C672 353 667 347 667 330V286C667 214 721 161 795 161Z"/><path fill="#2D64E8" d="M942 161L1092 305H985C956 305 942 289 942 259Z"/></g>
<g class="pc"><path fill="#F2B647" d="M267 652H529C555 652 561 670 538 688L364 818C330 844 311 869 311 892C311 931 339 949 391 949H582C597 949 605 957 605 973V1014C605 1060 574 1093 528 1093H371C254 1093 160 1017 160 918V755C160 697 207 652 267 652Z"/></g>
<g class="pc"><path fill="#EC6E62" d="M889 652H986C1052 652 1097 694 1097 755V918C1097 1018 1006 1093 911 1093H728C675 1093 638 1054 638 1002V973C638 957 645 949 662 949H863C919 949 954 918 954 878C954 841 924 815 879 815C821 815 746 845 631 860C632 797 647 744 678 703C731 666 798 652 889 652Z"/></g></svg>`;

const PLATS = [
  { g: "知", c: "#1768d5", n: L("知乎", "Zhihu") },
  { g: "掘", c: "#356beb", n: L("掘金", "Juejin") },
  { g: "博", c: "#395291", n: L("博客园", "CNBlogs") },
  { g: "C", c: "#ca513e", n: "CSDN" },
  { g: "小", c: "#dc3a52", n: L("小红书", "Xiaohongshu") },
  { g: "L", c: "#9a6b1c", n: "LINUX DO" },
];
const PATHS = [
  { g: "知", c: "#1768d5", n: L("知乎 · 文章", "Zhihu · Article") },
  { g: "掘", c: "#356beb", n: L("掘金 · 文章", "Juejin · Article") },
  { g: "博", c: "#395291", n: L("博客园 · 文章", "CNBlogs · Article") },
  { g: "C", c: "#ca513e", n: L("CSDN · 文章", "CSDN · Article") },
  { g: "文", c: "#dc3a52", n: L("小红书 · 长文章", "Xiaohongshu · Long post") },
  { g: "图", c: "#dc3a52", n: L("小红书 · 图文笔记", "Xiaohongshu · Image note") },
];

/* ── background ──────────────────────────────────────── */
const bg = el("bg");
const blobs = [
  ["#2d64e8", 0.42, 0.25, 0.3],
  ["#25a982", 0.26, 0.8, 0.75],
  ["#ec6e62", 0.2, 0.85, 0.15],
].map(([c, o, x, y], i) => {
  const b = el("blob abs", "", bg);
  const size = Math.max(W, H) * 0.55;
  b.style.cssText += `width:${size}px;height:${size}px;background:${c};`;
  return { b, o, x, y, i };
});
el("grid abs", "", bg);
el("vignette abs", "", bg);
function drawBg(t) {
  const hook = 1 - p(t, 5.2, 6.4, E.io); // 开场偏暖、偏暗
  for (const { b, o, x, y, i } of blobs) {
    const cx = (x + 0.08 * Math.sin(t * 0.21 + i * 2.1)) * W;
    const cy = (y + 0.07 * Math.cos(t * 0.17 + i * 1.3)) * H;
    const oo = i === 2 ? mix(o, 0.5, hook) : mix(o, o * 0.35, hook);
    put(b, cx, cy, oo);
  }
}

/* ── scene 1: hook ───────────────────────────────────── */
const hook = (() => {
  const head = el("title");
  head.style.cssText += `font-size:${F(112, LANG === "zh" ? 104 : 96)}px;text-align:center;white-space:nowrap;`;
  head.innerHTML = F(L("一篇文章，要发<em class='hot'>六个平台</em>？", "One post. <em class='hot'>Six platforms?</em>"), L("一篇文章，<br>要发<em class='hot'>六个平台</em>？", "One post.<br><em class='hot'>Six platforms?</em>"));
  const steps = L(["复制正文", "粘贴", "改标题", "重新排版", "上传配图", "填标签"], ["Copy", "Paste", "Retitle", "Reformat", "Re-upload images", "Re-enter tags"]);
  const cw = F(440, 460), ch = F(250, 270), gx = F(480, 500), gy = F(285, 310);
  const cols = F(3, 2);
  const cx0 = W / 2 - ((cols - 1) * gx) / 2;
  const cy0 = F(455, 880);
  const cards = PLATS.map((pl, i) => {
    const c = el("paper");
    c.style.cssText += `width:${cw}px;height:${ch}px;`;
    c.innerHTML = `<div class="hd" style="font-size:26px">${glyph(pl.g, pl.c, 42)}<span>${pl.n}</span></div>
      <div class="sk" style="width:78%"></div><div class="sk" style="width:58%"></div><div class="sk" style="width:68%"></div>
      <div style="position:absolute;left:18px;bottom:18px" class="pill"></div>`;
    const pill = c.querySelector(".pill");
    pill.style.cssText += "background:#fdebe9;color:#c0352f;font-size:24px;";
    return { c, pill, x: cx0 + (i % cols) * gx, y: cy0 + Math.floor(i / cols) * gy, i };
  });
  const punch = el("title");
  punch.style.cssText += `font-size:${F(74, 80)}px;white-space:nowrap;text-align:center`;
  punch.innerHTML = L("同样的事，<em class='hot'>做六遍。</em>", "Same chore. <em class='hot'>Six times.</em>");
  return (t) => {
    const out = p(t, 5.15, 5.6, E.in);
    const up = p(t, 1.7, 2.4, E.io);
    const hin = p(t, 0.15, 0.9, E.out5);
    put(head, W / 2, mix(H * F(0.5, 0.46), F(150, 400), up) + (1 - hin) * 60, hin * (1 - out), mix(1, F(0.6, 0.78), up) * (1 - out * 0.3));
    for (const { c, pill, x, y, i } of cards) {
      const t0 = 2.2 + i * 0.33;
      const a = p(t, t0, t0 + 0.45, E.back);
      const shake = p(t, 3.6, 5.2, E.lin) * 7;
      const jx = Math.sin(t * 47 + i * 1.7) * shake;
      const jy = Math.cos(t * 41 + i * 2.3) * shake;
      const rot = (rnd(i) - 0.5) * 9 + Math.sin(t * 33 + i) * shake * 0.25;
      const k = Math.floor(Math.max(0, t - t0) / 0.33 + i * 2) % steps.length;
      pill.textContent = steps[k];
      put(c, mix(x + jx, W / 2, out), mix(y + jy, H / 2, out), clamp(a * 2) * (1 - out), mix(0.6, 1, a) * (1 - out * 0.9), rot + out * 40 * (rnd(i + 9) - 0.5));
    }
    const pin = p(t, 4.3, 4.75, E.back);
    put(punch, W / 2, F(1000, 1790), clamp(pin * 2) * (1 - out), mix(1.5, 1, pin));
  };
})();

/* ── scene 2: logo reveal ────────────────────────────── */
function logoBlock(size) {
  const wrap = el("");
  wrap.style.cssText += `width:${size}px;height:${size}px;`;
  wrap.innerHTML = ICON;
  const pcs = [...wrap.querySelectorAll(".pc")];
  pcs.forEach((g) => (g.style.cssText = "transform-box:fill-box;transform-origin:center"));
  return { wrap, pcs };
}
const DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
function assemble(pcs, k) {
  pcs.forEach((g, i) => {
    const a = E.out5(clamp(k * 1.25 - i * 0.08));
    const d = (1 - a) * 1500;
    g.style.transform = `translate(${DIRS[i][0] * d}px,${DIRS[i][1] * d}px) rotate(${(1 - a) * 160 * DIRS[i][0]}deg)`;
    g.style.opacity = clamp(a * 3);
  });
}
const ring = el("");
ring.style.cssText += "border-radius:50%;border:3px solid #7aa2ff;width:400px;height:400px;";
const logo = (() => {
  const { wrap, pcs } = logoBlock(F(300, 340));
  const word = el("title");
  word.style.cssText += `font-size:${F(150, 160)}px;font-weight:800;letter-spacing:-0.01em;white-space:nowrap`;
  word.innerHTML = [..."zMatrix"].map((c) => `<span style="display:inline-block">${c}</span>`).join("");
  const letters = [...word.children];
  const tag = el("title");
  tag.style.cssText += `font-size:${F(58, LANG === "zh" ? 66 : 60)}px;white-space:nowrap;text-align:center`;
  tag.innerHTML = L("一份母稿，<em>多种表达。</em>", F("One draft. <em>Every platform.</em>", "One draft.<br><em>Every platform.</em>"));
  const sub = el("sub");
  sub.style.cssText += `font-size:${F(28, 32)}px;white-space:nowrap;text-align:center;line-height:1.6`;
  sub.innerHTML = L(`面向个人创作者的本地内容工作台${F(" · ", "<br>")}Microsoft Edge 扩展`, `A local-first content workbench for creators${F(" · ", "<br>")}Microsoft Edge extension`);
  return (t) => {
    const out = p(t, 9.45, 9.95, E.in);
    const o = (t >= 5.5 ? 1 : 0) * (1 - out);
    const lift = -out * 60;
    const cy = F(370, 640);
    assemble(pcs, p(t, 5.5, 6.05, E.lin));
    const pop = 1 + 0.12 * (1 - p(t, 6.0, 6.5, E.out)) * (t >= 6 ? 1 : 0);
    put(wrap, W / 2, cy + lift, o, pop);
    const rk = p(t, 6.0, 6.9, E.out);
    put(ring, W / 2, cy, t >= 6 ? (1 - rk) * 0.9 : 0, mix(0.7, 3.2, rk));
    letters.forEach((s, i) => {
      const a = p(t, 6.55 + i * 0.06, 7.05 + i * 0.06, E.out5);
      s.style.transform = `translateY(${(1 - a) * 70}px)`;
      s.style.opacity = a;
    });
    put(word, W / 2, cy + F(270, 320) + lift, o * p(t, 6.5, 6.6));
    const a2 = p(t, 7.4, 8.0, E.out5);
    put(tag, W / 2, cy + F(420, LANG === "zh" ? 500 : 530) + (1 - a2) * 40 + lift, a2 * (1 - out));
    const a3 = p(t, 8.0, 8.6, E.out5);
    put(sub, W / 2, cy + F(520, LANG === "zh" ? 640 : 720) + (1 - a3) * 30 + lift, a3 * (1 - out));
  };
})();

/* ── app window ──────────────────────────────────────── */
const WIN = F({ x: 150, y: 262, w: 1620, h: 900, vh: 774 }, { x: 40, y: 640, w: 1000, h: 1080, vh: 1036 });
const SHOTS = ["ed0", "ed_scroll1", "ed_scroll2", "ed_add", "ed1", "ed_t1", "ed_t2", "ed_t3", "ed_s", "dd0", "dd1", "dd2", "dd3", "dd4", "dd5", "dd6", "dd_mode", "queue", "cs0", "cs1", "lib_matrix", "lib_matrix_dark"];
const STATES = [[0, "ed0"], [13.0, "ed_scroll1"], [14.2, "ed_scroll2"], [15.75, "ed0"], [16.25, "ed_add"], [16.95, "ed1"], [19.0, "ed_t1"], [19.5, "ed_t2"], [20.0, "ed_t3"], [20.55, "ed_s"], [24.9, "dd0"], [25.5, "dd1"], [26, "dd2"], [26.5, "dd3"], [27, "dd4"], [27.5, "dd5"], [28, "dd6"], [32, "dd_mode"], [34.7, "queue"], [37, "cs0"], [38.3, "cs1"], [41.8, "lib_matrix"]];
const CAM = F(
  [[10, 720, 344, 1.125], [11.6, 720, 344, 1.125], [12.8, 664, 420, 1.5], [13.0, 664, 430, 1.5], [15.4, 800, 520, 1.6], [15.9, 720, 344, 1.125], [16.2, 720, 450, 1.125], [17.0, 720, 450, 1.125], [17.6, 760, 230, 1.4], [18.1, 820, 240, 1.4], [18.7, 1070, 330, 2.0], [21.1, 1070, 330, 2.0], [21.9, 1070, 320, 1.7], [23.6, 1070, 320, 1.7], [24.2, 720, 344, 1.125], [25.0, 720, 344, 1.125], [25.5, 477, 470, 1.55], [28.2, 477, 490, 1.55], [29.0, 912, 624, 1.4], [30.2, 912, 624, 1.4],
    [32, 435, 300, 1.7, "cut"], [34.5, 435, 300, 1.78], [34.7, 836, 330, 1.2, "cut"], [36.95, 860, 400, 1.26], [37, 720, 450, 1.16, "cut"], [38.2, 720, 450, 1.16], [39.1, 790, 300, 1.45], [41.7, 790, 300, 1.45], [41.8, 836, 390, 1.2, "cut"], [46, 836, 400, 1.3]],
  [[10, 520, 450, 1.16], [11.6, 520, 450, 1.16], [12.8, 450, 430, 1.9], [13.0, 880, 560, 2.0, "cut"], [15.4, 880, 580, 2.0], [15.9, 600, 345, 1.3], [16.2, 600, 345, 1.3], [16.5, 720, 450, 1.5], [17.0, 720, 450, 1.5], [17.5, 560, 330, 1.6], [18.1, 1000, 330, 1.6], [18.7, 1232, 330, 2.4], [23.6, 1232, 330, 2.4], [24.2, 1100, 345, 1.5], [25.0, 1100, 345, 1.5], [25.5, 290, 470, 2.2], [28.2, 290, 490, 2.2], [29.0, 1177, 628, 1.9], [30.2, 1177, 628, 1.9],
    [32, 300, 300, 2.2, "cut"], [34.5, 300, 310, 2.26], [34.7, 610, 330, 1.5, "cut"], [36.95, 640, 380, 1.55], [37, 420, 480, 1.6, "cut"], [38.2, 420, 480, 1.6], [39.1, 700, 330, 2.0], [41.7, 700, 330, 2.0], [41.8, 600, 400, 1.6, "cut"], [42.3, 600, 400, 1.6], [43.8, 1000, 400, 1.6], [46, 1010, 400, 1.66]],
);
const side = F({ x: 300, y: -30, s: 0.68, ry: -12 }, { x: 0, y: -227, s: 0.58, ry: 0 });
const POSE = [ // t, x, y, scale, rotX, rotY, opacity, blur
  [9.9, 0, 220, 0.86, 26, 0, 0, 0], [10.9, 0, 0, 1, 0, 0, 1, 0], [21.1, 0, 0, 1, 0, 0, 1, 0], [21.9, side.x, side.y, side.s, 0, side.ry, 1, 0], [23.5, side.x, side.y, side.s, 0, side.ry, 1, 0], [24.2, 0, 0, 1, 0, 0, 1, 0],
  [29.75, 0, 0, 1, 0, 0, 1, 0], [30.2, 0, 0, 0.8, 0, 0, 0, 8], [32.9, 0, 120, 0.9, 16, 0, 0, 0], [33.5, 0, 0, 1, 0, 0, 1, 0], [39.2, 0, 0, 1, 0, 0, 1, 0], [39.8, 0, 0, 0.93, 0, 0, 0.2, 7], [41.5, 0, 0, 0.93, 0, 0, 0.2, 7], [42.1, 0, 0, 1, 0, 0, 1, 0], [45.8, 0, 0, 1, 0, 0, 1, 0], [46.2, 0, 0, 0.9, 0, 0, 0, 6],
];
const curStart = F([900, 450], [1150, 330]);
const CUR = [[15.5, 760, 520], [16.1, 364, 87], [16.3, 364, 87], [16.8, 916, 732], [17.0, 916, 732], [17.6, 1010, 560],
  [18.3, 1180, 420], [18.65, 1268, 258], [20.1, 1268, 258], [20.45, 1369, 357], [21.2, 1369, 357],
  [24.0, ...curStart], [24.7, 1363, 29], [25.0, 1363, 29], [25.45, 150, 350],
  ...[1, 2, 3, 4, 5].flatMap((k) => [[25.2 + 0.5 * k, 150, 350 + 55.6 * (k - 1)], [25.45 + 0.5 * k, 150, 350 + 55.6 * k]]),
  [28.3, 150, 628], [29.3, 1222, 802], [30.2, 1222, 802],
  [37.1, 620, 480], [37.8, 296, 715], [38.6, 296, 715], [39.2, 430, 640]];
const CUR_VIS = [[15.5, 17.6], [18.3, 21.2], [24.0, 30.0], [37.1, 39.2]];
const CLICKS = [16.2, 16.9, 18.7, 20.5, 24.85, 25.5, 26, 26.5, 27, 27.5, 28, 29.6, 37.9];

const win = el("");
win.id = "win";
win.style.cssText += `width:${WIN.w}px;height:${WIN.h}px;`;
win.innerHTML = `<div class="bar"><i class="dot" style="background:#ec6e62"></i><i class="dot" style="background:#f2b647"></i><i class="dot" style="background:#25a982"></i>
  <div class="tab">${ICON}<span>zMatrix · ${L("自媒体矩阵工作台", "Creator workbench")}</span></div></div><div class="view" style="height:${WIN.h - 44}px"><div class="ui"></div></div>`;
const ui = win.querySelector(".ui");
const imgs = {};
// 分段渲染时（?a=&b=）只加载该时间段用得到的截图，控制内存
const RA = Number(Q.get("a") ?? 0), RB = Number(Q.get("b") ?? DUR);
const inRange = (a, b) => a < RB + 0.5 && b > RA - 0.5;
for (const s of SHOTS) {
  const used = s === "lib_matrix_dark" ? inRange(44, 46.2) : STATES.some(([t0, n], i) => n === s && inRange(t0, (STATES[i + 1]?.[0] ?? 46.2) + 0.2));
  const im = el("", "", ui, "img");
  if (used) im.src = `ui/${s}.png`;
  imgs[s] = im;
}
const hl = el("hl", "", ui);
const ripple = el("ripple", "", ui);
const cursor = el("", `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5v17.2l4.6-4.3 3.1 6.8 2.7-1.2-3-6.7h6.3z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`, ui);
cursor.id = "cursor";

function drawWin(t) {
  const [x, y, s, rx, ry, o, blur] = track(POSE, t);
  if (t < 9.9 || t >= 46.2 || o <= 0.003) return void (win.style.display = "none");
  win.style.display = "";
  win.style.opacity = o;
  win.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
  win.style.transform = `translate(${WIN.x + x}px,${WIN.y + y}px) perspective(1800px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
  // camera
  let [cx, cy, z] = track(CAM, t);
  const tx = clamp(WIN.w / 2 - cx * z, WIN.w - 1440 * z, 0);
  const ty = clamp(WIN.vh / 2 - cy * z, Math.min(0, WIN.vh - 900 * z), 0);
  ui.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${z.toFixed(4)})`;
  // screenshot states
  let i = 0;
  while (i < STATES.length - 1 && STATES[i + 1][0] <= t) i++;
  const cur = STATES[i][1];
  const prev = i ? STATES[i - 1][1] : null;
  const fade = clamp((t - STATES[i][0]) / 0.14);
  for (const s2 of SHOTS) {
    const im = imgs[s2];
    if (s2 === cur) {
      im.style.display = "block";
      im.style.zIndex = 2;
      im.style.opacity = fade;
      im.style.clipPath = "";
    } else if (s2 === prev && fade < 1) {
      im.style.display = "block";
      im.style.zIndex = 1;
      im.style.opacity = 1;
    } else im.style.display = "none";
  }
  // light → dark wipe
  if (t >= 44 && t < 46.2) {
    const k = p(t, 44.0, 45.0, E.io) * 1.25;
    const d = imgs.lib_matrix_dark;
    d.style.display = "block";
    d.style.zIndex = 3;
    d.style.opacity = 1;
    d.style.clipPath = `polygon(0 0, ${k * 100}% 0, ${k * 100 - 25}% 100%, 0 100%)`;
  }
  // highlight “准备发布，手动确认”
  const hk = p(t, 33.5, 33.9, E.back) * (1 - p(t, 34.5, 34.7));
  if (hk > 0.01) {
    hl.style.display = "";
    hl.style.cssText += `left:264px;top:175px;width:168px;height:34px;opacity:${clamp(hk)};transform:scale(${mix(1.3, 1, clamp(hk))})`;
  } else hl.style.display = "none";
  // cursor
  const vis = CUR_VIS.some(([a, b]) => t >= a && t <= b);
  if (vis) {
    const [mx, my] = track(CUR, t);
    const last = CLICKS.filter((c) => c <= t).pop() ?? -9;
    const dt = t - last;
    const press = dt < 0.18 ? 1 - 0.18 * Math.sin((dt / 0.18) * Math.PI) : 1;
    cursor.style.display = "";
    cursor.style.left = mx + "px";
    cursor.style.top = my + "px";
    cursor.style.transform = `scale(${(press * 1.15) / z})`;
    if (dt >= 0 && dt < 0.45) {
      const k = E.out(dt / 0.45);
      ripple.style.display = "";
      ripple.style.left = mx + "px";
      ripple.style.top = my + "px";
      ripple.style.opacity = 1 - k;
      ripple.style.transform = `scale(${mix(0.2, 1.3, k) / z})`;
    } else ripple.style.display = "none";
  } else {
    cursor.style.display = "none";
    ripple.style.display = "none";
  }
}

/* ── captions ────────────────────────────────────────── */
const CAPS = [
  { a: 10, b: 15.6, k: L("01 · 写作", "01 · WRITE"), t: L("好内容，|<em>先在一处写完</em>", "Write it once,| <em>in one place</em>"), s: L("Markdown 实时预览 · 代码 · 表格 · 公式 · Mermaid", "Live Markdown preview · code · tables · LaTeX · Mermaid") },
  { a: 15.6, b: 18, k: L("01 · 写作", "01 · WRITE"), t: L("一份母稿，|<em>每个平台一个版本</em>", "One master draft,| <em>a version per platform</em>"), s: L("平台版本默认跟随母稿，也可以单独调整", "Versions follow the master, or diverge when you need") },
  { a: 18, b: 24, k: L("02 · 通用信息", "02 · SHARED DETAILS"), t: L("标签、摘要、封面，|<em>只填一次</em>", "Tags, summary, cover:| <em>fill in once</em>"), s: L("所有平台自动使用，个别平台可单独修改", "Every platform uses them. Override any one when needed") },
  { a: 24, b: 33, k: L("03 · 一步分发", "03 · DISTRIBUTE"), t: L("勾选平台，|<em>一步分发</em>", "Tick the platforms.| <em>Distribute in one step</em>"), s: L("实时检查每个平台是否就绪", "Readiness checked live for every platform") },
  { a: 33, b: 37, k: L("04 · 你来确认", "04 · YOU STAY IN CONTROL"), t: L("最终发布，|<em>始终由你点击</em>", "The final Publish click| <em>is always yours</em>"), s: L("任务逐个执行，停在原站发布按钮前", "Tasks run one by one and stop before the publish button") },
  { a: 37, b: 42, k: L("05 · 图文制作", "05 · CARD STUDIO"), t: L("长文，|<em>排成图文卡片</em>", "Long posts,| <em>laid out as image cards</em>"), s: L("三种模板 · 输出 1080 × 1440 PNG", "Three templates · 1080 × 1440 PNG export") },
  { a: 42, b: 44, k: L("06 · 内容库", "06 · LIBRARY"), t: L("每篇稿件 × 每个平台，|<em>状态一目了然</em>", "Every post × every platform,| <em>at a glance</em>"), s: L("平台矩阵视图", "Platform matrix view") },
  { a: 44, b: 46, k: L("07 · 外观", "07 · APPEARANCE"), t: L("浅色、深色，|<em>随你切换</em>", "Light or dark.| <em>Your call</em>"), s: L("也可以跟随系统", "Or follow the system setting") },
  { a: 46, b: 48, k: L("08 · 数据", "08 · YOUR DATA"), t: L("稿件留在本地，|<em>数据由你掌握</em>", "Drafts stay on your machine.| <em>Your data stays yours</em>"), s: "" },
].map((c) => {
  const e = el("cap");
  e.style.width = F(1800, 1000) + "px";
  const lines = V ? c.t.split("|").map((s) => s.trim()) : c.t.split("|");
  const tsize = F(LANG === "zh" ? 66 : 58, LANG === "zh" ? 88 : 66);
  e.innerHTML = `<div class="kicker" style="font-size:${F(19, 27)}px">${c.k}</div>
    <div class="title" style="font-size:${tsize}px;margin-top:${F(8, 22)}px">${lines.map((l) => `<span class="ln"><span class="in">${l}</span></span>`).join("")}</div>
    <div class="sub" style="font-size:${F(26, LANG === "zh" ? 33 : 30)}px;margin-top:${F(2, 14)}px">${c.s}</div>`;
  return { ...c, e, kicker: e.children[0], ins: [...e.querySelectorAll(".in")], sub: e.children[2] };
});
function drawCaps(t) {
  for (const c of CAPS) {
    const out = p(t, c.b - 0.28, c.b - 0.02, E.in);
    if (t < c.a || t >= c.b) {
      c.e.style.display = "none";
      continue;
    }
    c.e.style.display = "";
    c.e.style.transform = `translate(${W / 2}px,${F(40, 168) - out * 26}px) translate(-50%,0)`;
    c.e.style.opacity = 1 - out;
    const k0 = p(t, c.a + 0.02, c.a + 0.45);
    c.kicker.style.opacity = k0;
    c.kicker.style.transform = `translateY(${(1 - k0) * -14}px)`;
    c.ins.forEach((s, i) => {
      const a = p(t, c.a + 0.1 + i * 0.12, c.a + 0.7 + i * 0.12, E.out5);
      s.style.transform = `translateY(${(1 - a) * 110}%)`;
    });
    const k2 = p(t, c.a + 0.45, c.a + 0.95);
    c.sub.style.opacity = k2;
    c.sub.style.transform = `translateY(${(1 - k2) * 16}px)`;
  }
}

/* ── scene 3 extras: format tags ─────────────────────── */
const fmtTags = [L("代码块", "Code"), L("表格", "Tables"), "Mermaid", "LaTeX"].map((n, i) => {
  const e = el("tag", n);
  e.style.fontSize = F(30, 34) + "px";
  return { e, i };
});
function drawTags(t) {
  for (const { e, i } of fmtTags) {
    const t0 = 13.3 + i * 0.5;
    const a = p(t, t0, t0 + 0.4, E.back) * (1 - p(t, 15.3, 15.6, E.in));
    const x = F(1760 + (i % 2) * 40, 150 + i * 260);
    const y = F(430 + i * 130, 1660 + (i % 2) * 34);
    put(e, x, y + Math.sin(t * 1.6 + i) * 6, clamp(a * 2), mix(0.5, 1, a), (i % 2 ? 1 : -1) * 4);
  }
}

/* ── scene 4 extras: one set of details → six platforms ── */
const share = (() => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "lines abs");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  stage.appendChild(svg);
  const cw = F(560, 490), chh = F(80, 104);
  const items = PATHS.map((pl, i) => {
    const e = el("chip");
    e.style.cssText += `width:${cw}px;height:${chh}px;font-size:${F(25, LANG === "zh" ? 27 : 21)}px;`;
    e.innerHTML = `${glyph(pl.g, pl.c, F(46, 54))}<span>${pl.n}</span><span class="ok">${CHECK(F(22, 26))}</span>`;
    const x = F(130 + cw / 2, 40 + cw / 2 + (i % 2) * (cw + 20));
    const y = F(330 + i * 102, 1350 + Math.floor(i / 2) * 124);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sx = F(790, 540), sy = F(650 + (i - 2.5) * 26, 1262);
    const ex = F(x + cw / 2, x), ey = F(y, y - chh / 2);
    path.setAttribute("d", V ? `M${sx},${sy} C${sx},${sy + 50} ${ex},${ey - 60} ${ex},${ey}` : `M${sx},${sy} C${sx - 70},${sy} ${ex + 70},${ey} ${ex},${ey}`);
    path.setAttribute("pathLength", 1);
    path.setAttribute("stroke", "#6f97ff");
    path.setAttribute("stroke-width", 3);
    path.setAttribute("stroke-dasharray", 1);
    svg.appendChild(path);
    return { e, x, y, path, ok: e.querySelector(".ok"), i };
  });
  const label = el("pill", L("通用标签 · 摘要 · 封面", "Shared tags · summary · cover"));
  label.style.cssText += `background:#2d64e8;color:#fff;font-size:${F(24, 28)}px;padding:10px 22px;box-shadow:0 10px 40px #2d64e888`;
  return (t) => {
    const out = p(t, 23.5, 23.95, E.in);
    svg.style.display = t > 21.5 && t < 24 ? "" : "none";
    for (const { e, x, y, path, ok, i } of items) {
      const t0 = 21.7 + i * 0.16;
      const ln = p(t, t0, t0 + 0.45, E.io);
      path.setAttribute("stroke-dashoffset", 1 - ln);
      path.setAttribute("opacity", 0.75 * (1 - out));
      const a = p(t, t0 + 0.25, t0 + 0.65, E.back);
      put(e, x - (1 - a) * F(-60, 0), y + (1 - a) * F(0, 40), clamp(a * 2) * (1 - out), mix(0.85, 1, a));
      const c = p(t, t0 + 0.6, t0 + 0.9, E.back);
      ok.style.opacity = clamp(c * 2);
      ok.style.transform = `scale(${c})`;
    }
    const la = p(t, 21.5, 21.9, E.back);
    put(label, F(790, 540), F(560, 1262), clamp(la * 2) * (1 - out), la);
  };
})();

/* ── scene 5 extras: ready counter + fan-out burst ───── */
const counter = (() => {
  const e = el("feat");
  e.style.cssText += `width:${F(360, 400)}px;height:${F(210, 220)}px;flex-direction:column;justify-content:center;gap:6px;text-align:center;white-space:nowrap;padding:0`;
  e.innerHTML = `<b style="font-size:${F(84, 92)}px;line-height:1.1;white-space:nowrap"><span class="grad n" style="display:inline">0</span><span style="color:#5b6a8c;display:inline"> / 6</span></b><span style="font-size:${F(26, 30)}px">${L("平台就绪", "platforms ready")}</span>`;
  const n = e.querySelector(".n");
  return (t) => {
    const a = p(t, 25.3, 25.7, E.back) * (1 - p(t, 28.4, 28.8, E.in));
    const count = clamp(Math.floor((t - 25.5) / 0.5) + 1, 0, 6);
    n.textContent = count;
    const last = 25.5 + (count - 1) * 0.5;
    const bump = count ? 1 + 0.1 * (1 - p(t, last, last + 0.25)) : 1;
    put(e, F(1500, 800), F(560, 1560), clamp(a * 2), mix(0.6, 1, a) * bump);
  };
})();
const burst = (() => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "lines abs");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  stage.appendChild(svg);
  const mw = F(300, 360), mh = F(210, 240);
  const mx = W / 2, my0 = F(600, 1050), my1 = F(380, 800);
  const pw = F(262, 480), ph = F(250, 190);
  const items = PATHS.map((pl, i) => {
    const e = el("paper");
    e.style.cssText += `width:${pw}px;height:${ph}px;`;
    e.innerHTML = `<div class="hd" style="font-size:${F(LANG === "zh" ? 21 : 14.5, LANG === "zh" ? 27 : 22)}px;padding-right:8px">${glyph(pl.g, pl.c, F(38, 46))}<span>${pl.n}</span></div>
      <div class="sk" style="width:76%"></div><div class="sk" style="width:56%"></div>${V ? "" : '<div class="sk" style="width:66%"></div>'}
      <div class="pill" style="position:absolute;left:16px;bottom:16px;background:#e3f5ee;color:#14805f;font-size:${F(20, 24)}px">${CHECK(F(16, 20))}${L("就绪", "Ready")}</div>`;
    const x = F(W / 2 + (i - 2.5) * 292, 40 + pw / 2 + (i % 2) * (pw + 40));
    const y = F(800, 1140 + Math.floor(i / 2) * 215);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M${mx},${my1 + mh / 2 - 10} C${mx},${my1 + mh / 2 + 110} ${x},${y - ph / 2 - 120} ${x},${y - ph / 2}`);
    path.setAttribute("pathLength", 1);
    path.setAttribute("stroke", pl.c);
    path.setAttribute("stroke-width", 4);
    path.setAttribute("stroke-dasharray", 1);
    svg.appendChild(path);
    return { e, x, y, path, pill: e.querySelector(".pill"), i };
  });
  const master = el("paper");
  master.style.cssText += `width:${mw}px;height:${mh}px;box-shadow:0 0 120px #2d64e8aa,0 30px 80px #000a`;
  master.innerHTML = `<div class="hd" style="font-size:${F(30, 36)}px"><span style="width:${F(42, 50)}px;display:inline-block;line-height:0">${ICON}</span>${L("母稿", "Master draft")}</div>
    <div class="sk" style="width:82%;background:#2d64e8"></div><div class="sk" style="width:74%"></div><div class="sk" style="width:60%"></div><div class="sk" style="width:68%"></div>`;
  const label = el("title");
  label.style.cssText += `font-size:${F(54, LANG === "zh" ? 62 : 52)}px;white-space:nowrap;text-align:center`;
  label.innerHTML = L("一份母稿 <span style='color:#5b6a8c'>→</span> <em>六份平台版本</em>", F("One draft <span style='color:#5b6a8c'>→</span> <em>six platform versions</em>", "One draft <span style='color:#5b6a8c'>→</span><br><em>six platform versions</em>"));
  return (t) => {
    const out = p(t, 32.6, 33.0, E.in);
    const on = t >= 29.9 && t < 33;
    svg.style.display = on ? "" : "none";
    const a = p(t, 29.95, 30.4, E.back);
    const up = p(t, 30.4, 31.0, E.io);
    put(master, mx, mix(my0, my1, up), on ? clamp(a * 2) * (1 - out) : 0, mix(0.4, 1.25, a) * mix(1, 0.8, up) * (1 - out * 0.1));
    for (const { e, x, y, path, pill, i } of items) {
      const t0 = 30.5 + i * 0.09;
      const k = p(t, t0, t0 + 0.6, E.out5);
      path.setAttribute("stroke-dashoffset", 1 - p(t, t0, t0 + 0.55, E.io));
      path.setAttribute("opacity", 0.8 * (1 - out));
      put(e, mix(mx, x, k), mix(my1, y, k) + Math.sin(t * 1.4 + i) * 5 * k, on ? clamp(k * 3) * (1 - out) : 0, mix(0.3, 1, k), (1 - k) * 30 * (i - 2.5));
      const c = p(t, 31.3 + i * 0.1, 31.6 + i * 0.1, E.back);
      pill.style.opacity = clamp(c * 2);
      pill.style.transform = `scale(${c})`;
    }
    const la = p(t, 31.2, 31.8, E.out5);
    put(label, W / 2, F(1000, 1810) + (1 - la) * 30, on ? la * (1 - out) : 0);
  };
})();

/* ── scene 7 extras: real exported cards fan out ─────── */
const fan = (() => {
  const cw = F(330, 400), chh = (cw * 4) / 3;
  const cards = [1, 2, 3, 4].map((n, i) => {
    const e = el("cardimg", "", stage, "img");
    if (inRange(39, 42)) e.src = `ui/card${n}.png`;
    e.style.cssText += `width:${cw}px;height:${chh}px;`;
    return { e, i };
  });
  return (t) => {
    const out = p(t, 41.55, 41.95, E.in);
    for (const { e, i } of cards) {
      const t0 = 39.45 + i * 0.14;
      const a = p(t, t0, t0 + 0.6, E.back);
      const x = F(W / 2 + (i - 1.5) * 372, 300 + (i % 2) * 480);
      const y = F(690 + Math.abs(i - 1.5) * 22, 950 + Math.floor(i / 2) * 570);
      const r = F((i - 1.5) * 4.5, (i % 2 ? 1 : -1) * 2.5);
      put(e, x, y + (1 - a) * 500 + Math.sin(t * 1.3 + i * 1.1) * 7 - out * 80, clamp(a * 2.5) * (1 - out), mix(0.7, 1, a), r + (1 - a) * 14);
    }
  };
})();

/* ── scene 8 extras: data ownership ──────────────────── */
const own = (() => {
  const rows = [
    ['<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>', L("本地优先", "Local-first"), L("稿件保存在浏览器本地", "Drafts live in your browser")],
    ['<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.19"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07"/>', L("没有服务器", "No server"), L("无自建服务器，无遥测", "No backend, no telemetry")],
    ['<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', L("不存密码", "No passwords stored"), L("使用浏览器已有登录状态", "Uses your existing browser logins")],
    ['<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>', L("开源", "Open source"), L("MIT 许可，代码公开", "MIT licensed, code on GitHub")],
  ].map(([ic, a, b], i) => {
    const e = el("feat");
    const w = F(800, 940), hh = F(190, 190);
    e.style.cssText += `width:${w}px;height:${hh}px;`;
    e.innerHTML = `<span class="ico" style="background:${["#2d64e8", "#25a982", "#d99a22", "#ec6e62"][i]}"><svg width="${F(52, 56)}" height="${F(52, 56)}" viewBox="0 0 24 24">${ic}</svg></span><div><b style="font-size:${F(44, 46)}px">${a}</b><span style="font-size:${F(27, 30)}px">${b}</span></div>`;
    const x = F(W / 2 + (i % 2 ? 1 : -1) * 420, W / 2);
    const y = F(430 + Math.floor(i / 2) * 230, 720 + i * 230);
    return { e, x, y, i };
  });
  return (t) => {
    const out = p(t, 47.6, 47.98, E.in);
    for (const { e, x, y, i } of rows) {
      const t0 = 46.1 + i * 0.13;
      const a = p(t, t0, t0 + 0.5, E.back);
      put(e, x, y + (1 - a) * 70 - out * 40, clamp(a * 2) * (1 - out), mix(0.85, 1, a));
    }
  };
})();

/* ── logo bug (persistent during product scenes) ─────── */
const bug = el("bug", `${ICON}<span>zMatrix</span>`);
function drawBug(t) {
  const a = p(t, 10.2, 10.8) * (1 - p(t, 47.6, 48)) * (V ? 1 - p(t, 29.8, 30.2) + p(t, 33, 33.4) : 1);
  put(bug, F(130, W / 2), F(64, 1800), a * 0.92, F(1, 1.25));
}

/* ── scene 9: end card ───────────────────────────────── */
const end = (() => {
  const { wrap, pcs } = logoBlock(F(190, 240));
  const word = el("title", "zMatrix");
  word.style.cssText += `font-size:${F(120, 140)}px;font-weight:800;white-space:nowrap`;
  const tag = el("title");
  tag.style.cssText += `font-size:${F(50, LANG === "zh" ? 58 : 50)}px;white-space:nowrap;text-align:center;line-height:1.3`;
  tag.innerHTML = L(`把重复操作留给工具，${F("", "<br>")}<em>把表达留给自己。</em>`, `Leave the repetition to the tool.${F(" ", "<br>")}<em>Keep the voice yours.</em>`);
  const cta = el("cta");
  cta.style.cssText += `font-size:${F(44, 46)}px;padding:${F("26px 64px", "30px 60px")};`;
  cta.innerHTML = `<span>${L("免费下载预览版", "Download the free preview")}</span><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v13M6 12l6 6 6-6M5 21h14"/></svg><i class="shine"></i>`;
  const shine = cta.querySelector(".shine");
  const url = el("title", "github.com/zJay26/zMatrix");
  url.style.cssText += `font-size:${F(40, 44)}px;font-weight:700;white-space:nowrap;letter-spacing:0.01em;color:#dbe6ff`;
  const chips = PLATS.map((pl, i) => {
    const e = el("chip");
    e.style.cssText += `height:${F(60, 72)}px;font-size:${F(23, 27)}px;gap:12px;padding:0 20px 0 10px;border-radius:16px`;
    e.innerHTML = `${glyph(pl.g, pl.c, F(40, 50))}<span>${pl.n}</span>`;
    return { e, i };
  });
  const foot = el("sub");
  foot.style.cssText += `font-size:${F(22, 26)}px;white-space:nowrap;text-align:center;line-height:1.7;color:#7f8fb3`;
  foot.innerHTML = L(`Microsoft Edge 扩展 · v0.5.0 开发预览 · MIT 开源${F(" · ", "<br>")}演示画面为本地预览，使用内置示例稿`, `Microsoft Edge extension · v0.5.0 developer preview · MIT${F(" · ", "<br>")}Demo recorded in local preview with sample content`);
  return (t) => {
    const fade = 1 - p(t, 53.4, 53.95, E.io);
    const on = t >= 48 ? fade : 0;
    const cy = F(210, 430);
    assemble(pcs, p(t, 48.0, 48.5, E.lin));
    const pop = 1 + 0.1 * (1 - p(t, 48.45, 48.9));
    put(wrap, W / 2, cy, on, pop);
    const a1 = p(t, 48.5, 49.0, E.out5);
    put(word, W / 2, cy + F(175, 220) + (1 - a1) * 40, a1 * on);
    const a2 = p(t, 48.9, 49.5, E.out5);
    put(tag, W / 2, cy + F(300, 400) + (1 - a2) * 40, a2 * on);
    const a3 = p(t, 49.6, 50.1, E.back);
    put(cta, W / 2, cy + F(455, 640), clamp(a3 * 2) * on, mix(0.6, 1, a3) * (1 + 0.025 * Math.sin((t - 50) * 4.2) * p(t, 50.2, 50.6)));
    shine.style.left = mix(-40, 130, p(t, 50.3, 51.3, E.io)) + "%";
    const a4 = p(t, 50.1, 50.6, E.out5);
    put(url, W / 2, cy + F(575, 780) + (1 - a4) * 24, a4 * on);
    // platform chips: one row (横屏) / 3 × 2（竖屏）
    const widths = chips.map(({ e }) => {
      e.style.display = "";
      return e.offsetWidth;
    });
    const gap = F(18, 20);
    const rows = F([[0, 1, 2, 3, 4, 5]], [[0, 1, 2], [3, 4, 5]]);
    rows.forEach((row, r) => {
      const total = row.reduce((s, i) => s + widths[i], 0) + gap * (row.length - 1);
      let x = W / 2 - total / 2;
      for (const i of row) {
        const a = p(t, 50.6 + i * 0.07, 51.0 + i * 0.07, E.back);
        put(chips[i].e, x + widths[i] / 2, cy + F(680, 940) + r * 96 + (1 - a) * 30, clamp(a * 2) * on, mix(0.8, 1, a));
        x += widths[i] + gap;
      }
    });
    const a5 = p(t, 51.2, 51.8);
    put(foot, W / 2, F(1010, 1700), a5 * on * 0.95);
  };
})();

/* ── flashes ─────────────────────────────────────────── */
const flash = el("flash abs");
function drawFlash(t) {
  let o = 0;
  for (const [t0, amp] of [[6.0, 0.85], [30.0, 0.5], [48.0, 0.7]]) if (t >= t0) o = Math.max(o, amp * (1 - p(t, t0, t0 + 0.45, E.out)));
  o = Math.max(o, 1 - p(t, 0, 0.35)); // open from white-ish? no: open from black
  flash.style.background = t < 0.5 ? "#060914" : "#fff";
  flash.style.display = o > 0.003 ? "" : "none";
  flash.style.opacity = o;
  flash.style.zIndex = 99;
}

/* ── master ──────────────────────────────────────────── */
function renderAt(t) {
  drawBg(t);
  hook(t);
  logo(t);
  drawWin(t);
  drawCaps(t);
  drawTags(t);
  share(t);
  counter(t);
  burst(t);
  fan(t);
  own(t);
  drawBug(t);
  end(t);
  drawFlash(t);
}
window.renderAt = renderAt;
window.DUR = DUR;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  renderAt(Number(Q.get("t") ?? 0));
  if (Q.get("play")) {
    const t0 = performance.now() - Number(Q.get("t") ?? 0) * 1000;
    const loop = () => {
      renderAt(((performance.now() - t0) / 1000) % DUR);
      requestAnimationFrame(loop);
    };
    loop();
  }
  return true;
})();
