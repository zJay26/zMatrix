import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

// Run `npm run icons` after editing the canonical vector artwork.
const directory = resolve(import.meta.dirname, "../public/icon");
const source = await readFile(join(directory, "zmatrix.svg"));
await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128, 256]) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(directory, `${size}.png`));
}
console.log("Generated transparent zMatrix icons: 16, 32, 48, 128, 256 px.");
