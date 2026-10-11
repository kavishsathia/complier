// Translation unit for the Notion MCP server.

import { channel, unit } from "../translation.ts";
import type { NotionTools } from "../gen/notion";

// The page whose new child pages count as `page_added`.
const DEMO_PAGE = "37b41d26e9528172abd7e8b38755acce";

const pageAdded = channel<string>("page_added");
const commented = channel<string>("commented");
const edited = channel<string>("edited");
const overwritten = channel<string>("overwritten");
const moved = channel<string[]>("moved");

// Notion page IDs are 32 hex digits; any that appear in `next` but not `prev` are new pages.
const pageIds = (text: string) => new Set(text.match(/[0-9a-f]{32}/g));

export const notion = unit<NotionTools>("notion")
  .poll("notion-fetch", {
    every: 10_000,
    args: { id: DEMO_PAGE },
    diff: (prev, next) => {
      const before = pageIds(prev);
      return [...pageIds(next)].filter((id) => !before.has(id)).map(pageAdded);
    },
  })
  .output("notion-create-comment", (a) => commented(a.page_id))
  .output("notion-update-page", (a) =>
    a.command === "replace_content" ? overwritten(a.page_id) : edited(a.page_id),
  )
  .output("notion-move-pages", (a) => moved(a.page_or_database_ids))
  .hide("notion-fetch", "notion-search", "notion-get-users", "notion-get-self");
