// The specs the stepper opens with. The first is the default.

export const EXAMPLES = [
  {
    name: "Refusal guard",
    src: `-- complier's refusal guard, as in its
-- FDR demo (fdr/).
channel draft, review, publish, refuse

-- The policy over the agent's actions:
-- draft, get a review, then publish.
-- A new draft needs a new review.
POLICY   = draft -> DRAFTED
DRAFTED  = draft -> DRAFTED
        [] review -> REVIEWED
REVIEWED = publish -> POLICY
        [] draft -> DRAFTED

-- Refusal runs alongside the policy (|||),
-- so a refusal leaves the policy where it
-- was.
REFUSAL = refuse -> REFUSAL
GUARD   = POLICY ||| REFUSAL

-- Any agent against the guard.
-- ControllableCHAOS may try any action or
-- none, and always offers refuse.
-- prioritise lets an allowed action beat
-- refuse: refuse happens only when nothing
-- else can.
AGENT = ControllableCHAOS(
          {draft, review, publish}, {refuse})
MAIN  = prioritise(
          AGENT [| {draft, review, publish,
                    refuse} |] GUARD,
          <{draft, review, publish}, {refuse}>)
`,
  },
  {
    name: "Interleaving",
    src: `-- Two writers that share nothing run side
-- by side. Each step is taken by one of
-- them, and the other stays where it was.
-- Both can draft at the start, so draft has
-- two transitions, one per writer.
channel draft, publish

WRITER = draft -> publish -> WRITER
MAIN   = WRITER ||| WRITER
`,
  },
  {
    name: "Vending machine",
    src: `-- After a coin, you pick tea or coffee
-- ([] is your choice). The machine may also
-- stop serving on its own (|~| is its
-- choice).
channel coin, tea, coffee

MAIN = coin -> (tea -> MAIN [] coffee -> MAIN)
       |~| STOP
`,
  },
];

export const EXAMPLE = EXAMPLES[0].src;
