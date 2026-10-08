const outcomes = [
  "A CSP fragment for constraining agents, with semantics grounded in Roscoe's operational semantics and extended to support compilation into a runtime monitor",
  "A symbolic translation from the fragment into a gatekeeper, so the properties proven upfront are the same ones enforced at runtime",
  "A working prototype integrated with agent harnesses, demonstrated on the agent-run storefront",
  "A set of modelled use cases with concrete guarantees",
];

const guarantees = [
  "No deadlock between agents",
  "No ordering before payment",
  "A balance that never dips below $0, even with multiple unsynchronised agents",
];

export default function Outcome() {
  return (
    <section className="slide outcome">
      <p className="eyebrow">11 · Expected outcome</p>
      <h2>By the end of this project, we expect to have:</h2>

      <ol className="outcomes">
        {outcomes.map((o, i) => (
          <li key={o}>
            <span className="n">{i + 1}</span>
            <p>{o}</p>
            {i === 3 && (
              <ul>
                {guarantees.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
