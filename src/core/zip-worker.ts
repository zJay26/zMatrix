import { zipSync } from "fflate";

// A packaged worker keeps compression off the UI thread without blob workers or eval.
self.onmessage = (event: MessageEvent<Record<string, Uint8Array>>) => {
  try {
    const bytes = zipSync(event.data, { level: 3 });
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
