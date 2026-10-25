const objectives = [
  {
    id: "O1",
    name: "Specification language",
    what: "A process language that separates actions the gatekeeper can block from events it cannot",
    success: "Precise syntax, formal semantics and well-formedness conditions",
    status: ["done", "Largely achieved"],
  },
  {
    id: "O2",
    name: "Real-world use cases",
    what: "Scenarios drawn from real agent transcripts, specified in CSPio",
    success: "A collection of use cases that grounds the evaluation",
    status: ["next", "Next semester"],
  },
  {
    id: "O3",
    name: "Runtime enforcement",
    what: "A gatekeeper that mediates the actions of interacting agents",
    success: "Provably allows only the actions the specification permits",
    status: ["proto", "Prototype"],
  },
  {
    id: "O4",
    name: "Harness integration",
    what: "Connect the gatekeeper to Claude Code and Codex, leaving the agents unchanged",
    success: "Agents in both harnesses mediated by the gatekeeper",
    status: ["proto", "Prototype"],
  },
  {
    id: "O5",
    name: "Verification and evaluation",
    what: "Check specifications before deployment; measure agents running under Complier",
    success: "Refinement checks pass; unsafe actions prevented and tasks completed",
    status: ["next", "Next semester"],
  },
];

export default function Objectives() {
  return (
    <section className="slide objectives">
      <p className="eyebrow">05 · Objectives</p>
      <h2>Let agents act autonomously while guaranteeing, by construction, that their interactions are safe.</h2>

      <div className="table">
        <span />
        <span className="label">Objective</span>
        <span className="label">Success</span>
        <span className="label">Status</span>
        {objectives.map((o) => (
          <div key={o.id} className="row">
            <span className="id">{o.id}</span>
            <div>
              <strong>{o.name}</strong>
              <p>{o.what}</p>
            </div>
            <p>{o.success}</p>
            <div>
              <span className={`status ${o.status[0]}`}>{o.status[1]}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
