import TeX from "../tex";

const drop = String.raw`\dfrac{a \in \Sigma^{\sim} \qquad S \overset{\tau}{\not\longrightarrow} \qquad a \notin \mathit{offered}(S)}{S \xrightarrow{\;\downarrow a\;} S}`;
const refuse = String.raw`\dfrac{a \in \Sigma^{\wedge} \qquad S \overset{\tau}{\not\longrightarrow} \qquad a \notin \mathit{offered}(S)}{S \xrightarrow{\;\times a\;} S}`;
const offered = String.raw`\mathit{offered}(S) = \{\, a \in \Sigma \mid \exists S'.\ S \xrightarrow{a} S' \,\}`;

export default function Semantics() {
  return (
    <section className="slide semantics">
      <p className="eyebrow">10 · CSPio · Operational semantics</p>
      <h2>Adapted from Roscoe&apos;s semantics of CSP, plus two rules for events the system does not offer.</h2>

      <div className="rules">
        <div className="rule">
          <span className="label">IO-Drop</span>
          <TeX tex={drop} display />
          <p>A world event the system does not offer is dropped.</p>
        </div>
        <div className="rule">
          <span className="label">IO-Refuse</span>
          <TeX tex={refuse} display />
          <p>An agent action the system does not offer is refused.</p>
        </div>
      </div>

      <div className="defs">
        <span className="label">Where</span>
        <TeX tex={offered} />
      </div>
    </section>
  );
}
