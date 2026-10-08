const assumptions = [
  {
    arc: "Can we describe it?",
    claim: "The steps of every agent and domain can be described upfront",
    holds: "Operators already choose an agent's tools in advance; a known alphabet and recursion identify sequences upfront",
    shaken: "Exploratory work with no fixed process; agents creating their own tools (DeepSeek Harness)",
    response: "A language with varying levels of constraint, from a strict series of steps to recursion over an allowlist",
  },
  {
    arc: "Can we enforce it?",
    claim: "Every action an agent takes can be intercepted and checked by the gatekeeper",
    holds: "Harnesses expose hooks (Claude Code's PreToolUse hook, Codex hooks)",
    shaken: "Depends entirely on the harness provider; no hook, no integration point",
    response: null,
  },
  {
    arc: "Does it match reality?",
    claim: "The gatekeeper's view of the domain stays in sync with its real state",
    holds: null,
    shaken: "Gatekeeper thinks the balance is $2, but $2 was withdrawn outside the system; the real balance is $0",
    response: "A mechanism to detect the discrepancy and reconcile it",
  },
];

const rows = [
  ["holds", "Why it holds"],
  ["shaken", "What shakes it"],
  ["response", "Response"],
] as const;

export default function Assumptions() {
  return (
    <section className="slide assumptions">
      <p className="eyebrow">04 · Assumptions and constraint</p>

      <div className="table">
        <span />
        {assumptions.map((a, i) => (
          <div key={a.arc} className="head">
            <span className="arc">
              {i + 1} · {a.arc}
            </span>
            <strong>{a.claim}</strong>
          </div>
        ))}
        {rows.map(([key, label]) => (
          <div key={key} className="row">
            <span className="label">{label}</span>
            {assumptions.map((a) => (
              <p key={a.arc}>{a[key]}</p>
            ))}
          </div>
        ))}
      </div>

      <p className="constraint">
        <span className="label">Constraint</span>
        Guarantees cover which sequences of steps are possible, not how wisely
        an agent chooses among them.
      </p>
    </section>
  );
}
