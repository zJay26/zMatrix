import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rendering dependency stays outside the extension's runtime dependencies.
const require = createRequire(process.env.ZMATRIX_RENDER_MODULES
  ? join(process.env.ZMATRIX_RENDER_MODULES, '_design-render.cjs') : import.meta.url);
const sharp = require('sharp');
const root = dirname(fileURLToPath(import.meta.url));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const tile = color => `<rect x="4" y="4" width="120" height="120" rx="30" fill="${color}"/>`;
const z = (color = '#fff') => `<path d="M33 35H95V51L56 78H95V94H33V78L72 51H33Z" fill="${color}"/>`;
const pixels = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 4), col = i % 4;
  const active = row === 0 || row === 3 || col === 3 - row;
  return `<rect x="${23 + col * 22}" y="${23 + row * 22}" width="16" height="16" rx="3" fill="${active ? '#80F1D3' : '#31535B'}"/>`;
}).join('');

const options = [
  { id: 'A', slug: 'minimal-z', title: '极简 z', note: '个人标识最直接，干净利落', color: '#355BEB',
    body: tile('#355BEB') + z() },
  { id: 'B', slug: 'pixel-matrix', title: '像素矩阵', note: '用矩阵里的亮点拼出 z', color: '#143D48',
    body: tile('#143D48') + pixels },
  { id: 'C', slug: 'one-to-many', title: '一稿多发', note: '一份内容，连接多个平台', color: '#218C80',
    body: `<path d="M51 64H73M73 30V98M73 30H95M73 64H95M73 98H95" fill="none" stroke="#218C80" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="6" y="39" width="50" height="50" rx="17" fill="#218C80"/>
      <path d="M18 51H44V58L28 70H44V77H18V70L34 58H18Z" fill="#fff"/>
      <rect x="88" y="16" width="28" height="28" rx="9" fill="#42AF9B"/>
      <rect x="88" y="50" width="28" height="28" rx="9" fill="#218C80"/>
      <rect x="88" y="84" width="28" height="28" rx="9" fill="#86C9BA"/>` },
  { id: 'D', slug: 'vermilion-seal', title: '朱砂印', note: '像给每篇作品落下一枚印章', color: '#B84435',
    body: `<path d="M25 7L105 5Q121 6 122 23L121 104Q121 121 104 122L24 120Q7 120 6 103L7 25Q7 8 25 7Z" fill="#B84435"/>
      <rect x="17" y="17" width="94" height="94" rx="7" fill="none" stroke="#FFEADF" stroke-width="3.5"/>
      <path d="M32 33H95V50L57 78H95V96H32V78L71 51H32Z" fill="#FFEADF"/>` },
  { id: 'E', slug: 'editorial-pages', title: '叠页', note: '母稿与各平台版本，一眼可见', color: '#DB923C',
    body: tile('#F2B34F') + `<rect x="36" y="27" width="69" height="84" rx="10" transform="rotate(10 70 69)" fill="#B96926"/>
      <path d="M31 20H75L94 39V98Q94 106 85 106H31Q23 106 23 98V28Q23 20 31 20Z" fill="#FFFCF6"/>
      <path d="M75 20V32Q75 40 83 40H94Z" fill="#F7D894"/>
      <path d="M38 49H79V61L54 78H79V90H38V78L63 61H38Z" fill="#80512B"/>` },
  { id: 'F', slug: 'folded-ribbon', title: '折带 z', note: '一条折带串起内容的流动', color: '#2C68D7',
    body: `<path d="M18 22H110L90 43H18Z" fill="#53CEC4"/>
      <path d="M90 43H110L39 106H18Z" fill="#2B92B6"/>
      <path d="M39 85H110V106H18Z" fill="#355BEB"/>
      <path d="M90 43L110 22V43Z" fill="#198988"/>
      <path d="M18 85L39 85L18 106Z" fill="#244CB3"/>` },
  { id: 'G', slug: 'conversation', title: '对话气泡', note: '内容与互动，都有自己的位置', color: '#7952CA',
    body: `<rect x="54" y="45" width="69" height="63" rx="20" fill="#CAB9F0"/>
      <path d="M99 96L116 118V94Z" fill="#CAB9F0"/>
      <path d="M28 9H79Q104 9 104 34V66Q104 89 79 89H44L20 111V86Q5 81 5 63V34Q5 9 28 9Z" fill="#7952CA"/>
      <path d="M28 31H79V44L47 62H79V75H28V62L61 44H28Z" fill="#fff"/>` },
  { id: 'H', slug: 'matrix-window', title: '矩阵之窗', note: '把不同平台，放进同一个窗口', color: '#4164DA',
    body: `<rect x="10" y="10" width="47" height="47" rx="13" fill="#355BEB"/>
      <rect x="70" y="8" width="43" height="43" rx="11" transform="rotate(12 91.5 29.5)" fill="#FFAA65"/>
      <rect x="10" y="70" width="47" height="47" rx="13" fill="#769BF3"/>
      <rect x="70" y="70" width="47" height="47" rx="13" fill="#355BEB"/>` },
];

