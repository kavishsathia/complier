import { existsSync, statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { localModelDir } from "../../../../../game/local";
import { LOCAL_MODEL } from "../../../../../game/qwen";

// What the visitor's browser downloads to run the game's agent itself, served from this server so
// nothing comes from a third party: the local model's files (GAME_LOCAL_MODEL_DIR), and the ONNX
// Runtime WebAssembly build transformers.js runs them with. Only the listed files are served.

const ORT = /^ort-wasm-simd-threaded(\.asyncify|\.jsep)?\.(mjs|wasm)$/;
const TYPES: Record<string, string> = { ".json": "application/json", ".onnx": "application/octet-stream", ".wasm": "application/wasm", ".mjs": "text/javascript" };

function file(parts: string[]): string | undefined {
  if (parts[0] === "model" && parts[1] === LOCAL_MODEL.id) {
    const name = parts.slice(2).join("/");
    const dir = localModelDir();
    if (typeof dir !== "string" || !LOCAL_MODEL.files.includes(name)) return undefined;
    return path.join(dir, name);
  }
  if (parts[0] === "ort" && parts.length === 2 && ORT.test(parts[1])) {
    return path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "onnxruntime-web", "dist", parts[1]);
  }
  return undefined;
}

// Reads the file a chunk at a time as the client asks for it, and stops cleanly if the client goes
// away: transformers.js aborts its first request for each file once it has seen the headers.
function stream(f: string): ReadableStream<Uint8Array> {
  let handle: FileHandle | undefined;
  let position = 0;
  let done = false;
  const close = async () => {
    done = true;
    const h = handle;
    handle = undefined;
    await h?.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (done) return;
        handle ??= await open(f, "r");
        const chunk = new Uint8Array(1 << 20);
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (done) return;
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(chunk.subarray(0, bytesRead));
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  );
}

async function serve(params: Promise<{ path: string[] }>, body: boolean) {
  const f = file((await params).path);
  if (!f || !existsSync(f)) return new Response("not found", { status: 404 });
  return new Response(body ? stream(f) : null, {
    headers: {
      "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream",
      "Content-Length": String(statSync(f).size),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serve(params, true);
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serve(params, false);
}
