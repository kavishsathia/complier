const vend = [
  ["Operating loss", "Priced items below cost"],
  ["Acting without authority", "Negotiated to hire a security officer; named a “real” CEO"],
  ["Order before payment", "Payment links added by hand to enforce the sequence"],
];

const prior = [
  ["Law-governed interaction", "Minsky", "Rules governing how multiple parties interact"],
  ["Security automata", "Schneider", "Execution monitors enforce exactly the safety properties"],
  ["Edit automata", "Ligatti, Bauer and Walker", "Monitors that suppress or insert actions, not just halt"],
];

export default function Motivation() {
  return (
    <section className="slide motivation">
      <header>
        <p className="eyebrow">02 · Motivation</p>
        <h2>
          Agents act in unbounded ways, and per-action guardrails cannot see the
          sequences where the danger lives.
        </h2>
      </header>

      <div className="grid">
        <figure className="leak">
          <h3>Example</h3>
          <div className="flow">
            <div className="node muted">confidential file</div>
            <div className="edge">read</div>
            <div className="node">
              <strong>Agent A</strong>
              <small>no email access</small>
            </div>
            <div className="edge">message</div>
            <div className="node">
              <strong>Agent B</strong>
              <small>cannot read file</small>
            </div>
            <div className="edge">email</div>
            <div className="node bad">outside</div>
          </div>
          <figcaption>
            Every per-agent guardrail is satisfied, yet the system leaks the file.
          </figcaption>
        </figure>

        <div className="vend">
          <h3>Project Vend (Anthropic)</h3>
          <dl>
            {vend.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="prior">
        <h3>Done before, for software</h3>
        <ol>
          {prior.map(([name, who, what]) => (
            <li key={name}>
              <strong>{name}</strong>
              <span className="who">{who}</span>
              <span>{what}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
