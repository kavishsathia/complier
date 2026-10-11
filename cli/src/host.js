// Loads a translation unit in Node and answers diff requests over stdio, one JSON object per line.
// The first line out describes the unit; after that, each {poll, prev, next} in gets an Event[] out.

import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const module = await import(pathToFileURL(process.argv[1]).href);
const units = Object.values(module).filter((v) => v && Array.isArray(v.polls) && v.hidden instanceof Set);
if (units.length !== 1) {
  throw new Error(`expected exactly one exported unit in ${process.argv[1]}, found ${units.length}`);
}
const [unit] = units;

console.log(JSON.stringify({
  server: unit.name,
  hidden: [...unit.hidden],
  polls: unit.polls.map(({ tool, every, args }) => ({ tool, every, args })),
}));

for await (const line of createInterface({ input: process.stdin })) {
  const { poll, prev, next } = JSON.parse(line);
  console.log(JSON.stringify(unit.polls[poll].diff(prev, next)));
}
