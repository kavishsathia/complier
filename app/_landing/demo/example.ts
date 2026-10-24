// The demo's starting point: a writer agent on Notion that drafts a post, gets it reviewed and
// publishes it, in that order.

import type { Call } from "./run.ts";

export const TRANSLATION = `# Which Notion calls count as which contract events.
translate:
  tools: [notion-update-page, notion-create-comment, notion-move-pages]
  schema:
    page_id: optional<string>
    command: optional<string>
  # A well-formed call names its page (moves list theirs instead).
  assumption: tool == 'notion-move-pages' || page_id.hasValue()
  rules:
    draft:
      when: >-
        tool == 'notion-update-page' &&
        command.orValue('') in ['update_content', 'insert_content']
      emit: draft
    review:
      when: tool == 'notion-create-comment'
      emit: review
    publish:
      when: tool == 'notion-move-pages'
      emit: publish
  # Any other call, such as replace_content, is this event.
  fallback:
    emit: other

# Reads pass through unchecked.
hidden: [notion-fetch, notion-search]
`;

export const CONTRACT = `-- The writer drafts, gets a review, then publishes.
-- Editing after a review needs a fresh one.
WRITER  = !draft -> DRAFTED

DRAFTED = !draft -> DRAFTED
       [] !review -> REVIEWED

REVIEWED = !publish -> WRITER
        [] !draft -> DRAFTED
`;

const page = `"page_id": "launch-post"`;
const move = `{"page_or_database_ids": ["launch-post"], "new_parent": {"database_id": "published"}}`;

export const CALLS: Omit<Call, "key">[] = [
  { tool: "notion-update-page", args: `{${page}, "command": "update_content"}` },
  { tool: "notion-move-pages", args: move },
  { tool: "notion-create-comment", args: `{${page}, "markdown": "Reads well. Ship it."}` },
  { tool: "notion-update-page", args: `{${page}, "command": "replace_content"}` },
  { tool: "notion-move-pages", args: move },
];

// Edits worth trying, each a find-and-replace in one editor.
export const TRIES = [
  {
    tab: "translation" as const,
    label: "Count replace_content as a draft",
    find: "['update_content', 'insert_content']",
    replace: "['update_content', 'insert_content', 'replace_content']",
  },
  {
    tab: "contract" as const,
    label: "Let the writer publish without a review",
    find: "       [] !review -> REVIEWED\n",
    replace: "       [] !review -> REVIEWED\n       [] !publish -> WRITER\n",
  },
  {
    tab: "translation" as const,
    label: "Make two rules overlap",
    find: "when: tool == 'notion-create-comment'",
    replace: "when: tool != 'notion-move-pages'",
  },
];
