import { UseCase } from "./types";

export const feedbackLoop: UseCase = {
  slug: "feedback-loop",
  title: "Customer feedback to bug fix loop",
  summary:
    "For a SaaS product, the dot watches Zendesk and Intercom, clusters reports, reproduces bugs, opens GitHub issues, and drafts PRs.",
  constraints: [
    {
      text: "It never opens a duplicate issue when an open one already matches.",
      how: "enforced",
      detail: "Reports arrive already clustered by bug. open_issue is only offered while no issue for that bug is open, and merging the fix closes it. The proof shows there is never more than one open issue per bug.",
    },
    {
      text: "Every PR passes CI and adds a regression test.",
      how: "enforced",
      detail: "open_pr says whether the change adds a regression test, and ci reports the result. Review is only offered for a PR that has both.",
    },
    {
      text: "Nothing merges to main without human review.",
      how: "enforced",
      detail: "merge is only offered after a review, and the proof shows merges never exceed reviews.",
    },
    {
      text: "Outage-level reports (P1) are escalated to on-call within 15 minutes.",
      how: "deadline",
      detail: "One tock is a minute. A P1 report starts a clock. After 15 minutes the bug is Paging, where escalate is the only action and merges wait.",
    },
    {
      text: "Customer replies use approved macros only.",
      how: "enforced",
      detail: "A reply names a macro, and only the approved ids 1 to 5 are offered. Whether a macro fits the customer is a judgment the model does not make.",
    },
    {
      text: "Clustering reports and reproducing bugs.",
      how: "not-encoded",
      detail: "Deciding which reports are the same bug is a judgment. The model takes the clustering as given and governs what is done with it.",
    },
  ],
  source: `-- Customer feedback to bug fix. One tock is one minute.
-- Two bugs stand in for the clusters.

datatype Bug = B1 | B2
channel report : Bug.Int          -- a clustered report with priority 1..3
channel open_issue, escalate : Bug
channel open_pr : Bug.Int         -- 1 if the PR adds a regression test
channel push_fix : Bug.Int        -- a new commit on the PR, same flag
channel ci : Bug.Int              -- CI result, 1 for pass
channel review, merge : Bug       -- a person reviews; then it can merge
channel reply : Int               -- the macro used to answer a customer
channel tock

-- age counts minutes since an unescalated P1 report, -1 when there is none.
-- While a P1 is overdue (Paging), merges for that bug wait.
Tracker(b, age) =
     report!b?p:{1..3} -> Tracker(b, if p == 1 and age < 0 then 0 else age)
  [] age >= 0 & escalate!b -> Tracker(b, -1)
  [] merge!b -> Tracker(b, age)
  [] age < 15 & tock -> Tracker(b, if age < 0 then age else age + 1)
  [] age >= 15 & tock -> Paging(b)
Paging(b) =
     escalate!b -> Tracker(b, -1)
  [] report!b?p:{1..3} -> Paging(b)
  [] tock -> Paging(b)

-- A PR is reviewed only once CI passes and it adds a regression test.
Idle(b) = open_pr!b?t:{0..1} -> Testing(b, t)
Testing(b, t) = ci!b?pass:{0..1} -> Checked(b, t, pass)
Checked(b, t, pass) =
     (pass == 0 or t == 0) & push_fix!b?t2:{0..1} -> Testing(b, t2)
  [] pass == 1 and t == 1 & review!b -> Reviewed(b)
Reviewed(b) = merge!b -> Idle(b)

Replies = reply?m:{1..5} -> Replies

-- The issue for each bug: opened only when none is open, closed by the merge.
Issues(b, n) = n == 0 & open_issue!b -> Issues(b, n + 1)  [] n == 1 & merge!b -> Issues(b, n - 1)
Log(reviews, merges) = review?b -> Log(reviews + 1, merges)  [] merge?b -> Log(reviews, merges + 1)

System =
  ((Tracker(B1, -1) [| {| tock |} |] Tracker(B2, -1))
     [| {| merge |} |]
   (Idle(B1) ||| Idle(B2)))
    [| {| open_issue, review, merge |} |]
  ((Issues(B1, 0) ||| Issues(B2, 0)) [| {| merge |} |] Log(0, 0))
  ||| Replies

assert Issues :[always n <= 1]
assert Log :[always merges <= reviews]
assert Tracker :[always age <= 15]
`,
};
