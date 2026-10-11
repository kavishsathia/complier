// Reviewed readers for the Notion MCP server's tool output, which has no outputSchema.
// Each reader parses a tool's text result and validates it, throwing ReadError on anything
// unexpected, so a format change on Notion's side fails loudly instead of mistranslating.

export class ReadError extends Error {
  constructor(tool: string, problem: string) {
    super(`${tool}: ${problem} (output format may have changed; reader needs review)`);
  }
}

export type ChildPage = { id: string; title: string };

export type Page = { id: string; title: string; url: string; childPages: ChildPage[] };

// notion-fetch on a page. Its result is JSON whose `text` holds the page as markup:
// <page url="…/<id>"> … <content> … <page url="…/<child id>">Child title</page> … </content></page>
export const page = {
  tool: "notion-fetch",
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
