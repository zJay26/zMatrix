import "fake-indexeddb/auto";
import { TextEncoder, TextDecoder } from "node:util";
import { Blob, File } from "node:buffer";
import { webcrypto } from "node:crypto";
Object.assign(globalThis, { TextEncoder, TextDecoder, Blob, File });
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
class NodeFileReader {
  result: string | null = null;
  onload?: () => void;
  onerror?: () => void;
  readAsDataURL(blob: Blob) {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      })
      .catch(() => this.onerror?.());
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader });
if (!("innerText" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent ?? "";
    },
    set(value) {
      this.textContent = value;
    },
    configurable: true,
  });
}
