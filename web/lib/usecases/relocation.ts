import { UseCase } from "./types";

export const relocation: UseCase = {
  slug: "relocation",
  title: "International family relocation",
  summary:
    "Over about 4 months, the dot coordinates movers, school enrollment, lease exits, utilities, and documents.",
  constraints: [
    {
      text: "Every passport stays valid at least 6 months beyond the entry date.",
      how: "enforced",
      detail: "Each passport records its expiry month, and booking flights needs every passport to expire at least 6 months after the entry month. The proof shows no flight is booked otherwise.",
    },
    {
      text: "Required documents are apostilled or certified as the destination requires.",
      how: "enforced",
      detail: "submit_docs needs every required document apostilled first. Which documents a country requires is given, not decided by the model.",
    },
    {
      text: "The shipping container is booked at least 8 weeks before the move.",
      how: "deadline",
      detail: "One tock is a week. book_container is only offered with 8 or more weeks left; after that the only action is alert_family.",
    },
    {
      text: "The current lease's notice is given by the contract deadline.",
      how: "deadline",
      detail: "With a 6 week notice period, give_notice is only offered with 6 or more weeks left.",
    },
    {
      text: "Utilities overlap no more than 3 days on either end.",
      how: "enforced",
      detail: "Days are counted from the move day. New utilities can start at most 3 days before it, and old ones stop at most 3 days after.",
    },
  ],
  source: `-- International relocation. One tock is one week; the move is 16 weeks out.
-- Entry is month 5; passports are given as their expiry month.

datatype Member = Parent | Child
datatype Doc = Birth | Marriage
channel passport : Member.Int        -- expiry month of the member's passport
channel book_flights
channel apostille : Doc
channel submit_docs
channel book_container, give_notice, alert_family
channel start_new, stop_old : Int    -- day relative to the move day
channel tock

Passport(m, exp) = passport!m?e:{0..240} -> Passport(m, e)
                [] exp >= 5 + 6 & book_flights -> Booked(m, exp)
Booked(m, exp) = STOP

Document(d, done) = done == 0 & apostille!d -> Document(d, 1)
                 [] done == 1 & submit_docs -> Submitted(d, done)
Submitted(d, done) = STOP

Move(w, container, notice) =
     w >= 8 and container == 0 & book_container -> Move(w, 1, notice)
  [] w >= 6 and notice == 0 & give_notice -> Move(w, container, 1)
  [] (w < 8 and container == 0) or (w < 6 and notice == 0) & alert_family -> Move(w, 1, 1)
  [] w > 0 & tock -> Move(w - 1, container, notice)
  [] w == 0 & start_new?day:{-3..0} -> Utilities(day)
Utilities(start) = stop_old?day:{0..3} -> Settled(start, day)
Settled(start, stop) = STOP

System =
  (Passport(Parent, 0) [| {| book_flights |} |] Passport(Child, 0))
  ||| (Document(Birth, 0) [| {| submit_docs |} |] Document(Marriage, 0))
  ||| Move(16, 0, 0)

assert Booked :[always exp >= 11]
assert Submitted :[always done == 1]
assert Settled :[always start >= -3 and stop <= 3]
`,
};
