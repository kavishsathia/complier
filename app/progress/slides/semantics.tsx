import TeX from "../tex";

const roscoe: [string, string[]][] = [
  ["Termination, prefix, guard", ["IO-Skip", "IO-Prefix", "IO-Guard"]],
  ["External choice", ["IO-ExtL", "IO-ExtR", "IO-ExtTauL", "IO-ExtTauR"]],
  ["Internal choice", ["IO-IntL", "IO-IntR"]],
  ["Sequential", ["IO-Seq", "IO-SeqTerm"]],
  ["Parallel", ["IO-ParL", "IO-ParR", "IO-Sync", "IO-ParTermL", "IO-ParTermR", "IO-ParTerm"]],
  ["Calls", ["IO-Call"]],
];

const drop = String.raw`\dfrac{a \in \Sigma^{\sim} \qquad S \text{ stable} \qquad a \notin \mathit{offered}(S)}{S \xrightarrow{\;\downarrow a\;} S}\;\textsf{[IO-Drop]}`;
const refuse = String.raw`\dfrac{a \in \Sigma^{\wedge} \qquad S \text{ stable} \qquad a \notin \mathit{offered}(S)}{S \xrightarrow{\;\times a\;} S}\;\textsf{[IO-Refuse]}`;
const offered = String.raw`\mathit{offered}(S) = \{\, a \in \Sigma \mid \exists S'.\ S \xrightarrow{a} S' \,\}`;

export default function Semantics() {
  return (
    <section className="slide semantics">
      <p className="eyebrow">10 · CSPio · Operational semantics</p>
      <h2>Adapted from Roscoe&apos;s semantics of CSP, plus two rules for events the system does not offer.</h2>

      <div className="grid">
        <div className="roscoe">
          <span className="label">Adapted from Roscoe</span>
          <dl>
            {roscoe.map(([group, rules]) => (
              <div key={group}>
                <dt>{group}</dt>
                <dd>
                  {rules.map((r) => (
                    <code key={r}>{r}</code>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="new">
          <span className="label">New in CSPio</span>
          <div className="rule">
            <TeX tex={drop} display />
            <p>A world event the system does not offer is dropped.</p>
          </div>
          <div className="rule">
            <TeX tex={refuse} display />
            <p>An agent action the system does not offer is refused.</p>
          </div>
          <div className="defs">
            <TeX tex={offered} />
            <span>
              <em>Stable</em>: no <TeX tex="\tau" /> transitions. Either way, the state is unchanged.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
