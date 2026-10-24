/**
 * Z3's JNI surface, implemented in JavaScript.
 *
 * The verifier drives Z3 through com.microsoft.z3, whose `Native` class is
 * one `native` method per C entry point — normally satisfied by libz3java
 * (JNI). In the browser those natives are satisfied here instead: CheerpJ
 * calls `Java_com_microsoft_z3_Native_INTERNALmkAnd(lib, ctx, n, args)` and
 * this module marshals the call onto `_Z3_mk_and` in the Z3 wasm module.
 *
 * Nothing here is hand-written per function. `z3natives.json` is generated
 * from the `def_API(...)` declarations in Z3's own headers — the same source
 * the Java binding is generated from — so the parameter shapes match by
 * construction (see wasm-src/cel/check-sigs.mjs, which verifies that against
 * `javap` output).
 *
 * Calling conventions (measured against CheerpJ 4.3):
 *   - Java long arrives as BigInt; long[] as BigInt64Array (by reference);
 *     int[] as Int32Array; boolean[] as Uint8Array; String as string.
 *   - A long *return* must be a Number (a BigInt comes back as 0). Handles
 *     are 32-bit wasm pointers so that's lossless; int64 out-values are
 *     lossy above 2^53, which the verifier only uses for list lengths.
 *   - Out-parameters are holder objects whose `.value` field is writable.
 *   - A JS exception escaping a native kills the Java thread, so failures
 *     are converted into a Z3 error code — the generated Java wrappers
 *     check Z3_get_error_code after every call and throw Z3Exception.
 */

import table from "./z3natives.json";

export type Z3Module = {
  _malloc(n: number): number;
  _free(p: number): void;
  wasmMemory: WebAssembly.Memory;
  UTF8ToString(p: number): string;
  stringToUTF8(s: string, p: number, max: number): void;
  lengthBytesUTF8(s: string): number;
  _cel_set_noop_error_handler(ctx: number): void;
  _Z3_set_error(ctx: number, code: number): void;
  _Z3_get_error_code(ctx: number): number;
} & Record<string, unknown>;

type Kind = "handle" | "int" | "bool" | "string" | "int64" | "uint64" | "double" | "void";
type Param = {
  kind: "in" | "out" | "in_array" | "out_array" | "inout_array" | "out_managed_array" | "fnptr";
  type: Kind;
  raw?: string;
  sizeIndex?: number;
};
type Entry = { c: string; java: string; ret: Kind; retRaw: string; params: Param[] };

export type NativeFn = (lib: unknown, ...args: unknown[]) => Promise<unknown>;

const PREFIX = "Java_com_microsoft_z3_Native_";
/** Z3_error_code.Z3_EXCEPTION */
const Z3_EXCEPTION = 12;

const entries = table as Entry[];

