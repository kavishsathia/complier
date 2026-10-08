const examples = [
  ["Deadlock", "An agent will never deadlock waiting for another"],
  [
    "Shared state",
    "A bank balance will never dip below $0, even when multiple unsynchronised agents are deducting from it",
  ],
];

export default function Problem() {
  return (
    <section className="slide problem">
      <p className="eyebrow">03 · Problem statement</p>
      <h2>
        Can we prove safety properties of interacting agents and domains before
        any agent runs?
      </h2>
      <p className="given">
        Given descriptions of agents and domain processes as the sequences of
        steps they can take, can we show, before any agent runs, that certain
        safety properties are guaranteed?
      </p>
      <dl className="examples">
        {examples.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
