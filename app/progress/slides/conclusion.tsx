const done = [
  "Evaluated KAT and LTLf/LDLf; adopted CSP",
  "Designed CSPio: syntax, operational semantics, well-formedness",
  "Formalised the translation to CSPM",
  "Built an interactive stepper for the semantics",
  "Prototyped a runtime enforcing specifications in Claude Code",
];

const next = [
  "Use cases from real agent transcripts",
  "A gatekeeper that provably allows only permitted actions",
  "Integration with Claude Code and Codex",
  "Refinement checks and an evaluation of safety and task completion",
];

export default function Conclusion() {
  return (
    <section className="slide conclusion">
      <p className="eyebrow">21 · Conclusion</p>
      <h2>Safety for interacting agents, proven rather than merely expected.</h2>

      <div className="grid">
        <div>
          <span className="label">This semester</span>
          <ul>
            {done.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="label">Next semester</span>
          <ul>
            {next.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
