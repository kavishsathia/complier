const stages = [
  {
    name: "Specification",
    asks: "What is safe behaviour?",
    works: [
      ["nl2spec", "Natural language to temporal logic, corrected interactively"],
      ["NL2LTL", "Natural language to LTL through a library of patterns"],
    ],
    limit: "Properties of a single trace, not a protocol between agents",
  },
  {
    name: "Verification",
    asks: "Is the plan safe before it runs?",
    works: [
      ["VeriPlan", "Model-checks each LLM plan against user rules"],
      ["VeriGuard", "Verified policy code that intercepts actions"],
    ],
    limit: "One agent with a fixed plan",
  },
  {
    name: "Enforcement",
    asks: "Is this action safe right now?",
    works: [
      ["AgentSpec", "Trigger, predicate and enforcement rules"],
      ["Agent-C", "SMT-checked temporal constraints during generation"],
      ["CaMeL", "Untrusted data cannot change control flow"],
    ],
    limit: "One agent, one action at a time",
  },
];

export default function Related() {
  return (
    <section className="slide related">
      <p className="eyebrow">04 · Related work</p>
      <h2>Existing work specifies, verifies or enforces safety, one agent at a time.</h2>

      <div className="stages">
        {stages.map((s) => (
          <div key={s.name} className="stage">
            <span className="label">{s.name}</span>
            <strong className="asks">{s.asks}</strong>
            <dl>
              {s.works.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="limit">
              <span className="label">Limitation</span>
              {s.limit}
            </p>
          </div>
        ))}
      </div>

      <p className="source">Three stages from Dantas et al., a survey of 38 studies on formal safety for LLM agents</p>
    </section>
  );
}
