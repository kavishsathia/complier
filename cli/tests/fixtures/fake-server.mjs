// A stand-in MCP server for the end-to-end test: `list-items` reads <dir>/items.json (the world),
// every other call is appended to <dir>/calls.jsonl, so the test can see what reached upstream.

import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const dir = process.argv[2];
const object = (properties) => ({ type: "object", properties });
const tools = [
  { name: "list-items", inputSchema: object({}) },
  { name: "peek", inputSchema: object({}) },
  { name: "write-item", inputSchema: object({ id: { type: "string" }, mode: { type: "string" } }) },
  { name: "wipe", inputSchema: object({}) },
  { name: "stale", inputSchema: object({}) },
  { name: "unlisted", inputSchema: object({}) },
];

const reply = (id, result) => console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
const text = (t) => ({ content: [{ type: "text", text: t }] });

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  if (method === "initialize") reply(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } });
  else if (method === "tools/list") reply(id, { tools });
  else if (method === "tools/call" && params.name === "list-items") reply(id, text(readFileSync(`${dir}/items.json`, "utf8")));
  else if (method === "tools/call") {
    appendFileSync(`${dir}/calls.jsonl`, JSON.stringify(params) + "\n");
    reply(id, text(`did ${params.name}`));
  } else console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: method } }));
}
