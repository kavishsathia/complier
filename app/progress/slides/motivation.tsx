const alignment = [
  ["Prompt injection", "Instructions hidden in the data an agent reads"],
  ["Misjudged context", "Acts on a wrong reading of the situation"],
  ["Unintended means", "Reaches its objective by a route nobody sanctioned"],
];

export default function Motivation() {
  return (
    <section className="slide motivation">
      <header>
        <p className="eyebrow">02 · Motivation</p>
        <h2>
          Agents now act on our behalf, and one manipulated agent can compromise
          every agent it interacts with.
        </h2>
      </header>

      <div className="grid">
        <figure className="leak">
          <h3>Interacting agents</h3>
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
            Each agent passes its own checks, yet together they leak the file.
          </figcaption>
        </figure>

        <div className="vend">
          <h3>Why alignment is not enough</h3>
          <dl>
            {alignment.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <dl className="strips">
        <div>
          <dt>Today</dt>
          <dd>
            Guardrails, input filters and runtime monitors are best-effort:
            adaptive attackers routinely bypass them.
          </dd>
        </div>
        <div>
          <dt>Goal</dt>
          <dd>Safety properties that are proven to hold, whatever the model does.</dd>
        </div>
      </dl>
    </section>
  );
}
