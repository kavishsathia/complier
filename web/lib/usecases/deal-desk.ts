import { UseCase } from "./types";

export const dealDesk: UseCase = {
  slug: "deal-desk",
  title: "Deal desk for a live enterprise deal",
  summary:
    "The dot handles the RFP response, a 300-question security questionnaire, and tracking contract redlines.",
  constraints: [
    {
      text: "Every questionnaire answer comes only from the approved knowledge base and cites its source document.",
      how: "enforced",
      detail: "An answer event must name a source, and only approved knowledge base documents 1 to 40 are offered. Whether the cited document really supports the answer is a judgment the model does not make.",
    },
    {
      text: "Any discount over 15% routes to a VP.",
      how: "enforced",
      detail: "Quotes up to 15% go out directly. Anything higher needs vp_approve for that exact discount first. The proof shows quotes over 15% never exceed VP approvals.",
    },
    {
      text: "Any redline outside the legal fallback playbook gets flagged to counsel.",
      how: "enforced",
      detail: "A redline arrives marked in or out of the playbook. An out-of-playbook redline can only be accepted after counsel_ok. The proof shows out-of-playbook acceptances never exceed counsel approvals.",
    },
    {
      text: "The RFP is submitted at least 24 hours before the portal closes.",
      how: "deadline",
      detail: "One tock is an hour, counting down from 72. submit_rfp is only offered with 24 or more hours left. The proof shows every submission happened with at least 24 hours to spare.",
    },
  ],
  source: `-- Deal desk. One tock is one hour before the RFP portal closes.

channel answer : Int.Int            -- question 1..300, cited knowledge base document
channel quote : Int                 -- discount in percent
channel request_vp, vp_approve, vp_reject : Int
channel redline : Int.Int           -- clause, 1 if it is inside the fallback playbook
channel accept : Int.Int             -- clause, 1 if it was inside the playbook
channel flag_counsel, counsel_ok, counsel_reject : Int
channel submit_rfp
channel tock

-- Answers cite one of the 40 approved knowledge base documents.
Questionnaire = answer?q:{1..300}?doc:{1..40} -> Questionnaire

-- Up to 15% is the rep's call; above that a VP approves the exact number.
Pricing = quote?d:{0..15} -> Pricing
       [] request_vp?d:{16..100} -> AwaitVP(d)
AwaitVP(d) = vp_approve!d -> Approved(d)  [] vp_reject!d -> Pricing
Approved(d) = quote!d -> Pricing

-- Redlines outside the playbook go to counsel before they are accepted.
Redlines = redline?c:{1..50}?ok:{0..1} -> Review(c, ok)
Review(c, ok) = ok == 1 & accept!c!1 -> Redlines
             [] ok == 0 & flag_counsel!c -> Counsel(c)
Counsel(c) = counsel_ok!c -> Cleared(c)  [] counsel_reject!c -> Redlines
Cleared(c) = accept!c!0 -> Redlines

Portal(h) = h >= 24 & submit_rfp -> Submitted(h)
         [] h > 0 & tock -> Portal(h - 1)
Submitted(h) = STOP

Log(big_quotes, vp_ok) =
     quote?d -> Log(big_quotes + (if d > 15 then 1 else 0), vp_ok)
  [] vp_approve?d -> Log(big_quotes, vp_ok + 1)

Legal(outside, cleared) =
     counsel_ok?c -> Legal(outside, cleared + 1)
  [] accept?c?ok -> Legal(outside + 1 - ok, cleared)

System =
  Questionnaire
  ||| (Pricing [| {| quote, vp_approve |} |] Log(0, 0))
  ||| (Redlines [| {| counsel_ok, accept |} |] Legal(0, 0))
  ||| Portal(72)

assert Log :[always big_quotes <= vp_ok]
assert Legal :[always outside <= cleared]
assert Submitted :[always h >= 24]
`,
};
