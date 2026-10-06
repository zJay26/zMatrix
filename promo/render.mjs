// 逐帧渲染：node render.mjs --lang zh --fmt h [--fps 60] [--workers 4] [--snap 1,5.9,12]
// --snap 只导出指定时间点的静帧到 out/snap/，用于检查画面。
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const lang = arg("lang", "zh"), fmt = arg("fmt", "h");
const fps = Number(arg("fps", 60)), workers = Number(arg("workers", 4));
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "out");
mkdirSync(path.join(out, "snap"), { recursive: true });
const [W, H] = fmt === "v" ? [1080, 1920] : [1920, 1080];
const url = pathToFileURL(path.join(root, "video", "index.html")).href + `?lang=${lang}&fmt=${fmt}`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-checker-imaging", "--force-color-profile=srgb", "--allow-file-access-from-files"] });
const open = async (a = 0, b = 54) => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto(url + `&a=${a}&b=${b}`);
  await page.evaluate(() => window.ready);
  // 预热：每张截图都至少显示一次，保证解码完成
  for (const t of (x => x.filter((t) => t > a - 0.5 && t < b + 0.5))([11, 13.5, 14.5, 16.5, 17.5, 19.2, 19.7, 20.2, 21, 25.2, 25.7, 26.2, 26.7, 27.2, 27.7, 28.5, 33, 35, 37.5, 39, 40.5, 43, 45])) {
    await page.evaluate((t) => window.renderAt(t), t);
    await page.screenshot({ type: "jpeg", quality: 30 }).catch(() => {});
  }
  return page;
};

// 截图偶发失败（Unable to capture screenshot）时重试
const grab = async (page, opts) => {
  for (let i = 0; ; i++) {
    try {
      return await page.screenshot(opts);
    } catch (e) {
      if (i >= 6) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
};

const snap = arg("snap");
if (snap) {
  const page = await open();
  for (const t of snap.split(",").map(Number)) {
    await page.evaluate((t) => window.renderAt(t), t);
    await page.screenshot({ path: path.join(out, "snap", `${lang}_${fmt}_${t.toFixed(2).padStart(5, "0")}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const DUR = 54, total = Math.round(DUR * fps);
const per = Math.ceil(total / workers);
const segs = [];
const t0 = Date.now();
await Promise.all(
  Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    const seg = path.join(out, `seg_${lang}_${fmt}_${w}.mp4`);
    segs[w] = seg;
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709", seg], { stdio: ["pipe", "inherit", "inherit"] });
    const page = await open(a / fps, b / fps);
    for (let f = a; f < b; f++) {
      await page.evaluate((t) => window.renderAt(t), f / fps);
      const buf = await grab(page, { type: "jpeg", quality: 97 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (w === 0 && (f - a) % 120 === 0) console.log(`${lang}/${fmt} ${Math.round(((f - a) / (b - a)) * 100)}%  ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
  }),
);
await browser.close();

const list = path.join(out, `list_${lang}_${fmt}.txt`);
writeFileSync(list, segs.map((s) => `file '${s.split(path.sep).join("/")}'`).join("\n"));
const name = `zMatrix-promo-${lang}-${fmt === "v" ? "vertical-1080x1920" : "landscape-1920x1080"}.mp4`;
const audio = path.join(root, "audio", "soundtrack.wav");
const args = ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list];
if (existsSync(audio)) args.push("-i", audio, "-c:a", "aac", "-b:a", "256k", "-shortest");
args.push("-c:v", "copy", "-movflags", "+faststart", path.join(out, name));
execFileSync("ffmpeg", args, { stdio: "inherit" });
for (const s of [...segs, list]) rmSync(s);
console.log("done", name, `${Math.round((Date.now() - t0) / 1000)}s`);
