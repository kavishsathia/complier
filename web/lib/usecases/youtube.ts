import { UseCase } from "./types";

export const youtube: UseCase = {
  slug: "youtube",
  title: "Weekly content production for a YouTube creator",
  summary:
    "For a creator with sponsors, the dot manages scripts, thumbnail briefs, sponsor reads, and descriptions.",
  constraints: [
    {
      text: "Sponsor segments meet contract specs (e.g., a 60 to 90 second read in the first 3 minutes, plus the tracking link pinned in the description).",
      how: "enforced",
      detail: "place_read picks a length from 60 to 90 seconds and a start that ends the read by 180 seconds. publish needs the read placed and the tracking link pinned. The proof shows every published video meets both.",
    },
    {
      text: "Paid placements carry clear FTC-style disclosure.",
      how: "enforced",
      detail: "publish needs a disclosure in the script. Whether its wording is clear enough is a judgment the model does not make.",
    },
    {
      text: "Sponsor drafts are submitted for approval 5 days before publish.",
      how: "deadline",
      detail: "One tock is a day. submit_draft is only offered with 5 or more days left; after that the sponsor read cannot go out this week and the only action is alert_creator.",
    },
    {
      text: "Videos go live on the fixed weekly slot.",
      how: "enforced",
      detail: "publish is only offered on the slot day, with zero days left, and only with the sponsor's approval.",
    },
  ],
  source: `-- One week of a sponsored video. One tock is one day; the slot is 7 days out.

channel place_read : Int.Int     -- read length in seconds, start time in seconds
channel pin_link, disclose
channel submit_draft, sponsor_approve, alert_creator
channel publish
channel tock

-- The read: 60 to 90 seconds, finished by the 3 minute mark.
Script = place_read?l:{60..90}?s:{0..180 - l} -> Placed(l, s)
Placed(dur, start) = publish -> Published(dur, start)
Published(dur, start) = STOP

-- The description: link pinned and disclosure in place before publishing.
Description(pinned, disclosed) =
     pin_link -> Description(1, disclosed)
  [] disclose -> Description(pinned, 1)
  [] pinned == 1 and disclosed == 1 & publish -> Live(pinned, disclosed)
Live(pinned, disclosed) = STOP

-- The sponsor sees the draft at least 5 days out; publishing is on the slot.
Sponsor(d, sent, approved) =
     sent == 0 and d >= 5 & submit_draft -> Sponsor(d, 1, approved)
  [] sent == 1 and approved == 0 & sponsor_approve -> Sponsor(d, sent, 1)
  [] d == 0 and approved == 1 & publish -> Aired(d)
  [] sent == 0 and d < 5 & alert_creator -> Missed
  [] d > 0 & tock -> Sponsor(d - 1, sent, approved)
Aired(d) = STOP
Missed = STOP

System =
  Script [| {| publish |} |] Description(0, 0) [| {| publish |} |] Sponsor(7, 0, 0)

assert Published :[always dur >= 60 and dur <= 90 and start + dur <= 180]
assert Live :[always pinned == 1 and disclosed == 1]
assert Aired :[always d == 0]
`,
};
