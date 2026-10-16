export default function Runtime() {
  return (
    <section className="slide runtime">
      <p className="eyebrow">16 · Runtime and harness integration</p>
      <h2>A prototype runtime enforces specifications on agents running in Claude Code.</h2>

      <figure className="arch">
        <span className="box">
          Claude Code agent
          <small>hooks tell it what it may do</small>
        </span>
        <span className="arrow">tool call</span>
        <span className="box strong">
          MCP proxy
          <small>the only server it can reach</small>
        </span>
        <span className="arrow">if accepted</span>
        <span className="box">
          Real MCP server
          <small>e.g. email</small>
        </span>
        <span className="vline" style={{ gridColumn: 3 }}>
          event
        </span>
        <span className="vline" style={{ gridColumn: 5 }}>
          poll
        </span>
        <span className="box daemon">
          Daemon
          <small>performs allowed events; drops ~ and refuses ^ otherwise</small>
        </span>
      </figure>

      <p className="caveat">
        <span className="label">Caveat</span>
        Correctness against the CSPio semantics is not yet proven.
      </p>
    </section>
  );
}
