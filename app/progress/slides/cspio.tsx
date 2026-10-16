const kinds = [
  {
    mark: "^",
    name: "Controllable",
    who: "Agent actions",
    can: "The gatekeeper can block it",
    off: "refused",
  },
  {
    mark: "~",
    name: "Uncontrollable",
    who: "World events",
    can: "The gatekeeper cannot block it",
    off: "dropped",
  },
  {
    mark: "ε",
    name: "Internal",
    who: "Steps between processes",
    can: "Fires as soon as it is enabled",
    off: null,
  },
];

export default function CSPio() {
  return (
    <section className="slide cspio">
      <p className="eyebrow">08 · CSPio</p>
      <h2>CSPio is CSP in which every channel carries an IO kind.</h2>

      <div className="kinds">
        {kinds.map((k) => (
          <div key={k.name} className="kind">
            <span className="mark">{k.mark}</span>
            <strong>{k.name}</strong>
            <span>{k.who}</span>
            <p>{k.can}</p>
            <p className="off">
              <span className="label">Not offered</span>
              {k.off ? <em>{k.off}</em> : <span className="na">n/a</span>}
            </p>
          </div>
        ))}
      </div>

      <figure className="spec">
        <pre>
          {`channel ^coin, ^tea, ^coffee
channel ~power_cut

MAIN = coin -> (tea -> MAIN [] coffee -> MAIN)
    [] power_cut -> STOP`}
        </pre>
        <figcaption>
          The agent inserts a coin and picks a drink; the world may cut the power
          while the machine waits for a coin.
        </figcaption>
      </figure>
    </section>
  );
}
