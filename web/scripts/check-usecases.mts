// Proves every assertion in every use case and fails if any does not hold.
// Run with: npm run check:usecases
import { prove } from "../lib/csp/prove";
import { heldAccount, naiveAccount } from "../lib/csp/examples";
import { useCases } from "../lib/usecases/index";

const only = process.argv[2];
let failed = 0;
for (const uc of useCases) {
  if (only && uc.slug !== only) continue;
  const started = Date.now();
  const r = await prove(uc.source);
  if (!r.ok) {
    failed++;
    console.log(`FAIL ${uc.slug}: line ${r.line}: ${r.error}`);
    continue;
  }
  for (const a of r.results) {
    const ok = a.status === "holds";
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${uc.slug}: ${a.process} :[always ${a.assertion}] ${a.status} ${a.ms}ms`);
    if (!ok && a.trace) for (const s of a.trace) console.log(`       ${s.event ?? "start"}  ${s.state.join("  ")}`);
    if (!ok && a.note) console.log(`       ${a.note}`);
  }
  console.log(`     ${uc.slug} total ${Date.now() - started}ms`);
}
// The docs walkthrough depends on the naive account failing and the fixed one holding.
if (!only) {
  for (const [name, src, want] of [["docs naive", naiveAccount, "violated"], ["docs held", heldAccount, "holds"]] as const) {
    const r = await prove(src);
    const got = r.ok ? r.results[0].status : "error";
    if (got !== want) failed++;
    console.log(`${got === want ? "ok  " : "FAIL"} ${name}: ${got}`);
  }
}

process.exit(failed ? 1 : 0);
