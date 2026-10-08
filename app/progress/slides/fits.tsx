const fits = [
  {
    code: "System = Agent ∥ Inbox ∥ Balance",
    math: true,
    text: "Agents and domains (inbox, inventory, bank balance) are all processes; the system is their composition",
  },
  {
    code: "a → P ⊓ b → Q   vs   a → P □ b → Q",
    math: true,
    text: "Internal choice is the agent deciding; external choice is the environment or another process deciding. Agent autonomy is first-class in the language",
  },
  {
    code: "no send_email after read_confidential",
    math: false,
    text: "Composition lets properties span agents and domains",
  },
];

export default function Fits() {
  return (
    <section className="slide fits">
      <p className="eyebrow">08 · Approach</p>
      <h2>Why CSP fits agents</h2>
      <div className="points">
        {fits.map((f) => (
          <div key={f.code} className="point">
            <code className={f.math ? "math" : undefined}>{f.code}</code>
            <p>{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
