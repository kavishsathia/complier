import TeX from "../tex";

const clauses = [
  [String.raw`[\![\kappa m \to P]\!]`, String.raw`[\![m]\!]\ \texttt{->}\ [\![P]\!]`],
  [String.raw`[\![P \mathbin{\square} Q]\!]`, String.raw`[\![P]\!]\ \texttt{[]}\ [\![Q]\!]`],
  [String.raw`[\![P \parallel_X Q]\!]`, String.raw`[\![P]\!]\ \texttt{[|}\, [\![X]\!] \,\texttt{|]}\ [\![Q]\!]`],
  [String.raw`[\![\mathbf{nametype}\ T]\!]`, String.raw`\texttt{nametype}\ T = V_T`],
  [String.raw`[\![N(\vec{x} : \vec{\tau}) = P]\!]`, String.raw`N(\vec{x}) = \textstyle\bigwedge_i \texttt{member}(x_i, [\![\tau_i]\!])\ \texttt{\&}\ [\![P]\!]`],
];

const sets = String.raw`\Sigma^{\sim} = \{\!|\, c \mid \mathbf{channel}\ {\sim}c \,|\!\} \qquad \Sigma^{\wedge} = \{\!|\, c \mid \mathbf{channel}\ {}^{\wedge}c \,|\!\}`;

export default function CSPM() {
  return (
    <section className="slide cspm">
      <p className="eyebrow">13 · CSPio · Translation to CSPM</p>
      <h2>Translating to CSPM erases IO kinds and keeps them as two event sets for FDR.</h2>

      <div className="pipeline">
        <span className="box">CSPio program</span>
        <span className="arrow">
          <TeX tex="[\![\cdot]\!]" />
        </span>
        <span className="box">
          CSPM process
          <small>with Σ~ and Σ^</small>
        </span>
        <span className="arrow">refinement</span>
        <span className="box">FDR</span>
      </div>

      <div className="grid">
        <dl className="clauses">
          {clauses.map(([l, r]) => (
            <div key={l}>
              <dt>
                <TeX tex={l} />
              </dt>
              <dd>
                <TeX tex={r} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="notes">
          <span className="label">Marks become sets</span>
          <TeX tex={sets} display />
          <p>Properties may refer to them; drop and refusal come into play only at runtime.</p>
          <span className="label">Status</span>
          <p>Formalised by structural recursion; not yet implemented.</p>
        </div>
      </div>
    </section>
  );
}
