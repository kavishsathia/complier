import { UseCase } from "./types";

export const nihR01: UseCase = {
  slug: "nih-r01",
  title: "NIH R01 grant application pipeline",
  summary:
    "For a research lab, the dot tracks funding announcements, assembles sections from multiple co-investigators, and runs compliance checks before internal routing.",
  constraints: [
    {
      text: "Specific Aims is 1 page, Research Strategy is 12 pages, and each biosketch is 5 pages max.",
      how: "enforced",
      detail: "Each section records whether its latest version is within its page limit. route needs every section to agree, so it is only offered when all of them comply.",
    },
    {
      text: "Fonts are 11pt or larger with 0.5\" minimum margins.",
      how: "enforced",
      detail: "Checked on the same submit event as the page count. Margins are in hundredths of an inch, so 0.5 inch is 50.",
    },
    {
      text: "The modular budget stays at or under $250K direct costs per year.",
      how: "enforced",
      detail: "The budget keeps one figure per year for 5 years, and route requires each to be at most 250000.",
    },
    {
      text: "Everything is complete before the institution's internal deadline.",
      how: "deadline",
      detail: "One tock is a business day, counting down from 10. route is only offered while days remain; at zero the only thing left is alert_pi.",
    },
  ],
  source: `-- NIH R01 application. One tock is one business day before the
-- institution's internal deadline.

datatype Section = Aims | Strategy | Bio1 | Bio2
channel submit : Section.Int.Int.Int  -- pages, font size in points, margin in 1/100 inch
channel budget : Int.Int              -- year 1..5, direct costs in dollars
channel route                         -- send the package to internal review
channel alert_pi
channel tock

-- The latest version of a section either complies or it does not.
Part(s, ok) =
     submit!s?pages:{1..100}?font:{6..24}?margin:{0..200}
       -> Part(s, if pages <= (if s == Aims then 1 else if s == Strategy then 12 else 5)
                     and font >= 11 and margin >= 50 then 1 else 0)
  [] ok == 1 & route -> Sent(s, ok)
Sent(s, ok) = STOP

-- Direct costs per year, routed only when every year is within $250K.
Budget(y1, y2, y3, y4, y5) =
     budget?y:{1..5}?amt:{0..10000000}
       -> Budget(if y == 1 then amt else y1, if y == 2 then amt else y2,
                 if y == 3 then amt else y3, if y == 4 then amt else y4,
                 if y == 5 then amt else y5)
  [] y1 <= 250000 and y2 <= 250000 and y3 <= 250000 and y4 <= 250000 and y5 <= 250000
     & route -> Filed(y1, y2, y3, y4, y5)
Filed(y1, y2, y3, y4, y5) = STOP

Calendar(d) = d > 0 & route -> Done(d)
           [] d > 0 & tock -> Calendar(d - 1)
           [] d == 0 & alert_pi -> Missed
Done(d) = STOP
Missed = STOP

System =
  Part(Aims, 0) [| {| route |} |] Part(Strategy, 0) [| {| route |} |]
  Part(Bio1, 0) [| {| route |} |] Part(Bio2, 0) [| {| route |} |]
  Budget(0, 0, 0, 0, 0) [| {| route |} |] Calendar(10)

assert Sent :[always ok == 1]
assert Filed :[always y1 <= 250000 and y2 <= 250000 and y3 <= 250000
                      and y4 <= 250000 and y5 <= 250000]
assert Done :[always d >= 1]
`,
};
