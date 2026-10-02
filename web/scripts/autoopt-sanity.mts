// Non-vacuity checks for the AutoOPT encoding: the happy path runs end to end
// in the monitor, and breaking each rule makes the matching proof fail.
import { Monitor, parseEvent } from "../lib/csp/monitor";
import { parse } from "../lib/csp/parser";
import { prove } from "../lib/csp/prove";
import { autoopt } from "../lib/usecases/autoopt";

const happy = `present.Derivation approve.Derivation write_code present.Code approve.Code
present.Run approve.Run run_code solver_result.0 debug write_code present.Code approve.Code
present.Run approve.Run run_code solver_result.1 store_stage1
request_global run_global global_result.1 store_stage1
present.Stage1 approve.Stage1 present.Bundle approve.Bundle send_bundle llm_reply save_candidate
invoke_native present.Bundle edit.Bundle start_native native_done save_candidate
present.Stage2 approve.Stage2 formalize lake_build lean_result.1.3 formalize lake_build
lean_result.1.0 run_comparator comparator_result.1 present.Statement approve.Statement
record_verified present.Stage3 approve.Stage3`.split(/\s+/);

const prog = parse(autoopt.source);
const m = new Monitor(prog);
let ok = true;
for (const e of happy) {
  if (!m.fire(parseEvent(prog, e))) {
    console.log(`FAIL happy path blocked at ${e}; offered: ${m.offered().join(", ")}`);
    ok = false;
    break;
  }
}
if (ok) console.log(`ok   happy path: ${happy.length} events, ends in ${m.describe()[0][0]}`);

// Each mutation breaks one rule; the named gate must then be violated.
const mutations: [string, string, string, string][] = [
  ["code before the derivation is approved", "DeriveReview = approve!Derivation -> Coding", "DeriveReview = write_code -> CodeWritten [] approve!Derivation -> Coding", "DerivationGate"],
  ["run without approval", "RunAsk = present!Run -> RunReview", "RunAsk = run_code -> Solving [] present!Run -> RunReview", "RunGate"],
  ["global run without a request", "  [] g == 1 & run_global -> Permissions(0, n)", "  [] run_global -> Permissions(0, n)", "GlobalGate"],
  ["send without approval", "Sending = send_bundle -> Waiting", "Sending = send_bundle -> Waiting\nConsultX = send_bundle -> Waiting", "BundleGate"],
  ["native campaign sends out", "Native = native_done -> Reply", "Native = native_done -> Reply [] send_bundle -> Waiting", "NativeGate"],
  ["formalize before Stage 2 approval", "Stage2Review = approve!Stage2 -> Formalize", "Stage2Review = formalize -> Building [] approve!Stage2 -> Formalize", "StageGate"],
  ["verified with holes left", "ok == 1 and holes == 0 & run_comparator", "ok == 1 & run_comparator", "VerifyGate"],
];
for (const [what, from, to, gate] of mutations) {
  if (!autoopt.source.includes(from)) { console.log(`FAIL mutation text not found: ${what}`); ok = false; continue; }
  let src = autoopt.source.replace(from, to);
  if (what === "send without approval") src = src.replace("Consult = present!Bundle -> BundleReview", "Consult = send_bundle -> Waiting [] present!Bundle -> BundleReview");
  const r = await prove(src);
  const res = r.ok ? r.results.find((x) => x.process === gate) : undefined;
  const good = res?.status === "violated";
  if (!good) ok = false;
  console.log(`${good ? "ok  " : "FAIL"} mutation "${what}": ${gate} ${res?.status ?? (r.ok ? "missing" : r.error)}${res?.trace ? ` in ${res.trace.length - 1} events` : ""}`);
}
process.exit(ok ? 0 : 1);
