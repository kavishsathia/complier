import TeX, { A, W } from "../tex";

const blocks = [
  {
    name: "Program",
    tex: String.raw`\begin{aligned}
\mathit{Prog} &::= \mathit{TD}^*\ \mathit{CD}^*\ D^*\ \mathbf{main}\ P \\
D &::= [\mathbf{role}]\ N(x_1{:}\tau_1, \dots, x_k{:}\tau_k) = P
\end{aligned}`,
    note: "A role marks the component an agent joins",
  },
  {
    name: "Types and channels",
    tex: String.raw`\begin{aligned}
\tau &::= \mathit{Bool} \mid \{e..e\} \mid T \\
\mathit{TD} &::= \mathbf{nametype}\ T \mid \mathbf{nametype}\ T = \tau \\
\mathit{CD} &::= \mathbf{channel}\ \kappa c \mid \mathbf{channel}\ \kappa c : \tau_1. \cdots .\tau_n \\
\kappa &::= ${W} \mid ${A} \mid \epsilon
\end{aligned}`,
    note: "A nametype without a definition is opaque: no literals, equality only",
  },
  {
    name: "Communications",
    tex: String.raw`\begin{aligned}
m &::= c\, f_1 \dots f_n \\
f &::= {?}x \mid {!}e \mid .e
\end{aligned}`,
    note: "Receive into x, send the value of e, or fix a field",
  },
  {
    name: "Processes",
    tex: String.raw`\begin{aligned}
P ::=\ & \mathit{STOP} \mid \mathit{SKIP} \mid ${W}m \to P \mid ${A}m \to P \mid m \to P \\
\mid\ & P \mathbin{\square} P \mid P \sqcap P \mid b \mathbin{\&} P \\
\mid\ & P \mathbin{;} P \mid P \parallel_X P \mid N(\vec{e})
\end{aligned}`,
    note: "The standard CSP operators; prefixes carry their channel's kind",
  },
];

export default function Syntax() {
  return (
    <section className="slide syntax">
      <p className="eyebrow">09 · CSPio · Syntax</p>
      <h2>A program declares types and channels, defines processes, and names a main process.</h2>

      <div className="blocks">
        {blocks.map((b) => (
          <div key={b.name} className="block">
            <span className="label">{b.name}</span>
            <TeX tex={b.tex} display />
            <p>{b.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