const pngs = new Map();
await mkdir(root, { recursive: true });
for (const option of options) {
  const folder = join(root, `${option.id}-${option.slug}`);
  await mkdir(folder, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${esc('zMatrix — ' + option.title)}"><title>${esc('zMatrix — ' + option.title)}</title>${option.body}</svg>`;
  await writeFile(join(folder, 'icon.svg'), svg + '\n');
  for (const size of [16, 24, 32, 48, 128, 256]) {
    const png = await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
    await writeFile(join(folder, `icon-${size}.png`), png);
    pngs.set(`${option.id}-${size}`, png);
  }
}

function picture(option, size, x, y) {
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${pngs.get(`${option.id}-${size}`).toString('base64')}"/>`;
}

const family = "'Microsoft YaHei', 'Segoe UI', sans-serif";
const label = (x, y, text, size, color = '#24304B', weight = 400) => `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(text)}</text>`;
const cards = options.map((option, i) => {
  const x = 36 + (i % 4) * 336, y = 148 + Math.floor(i / 4) * 420;
  return `<g transform="translate(${x} ${y})">
    <rect width="320" height="400" rx="18" fill="#fff" stroke="#DDE3EE"/>
    <rect x="20" y="20" width="30" height="30" rx="8" fill="${option.color}"/>
    ${label(29, 41, option.id, 17, '#fff', 700)}
    ${label(62, 42, option.title, 21, '#24304B', 600)}
    ${label(20, 73, option.note, 12, '#66758E')}
    ${picture(option, 128, 96, 101)}
    ${label(106, 259, '16', 10, '#78859A')}
    ${label(158, 259, '24', 10, '#78859A')}
    ${label(222, 259, '32 px', 10, '#78859A')}
    <rect x="20" y="270" width="280" height="44" rx="8" fill="#F0F3F8"/>
    ${label(34, 297, '浅色', 11, '#61708A')}
    ${picture(option, 16, 104, 284)}${picture(option, 24, 153, 280)}${picture(option, 32, 220, 276)}
    <rect x="20" y="326" width="280" height="44" rx="8" fill="#252A36"/>
    ${label(34, 353, '深色', 11, '#B9C2D4')}
    ${picture(option, 16, 104, 340)}${picture(option, 24, 153, 336)}${picture(option, 32, 220, 332)}
  </g>`;
}).join('');
const board = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1060" viewBox="0 0 1400 1060">
  <rect width="1400" height="1060" fill="#F4F7FB"/>
  ${label(36, 62, 'zMatrix', 38, '#24304B', 700)}
  ${label(215, 60, '图标候选', 27, '#24304B', 500)}
  ${label(36, 105, '8 种方向 · 个人标识 / 自媒体 / 矩阵 · 下方显示实际 16 / 24 / 32 px 栅格图标', 17, '#66758E')}
  ${cards}
  ${label(36, 1027, '选择 A—H 即可，也可以组合某款的造型与另一款的配色。工具栏背景为模拟展示。', 15, '#66758E')}
</svg>`;
await writeFile(join(root, 'overview.svg'), board);
await sharp(Buffer.from(board)).png().toFile(join(root, 'overview.png'));

const htmlCards = options.map(option => {
  const base = `${option.id}-${option.slug}`;
  const samples = [16, 24, 32].map(size => `<img src="${base}/icon-${size}.png" width="${size}" height="${size}" alt="${size} 像素" title="${size} px">`).join('');
  return `<article><h2><span style="background:${option.color}">${option.id}</span>${option.title}</h2><p>${option.note}</p><img class="hero" src="${base}/icon-256.png" width="128" height="128" alt="${option.title}"><div class="toolbar light"><span>浅色</span>${samples}</div><div class="toolbar dark"><span>深色</span>${samples}</div><footer><a href="${base}/icon.svg" download>SVG 源文件</a><a href="${base}/icon-128.png" download>128 px PNG</a></footer></article>`;
}).join('');
await writeFile(join(root, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>zMatrix · 图标候选</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#24304b;font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1400px;margin:auto;padding:32px}h1{font-size:32px;letter-spacing:-.7px;margin:0}header p{color:#66758e;margin:10px 0 28px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}article{padding:22px;border:1px solid #dde3ee;border-radius:18px;background:white}h2{font-size:20px;margin:0;display:flex;align-items:center;gap:12px}h2 span{color:white;border-radius:7px;width:30px;text-align:center;font-size:17px}article p{color:#66758e;font-size:12px;min-height:20px}.hero{display:block;margin:30px auto}.toolbar{height:46px;margin:10px 0;border-radius:8px;display:flex;align-items:center;justify-content:space-around}.toolbar span{font-size:11px}.light{background:#f0f3f8;color:#61708a}.dark{background:#252a36;color:#b9c2d4}footer{display:flex;justify-content:space-between;margin-top:20px;font-size:12px}a{color:#355beb;text-underline-offset:3px}a:focus-visible{outline:3px solid #355beb;outline-offset:4px}body>main>footer{color:#66758e;font-size:14px}@media(max-width:1080px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){main{padding:20px}.grid{grid-template-columns:1fr}}
</style><main><header><h1>zMatrix · 图标候选</h1><p>选择 A—H，也可以组合造型与配色。下面两行是实际 16 / 24 / 32 px 的图标；浏览器工具栏背景为模拟展示。</p></header><div class="grid">${htmlCards}</div><footer>候选设计尚未应用到扩展。各方案均保留 SVG 和透明 PNG，可继续调整。</footer></main></html>`);
await writeFile(join(root, 'README.md'), `# zMatrix 图标候选\n\n打开 index.html 或 overview.png 查看 8 款候选。当前尚未修改扩展 manifest，也未应用任何候选。\n\n每款包含 SVG 源文件及 16、24、32、48、128、256 px 透明 PNG。overview.png 中的小尺寸使用对应 PNG 原始像素嵌入，背景为模拟工具栏。\n\n${options.map(o => `- **${o.id} ${o.title}**：${o.note}。`).join('\n')}\n\n## 重新生成\n\n使用 Node.js 和 sharp。若 sharp 不在当前模块搜索路径，将环境变量 ZMATRIX_RENDER_MODULES 指向已安装 sharp 的 node_modules 目录，再执行 node design/icon-options/generate.mjs。此依赖仅用于设计稿渲染，不增加扩展运行依赖。\n`);
console.log(JSON.stringify({ output: root, options: options.length, pngSizes: [16,24,32,48,128,256], overview: join(root, 'overview.png') }, null, 2));
