// Translation unit for the Notion MCP server.

import { channel, unit } from "../translation.ts";
import { notion } from "../packages/notion/index.ts";

// The page whose new child pages count as `page_added`.
const DEMO_PAGE = "37b41d26e9528172abd7e8b38755acce";

const pageAdded = channel<string>("page_added");
const commented = channel<string>("commented");
const edited = channel<string>("edited");
const overwritten = channel<string>("overwritten");
const moved = channel<string[]>("moved");

export const notionUnit = unit(notion)
  .poll("notion-fetch", {
    every: 10_000,
    args: { id: DEMO_PAGE },
    diff: (prev, next) => {
      const before = new Set(prev.childPages.map((c) => c.id));
      return next.childPages.filter((c) => !before.has(c.id)).map((c) => pageAdded(c.id));
    },
  })
  .output("notion-create-comment", (a) => commented(a.page_id))
  .output("notion-update-page", (a) =>
    a.command === "replace_content" ? overwritten(a.page_id) : edited(a.page_id),
  )
  .output("notion-move-pages", (a) => moved(a.page_or_database_ids))
  .hide("notion-fetch", "notion-search", "notion-get-users", "notion-get-self");
