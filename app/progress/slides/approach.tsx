const formalisms = [
  {
    name: "KAT",
    expressiveness: "Regular language, severely limited",
    state: "No",
    processes: "No, strictly local transitions",
    guarantees: "Good",
    verdict: "Limits expressiveness, and so agent autonomy",
  },
  {
    name: "LTLf / LDLf",
    expressiveness: "An assertion language, not a process description language",
    state: "No",
    processes: "Can be modelled",
    guarantees: "Good",
    verdict: "Expressiveness in the wrong direction",
  },
  {
    name: "CSP",
    expressiveness: "Meets our needs",
    state: "Yes",
    processes: "Yes",
    guarantees: "Same strength, higher cost (FDR explores the state graph)",
    verdict: "Chosen",
  },
];

const rows = [
  ["expressiveness", "Expressiveness"],
  ["state", "Global state"],
  ["processes", "Interacting processes"],
  ["guarantees", "Compile-time guarantees"],
  ["verdict", "Verdict"],
] as const;

export default function Approach() {
  return (
    <section className="slide approach">
      <p className="eyebrow">07 · Design alternatives</p>
      <h2>The gatekeeper is a CSP state machine.</h2>
      <p className="sub">
        Chosen after three two-week iterations, judged on one trade-off:
        expressiveness vs compile-time guarantees vs agent autonomy.
      </p>

      <div className="table">
        <span />
        {formalisms.map((f, i) => (
          <span key={f.name} className={`head${f.name === "CSP" ? " chosen" : ""}`}>
            <span className="label">Iteration {i + 1}</span>
            {f.name}
          </span>
        ))}
        {rows.map(([key, label]) => (
          <div key={key} className="row">
            <span className="label">{label}</span>
            {formalisms.map((f) => (
              <p key={f.name} className={f.name === "CSP" ? "chosen" : undefined}>
                {f[key]}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
