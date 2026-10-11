// Translation unit for the Notion MCP server.

import { channel, unit } from "../translation";
import type { NotionTools } from "../gen/notion";

const commented = channel<string>("commented");
const edited = channel<string>("edited");
const overwritten = channel<string>("overwritten");
const moved = channel<string[]>("moved");
const commentAdded = channel<string>("comment_added");

type CommentCreated = { type: "comment.created"; entity: { id: string }; data: { page_id: string } };

export const notion = unit<NotionTools>("notion")
  .input<CommentCreated>("comment.created", (e) => commentAdded(e.data.page_id))
  .output("notion-create-comment", (a) => commented(a.page_id))
  .output("notion-update-page", (a) =>
    a.command === "replace_content" ? overwritten(a.page_id) : edited(a.page_id),
  )
  .output("notion-move-pages", (a) => moved(a.page_or_database_ids))
  .hide("notion-search", "notion-fetch", "notion-get-users", "notion-get-self");
