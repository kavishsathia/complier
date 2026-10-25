// Weeks are inclusive, read off the report's schedule (Figure 1).
const groups = [
  {
    name: "O2 Use cases",
    span: [1, 5],
    tasks: [
      ["Analyse transcripts", 1, 3],
      ["Specify in CSPio", 3, 5],
    ],
  },
  {
    name: "O3 Enforcement",
    span: [2, 7],
    tasks: [
      ["Gatekeeper", 2, 6],
      ["Drop and refusal", 5, 7],
    ],
  },
  {
    name: "O4 Integration",
    span: [7, 10],
    tasks: [
      ["Claude Code", 7, 8],
      ["Codex", 9, 10],
    ],
  },
  {
    name: "O5 Evaluation",
    span: [6, 13],
    tasks: [
      ["Refinement checks", 6, 9],
      ["Evaluation", 10, 12],
      ["Final report", 11, 13],
    ],
  },
] as const;

const weeks = Array.from({ length: 13 }, (_, i) => i + 1);

// Grid column for week w: the first column holds the labels.
const col = (from: number, to: number) => `${from + 1} / ${to + 2}`;

export default function Plan() {
  let row = 2;
  return (
    <section className="slide plan">
      <p className="eyebrow">20 · Plan for next semester</p>
      <h2>Ground Complier in use cases, build the gatekeeper, integrate it, then verify and evaluate.</h2>

      <div className="gantt">
        <span className="label corner">Week</span>
        {weeks.map((w) => (
          <span key={w} className="week" style={{ gridColumn: w + 1, gridRow: 1 }}>
            {w}
          </span>
        ))}
        {groups.map((g) => {
          const head = row++;
          return [
            <span key={g.name} className="name group" style={{ gridRow: head }}>
              {g.name}
            </span>,
            <span key={`${g.name}-bar`} className="bar group" style={{ gridRow: head, gridColumn: col(g.span[0], g.span[1]) }} />,
            ...g.tasks.map(([t, from, to]) => {
              const r = row++;
              return [
                <span key={t} className="name" style={{ gridRow: r }}>
                  {t}
                </span>,
                <span key={`${t}-bar`} className="bar" style={{ gridRow: r, gridColumn: col(from, to) }} />,
              ];
            }),
          ];
        })}
        <span className="name submission" style={{ gridRow: row }}>
          Submission
        </span>
        <span className="diamond" style={{ gridRow: row, gridColumn: 14 }} />
      </div>
    </section>
  );
}
