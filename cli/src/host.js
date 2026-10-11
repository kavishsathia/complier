// Loads a translation unit in Node and answers diff requests over stdio, one JSON object per line.
// The first line out describes the unit; after that, each {poll, prev, next} in gets an Event[]
// out, and each {output, args} in gets {event} or {error} out.

import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const module = await import(pathToFileURL(process.argv[1]).href);
const units = Object.values(module).filter((v) => v && Array.isArray(v.polls) && v.readOnly instanceof Set);
if (units.length !== 1) {
  throw new Error(`expected exactly one exported unit in ${process.argv[1]}, found ${units.length}`);
}
const [unit] = units;

console.log(JSON.stringify({
  server: unit.name,
  readOnly: [...unit.readOnly],
  polls: unit.polls.map(({ tool, every, args }) => ({ tool, every, args })),
  outputs: [...unit.outputs.keys()],
  hidden: [...unit.hidden],
  hashes: unit.hashes,
}));

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if ("output" in request) {
    // An agent's tool call to translate. A map that throws refuses the call rather than
    // taking the host down.
    try {
      console.log(JSON.stringify({ event: unit.outputs.get(request.output)(request.args) }));
    } catch (error) {
      console.log(JSON.stringify({ error: String(error?.message ?? error) }));
    }
  } else {
    const { poll, prev, next } = request;
    console.log(JSON.stringify(unit.polls[poll].diff(prev, next)));
  }
}
