const steps = [
  "Define a fragment of CSP",
  "Extend the fragment's semantics with what helps it compile into a runtime monitor",
  "Define a symbolic transition system (STS) semantics so the fragment compiles into a runtime monitor",
  "Ground the work in CSP's operational semantics (Roscoe)",
  "Model use cases for constrained agents using the fragment",
];

export default function Plan() {
  return (
    <section className="slide plan">
      <p className="eyebrow">10 · Plan for next semester</p>
      <h2>
        Turn CSP into a constrained language that compiles into a runtime
        monitor, then prove it out on use cases.
      </h2>

      <div className="body">
        <ol className="steps">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <div className="side">
          <h3 className="label">STS intuition</h3>
          <div className="sts">
            <span className="loc">ℓ</span>
            <div className="edge">
              <span className="math">withdraw(x)</span>
              <span className="math guard">[balance ≥ x] / balance := balance − x</span>
            </div>
            <span className="loc">ℓ′</span>
          </div>
          <dl>
            <div>
              <dt>Process states</dt>
              <dd>become control locations</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>become transitions with a guard and an update</dd>
            </div>
            <div>
              <dt>Shared events</dt>
              <dd>are synchronised</dd>
            </div>
          </dl>

          <h3 className="label">Why symbolic</h3>
          <p>One transition covers every data value, so the state space does not explode.</p>

          <h3 className="label">Why a fragment</h3>
          <p>
            Keep the expressiveness agents need; trim what makes checking and
            compilation costly.
          </p>
        </div>
      </div>
    </section>
  );
}
