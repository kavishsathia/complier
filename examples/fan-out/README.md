# Fan-out: three approaches at once

Four Claude Code sessions share one complier machine, `fan-out`, as the pattern library's parallel
fan-out/gather. The task is a forecasting competition: predict hourly bike-share rentals for the
last third of each month, scored by RMSLE (`workspace/TASK.md`).

- The **planner** reads the task, makes a git worktree for each worker (`trees/worker1`,
  `trees/worker2`, `trees/worker3`, each on its own branch), writes the approach that worker is to
  try in its `APPROACH.md`, and hands them out with `./tools/assign.sh`.
- **worker1**, **worker2** and **worker3** wait until then, held by complier. Then all three work at
  the same time, each on its own approach in its own tree, and submit with `./tools/submit.sh`,
  which scores the predictions on the test set and commits the tree.
- The planner waits while they work. Once all three have scored, it compares them with
  `./tools/status.sh` and merges the best with `./tools/choose.sh workerN`, which writes `RESULT.md`.

[`fan-out.csp`](fan-out.csp) is the protocol:

```csp
Policy = Pipeline(<Plan, FanOut(<Worker(worker1), Worker(worker2), Worker(worker3)>, Gather)>)
```

FDR proves, before anything runs, that no worker acts before the hand-off, nothing is chosen before
every submission has scored, and the planner makes no call at all from the hand-off until the last
submission. [`claude-code.yaml`](claude-code.yaml) says which calls are which steps: the three
scripts, and `work` for everything else. Reading files is passed through.

From the launcher, ⌘↩ copies this folder to `~/complier-demos/fan-out`, makes its workspace a git
repository, starts the machine and opens five Terminal windows: the machine's log, the planner and
the three workers, each already given its prompt. It needs complier with the pattern library and
agents acting at the same time, which are on main and not yet in a release.

The data is synthetic and made by [`answers/make_data.py`](answers/make_data.py), which also writes
the test set's counts to `answers/test_counts.csv` for the scorer. Nothing stops an agent from
reading `answers/` but its instructions: the workspace is all they're told to touch.
