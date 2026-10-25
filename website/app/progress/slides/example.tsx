import type { SlideProps } from "../deck";
import TeX from "../tex";

const S0 = String.raw`S_0 = (\mathit{coin} \to Q) \mathbin{\square} (\mathit{power\_cut} \to \mathit{STOP})`;
const Q = String.raw`Q = (\mathit{tea} \to \mathit{MAIN}) \mathbin{\square} (\mathit{coffee} \to \mathit{MAIN})`;

const steps = [
  {
    event: "coin",
    in: "S₀",
    verdict: "performed",
    tex: String.raw`\dfrac{\dfrac{(\mathit{coin}, \emptyset) \in \mathit{comms}(\mathit{coin})}{(\mathit{coin} \to Q) \xrightarrow{\mathit{coin}} Q}\;\textsf{[IO-Prefix]} \qquad \mathit{coin} \in \Sigma^{\checkmark}}{S_0 \xrightarrow{\mathit{coin}} Q}\;\textsf{[IO-ExtL]}`,
  },
  {
    event: "tea",
    in: "S₀",
    verdict: "refused",
    tex: String.raw`\dfrac{\mathit{tea} \in \Sigma^{\wedge} \qquad S_0 \overset{\tau}{\not\longrightarrow} \qquad \mathit{tea} \notin \mathit{offered}(S_0)}{S_0 \xrightarrow{\;\times \mathit{tea}\;} S_0}\;\textsf{[IO-Refuse]}`,
  },
  {
    event: "power_cut",
    in: "Q",
    verdict: "dropped",
    tex: String.raw`\dfrac{\mathit{power\_cut} \in \Sigma^{\sim} \qquad Q \overset{\tau}{\not\longrightarrow} \qquad \mathit{power\_cut} \notin \mathit{offered}(Q)}{Q \xrightarrow{\;\downarrow \mathit{power\_cut}\;} Q}\;\textsf{[IO-Drop]}`,
  },
];

export default function Example({ step }: SlideProps) {
  return (
    <section className="slide example">
      <p className="eyebrow">11 · CSPio · Example</p>
      <h2>Stepping the vending machine: one transition, one refusal, one drop.</h2>

      <div className="states">
        <TeX tex={S0} />
        <TeX tex={Q} />
      </div>

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.event} className={i > step ? "hidden" : undefined}>
            <div className="what">
              <code>{s.event}</code>
              <span>in {s.in}</span>
              <span className={`verdict ${s.verdict}`}>{s.verdict}</span>
            </div>
            <TeX tex={s.tex} display />
          </li>
        ))}
      </ol>

      <p className="live">
        <span className="label">Live</span>
        complier.dev/stepper derives every step from the rules
      </p>
    </section>
  );
}
