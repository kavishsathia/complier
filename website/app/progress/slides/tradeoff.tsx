const corners = [
  {
    name: "Expressiveness",
    what: "What processes and properties can be described",
    className: "top",
  },
  {
    name: "Compile-time guarantees",
    what: "What can be proven before any agent runs",
    className: "left",
  },
  {
    name: "Agent autonomy",
    what: "How much the agent decides for itself",
    className: "right",
  },
];

export default function Tradeoff() {
  return (
    <section className="slide tradeoff">
      <p className="eyebrow">06 · Design alternatives</p>
      <h2>Judged on one trade-off</h2>

      <div className="triangle">
        <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="200,10 10,290 390,290" />
        </svg>
        {corners.map((c) => (
          <div key={c.name} className={`corner ${c.className}`}>
            <strong>{c.name}</strong>
            <span>{c.what}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
