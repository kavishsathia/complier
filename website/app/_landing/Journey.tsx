// Four attempts against the writer's contract, as the playground runs them: each call's event,
// whether it was allowed, and where the contract is afterwards. The refused one leaves it in place.

const STEPS = [
  { tool: "notion-update-page", event: "draft", ok: true, state: "DRAFTED" },
  { tool: "notion-move-pages", event: "publish", ok: false, state: "DRAFTED" },
  { tool: "notion-create-comment", event: "review", ok: true, state: "REVIEWED" },
  { tool: "notion-move-pages", event: "publish", ok: true, state: "WRITER" },
];

export default function Journey() {
  return (
    <ol className="journey">
      {STEPS.map((s, i) => (
        <li key={i} className={`j-step is-${s.ok ? "ok" : "bad"}`}>
          <span className="j-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="j-tool">{s.tool}</span>
          <span className="j-event">{s.event}</span>
          <span className="j-verdict">
            <span className="j-icon" aria-hidden="true">
              {s.ok ? "✓" : "✕"}
            </span>
            {s.ok ? "allowed" : "refused"}
          </span>
          <span className="j-state">
            <span className="sr-only">contract {s.ok ? "moves to" : "stays at"} </span>
            {s.state}
            {!s.ok && <span className="j-kept"> · unchanged</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
