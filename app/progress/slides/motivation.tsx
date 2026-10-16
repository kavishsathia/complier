const reasons = [
  ["Prompt injection", "Instructions hidden in the data an agent reads"],
  ["Misjudged context", "Acts on a wrong reading of the situation"],
  ["Unintended means", "Reaches its objective by a route nobody sanctioned"],
];

export default function Motivation() {
  return (
    <section className="slide motivation">
      <p className="eyebrow">02 · Motivation</p>
      <h2>Why alignment is not enough</h2>

      <dl className="reasons">
        {reasons.map(([k, v], i) => (
          <div key={k}>
            <span className="n">{i + 1}</span>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
