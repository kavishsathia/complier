// How a call travels, and how rules get loaded before any call does. Drawn with HTML so it
// reflows to one column on a phone; the ordered list underneath is the same diagram as text.

type NodeProps = { area: string; title: string; kind?: string; demo?: boolean; tone?: "agent" | "check" | "service" | "file"; children: React.ReactNode };

function Node({ area, title, kind, demo, tone = "check", children }: NodeProps) {
  return (
    <div className={`d-node is-${tone}${demo ? " is-demo" : ""}`} style={{ gridArea: area }}>
      {kind && <span className="d-kind">{kind}</span>}
      <strong className="d-title">{title}</strong>
      <span className="d-body">{children}</span>
      {demo && <span className="d-demo">In the demo</span>}
    </div>
  );
}

function Arrow({ area, label, dir = "right", tone }: { area: string; label: string; dir?: "right" | "down" | "left"; tone?: "ok" | "bad" }) {
  return (
    <div className={`d-arrow is-${dir}${tone ? ` is-${tone}` : ""}`} style={{ gridArea: area }}>
      <span className="d-line" />
      <span className="d-label">{label}</span>
    </div>
  );
}

export default function Diagram() {
  return (
    <figure className="diagram" aria-labelledby="diagram-caption">
      <div className="d-grid" aria-hidden="true">
        <span className="d-lane d-lane-load" style={{ gridArea: "lane1" }}>
          Before the agent starts
        </span>
        <Node area="unit" title="Translation unit" kind="YAML + CEL" tone="file" demo>
          Rules proven by Google&apos;s CEL verifier: no call matches two rules, and with the fallback every call matches one.
          Unproven units are refused.
        </Node>
        <Node area="spec" title="Contract" kind="CSP" tone="file" demo>
          Which events may happen, in what order, for each role.
        </Node>
        <Arrow area="down1" dir="down" label="loaded when proven" />
        <Arrow area="down2" dir="down" label="machine up" />

        <span className="d-lane d-lane-run" style={{ gridArea: "lane2" }}>
          On every call
        </span>
        <Node area="agent" title="Agent" kind="Claude Code + plugin" tone="agent">
          Sees only the tools the units name.
        </Node>
        <Arrow area="a1" label="tool call" />
        <Node area="proxy" title="Translate" kind="complier proxy" demo>
          CEL evaluates the rules on the call&apos;s arguments: one match gives its event, none the fallback&apos;s.
        </Node>
        <Arrow area="a2" label="event" />
        <Node area="daemon" title="Check the contract" kind="complier daemon" demo>
          Allowed in the current state? Then the state moves on.
        </Node>
        <Arrow area="a3" label="allowed" tone="ok" />
        <Node area="svc" title="Service" kind="Notion MCP" tone="service">
          Its result goes back to the agent. Credentials stay in the proxy.
        </Node>
        <Arrow area="back" dir="left" tone="bad" label="refused: the reason goes back to the agent, nothing reaches the service" />
      </div>
      <figcaption id="diagram-caption" className="d-caption">
        Ambiguous calls, calls outside the unit&apos;s domain and events the contract doesn&apos;t allow now are all refused before
        anything is sent upstream. Read-only tools a unit lists as hidden pass straight through. The dashed parts are what the demo
        runs in your browser: the same cel-java the CLI uses, and the stepper&apos;s CSP engine standing in for the daemon.
      </figcaption>
      <ol className="sr-only">
        <li>Before the agent starts: the translation unit (YAML with CEL rules) is proven by the CEL verifier and loaded into the proxy; the CSP contract is loaded into the daemon with machine up.</li>
        <li>The agent, Claude Code with the complier plugin, makes a tool call to the complier proxy.</li>
        <li>The proxy translates the call into an event with CEL.</li>
        <li>The daemon checks the event against the contract&apos;s current state.</li>
        <li>If allowed, the call is forwarded to the service, such as Notion&apos;s MCP server.</li>
        <li>If refused, the reason goes back to the agent and nothing reaches the service.</li>
      </ol>
    </figure>
  );
}
