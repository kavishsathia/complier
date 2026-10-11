// Demo: run `complier run demo/delete.ts`, then delete "Delete me" from the "complier demo" page.

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
  });
