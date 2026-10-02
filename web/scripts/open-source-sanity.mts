// Non-vacuity checks for the two-agent open-source encoding.
import { Monitor, parseEvent } from "../lib/csp/monitor";
import { parse } from "../lib/csp/parser";
import { prove } from "../lib/csp/prove";
import { openSource } from "../lib/usecases/open-source";

let ok = true;
const prog = parse(openSource.source);
const fire = (m: Monitor, e: string) => m.fire(parseEvent(prog, e));

const run = `opened.1 tock respond open_pr cla.0 ci.1 cla.1 request_changes.Reviewer
push.Implementor ci.1 approve.Reviewer push.Implementor ci.1 approve.Reviewer
merge.Reviewer maintainer_look close write_changelog release.1.5.0`.split(/\s+/);
const m = new Monitor(prog);
for (const e of run) {
  if (!fire(m, e)) { console.log(`FAIL run blocked at ${e}; offered: ${m.offered().join(", ")}`); ok = false; break; }
}
if (ok) console.log(`ok   full run of ${run.length} events`);

const probe = new Monitor(prog);
for (const e of "opened.0 respond open_pr cla.1 ci.1".split(" ")) fire(probe, e);
const selfApprove = !fire(probe, "approve.Implementor");
const reviewerPush = !fire(probe, "push.Reviewer");
if (!selfApprove || !reviewerPush) ok = false;
console.log(`${selfApprove ? "ok  " : "FAIL"} approve.Implementor is blocked`);
console.log(`${reviewerPush ? "ok  " : "FAIL"} push.Reviewer is blocked`);

const mutations: [string, string, string, string][] = [
  ["reviewer ignores the CLA", "signed == 1 and green == 1 & approve!Reviewer", "green == 1 & approve!Reviewer", "ReviewGate"],
  ["merge after a later push", "Ready(signed) =\n     merge!Reviewer -> Done\n  [] push!Implementor -> Watching(signed, 0)", "Ready(signed) =\n     merge!Reviewer -> Done\n  [] push!Implementor -> Ready(signed)", "MergeGate"],
  ["implementor approves itself", "  [] approve!Reviewer -> Approved", "  [] approve!Reviewer -> Approved\n  [] approve!Implementor -> Approved", "Separation"],
  ["close a first-time issue unseen", "f == 0 or looked == 1 & close -> Closed", "close -> Closed", "FirstTimeGate"],
];
for (const [what, from, to, gate] of mutations) {
  if (!openSource.source.includes(from)) { console.log(`FAIL mutation text not found: ${what}`); ok = false; continue; }
  let src = openSource.source.replace(from, to);
  // the self-approval needs the reviewer side to allow it too, or the sync blocks it
  if (gate === "Separation") src = src.replace("  [] signed == 1 and green == 1 & approve!Reviewer -> Ready(signed)", "  [] signed == 1 and green == 1 & approve!Reviewer -> Ready(signed)\n  [] approve!Implementor -> Ready(signed)");
  // the merge mutation needs the implementor side to allow merging after a push too
  if (gate === "MergeGate") src = src.replace("Approved = push!Implementor -> Submitted  [] merge!Reviewer -> Merged", "Approved = push!Implementor -> Approved  [] merge!Reviewer -> Merged");
  const r = await prove(src);
  const res = r.ok ? r.results.find((x) => x.process === gate) : undefined;
  const good = res?.status === "violated";
  if (!good) ok = false;
  console.log(`${good ? "ok  " : "FAIL"} mutation "${what}": ${gate} ${res?.status ?? (r.ok ? "missing" : r.error)}`);
}
process.exit(ok ? 0 : 1);
