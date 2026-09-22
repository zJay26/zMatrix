import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
async function filesIn(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesIn(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const notices = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev || !path.startsWith("node_modules/")) continue;
  const dir = join(root, path);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  const names = (await readdir(dir)).filter((name) =>
    /^(?:license|licence|copying|notice)(?:[.-].*)?$/i.test(name),
  );
  const licenses = [];
  for (const name of names) {
    try {
      licenses.push(`${name}\n${await readFile(join(dir, name), "utf8")}`);
    } catch {}
  }
  notices.push(
    `## ${manifest.name}@${manifest.version}\nLicense: ${manifest.license ?? info.license ?? "See upstream"}\n${licenses.join("\n\n")}`,
  );
}
const licenseText = `${await readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")}\n\n${await readFile(join(root, "docs/licenses/Apache-2.0.txt"), "utf8")}\n\n# Installed production dependency licenses\n\n${notices.join("\n\n---\n\n")}`;
await writeFile(join(dist, "THIRD_PARTY_LICENSES.txt"), licenseText);
const extensionRoot = join(root, ".output", "edge-mv3");
const manifest = JSON.parse(
  await readFile(join(extensionRoot, "manifest.json"), "utf8"),
);
if (
  manifest.manifest_version !== 3 ||
  !manifest.key ||
  manifest.version !== pkg.version ||
  manifest.key !==
    JSON.parse(await readFile(join(root, "extension-identity.json"), "utf8"))
      .key
)
  throw new Error("Manifest identity/version mismatch");
await copyFile(
  join(root, "docs", "installation.md"),
  join(extensionRoot, "INSTALL.md"),
);
await writeFile(join(extensionRoot, "THIRD_PARTY_LICENSES.txt"), licenseText);
await copyFile(join(root, "LICENSE"), join(extensionRoot, "LICENSE"));
const extension = {};
for (const path of await filesIn(extensionRoot))
  extension[relative(extensionRoot, path).replaceAll("\\", "/")] =
    new Uint8Array(await readFile(path));
const source = {};
for (const folder of ["src", "tests", "scripts", "docs", ".github"]) {
  for (const path of await filesIn(join(root, folder)))
    source[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(
      await readFile(path),
    );
}
for (const name of [
  "package.json",
  "package-lock.json",
  "extension-identity.json",
  "tsconfig.json",
  "wxt.config.ts",
  "vitest.config.ts",
  "vite.preview.config.ts",
  "index.html",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  ".gitignore",
  ".gitattributes",
])
  source[name] = new Uint8Array(await readFile(join(root, name)));
source["THIRD_PARTY_LICENSES.txt"] = strToU8(licenseText);
const outputs = [
  [`zMatrix-edge-${pkg.version}.zip`, extension],
  [`zMatrix-source-${pkg.version}.zip`, source],
];
const checksums = [];
for (const [name, files] of outputs) {
  const bytes = zipSync(files, { level: 6 });
  await writeFile(join(dist, name), bytes);
  checksums.push(
    `${createHash("sha256").update(bytes).digest("hex")}  ${name}`,
  );
  console.log(`${name} (${bytes.length} bytes)`);
}
checksums.push(
  `${createHash("sha256").update(licenseText).digest("hex")}  THIRD_PARTY_LICENSES.txt`,
);
await writeFile(join(dist, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`Unpacked extension: ${extensionRoot}`);
