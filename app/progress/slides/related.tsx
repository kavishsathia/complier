import type { SlideProps } from "../deck";

// Placed on two axes: agent autonomy (x) and compile-time guarantees (y).
// Columns: 1 none, 2 low, 3 medium, 4 high. Rows: 1 high, 2 none.
// On the second step the chart tilts into 3D and each group moves onto the
// single-agent or multi-agent plane.
const groups = [
  {
    name: "CaMeLoT",
    multi: false,
    what: "Model-checks a fixed plan before any tool runs",
    works: [],
    col: "1",
    row: "1",
  },
  {
    name: "Orchestration",
    multi: true,
    what: "The conversation between agents, not domain state",
    works: ["ZipperGen"],
    col: "2",
    row: "1",
  },
  {
    name: "Runtime enforcement",
    multi: false,
    what: "Checks actions as they happen",
    works: ["AgentSpec (SMU)", "Agent-C", "AgentLTL", "Pro2Guard (SMU)"],
    col: "3",
    row: "2",
  },
  {
    name: "Guide",
    multi: false,
    what: "Steers with a procedure, no guarantee",
    works: ["SOP-Agent"],
    col: "4",
    row: "2",
  },
];

const xTicks = ["None", "Low", "Medium", "High"];
const yTicks = ["High", "None"];

export default function Related({ step }: SlideProps) {
  return (
    <section className={`slide related${step > 0 ? " tilted" : ""}`}>
      <p className="eyebrow">05 · Related work</p>
      <h2>
        Seven related works trade agent autonomy against compile-time
        guarantees.
      </h2>

      <div className="chart">
        <span className="y-title">Compile-time guarantees</span>
        {yTicks.map((t, i) => (
          <span key={t} className="y-tick" style={{ gridRow: i + 1 }}>
            {t}
          </span>
        ))}
        <div className="plot">
          <span className="plane single">Single agent</span>
          <span className="plane multi">Multi-agent</span>
          {groups.map((g) => (
            <div
              key={g.name}
              className={`group ${g.multi ? "multi" : "single"}`}
              style={{ gridColumn: g.col, gridRow: g.row }}
            >
              <strong>{g.name}</strong>
              <p>{g.what}</p>
              {g.works.length > 0 && (
                <span className="works">
                  {g.works.map((w, i) => (
                    <span key={w}>
                      {i > 0 && " · "}
                      <span className="work">{w}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
          <div className="group multi ours" style={{ gridColumn: "3", gridRow: "1" }}>
            <strong>Ours</strong>
            <p>Proves upfront and enforces at runtime, across agents and domains</p>
          </div>
        </div>
        {xTicks.map((t, i) => (
          <span key={t} className="x-tick" style={{ gridColumn: i + 3 }}>
            {t}
          </span>
        ))}
        <span className="x-title">Agent autonomy</span>
      </div>
    </section>
  );
}
