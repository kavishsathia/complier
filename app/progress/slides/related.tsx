// Placed on two axes: when safety is checked (x) and what scope it covers (y).
// Columns: 1 none, 2 at runtime, 3 before running. Rows: 1 agents and domains,
// 2 multiple agents, 3 single agent.
const groups = [
  {
    name: "Guide",
    what: "Steers with a procedure, no guarantee",
    works: ["SOP-Agent"],
    col: "1",
    row: "3",
  },
  {
    name: "Runtime enforcement",
    what: "Checks actions as they happen",
    works: ["AgentSpec (SMU)", "Agent-C", "AgentLTL", "Pro2Guard (SMU)", "CaMeLoT"],
    col: "2",
    row: "3",
  },
  {
    name: "Orchestration",
    what: "The conversation between agents, not domain state",
    works: ["ZipperGen", "Session-Typed Judge Panel", "Schlapbach"],
    col: "2",
    row: "2",
  },
];

const xTicks = ["No check", "At runtime", "Before running"];
const yTicks = ["Agents and domains", "Multiple agents", "Single agent"];

export default function Related() {
  return (
    <section className="slide related">
      <p className="eyebrow">05 · Related work</p>
      <h2>
        Nine related works fall into three groups, and each picks one moment to
        check safety.
      </h2>

      <div className="chart">
        <span className="y-title">Scope</span>
        {yTicks.map((t, i) => (
          <span key={t} className="y-tick" style={{ gridRow: i + 1 }}>
            {t}
          </span>
        ))}
        <div className="plot">
          {groups.map((g) => (
            <div
              key={g.name}
              className="group"
              style={{ gridColumn: g.col, gridRow: g.row }}
            >
              <strong>{g.name}</strong>
              <p>{g.what}</p>
              <span className="works">{g.works.join(" · ")}</span>
            </div>
          ))}
          <div className="group ours" style={{ gridColumn: "2 / 4", gridRow: "1" }}>
            <strong>Ours</strong>
            <p>Proves upfront and enforces at runtime, across agents and domains</p>
          </div>
        </div>
        {xTicks.map((t, i) => (
          <span key={t} className="x-tick" style={{ gridColumn: i + 3 }}>
            {t}
          </span>
        ))}
        <span className="x-title">When safety is checked</span>
      </div>
    </section>
  );
}
