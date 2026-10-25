import TeX from "../tex";

const rules = [
  ["send_email", String.raw`\exists r \in \mathit{to}.\ r \notin \mathit{org}`, "send_external"],
  ["send_email", String.raw`\forall r \in \mathit{to}.\ r \in \mathit{org}`, "send_internal"],
];

const checks = [
  {
    name: "Disjointness",
    what: "No tool call maps to more than one event",
    z3: String.raw`p_i \land p_j \text{ unsatisfiable for } i \neq j`,
  },
  {
    name: "Exhaustiveness",
    what: "Every tool call maps to some event",
    z3: String.raw`\neg (p_1 \lor \dots \lor p_n) \text{ unsatisfiable}`,
  },
];

export default function Declarative() {
  return (
    <section className="slide declarative">
      <p className="eyebrow">15 · Translation units</p>
      <h2>Alternative: declarative units</h2>
      <p className="sub">Rules from predicates over a tool&apos;s arguments to events, checked by Z3.</p>

      <div className="rules">
        <span className="label">Tool</span>
        <span className="label">Predicate</span>
        <span />
        <span className="label">Event</span>
        {rules.map(([tool, p, ev]) => (
          <div key={ev} className="row">
            <code>{tool}</code>
            <TeX tex={p} />
            <span className="to">→</span>
            <code>{ev}</code>
          </div>
        ))}
      </div>

      <div className="checks">
        {checks.map((c) => (
          <div key={c.name}>
            <span className="label">{c.name}</span>
            <strong>{c.what}</strong>
            <TeX tex={c.z3} />
          </div>
        ))}
      </div>
    </section>
  );
}
