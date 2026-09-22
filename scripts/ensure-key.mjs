import { existsSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
const path = new URL("../extension-identity.json", import.meta.url);
if (!existsSync(path)) {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(
    path,
    JSON.stringify(
      {
        key: publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      },
      null,
      2,
    ) + "\n",
  );
}
