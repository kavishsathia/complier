// Demo: the writer drafts on the "complier demo" page, waits for the world to delete a page,
// then recreates one. Run (after cel/build.sh, which builds the CEL backend that proves the unit):
//   complier machine up demo --spec demo/deleted.csp --unit demo/delete.ts
//   COMPLIER_MACHINE=demo COMPLIER_ROLE=writer claude --plugin-dir plugin

import { channel, unit } from "../translation.ts";
import { notion } from "../packages/notion/index.ts";

// The "complier demo" page; its child pages are watched.
const DEMO_PARENT = "3f641d26e95281318541d28473eb331f";

const pageDeleted = channel<string>("page_deleted");

export const demo = unit(notion)
  .poll("notion-fetch", {
    every: 5_000,
    args: { id: DEMO_PARENT },
    diff: (prev, next) => {
      const remaining = new Set(next.childPages.map((c) => c.id));
      return prev.childPages.filter((c) => !remaining.has(c.id)).map((c) => pageDeleted(c.id));
    },
  })
  // Editing a page is drafting, with the page's id; creating pages is recreating, with their titles.
  .translate({
    tools: ["notion-update-page", "notion-create-pages"],
    schema: { page_id: "optional<string>", pages: "optional<list<map<string, dyn>>>" },
    assumption: "tool == 'notion-update-page' ? page_id.hasValue() : pages.hasValue()",
    units: {
      draft: { when: "tool == 'notion-update-page'", emit: "draft", value: "page_id.value()" },
      recreate: {
        when: "tool == 'notion-create-pages'",
        emit: "recreate",
        value: `pages.value().map(p,
          has(p.properties) && has(p.properties.title) && p.properties.title != null
            ? string(p.properties.title) : 'untitled').join(', ')`,
      },
    },
  })
  .hide("notion-fetch", "notion-search");
