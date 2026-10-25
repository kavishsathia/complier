import TeX from "../tex";

const conditions = [
  {
    name: <>No recursion through <TeX tex="\mathbin{;}" /> or <TeX tex="\parallel" /></>,
    means: "A non-tail call reaches only a strictly lower SCC of the call graph",
    bad: String.raw`P = a \to (P \mathbin{;} b \to \mathit{SKIP})`,
  },
  {
    name: "Guardedness",
    means: "A call within the same SCC sits under a prefix",
    bad: String.raw`P = P \sqcap (a \to \mathit{STOP})`,
  },
  {
    name: "Finite types",
    means: "Every opaque nametype is instantiated with a finite set",
    bad: String.raw`\mathbf{nametype}\ \mathit{User} \;\text{left unbounded}`,
  },
];

export default function Wellformed() {
  return (
    <section className="slide wellformed">
      <p className="eyebrow">12 · CSPio · Well-formedness</p>
      <h2>Well-formed programs are finite-state, so a refinement checker can explore them exhaustively.</h2>

      <div className="table">
        <span />
        <span className="label">Condition</span>
        <span className="label">Rules out</span>
        {conditions.map((c, i) => (
          <div key={c.means} className="row">
            <span className="n">{i + 1}</span>
            <div>
              <strong>{c.name}</strong>
              <p>{c.means}</p>
            </div>
            <span className="bad">
              <TeX tex={c.bad} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
