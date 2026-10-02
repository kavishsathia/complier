import { UseCase } from "./types";

export const labAnalysis: UseCase = {
  slug: "lab-analysis",
  title: "Rerunning analysis as experimental data arrives",
  summary:
    "The dot reruns a lab's analysis pipeline each time a new instrument batch lands.",
  constraints: [
    {
      text: "Raw data files are never modified.",
      how: "enforced",
      detail: "write_raw exists as an event but the law never offers it; the dot can read raw files and write derived ones. The proof shows no raw write ever happens.",
    },
    {
      text: "Every run is tied to a specific code commit hash.",
      how: "enforced",
      detail: "run carries a commit and is only offered for the commit currently checked out, and only once one is.",
    },
    {
      text: "Batches where the controls fall outside 2 SD of their historical mean are flagged as QC failures.",
      how: "enforced",
      detail: "The historical mean (100) and SD (5) are given, so the band is 90 to 110. A batch outside it can only be flagged, never run. The proof shows no out-of-band batch is ever analysed. Updating the mean and SD over time is left out.",
    },
    {
      text: "The PI is notified when an effect estimate shifts by more than a pre-set threshold.",
      how: "enforced",
      detail: "With a threshold of 10, a result that moves more than 10 from the last one can only be followed by notify_pi; a smaller move can only be recorded.",
    },
  ],
  source: `-- Rerunning a lab's analysis on each new batch.
-- Control band: historical mean 100, SD 5, so 90..110. Shift threshold: 10.

channel checkout : Int              -- the code commit to analyse with
channel batch : Int                 -- a new instrument batch with its control value
channel read_raw, write_derived, write_raw
channel flag_qc
channel run : Int.Int               -- commit, control value of the batch
channel result : Int                -- the pipeline's effect estimate
channel notify_pi, record : Int

Lab(commit, last) =
     checkout?c:{1..1000000} -> Lab(c, last)
  [] commit > 0 & batch?ctrl:{0..1000} -> Batch(commit, last, ctrl)
Batch(commit, last, ctrl) =
     ctrl < 90 or ctrl > 110 & flag_qc -> Lab(commit, last)
  [] ctrl >= 90 and ctrl <= 110 & read_raw -> Ready(commit, last, ctrl)
Ready(commit, last, ctrl) = run!commit!ctrl -> Ran(commit, last)
Ran(commit, last) = result?e:{-1000..1000} -> Check(commit, last, e)
Check(commit, last, e) =
     e - last > 10 or last - e > 10 & notify_pi!e -> Saving(commit, e)
  [] e - last <= 10 and last - e <= 10 & record!e -> Saving(commit, e)
Saving(commit, e) = write_derived -> Lab(commit, e)

-- write_raw is in the alphabet but no state of Lab offers it.
Audit(bad_runs, raw_writes) =
     run?c?ctrl -> Audit(bad_runs + (if ctrl < 90 or ctrl > 110 then 1 else 0), raw_writes)
  [] write_raw -> Audit(bad_runs, raw_writes + 1)

System = Lab(0, 0) [| {| run, write_raw |} |] Audit(0, 0)

assert Audit :[always bad_runs == 0]
assert Audit :[always raw_writes == 0]
`,
};
