# zMatrix 宣传视频

54 秒，中文 / 英文 × 横屏 1920×1080 / 竖屏 1080×1920，60 fps。成片在 `out/`。

## 画面来源

界面画面是 `npm run preview`（本地网页预览）的真实截图，使用内置示例稿和几篇临时演示稿件；没有连接平台，没有登录账号。图文卡片是“制作图文”实际导出的 1080×1440 PNG。本地预览特有的提示条（“这是本地界面预览…”）在截图时隐藏。

视频中的说法只取自 README 和更新记录已有的表述。结尾注明“v0.5.0 开发预览”和“演示画面为本地预览，使用内置示例稿”。真实平台端到端验收状态见 `docs/acceptance.md`，视频没有展示也不暗示原站自动发布。

英文版只翻译了字幕和图形文字，界面本身仍是中文。

## 重新生成

```sh
cd promo
npm install                       # playwright-core，使用本机 Chrome
# 1. 界面截图（先在仓库根目录启动 npm run preview，或用 localhost:5173 的任意预览）
node capture-ui.mjs               # → video/ui/*.png
# 2. 配乐与音效（numpy 程序化合成，无第三方素材）
python audio/make_soundtrack.py   # → audio/soundtrack.wav
# 3. 渲染
node render.mjs --lang zh --fmt h # 中文横屏；--lang en、--fmt v 得到其余三版
node render.mjs --lang zh --fmt h --snap 12,26.3,31   # 只导出静帧检查
```

需要 Node 24、Python（numpy、Pillow）、ffmpeg 和本机 Chrome。

## 文件

| 文件 | 内容 |
| --- | --- |
| `video/timeline.js` | 全部分镜。`renderAt(t)` 是时间的纯函数，文案、镜头、光标轨迹都在这里 |
| `video/style.css` | 视觉样式 |
| `capture-ui.mjs` | 驱动本地预览并截图 |
| `render.mjs` | 逐帧截图 → ffmpeg 编码 → 混入音轨 |
| `audio/make_soundtrack.py` | 120 BPM 配乐与界面音效，节点与时间线对齐 |

实时预览：用浏览器打开 `video/index.html?lang=zh&fmt=h&play=1`（需允许本地文件，或用任意静态服务器）。

## 分镜

| 时间 | 内容 |
| --- | --- |
| 0–6 s | 痛点：一篇文章发六个平台，同样的事做六遍 |
| 6–10 s | 标志与主张：一份母稿，多种表达 |
| 10–18 s | 写作：Markdown 实时预览，母稿与平台版本 |
| 18–24 s | 通用发布信息只填一次 |
| 24–33 s | 勾选平台，一步分发 |
| 33–37 s | 最终发布由你点击 |
| 37–42 s | 图文卡片 |
| 42–48 s | 平台矩阵、深色外观、本地优先 |
| 48–54 s | 下载引导 |
