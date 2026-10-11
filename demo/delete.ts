// Demo: run `complier run demo/delete.ts`, then delete "Delete me" from the "complier demo" page.

import { channel, unit } from "../translation.ts";
import type { NotionTools } from "../gen/notion";

// The "complier demo" page; its child pages are watched.
const DEMO_PARENT = "3f641d26e95281318541d28473eb331f";

const pageDeleted = channel<string>("page_deleted");

// notion-fetch returns JSON whose `text` holds the page as markup; child pages appear in it
// as <page url=".../<32 hex id>">.
const childPages = (result: string) => {
  const { text } = JSON.parse(result) as { text: string };
  return new Set([...text.matchAll(/<page url="[^"]*\/([0-9a-f]{32})">/g)].map((m) => m[1]));
};

export const demo = unit<NotionTools>("notion")
  .poll("notion-fetch", {
    every: 5_000,
    args: { id: DEMO_PARENT },
    diff: (prev, next) => {
      const remaining = childPages(next);
      return [...childPages(prev)].filter((id) => !remaining.has(id)).map(pageDeleted);
    },
  })
  .hide("notion-fetch");
