// The policies the sequence page opens with. The first is the default.

export const EXAMPLES = [
  {
    name: "Draft, then recreate",
    // examples/demo/draft.csp, as `complier machine up` loads it (a test keeps the two equal).
    src: `-- Demo machine: the writer drafts, then recreates, in turn. Out of turn (a second draft before a
-- recreate, or a recreate first) is refused, and any other Notion write, which
-- examples/demo/draft.yaml translates to \`other\`, is denied. FDR proves and compiles this at
-- \`complier machine up\`.
datatype Act = draft | recreate | other
datatype Value = done | failed
Returns(_) = {done, failed}

Policy   = Draft
Draft    = Permit(draft, \\ _ @ Recreate) [] Deny(other, Draft)
Recreate = Permit(recreate, \\ _ @ Draft) [] Deny(other, Recreate)

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
`,
  },
  {
    name: "Review before publishing",
    src: `-- After a draft, the writer may draft again or ask
-- for a review; publishing needs an approved review.
datatype Act = draft | review | publish | other
datatype Value = done | failed | approved | rejected
Returns(review) = {approved, rejected}
Returns(_)      = {done, failed}

Policy   = Permit(draft, \\ _ @ Drafted) [] Deny(other, Policy)
Drafted  = Permit(draft, \\ _ @ Drafted)
        [] Permit(review, \\ v @ if v == approved then Approved else Drafted)
        [] Deny(publish, Drafted)
Approved = Permit(publish, \\ _ @ Policy)
        [] Permit(draft, \\ _ @ Drafted)

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
`,
  },
  {
    name: "A result decides",
    // cli/tests/fixtures/gate.csp
    src: `-- A call's result decides: after a peek, writing is permitted only if the peek saw \`big\`.
datatype Act = check | write
datatype Value = done | failed | big | small
Returns(check) = {big, small, failed}
Returns(_)     = {done, failed}

Policy = Permit(check, Checked)
Checked(big) = Permit(write, \\ _ @ Policy)
Checked(_)   = Policy

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
`,
  },
  {
    name: "Two agents (roles)",
    src: `-- With a Role datatype, every event carries the role,
-- as in the paper's encoding, and Agent is one
-- ControllableCHAOS per role. (complier machine up compiles policies
-- without roles today.)
datatype Role = writer | reviewer
datatype Act = draft | approve | publish
datatype Value = done | failed
Returns(_) = {done, failed}

Policy   = Permit(writer, draft, \\ _ @ Review)
Review   = Permit(reviewer, approve, \\ _ @ Approved)
        [] Permit(writer, draft, \\ _ @ Review)
Approved = Permit(writer, publish, \\ _ @ Policy)

Agent  = ||| r : Role @ ControllableCHAOS(r)
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {|refuse|}>)
`,
  },
];

export const EXAMPLE = EXAMPLES[0].src;
