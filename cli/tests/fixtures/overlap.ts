// Not admissible: a write with no mode is both an append and an unchecked write.

import { service, unit } from "../../../translation.ts";

const fake = service<{ "write-item": { id?: string; mode?: string } }>()({ name: "fake", readers: {}, readOnly: [], hashes: {} });

export const overlapUnit = unit(fake).translate({
  tools: ["write-item"],
  schema: { id: "string", mode: "optional<string>" },
  units: {
    append: { when: "mode.orValue('append') == 'append'", emit: "appended" },
    any: { when: "!mode.hasValue() || mode.value() != 'replace'", emit: "written" },
  },
});
