// Translation units: maps between external events and the CSP alphabet.
// Input events come from the world (uncontrollable): polls and their diffs, plain functions complier
// makes no claim about. Output events come from the agent (controllable): its tool calls,
// classified by CEL rules that complier proves partition the calls before it lets any through.

// ---- alphabet ----

export type Event<T = unknown> = { channel: string; value: T };

export type Channel<T> = ((value: T) => Event<T>) & { name: string };

export function channel<T = void>(name: string): Channel<T> {
  const make = (value: T) => ({ channel: name, value });
  // A function's own `name` is read-only, so it has to be redefined rather than assigned.
  return Object.defineProperty(make, "name", { value: name }) as Channel<T>;
}

// ---- output translation: CEL rules over tool calls ----

// The concrete event a tool call is: `tool`, the called tool's name (always declared, as a string),
// and each argument named in the schema, as a CEL type in the verifier's syntax (`string`, `int`,
// `list<string>`, `map<string, dyn>`, ...). An argument a call may leave out is `optional<T>`: it
// binds to optional.none() when absent. Arguments the schema doesn't name are passed upstream but
// play no part in classifying the call.
export type Schema = Record<string, string>;

// A call satisfying the CEL predicate `when` emits the CSP event `emit`, whose value is the CEL
// expression `value` over the same fields (no value if left out).
export type Rule = { when: string; emit: string; value?: string };

export type Translation<T extends string = string> = {
  // The tools whose calls are translated. Each call must be in the domain: its tool listed here
  // and the `assumption`, a CEL predicate over the schema, true. Anything else is refused.
  tools: T[];
  schema: Schema;
  assumption?: string;
  // Named rules. Complier proves under the domain that no two can match the same call.
  units: Record<string, Rule>;
  // The event for an in-domain call no rule matches, generated as !(P1 || ... || Pn); complier
  // proves the rules and the fallback together cover the domain. Defaults to `other`.
  fallback?: { emit: string; value?: string };
  // Per solver query; and how far list quantifiers are unrolled.
  timeoutMs?: number;
  unroll?: number;
};

// `other`, or `other_2`, `other_3`... if a rule already emits it.
function defaultFallback(rules: Rule[]): string {
  const taken = new Set(rules.map((r) => r.emit));
  if (!taken.has("other")) return "other";
  let i = 2;
  while (taken.has(`other_${i}`)) i++;
  return `other_${i}`;
}

// What the runtime sees: plain data, ordered, defaults filled in.
export type TranslationSpec = {
  tools: string[];
  schema: { name: string; type: string }[];
  assumption: string;
  units: { name: string; when: string; emit: string; value?: string }[];
  fallback: { emit: string; value?: string };
  timeoutMs: number;
  unroll: number;
};

// ---- translation unit ----

// Parses one tool's text result into a value, throwing if the result isn't what it expects.
export type Reader<T> = { read: (result: string) => T };

// Readers keyed by the tool they parse, as published in a package like packages/notion.
export type Readers<Tools> = { [K in keyof Tools]?: Reader<unknown> };

// A service as a package publishes it: its generated tool types, its reviewed readers, the tools
// it has reviewed as side-effect free (`readOnly`), which are the only ones complier polls, and
// the input schema hashes its types were generated from, so complier can drop any tool whose
// live schema has since changed. `tools` only carries the type; it has no runtime value.
export type Service<Tools, R, RO> = {
  name: string;
  readers: R;
  readOnly: RO[];
  hashes: { [K in keyof Tools]?: string };
  tools?: Tools;
};

// service<NotionTools>()({ name, readers, readOnly, hashes }): curried so `Tools` is given and
// the rest inferred.
export function service<Tools extends Record<string, unknown>>() {
  return <R extends Readers<Tools>, RO extends keyof Tools & string>(spec: {
    name: string;
    readers: R;
    readOnly: RO[];
    hashes: { [K in keyof Tools]?: string };
  }): Service<Tools, R, RO> => spec;
}

// What a poll of `K` hands to diff: the reader's value, or the raw text if no reader is registered.
export type Reading<R, K> = K extends keyof R ? (R[K] extends Reader<infer T> ? T : string) : string;

// Compares two successive readings of a polled tool and returns the input events that happened
// in between. Complier makes no claim about this step: the guarantee starts at the events it returns.
export type Diff<T> = (prev: T, next: T) => Event[];

// What the runtime sees: the reader is folded into the diff, so results cross over as text.
export type Poll = { tool: string; every: number; args: unknown; diff: Diff<string> };

// Built from a service, so tool names and arguments come from the server's own schemas
// and polled results are parsed by the service's reviewed readers.
export class Unit<Tools extends Record<string, unknown>, R extends Readers<Tools>, RO extends string> {
  readonly polls: Poll[] = [];
  translation: TranslationSpec | null = null;
  readonly hidden = new Set<string>();
  readonly readOnly: Set<string>;
  readonly hashes: Record<string, string>;
  readonly name: string;
  private readonly readers: R;

  constructor(service: Service<Tools, R, RO>) {
    this.name = service.name;
    this.readers = service.readers;
    this.readOnly = new Set(service.readOnly);
    this.hashes = service.hashes as Record<string, string>;
  }

  // Input events, observed by calling `tool` every `every` ms and diffing successive readings.
  // The tool runs outside CSP on complier's credentials, so only tools the service has reviewed
  // as read-only can be polled.
  poll<K extends RO & keyof Tools & string>(
    tool: K,
    spec: { every: number; args: Tools[K]; diff: Diff<Reading<R, K>> },
  ): this {
    const { every, args, diff } = spec;
    const reader = (this.readers as Readers<Tools>)[tool];
    const read = (result: string) => (reader ? reader.read(result) : result) as Reading<R, K>;
    this.polls.push({ tool, every, args, diff: (prev, next) => diff(read(prev), read(next)) });
    return this;
  }

  // The agent's actions: calls of `tools`, classified into CSP events by CEL rules. Calls of any
  // tool neither translated nor hidden are refused (fail closed).
  translate<K extends keyof Tools & string>(spec: Translation<K>): this {
    if (this.translation) throw new Error(`${this.name}: translate() can only be called once per unit`);
    const units = Object.entries(spec.units).map(([name, rule]) => ({ name, ...rule }));
    this.translation = {
      tools: [...spec.tools],
      schema: Object.entries(spec.schema).map(([name, type]) => ({ name, type })),
      assumption: spec.assumption ?? "",
      units,
      fallback: spec.fallback ?? { emit: defaultFallback(units) },
      timeoutMs: spec.timeoutMs ?? 10_000,
      unroll: spec.unroll ?? 5,
    };
    return this;
  }

  // Agent actions declared to have no effect on the modeled world: passed upstream unchecked.
  // This is trusted policy, separate from translation; a hidden tool can't also be translated.
  hide(...tools: (keyof Tools & string)[]): this {
    tools.forEach((t) => this.hidden.add(t));
    return this;
  }
}

export function unit<Tools extends Record<string, unknown>, R extends Readers<Tools>, RO extends string>(
  service: Service<Tools, R, RO>,
): Unit<Tools, R, RO> {
  return new Unit(service);
}
