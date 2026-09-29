import { zipSync } from "fflate";

export function zipFiles(files: Record<string, Uint8Array>): Promise<Blob> {
  if (typeof Worker === "undefined")
    return Promise.resolve(
      new Blob([zipSync(files, { level: 3 }) as Uint8Array<ArrayBuffer>], {
        type: "application/zip",
      }),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./zip-worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("文件压缩超时，请减少导出数量后重试。"));
    }, 60000);
    worker.onmessage = (
      event: MessageEvent<{ bytes?: Uint8Array<ArrayBuffer>; error?: string }>,
    ) => {
      finish();
      if (event.data.bytes)
        resolve(new Blob([event.data.bytes], { type: "application/zip" }));
      else reject(new Error(event.data.error ?? "文件压缩失败"));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("文件压缩进程未能运行，本地数据仍保留。"));
    };
    worker.postMessage(files);
  });
}