/** Builds the `natives` object for cheerpjInit from a loaded Z3 module. */
export function buildZ3Natives(Mod: Z3Module): Record<string, NativeFn> {
  // Memory can grow, which replaces the buffer; views are rebuilt on demand.
  let buffer: ArrayBufferLike | null = null;
  let u8: Uint8Array, i32: Int32Array, u32: Uint32Array, i64: BigInt64Array, u64: BigUint64Array;
  const heap = () => {
    const b = Mod.wasmMemory.buffer;
    if (b !== buffer) {
      buffer = b;
      u8 = new Uint8Array(b);
      i32 = new Int32Array(b);
      u32 = new Uint32Array(b);
      i64 = new BigInt64Array(b);
      u64 = new BigUint64Array(b);
    }
  };

  const toNum = (v: unknown): number => (typeof v === "bigint" ? Number(v) : Number(v));
  const toBig = (v: unknown): bigint =>
    typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v)));

  /** Messages for failures that happened on this side, keyed by context. */
  const jsErrors = new Map<number, string>();

  function invoke(entry: Entry, args: unknown[]): unknown {
    const fn = Mod["_" + entry.c] as ((...a: unknown[]) => unknown) | undefined;
    if (!fn) throw new Error(`${entry.c} is not exported by the Z3 wasm build`);
    const cargs: unknown[] = [];
    const allocs: number[] = [];
    const after: (() => void)[] = [];
    const alloc = (n: number) => {
      const p = Mod._malloc(Math.max(n, 8));
      allocs.push(p);
      return p;
    };

    for (let i = 0; i < entry.params.length; i++) {
      const p = entry.params[i];
      const a = args[i];
      if (p.kind === "in") {
        switch (p.type) {
          case "handle":
            cargs.push(toNum(a));
            break;
          case "int":
            cargs.push(toNum(a) | 0);
            break;
          case "bool":
            cargs.push(a ? 1 : 0);
            break;
          case "double":
            cargs.push(Number(a));
            break;
          case "int64":
            cargs.push(BigInt.asIntN(64, toBig(a)));
            break;
          case "uint64":
            cargs.push(BigInt.asUintN(64, toBig(a)));
            break;
          case "string": {
            if (a === null || a === undefined) {
              cargs.push(0);
              break;
            }
            const s = String(a);
            const n = Mod.lengthBytesUTF8(s) + 1;
            const ptr = alloc(n);
            Mod.stringToUTF8(s, ptr, n);
            cargs.push(ptr);
            break;
          }
          default:
            throw new Error(`unsupported in-parameter ${p.type} in ${entry.c}`);
        }
      } else if (p.kind === "out") {
        if (a === null || a === undefined) {
          cargs.push(0);
          continue;
        }
        const ptr = alloc(8);
        heap();
        u32[ptr >> 2] = 0;
        u32[(ptr >> 2) + 1] = 0;
        cargs.push(ptr);
        const holder = a as { value: unknown };
        after.push(() => {
          heap();
          switch (p.type) {
            case "handle":
              holder.value = u32[ptr >> 2];
              break;
            case "int":
              holder.value = i32[ptr >> 2];
              break;
            case "int64":
              holder.value = Number(i64[ptr >> 3]);
              break;
            case "uint64":
              // A Java long holds the bit pattern.
              holder.value = Number(BigInt.asIntN(64, u64[ptr >> 3]));
              break;
            case "string":
              holder.value = Mod.UTF8ToString(u32[ptr >> 2]);
              break;
            default:
              throw new Error(`unsupported out-parameter ${p.type} in ${entry.c}`);
          }
        });
      } else if (p.kind === "in_array" || p.kind === "out_array" || p.kind === "inout_array") {
        if (a === null || a === undefined) {
          // Java passes null for empty arrays; Z3 takes a null pointer with a
          // zero count.
          cargs.push(0);
          continue;
        }
        const arr = a as { length: number; [i: number]: unknown };
        const n = arr.length;
        const size = p.type === "bool" ? 1 : p.type === "int64" || p.type === "uint64" ? 8 : 4;
        const ptr = alloc(n * size);
        heap();
        if (p.kind !== "out_array") {
          for (let j = 0; j < n; j++) {
            if (p.type === "handle") u32[(ptr >> 2) + j] = toNum(arr[j]);
            else if (p.type === "int") i32[(ptr >> 2) + j] = toNum(arr[j]) | 0;
            else if (p.type === "bool") u8[ptr + j] = arr[j] ? 1 : 0;
            else if (p.type === "int64") i64[(ptr >> 3) + j] = BigInt.asIntN(64, toBig(arr[j]));
            else if (p.type === "uint64") u64[(ptr >> 3) + j] = BigInt.asUintN(64, toBig(arr[j]));
            else throw new Error(`unsupported array element ${p.type} in ${entry.c}`);
          }
        }
        cargs.push(ptr);
        if (p.kind !== "in_array") {
          after.push(() => {
            heap();
            for (let j = 0; j < n; j++) {
              // Typed arrays are shared with Java, so writes land in the
              // Java array. long[] is a BigInt64Array.
              if (p.type === "handle") arr[j] = BigInt(u32[(ptr >> 2) + j]);
              else if (p.type === "int") arr[j] = i32[(ptr >> 2) + j];
              else if (p.type === "bool") arr[j] = u8[ptr + j];
              else if (p.type === "int64") arr[j] = i64[(ptr >> 3) + j];
              else if (p.type === "uint64") arr[j] = BigInt.asIntN(64, u64[(ptr >> 3) + j]);
            }
          });
        }
      } else {
        throw new Error(`${entry.c} needs a callback into Java, which this bridge does not support`);
      }
    }

    let r: unknown;
    try {
      r = fn(...cargs);
      for (const f of after) f();
    } finally {
      for (const p of allocs) Mod._free(p);
    }

    switch (entry.ret) {
      case "void":
        return undefined;
      case "bool":
        return Boolean(r);
      case "string":
        return (r as number) === 0 ? null : Mod.UTF8ToString(r as number);
      case "uint64":
        return Number(BigInt.asIntN(64, r as bigint));
      case "int64":
        return Number(r as bigint);
      default:
        // handles, ints and doubles are already JS numbers
        return r;
    }
  }

  const defaultReturn = (ret: Kind): unknown =>
    ret === "void" ? undefined : ret === "bool" ? false : ret === "string" ? null : 0;

  const natives: Record<string, NativeFn> = {};

  for (const entry of entries) {
    const ctxIndex = entry.params.findIndex((p) => p.kind === "in" && p.raw === "CONTEXT");
    natives[PREFIX + entry.java] = async (_lib, ...args) => {
      try {
        const r = invoke(entry, args);
        if (entry.c === "Z3_mk_context" || entry.c === "Z3_mk_context_rc") {
          // Z3's default handler aborts the process; report through the
          // error code the Java wrappers already check instead.
          Mod._cel_set_noop_error_handler(r as number);
        }
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[z3 bridge] ${entry.c}: ${msg}`);
        if (ctxIndex >= 0) {
          const ctx = toNum(args[ctxIndex]);
          jsErrors.set(ctx, msg);
          try {
            Mod._Z3_set_error(ctx, Z3_EXCEPTION);
          } catch {
            // nothing more to do
          }
        }
        return defaultReturn(entry.ret);
      }
    };
  }

  // Surface bridge-side failures with their real message.
  const getErrorMsg = natives[PREFIX + "INTERNALgetErrorMsg"];
  natives[PREFIX + "INTERNALgetErrorMsg"] = async (lib, ctx, code) => {
    const own = jsErrors.get(toNum(ctx));
    if (own !== undefined && toNum(code) === Z3_EXCEPTION) {
      jsErrors.delete(toNum(ctx));
      return `bridge: ${own}`;
    }
    return getErrorMsg(lib, ctx, code);
  };

  natives[PREFIX + "setInternalErrorHandler"] = async (_lib, ctx) => {
    Mod._cel_set_noop_error_handler(toNum(ctx));
  };

  // User propagators need Java callbacks; the verifier never registers one.
  for (const name of [
    "propagateInit",
    "propagateRegisterCreated",
    "propagateRegisterFixed",
    "propagateRegisterEq",
    "propagateRegisterDecide",
    "propagateRegisterFinal",
    "propagateAdd",
    "propagateConsequence",
    "propagateNextSplit",
    "propagateDestroy",
  ]) {
    natives[PREFIX + name] = async () => {
      console.error(`[z3 bridge] ${name}: user propagators are not supported in the browser`);
      return name === "propagateInit" ? 0 : name.startsWith("propagateConsequence") || name === "propagateNextSplit" ? false : undefined;
    };
  }

  return natives;
}

/** How many entry points the bridge covers — for the page's footer. */
export const nativeCount = entries.length;
