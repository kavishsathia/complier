const ours = [
  ["Global state", "Tracks the whole interaction, not one action at a time"],
  ["Controllability", "Blocks only what it can block; accepts what the world does"],
  ["Compile time", "Specifications verified by refinement checking"],
];

export default function Gap() {
  return (
    <section className="slide gap">
      <p className="eyebrow">04 · Research gap</p>
      <h2>Multi-agent verification is an open problem: checking each agent alone misses what they do together.</h2>

      <div className="emergent">
        <span className="label">Missed when each agent is checked alone</span>
        <ul>
          <li>Collusion</li>
          <li>Cascading failures</li>
          <li>Trust delegation</li>
        </ul>
      </div>

      <div className="ours">
        <span className="label">Complier</span>
        <p className="lead">Inter-agent communication as communicating processes</p>
        <dl>
          {ours.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
