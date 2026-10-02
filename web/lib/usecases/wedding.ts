import { UseCase } from "./types";

export const wedding: UseCase = {
  slug: "wedding",
  title: "Wedding planning for 140 guests",
  summary:
    "Over 10 months, the dot juggles about 15 vendors, RSVPs, dietary needs, deposits, and seating.",
  constraints: [
    {
      text: "Total spend stays at or under the budget, with per-category caps (venue, catering, photography, etc.).",
      how: "enforced",
      detail: "A proposal can only ask for what is left under its category cap and under the overall budget, whichever is smaller. Signing commits it. The proof shows every cap and the total always hold.",
    },
    {
      text: "Every payment due date is calendared with a 7-day warning.",
      how: "deadline",
      detail: "One tock is a day. From 7 days out the deposit must be warned about; if a day passes first it is Unwarned, where warning is the only thing the dot may do. Paying it is still a person's job.",
    },
    {
      text: "The final headcount and dietary breakdown go to the caterer by the contract deadline.",
      how: "deadline",
      detail: "send_final is offered while days remain before the caterer's deadline; after that the only action is alert_couple.",
    },
    {
      text: "Guests on the \"keep apart\" list never share a table.",
      how: "enforced",
      detail: "Seating a guest only offers tables other than the one the other guest is at. The proof shows the two are never at the same table.",
    },
    {
      text: "The dot never signs contracts or makes payments.",
      how: "enforced",
      detail: "The dot can only propose and warn. sign, decline and pay are a person's events; the dot has no event that commits money.",
    },
  ],
  source: `-- Wedding planning. One tock is one day.
-- Caps: venue 30000, catering 25000, photography 6000, total 60000.

datatype Cat = Venue | Catering | Photo
datatype Guest = Uncle | Ex                 -- the keep-apart pair
channel propose : Cat.Int                   -- the dot proposes a contract amount
channel sign, decline : Cat                 -- a person signs or declines it
channel seat : Guest.Int                    -- table 1..14
channel warn, pay                           -- the deposit reminder and the payment
channel send_final : Int.Int                -- headcount, guests with dietary needs
channel alert_couple
channel tock

-- Each proposal is capped by what is left in its category and in the total.
Budget(v, k, p) =
     propose!Venue?a:{1..(if 30000 - v < 60000 - v - k - p then 30000 - v else 60000 - v - k - p)}
       -> Proposed(v, k, p, Venue, a)
  [] propose!Catering?a:{1..(if 25000 - k < 60000 - v - k - p then 25000 - k else 60000 - v - k - p)}
       -> Proposed(v, k, p, Catering, a)
  [] propose!Photo?a:{1..(if 6000 - p < 60000 - v - k - p then 6000 - p else 60000 - v - k - p)}
       -> Proposed(v, k, p, Photo, a)
Proposed(v, k, p, c, a) =
     sign!c -> Budget(v + (if c == Venue then a else 0), k + (if c == Catering then a else 0),
                      p + (if c == Photo then a else 0))
  [] decline!c -> Budget(v, k, p)

-- Keep-apart guests are never seated at the same table.
Seating(u, e) =
     seat!Uncle?t:{1..e - 1} -> Seating(t, e)
  [] seat!Uncle?t:{e + 1..14} -> Seating(t, e)
  [] seat!Ex?t:{1..u - 1} -> Seating(u, t)
  [] seat!Ex?t:{u + 1..14} -> Seating(u, t)

-- A deposit due in 20 days: the dot warns 7 days out; a person pays.
-- If the day passes without the warning, warning is all it may do.
Deposit(d, warned) =
     d <= 7 and warned == 0 & warn -> Deposit(d, 1)
  [] pay -> Paid
  [] (d > 7 or warned == 1) and d > 0 & tock -> Deposit(d - 1, warned)
  [] d <= 7 and warned == 0 and d > 0 & tock -> Unwarned(d - 1)
Unwarned(d) = warn -> Deposit(d, 1)  [] pay -> Paid  [] tock -> Unwarned(d)
Paid = tock -> Paid

-- The caterer needs final numbers 14 days before the wedding (day 16 of 30).
Caterer(d) =
     d > 0 & send_final?n:{1..140}?diet:{0..n} -> Sent(d, n, diet)
  [] d > 0 & tock -> Caterer(d - 1)
  [] d == 0 & alert_couple -> Late
  [] d == 0 & tock -> Caterer(0)
Sent(d, n, diet) = tock -> Sent(d, n, diet)
Late = tock -> Late

System =
  Budget(0, 0, 0) ||| Seating(0, 0) ||| (Deposit(20, 0) [| {| tock |} |] Caterer(16))

assert Budget :[always v <= 30000 and k <= 25000 and p <= 6000 and v + k + p <= 60000]
assert Seating :[always u == 0 or e == 0 or u != e]
assert Deposit :[always d >= 7 or warned == 1]
assert Sent :[always d >= 1 and diet <= n]
`,
};
