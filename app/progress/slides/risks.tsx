const risks = [
  {
    name: "State-space explosion",
    why: "Grows with agents, channels and data values",
    fix: "Finite by well-formedness; smallest opaque sets that keep the property; check pairs of agents separately",
  },
  {
    name: "Harness constraints",
    why: "Harnesses may hide actions or change their extension points",
    fix: "Documented extension points; fall back to wrapping tools; Codex can be descoped",
  },
  {
    name: "Few multi-agent use cases",
    why: "Most deployed agents still act alone",
    fix: "Add AgentDojo scenarios, and constructed ones such as scheduling and negotiation",
  },
  {
    name: "Over-restriction",
    why: "Safe but useless: the verifier tax",
    fix: "Measure task completion alongside safety; refine specifications that block valid tasks",
  },
  {
    name: "Specification burden",
    why: "Writing process algebra limits adoption",
    fix: "A library of reusable patterns from O2; natural-language translation stays out of scope",
  },
];

export default function Risks() {
  return (
    <section className="slide risks">
      <p className="eyebrow">20 · Risks and mitigations</p>
      <h2>Five risks, each with a mitigation.</h2>

      <div className="table">
        <span className="label">Risk</span>
        <span className="label">Mitigation</span>
        {risks.map((r) => (
          <div key={r.name} className="row">
            <div>
              <strong>{r.name}</strong>
              <p>{r.why}</p>
            </div>
            <p className="fix">{r.fix}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
