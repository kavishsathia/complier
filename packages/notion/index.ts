// Reviewed readers for the Notion MCP server's tool output, which has no outputSchema.
// Each reader parses a tool's text result and validates it, throwing ReadError on anything
// unexpected, so a format change on Notion's side fails loudly instead of mistranslating.

import { service, type Reader } from "../../translation.ts";
import { notionSchemaHashes, type NotionTools } from "./tools.ts";

export class ReadError extends Error {
  constructor(tool: string, problem: string) {
    super(`${tool}: ${problem} (output format may have changed; reader needs review)`);
  }
}

export type ChildPage = { id: string; title: string };

export type Page = { id: string; title: string; url: string; childPages: ChildPage[] };

// notion-fetch on a page. Its result is JSON whose `text` holds the page as markup:
// <page url="…/<id>"> … <content> … <page url="…/<child id>">Child title</page> … </content></page>
export const page: Reader<Page> & { verified: { schemaHash: string; on: string } } = {
  // The notion-fetch inputSchema hash (from `complier gen`) and date this reader was checked against.
  verified: { schemaHash: "5632d435e280b354", on: "2026-10-11" },

  read(result: string): Page {
    const fail = (problem: string) => new ReadError("notion-fetch", problem);

    let json: unknown;
    try {
      json = JSON.parse(result);
    } catch {
      throw fail("result is not JSON");
    }
    const { metadata, title, url, text } = (json ?? {}) as Record<string, unknown>;
    if ((metadata as { type?: unknown } | undefined)?.type !== "page") throw fail("not a page");
    if (typeof title !== "string" || typeof url !== "string" || typeof text !== "string") {
      throw fail("missing title, url or text");
    }

    const id = url.match(/[0-9a-f]{32}/)?.[0];
    if (!id) throw fail("url has no page id");

    const content = text.match(/<content>([\s\S]*)<\/content>/)?.[1];
    if (content === undefined) throw fail("text has no <content> section");

    const childPages = [...content.matchAll(/<page url="[^"]*\/([0-9a-f]{32})">([^<]*)<\/page>/g)].map(
      ([, id, title]) => ({ id, title }),
    );
    return { id, title, url, childPages };
  },
};

// The Notion service: generated tool types (./tools.ts), every reviewed reader keyed by the tool
// it parses, and the tools reviewed as side-effect free. Units are built from it with unit(notion).
export const notion = service<NotionTools>()({
  name: "notion",
  readers: {
    "notion-fetch": page,
  },
  readOnly: [
    "notion-fetch",
    "notion-search",
    "notion-get-comments",
    "notion-get-users",
    "notion-get-self",
    "notion-get-teams",
    "notion-list-private-pages",
    "notion-list-shared-pages",
    "notion-list-favorite-pages",
    "notion-list-recent-pages",
  ],
  hashes: notionSchemaHashes,
});
