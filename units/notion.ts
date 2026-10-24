// Translation unit for the Notion MCP server.

import { channel, unit } from "../translation.ts";
import { notion } from "../packages/notion/index.ts";

// The page whose new child pages count as `page_added`.
const DEMO_PAGE = "37b41d26e9528172abd7e8b38755acce";

const pageAdded = channel<string>("page_added");

export const notionUnit = unit(notion)
  .poll("notion-fetch", {
    every: 10_000,
    args: { id: DEMO_PAGE },
    diff: (prev, next) => {
      const before = new Set(prev.childPages.map((c) => c.id));
      return next.childPages.filter((c) => !before.has(c.id)).map((c) => pageAdded(c.id));
    },
  })
  // The agent's writes. Complier proves no two rules match the same call and that, with the
  // fallback, they cover every call in the domain; it refuses the unit otherwise.
  .translate({
    tools: ["notion-create-comment", "notion-update-page", "notion-move-pages"],
    schema: {
      page_id: "optional<string>",
      command: "optional<string>",
      page_or_database_ids: "optional<list<string>>",
    },
    // A well-formed call: moves name what they move; comments and updates name their page, and
    // updates their command. Anything else is refused, not translated.
    assumption: `tool == 'notion-move-pages'
      ? page_or_database_ids.hasValue() && size(page_or_database_ids.value()) > 0
      : page_id.hasValue() && (tool != 'notion-update-page' || command.hasValue())`,
    units: {
      comment: { when: "tool == 'notion-create-comment'", emit: "commented", value: "page_id.value()" },
      // Replacing a page's whole content is its own event; every other reviewed update command
      // is an edit. (Optionals are read with .orValue/.value: see cel/README.md on == between them.)
      overwrite: {
        when: "tool == 'notion-update-page' && command.orValue('') == 'replace_content'",
        emit: "overwritten",
        value: "page_id.value()",
      },
      edit: {
        when: `tool == 'notion-update-page' && command.orValue('') in
          ['update_properties', 'update_content', 'insert_content', 'apply_template', 'update_verification']`,
        emit: "edited",
        value: "page_id.value()",
      },
      move: { when: "tool == 'notion-move-pages'", emit: "moved", value: "page_or_database_ids.value()" },
    },
    // An update command nobody reviewed is neither an edit nor an overwrite.
    fallback: { emit: "other", value: "tool" },
  })
  .hide("notion-fetch", "notion-search", "notion-get-users", "notion-get-self");
