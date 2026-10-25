const kinds = [
  {
    name: "Inputs",
    mark: "~",
    how: "Poll a side-effect-free tool; diff successive results into world events",
    eg: ["list_inbox", "email_received per new message"],
  },
  {
    name: "Outputs",
    mark: "^",
    how: "Map each tool call to an event, possibly by its arguments; an unmapped call is refused, so translation fails closed",
    eg: ["send_email", "send_external if a recipient is outside the org, else send_internal"],
  },
  {
    name: "Hidden",
    mark: "",
    how: "Tools with no effect on the modelled world pass through unchecked",
    eg: ["search_email, read_email", "no event"],
  },
];

export default function Units() {
  return (
    <section className="slide units">
      <p className="eyebrow">14 · Translation units</p>
      <h2>A translation unit maps a service&apos;s concrete tools onto the abstract events of a specification.</h2>

      <div className="bridge">
        <span className="box">
          Service tools
          <small>e.g. an MCP server</small>
        </span>
        <span className="arrow both" />
        <span className="box strong">
          Translation unit
          <small>TypeScript</small>
        </span>
        <span className="arrow both" />
        <span className="box">
          Specification alphabet
          <small>~ and ^ events</small>
        </span>
      </div>

      <div className="kinds">
        {kinds.map((k) => (
          <div key={k.name} className="kind">
            <span className="label">
              {k.name} {k.mark && <span className="mark">{k.mark}</span>}
            </span>
            <p>{k.how}</p>
            <div className="eg">
              <code>{k.eg[0]}</code>
              <span>→ {k.eg[1]}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
