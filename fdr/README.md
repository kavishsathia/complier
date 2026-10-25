# FDR guard demo

A standalone C++ program that uses FDR's C++ API to load a CSP policy, check it, compile it into
a state machine, and then decide an agent's tool calls one by one. It is a demo of the guard
design, separate from complier's daemon (which has its own CSP engine in `cli/`).

FDR is not included. You download it and get a licence from its makers (see [Setup](#setup)).

## The guard

The policy is ordinary CSP over the agent's actions `A`. The guard adds a refusal event `R` that
runs alongside it:

```csp
RefusalLoop(R) = [] r:R @ r -> RefusalLoop(R)
Guard          = Policy ||| RefusalLoop(R)
System(Agent)  = prioritise(Agent [| union(A, R) |] Guard, <A, R>)
```

- **A refusal keeps the policy's state.** `|||` (interleaving) means `refuse` moves only the
  refusal loop; the policy stays exactly where it was.
- **An allowed action always wins over a refusal.** `prioritise(..., <A, R>)` on the whole
  agent–guard composition: `refuse` happens only when the agent offers nothing the policy allows.
- **The guard never deadlocks.** `refuse` is always possible, so any agent can always be answered.

## What the demo shows

`csp/agent_tools.csp` is the policy "after any write, tests must run before a push":

```csp
Clean = read_file -> Clean [] write_file -> Dirty [] run_tests -> Clean [] git_push -> Clean
Dirty = read_file -> Dirty [] write_file -> Dirty [] run_tests -> Clean
```

`fdr/demo.sh` runs it against `attempts/agent_tools.txt`. This is its output on Ubuntu 24.04 with
FDR 4.2.7 (abridged):

```
Admission (checked by FDR before anything runs)
  ok   card(A) > 0 and card(R) > 0: true
  ok   empty(inter(A, R)): true
  ok   GuardDriverCHAOS(A, R) [|union(A, R)|] GuardDriverInterleaved(Policy, R) :[deadlock free [F]]: passed
  ok   prioritise(GuardDriverCHAOS(A, R) [|union(A, R)|] GuardDriverInterleaved(Policy, R), <A, R>)
       :[deadlock free [F]]: passed
  ok   GuardDriverInterleaved(Policy, R) :[deterministic [F]]: passed

Compiled normal(GuardDriverInterleaved(Policy, R)): 2 states, 9 transitions
  refuse edges: 2 back to the same state, 0 to the start, 0 elsewhere

Attempts (the agent's tool calls, as events)
   1  read_file   allowed                now at state 0 (start) next allowed: read_file, write_file, run_tests, git_push
   2  write_file  allowed                now at state 1         next allowed: read_file, write_file, run_tests
   3  git_push    REFUSED, state kept    now at state 1         next allowed: read_file, write_file, run_tests
   4  ?           (asks what is allowed)                        next allowed: read_file, write_file, run_tests
   5  git_push    REFUSED, state kept    now at state 1         next allowed: read_file, write_file, run_tests
   6  run_tests   allowed                now at state 0 (start) next allowed: read_file, write_file, run_tests, git_push
   7  git_push    allowed                now at state 0 (start) next allowed: read_file, write_file, run_tests, git_push
   8  deploy      error: not an event of A
```

Step by step, all of it coming from FDR through the API:

1. **Load**: the CSP file is loaded into an FDR session, with the guard definitions appended.
2. **Admit**: FDR evaluates `A` and `R` (non-empty, disjoint) and runs three assertions: the guard
   can't deadlock against any agent (`GuardDriverCHAOS` offers anything or nothing), with and
   without priority, and the guard is deterministic. A policy that fails is refused (exit 5).
3. **Normalise and enumerate**: FDR compiles `normal(Guard)`; the driver walks every state and
   transition, checks each state offers `refuse`, and counts where `refuse` goes. Here every
   refusal edge loops back to the same state, which is what keeps the policy's state.
4. **Decide**: each attempt is allowed if the current state has that event, and the driver moves
   along it; otherwise it follows `refuse`. Steps 3 and 5 are a push while Dirty: refused, still
   in state 1, and the agent is told what it may do instead (`read_file, write_file, run_tests`).
5. **Prerequisite**: after `run_tests` (step 6) the push is allowed (step 7).

The demo also prints the compiled state machine (`0 --write_file--> 1`, `1 --refuse--> 1`, ...).

Other runs (paths are relative to `fdr/`):

```sh
fdr/demo.sh csp/henz_req_exec.csp attempts/henz_req_exec.txt     # after exec (STOP), every attempt is refused
fdr/demo.sh csp/negative_overlap.csp attempts/henz_req_exec.txt   # A and R overlap: refused at admission
fdr/demo.sh csp/agent_tools.csp attempts/reset/agent_tools.txt --construction reset
```

The last one is the **historical comparison**: the earlier design
`Controlled(Policy, R) = Policy /\ (refuse -> Controlled(Policy, R))` used interrupt, so every
refusal restarted the policy. There, a push retried after a refusal goes through while the work
is still untested (step 5 of that run). That is why the design moved to interleaving.

## Setup

Verified on Ubuntu 24.04 (x86_64) with g++ 13 and FDR 4.2.7. FDR also ships for macOS and
Windows; these scripts are Linux-only.

1. **Download FDR** from [cocotec.io/fdr](https://cocotec.io/fdr/) and unpack it anywhere:

   ```sh
   curl -LO https://dl.cocotec.io/fdr/fdr-3814-linux-x86_64.tar.gz   # FDR 4.2.7
   tar xzf fdr-3814-linux-x86_64.tar.gz                               # creates ./fdr
   export FDR_HOME=$PWD/fdr          # or put $PWD/fdr/bin on PATH
   ```

2. **Ubuntu 24.04 only: libtinfo.so.5.** FDR 4.2.7 links against it and 24.04 no longer ships
   it. Unpack Ubuntu 22.04's package into a folder (nothing is installed system-wide):

   ```sh
   curl -LO http://archive.ubuntu.com/ubuntu/pool/universe/n/ncurses/libtinfo5_6.3-2ubuntu0.3_amd64.deb
   dpkg-deb -x libtinfo5_6.3-2ubuntu0.3_amd64.deb tinfo5
   export TINFO5_DIR=$PWD/tinfo5/lib/x86_64-linux-gnu
   ```

   Systems that already have libtinfo.so.5 skip this step; `build.sh` checks.

3. **Licence.** Run FDR once on any file:

   ```sh
   LD_LIBRARY_PATH=$TINFO5_DIR $FDR_HOME/bin/refines fdr/csp/compare_henz_req_exec.csp
   ```

   Without a licence it asks which option applies to you (students and academic researchers get
   a free non-commercial licence; see FDR's site for the terms), registers you and stores the
   licence in `~/.config/fdr/license`. Then it runs the file; `License: ...` in the output means
   it worked.

   If it reports "Could not connect" on Ubuntu: FDR 4.2.7's licence client reads CA certificates
   only from `/etc/pki/tls/certs/ca-bundle.crt`. Pointing that path at Ubuntu's bundle lets it
   connect:

   ```sh
   sudo mkdir -p /etc/pki/tls/certs
   sudo ln -s /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt
   ```

## Build, run, test

From the repository root, with `FDR_HOME` (and `TINFO5_DIR` if needed) set:

```sh
fdr/build.sh    # ends with: fdr/build.sh: built build/guard_driver and build/test_guard_step (FDR at ...)
fdr/demo.sh     # the output above; exits 0
fdr/test.sh     # ends with: 38/38 checks pass
```

`test.sh` builds, runs every fixture under both constructions, runs FDR's own `refines` on
`csp/compare_*.csp`, and checks the logs with `tests/check_run.py`. Logs go to `fdr/runs/`.

The 38 checks include assertions that are **expected to fail** on the historical construction,
for example `Policy [T= GuardReset \ R`: with refusals hidden, the reset guard lets through a
trace the policy forbids (`write_file, git_push`). FDR reporting "Failed" there is the check
passing; the same assertions on `GuardInterleave` pass. Likewise the two negative fixtures are
expected to be refused at admission.

`tests/test_guard_step.cc` tests the allow/refuse logic on small hand-written tables, without FDR.

## Files

| file | what it is |
| --- | --- |
| `src/guard_driver.cc` | The driver: FDR session, admission, `normal(...)`, state walk and export, attempts |
| `src/guard_step.h` | Allow-or-refuse step logic, independent of FDR |
| `csp/agent_tools.csp`, `csp/henz_req_exec.csp` | Policies the driver loads (each defines `A`, `R`, `Policy`) |
| `csp/negative_*.csp` | Policies admission must refuse |
| `csp/compare_*.csp` | Assertions for `refines`: interleave next to the historical reset |
| `attempts/*.txt` | Attempted events, one per line; `?` asks what is allowed. `attempts/reset/` for the comparison |
| `build.sh`, `demo.sh`, `test.sh`, `env.sh` | Build against `FDR_HOME`, run one policy, run everything |
| `show.py` | Formats the driver's JSON lines (`build/demo.jsonl`) for reading |

Driver exit codes: 0 ok, 2 usage, 3 no FDR licence, 4 load or compile error, 5 admission
refused, 6 the compiled guard broke an invariant.

FDR is © Oxford University Innovation and distributed by Cocotec under its own licence; nothing
from it is in this repository. The code here is MIT like the rest of complier.
