const faithful = [
  ["Generated types", "From each service's tool schemas"],
  ["Schema hashes", "A tool whose live schema drifts is withheld"],
  ["Reviewed readers", "Parse tool results; fail loudly rather than mistranslate"],
];

const declarative = [
  ["Disjointness", "No tool call maps to more than one event"],
  ["Exhaustiveness", "Every tool call maps to some event"],
];

export default function Boundary() {
  return (
    <section className="slide boundary">
      <p className="eyebrow">15 · Translation units</p>
      <h2>Translation units are the boundary of the guarantee.</h2>

      <figure className="line">
        <div className="side">
          <span className="box muted">World</span>
          <span className="arrow" />
          <span className="box">Translation units</span>
        </div>
        <div className="divider">
          <span>boundary</span>
        </div>
        <div className="side">
          <span className="box">Events</span>
          <span className="arrow" />
          <span className="box strong">Specification</span>
        </div>
        <figcaption>
          <span>No claim that events faithfully reflect the world</span>
          <span>Properties of the events are guaranteed</span>
        </figcaption>
      </figure>

      <div className="grid">
        <div>
          <span className="label">Kept faithful today by</span>
          <dl>
            {faithful.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <span className="label">Alternative: declarative units</span>
          <p className="lead">Rules from predicates over a tool&apos;s arguments to events, checked by Z3 for</p>
          <dl>
            {declarative.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
