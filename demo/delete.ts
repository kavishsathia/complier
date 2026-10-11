// Demo: the writer drafts on the "complier demo" page, waits for the world to delete a page,
// then recreates one. Run:
//   complier machine up demo --spec demo/deleted.csp --unit demo/delete.ts
//   COMPLIER_MACHINE=demo COMPLIER_ROLE=writer claude --plugin-dir plugin

import { channel, unit } from "../translation.ts";
import { notion } from "../packages/notion/index.ts";

// The "complier demo" page; its child pages are watched.
const DEMO_PARENT = "3f641d26e95281318541d28473eb331f";

const pageDeleted = channel<string>("page_deleted");
const draft = channel<string>("draft");
const recreate = channel<string>("recreate");

export const demo = unit(notion)
  .poll("notion-fetch", {
    every: 5_000,
    args: { id: DEMO_PARENT },
    diff: (prev, next) => {
      const remaining = new Set(next.childPages.map((c) => c.id));
      return prev.childPages.filter((c) => !remaining.has(c.id)).map((c) => pageDeleted(c.id));
    },
  })
  // Editing a page is drafting; creating pages is recreating.
  .output("notion-update-page", (a) => draft(a.page_id))
  .output("notion-create-pages", (a) => recreate(a.pages.map((p) => p.properties?.title ?? "untitled").join(", ")))
  .hide("notion-fetch", "notion-search");
