const handling = [
  ["~ World event", "performed if allowed, else dropped"],
  ["^ Agent action", "performed if allowed, else refused"],
  ["Internal event", "performed as soon as enabled"],
];

const parts = [
  {
    name: "MCP proxy",
    text: "The only MCP server the agent can reach. Offers only the units' tools; forwards a call only if the runtime accepts its event. Holds the credentials.",
  },
  {
    name: "Claude Code hooks",
    text: "Tell the agent its role and available actions; stop it bypassing the proxy or editing its configuration; hold it until it may act.",
  },
];

export default function Runtime() {
  return (
    <section className="slide runtime">
      <p className="eyebrow">16 · Runtime and harness integration</p>
      <h2>A prototype runtime enforces specifications on agents running in Claude Code.</h2>

      <figure className="arch">
        <span className="box">
          Claude Code agent
          <small>with hooks</small>
        </span>
        <span className="arrow">tool call</span>
        <span className="box strong">MCP proxy</span>
        <span className="arrow">forward if accepted</span>
        <span className="box">
          Real MCP server
          <small>e.g. Notion</small>
        </span>
        <span className="vline" style={{ gridColumn: 3 }}>
          event
        </span>
        <span className="vline" style={{ gridColumn: 5 }}>
          poll via units
        </span>
        <span className="box daemon">
          Daemon
          <small>runs machines: one component per agent role, composed in parallel</small>
        </span>
      </figure>

      <div className="grid">
        <dl className="handling">
          <span className="label">Daemon</span>
          {handling.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Detects</dt>
            <dd>termination, deadlock, divergence, a failed poll</dd>
          </div>
        </dl>
        {parts.map((p) => (
          <div key={p.name} className="part">
            <span className="label">{p.name}</span>
            <p>{p.text}</p>
          </div>
        ))}
      </div>

      <dl className="strips">
        <div>
          <dt>Demo</dt>
          <dd>A writer drafts on a Notion page, waits for the world to delete a page, then recreates one.</dd>
        </div>
        <div>
          <dt>Caveat</dt>
          <dd>Correctness against the CSPio semantics is not yet proven.</dd>
        </div>
      </dl>
    </section>
  );
}
