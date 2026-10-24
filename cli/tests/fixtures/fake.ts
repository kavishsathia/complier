// The end-to-end test's unit, over fake-server.mjs: a poll the world feeds, CEL rules for the
// agent's writes, a hidden read and a translated tool whose schema has drifted.

import { channel, service, unit } from "../../../translation.ts";

type FakeTools = {
  "list-items": Record<string, never>;
  peek: Record<string, never>;
  "write-item": { id?: string; mode?: string };
  wipe: Record<string, never>;
  stale: Record<string, never>;
  unlisted: Record<string, never>;
};

const fake = service<FakeTools>()({
  name: "fake",
  readers: { "list-items": { read: (text: string) => JSON.parse(text) as string[] } },
  readOnly: ["list-items", "peek"],
  // Not the hash of stale's live schema, so the proxy leaves stale out.
  hashes: { stale: "0000000000000000" },
});

const itemAdded = channel<string>("item_added");

export const fakeUnit = unit(fake)
  .poll("list-items", {
    every: 300,
    args: {},
    diff: (prev, next) => next.filter((i) => !prev.includes(i)).map((i) => itemAdded(i)),
  })
  .translate({
    tools: ["write-item", "wipe", "stale"],
    schema: { id: "optional<string>", mode: "optional<string>" },
    assumption: "tool != 'write-item' || id.hasValue()",
    units: {
      append: { when: "tool == 'write-item' && mode.orValue('append') == 'append'", emit: "appended", value: "id.value()" },
      replace: { when: "tool == 'write-item' && mode.orValue('') == 'replace'", emit: "replaced", value: "id.value()" },
    },
    fallback: { emit: "other", value: "tool" },
  })
  .hide("peek");
