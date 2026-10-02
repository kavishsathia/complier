import { UseCase } from "./types";

export const autoopt: UseCase = {
  slug: "autoopt",
  title: "AutoOPT: automating optimization research",
  summary:
    "From Kim, Ryu and Das Gupta (arXiv 2608.07407). A researcher works with an LLM agent through four stages: numerical design of an optimal first-order method with BnB-PEP, symbolic discovery of its analytic form and proof with a frontier LLM, formal verification in Lean, and human write-up. Every process in the encoding is exactly one participant: the agent, the human, or the world (solvers, the frontier model, Lean, the workspace). Observers only count events for the proofs. The playground language does not yet mark roles, so they are stated in the section headers rather than checked.",
  constraints: [
    {
      text: "The skill writes out the complete derivation and stops for the user's approval of the mathematics before any code is written.",
      how: "enforced",
      detail: "The agent only reaches write_code after approve.Derivation, and editing the derivation or rejecting Stage 1 sends it back. DerivationGate shows write_code never happens without a standing approval.",
    },
    {
      text: "Code is approved before it is run (Figure 2: approve or edit at derivation, code generation and run).",
      how: "enforced",
      detail: "Each run_code consumes one approve.Run. A failed solve goes back to code generation, which needs a new review. RunGate shows no run without its own approval.",
    },
    {
      text: "The global branch-and-bound stage runs only at the user's explicit request.",
      how: "enforced",
      detail: "request_global is the human's event. The agent's Permissions process remembers it and lets exactly one run_global through per request. GlobalGate shows global runs never exceed requests.",
    },
    {
      text: "The derivation, code, numerical solution, solver status and logs are stored in the research workspace.",
      how: "enforced",
      detail: "A successful solve can only be followed by store_stage1, and Stage 1 is only presented for approval after it. The individual files are one event here.",
    },
    {
      text: "The context bundle is shared with the frontier model only after the user approves it, and each follow-up round needs approval again.",
      how: "enforced",
      detail: "Each send_bundle consumes one approve.Bundle. BundleGate shows nothing is sent to an external model without its own approval.",
    },
    {
      text: "The native route runs only on explicit user invocation, and no problem material is sent to any external model during it.",
      how: "enforced",
      detail: "start_native needs a standing invoke_native from the human. NativeGate shows no send_bundle happens while a native campaign is running.",
    },
    {
      text: "Frontier model output is saved in the workspace and marked as a candidate.",
      how: "enforced",
      detail: "Every reply is followed by save_candidate before anything else. That the saved file says \"candidate\" is part of what the event means, not checked inside it.",
    },
    {
      text: "Each stage is approved by a human before the next begins.",
      how: "enforced",
      detail: "Stage 2 can only start after approve.Stage1, and formalization only after approve.Stage2. StageGate shows neither happens early.",
    },
    {
      text: "A result is recorded as formally verified only after Lean accepts it with no sorry, axiom, admit or unsafe, the comparator replay confirms it, and the human authors confirm the statements are faithful.",
      how: "enforced",
      detail: "lean_result reports whether the build passed and how many holes the hygiene scan found. record_verified needs a clean build, an accepted replay and approve.Statement for the current formalization; any new formalize resets all three. VerifyGate shows nothing is recorded verified otherwise.",
    },
    {
      text: "Interpreting the results and writing them up (Stage 4).",
      how: "not-encoded",
      detail: "This is the human's own work after Stage 3 is approved. The agent's process stops there.",
    },
  ],
  source: `-- AutoOPT (arXiv 2608.07407). Each process below is one participant.
-- Events are listed under the participant that performs them.

datatype Gate = Derivation | Code | Run | Bundle | Stage1 | Stage2 | Stage3 | Statement

-- performed by the human researcher
channel approve, edit : Gate
channel request_global, invoke_native

-- performed by the agent
channel present : Gate
channel write_code, debug, run_code, run_global, store_stage1
channel send_bundle, start_native, native_done, save_candidate
channel formalize, lake_build, run_comparator, record_verified

-- performed by the world (solvers, frontier model, Lean)
channel solver_result, global_result : Int    -- 1 if the solve succeeded
channel llm_reply
channel lean_result : Int.Int                 -- 1 if lake build passed, holes found
channel comparator_result : Int               -- 1 if the replay accepted

-- The agent: the four-stage pipeline -------------------------------------

-- Stage 1: numerical design with bnb-pep-skill.
Derive = present!Derivation -> DeriveReview
DeriveReview = approve!Derivation -> Coding  [] edit!Derivation -> Derive
Coding = write_code -> CodeWritten
CodeWritten = present!Code -> CodeReview
CodeReview = approve!Code -> RunAsk  [] edit!Code -> Coding
RunAsk = present!Run -> RunReview
RunReview = approve!Run -> Ready  [] edit!Run -> Coding
Ready = run_code -> Solving
Solving = solver_result?st:{0..1} -> Solved(st)
Solved(st) = st == 1 & store_stage1 -> Stored
          [] st == 0 & debug -> Coding
Stored = run_global -> Globaling
      [] present!Stage1 -> Stage1Review
Globaling = global_result?st:{0..1} -> Solved(st)
Stage1Review = approve!Stage1 -> Consult  [] edit!Stage1 -> Derive

-- Stage 2: symbolic discovery with frontier-llm-consult.
Consult = present!Bundle -> BundleReview
       [] start_native -> Native
BundleReview = approve!Bundle -> Sending  [] edit!Bundle -> Consult
Sending = send_bundle -> Waiting
Waiting = llm_reply -> Reply
Native = native_done -> Reply
Reply = save_candidate -> Saved
Saved = present!Bundle -> BundleReview
     [] present!Stage2 -> Stage2Review
Stage2Review = approve!Stage2 -> Formalize  [] edit!Stage2 -> Consult

-- Stage 3: formal verification with lean-verify.
Formalize = formalize -> Building
Building = lake_build -> Checking
Checking = lean_result?ok:{0..1}?holes:{0..1000} -> Built(ok, holes)
Built(ok, holes) = ok == 1 and holes == 0 & run_comparator -> Replaying
                [] ok == 0 or holes > 0 & formalize -> Building
Replaying = comparator_result?acc:{0..1} -> Replayed(acc)
Replayed(acc) = acc == 1 & present!Statement -> Faithful
             [] acc == 0 & formalize -> Building
Faithful = approve!Statement -> Confirmed  [] edit!Statement -> Formalize
Confirmed = record_verified -> Verified
Verified = present!Stage3 -> Stage3Review
Stage3Review = approve!Stage3 -> Handover  [] edit!Stage3 -> Formalize
Handover = STOP

-- The agent: what the human has explicitly allowed. It accepts a request
-- at any time and lets one global run or native campaign through per request.
Permissions(g, n) =
     request_global -> Permissions(1, n)
  [] invoke_native -> Permissions(g, 1)
  [] g == 1 & run_global -> Permissions(0, n)
  [] n == 1 & start_native -> Permissions(g, 0)

-- The human -------------------------------------------------------------

Human = present?g -> Deciding(g)
     [] request_global -> Human
     [] invoke_native -> Human
Deciding(g) = approve!g -> Human  [] edit!g -> Human

-- The world -------------------------------------------------------------

-- Julia/JuMP with MOSEK, KNITRO, Ipopt (local) and Gurobi (global).
Solver(busy) =
     busy == 0 & run_code -> Solver(1)
  [] busy == 0 & run_global -> Solver(2)
  [] busy == 1 & solver_result?st:{0..1} -> Solver(0)
  [] busy == 2 & global_result?st:{0..1} -> Solver(0)

Frontier(busy) = busy == 0 & send_bundle -> Frontier(1)
              [] busy == 1 & llm_reply -> Frontier(0)

-- Lean 4 with mathlib: lake build plus hygiene scan, then comparator replay.
Lean(busy) =
     busy == 0 & lake_build -> Lean(1)
  [] busy == 1 & lean_result?ok:{0..1}?holes:{0..1000} -> Lean(0)
  [] busy == 0 & run_comparator -> Lean(2)
  [] busy == 2 & comparator_result?acc:{0..1} -> Lean(0)

-- Observers: not participants, they count for the proofs ----------------

DerivationGate(ok, bad) =
     approve?g -> DerivationGate(if g == Derivation then 1 else ok, bad)
  [] edit?g -> DerivationGate(if g == Derivation or g == Stage1 then 0 else ok, bad)
  [] write_code -> DerivationGate(ok, bad + 1 - ok)

RunGate(ok, bad) =
     approve?g -> RunGate(if g == Run then 1 else ok, bad)
  [] run_code -> RunGate(0, bad + 1 - ok)

GlobalGate(req, bad) =
     request_global -> GlobalGate(1, bad)
  [] run_global -> GlobalGate(0, bad + 1 - req)

BundleGate(ok, bad) =
     approve?g -> BundleGate(if g == Bundle then 1 else ok, bad)
  [] send_bundle -> BundleGate(0, bad + 1 - ok)

NativeGate(running, bad) =
     start_native -> NativeGate(1, bad)
  [] native_done -> NativeGate(0, bad)
  [] send_bundle -> NativeGate(running, bad + running)

StageGate(s1, s2, bad) =
     approve?g -> StageGate(if g == Stage1 then 1 else s1, if g == Stage2 then 1 else s2, bad)
  [] edit?g -> StageGate(if g == Stage1 then 0 else s1, if g == Stage2 then 0 else s2, bad)
  [] present?g -> StageGate(s1, s2, bad + (if g == Bundle then 1 - s1 else 0))
  [] start_native -> StageGate(s1, s2, bad + 1 - s1)
  [] formalize -> StageGate(s1, s2, bad + 1 - s2)

VerifyGate(clean, accepted, faithful, bad) =
     formalize -> VerifyGate(0, 0, 0, bad)
  [] lean_result?ok?holes -> VerifyGate(if ok == 1 and holes == 0 then 1 else 0, accepted, faithful, bad)
  [] comparator_result?acc -> VerifyGate(clean, acc, faithful, bad)
  [] approve?g -> VerifyGate(clean, accepted, if g == Statement then 1 else faithful, bad)
  [] record_verified -> VerifyGate(clean, accepted, faithful,
       bad + (if clean == 1 and accepted == 1 and faithful == 1 then 0 else 1))

System =
  ((Derive [| {| run_global, start_native |} |] Permissions(0, 0))
     [| {| present, approve, edit, request_global, invoke_native |} |]
   Human)
    [| {| run_code, run_global, solver_result, global_result, send_bundle, llm_reply,
          lake_build, lean_result, run_comparator, comparator_result |} |]
  (Solver(0) ||| Frontier(0) ||| Lean(0))
    [| {| approve, edit, present, write_code, run_code, run_global, request_global,
          send_bundle, start_native, native_done, formalize, lean_result,
          comparator_result, record_verified |} |]
  -- each observer syncs with the ones before it on the events they share
  (DerivationGate(0, 0) [| {| approve |} |] RunGate(0, 0) [| {| approve |} |]
   BundleGate(0, 0) [| {| send_bundle |} |] NativeGate(0, 0)
   [| {| approve, edit, start_native |} |] StageGate(0, 0, 0)
   [| {| approve, formalize |} |] VerifyGate(0, 0, 0, 0)
   ||| GlobalGate(0, 0))

assert DerivationGate :[always bad == 0]
assert RunGate :[always bad == 0]
assert GlobalGate :[always bad == 0]
assert BundleGate :[always bad == 0]
assert NativeGate :[always bad == 0]
assert StageGate :[always bad == 0]
assert VerifyGate :[always bad == 0]
`,
};
