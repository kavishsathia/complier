import Image from "next/image";

const navItems = ["Product", "Runtime", "Syntax", "Docs"];

const featureCards = [
  {
    title: "Contracts",
    eyebrow: "Authored process",
    body: "Declare the tool sequence, checks, branches, loops, and guarantees your agent is expected to follow.",
  },
  {
    title: "Sessions",
    eyebrow: "Live state",
    body: "Bind one execution to a compiled contract and track the current workflow position as tool calls happen.",
  },
  {
    title: "Wrappers",
    eyebrow: "Tool boundary",
    body: "Wrap Python callables or MCP tools so enforcement happens where actions actually execute.",
  },
  {
    title: "Remediation",
    eyebrow: "Agent feedback",
    body: "Blocked calls return structured guidance with the next allowed actions, not a generic failure.",
  },
];

const runtimeRows = [
  ["01", "parse", "authored .cpl becomes a validated contract model"],
  ["02", "compile", "workflows become deterministic runtime graphs"],
  ["03", "attach", "a session tracks one live agent execution"],
  ["04", "enforce", "wrapped tools consult the session before running"],
];

function Header() {
  return (
    <header className="site-header">
      <a href="#top" className="brand" aria-label="complier homepage">
        <Image
          src="/logo-transparent.png"
          alt="complier"
          width={158}
          height={70}
          priority
          className="brand-mark"
        />
      </a>
      <nav className="nav-links" aria-label="Primary navigation">
        {navItems.map((item) => (
          <a key={item} href={item === "Docs" ? "/docs" : `#${item.toLowerCase()}`}>
            {item}
          </a>
        ))}
      </nav>
      <a href="/docs" className="header-cta">
        Read Docs
      </a>
    </header>
  );
}

function DotField() {
  return (
    <div className="dot-field" aria-hidden="true">
      <span className="dot-cluster cluster-a" />
      <span className="dot-cluster cluster-b" />
      <span className="dot-cluster cluster-c" />
      <span className="dot-cluster cluster-d" />
      <span className="dot-cluster cluster-e" />
      <span className="dot-cluster cluster-f" />
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="hero-shell">
      <DotField />
      <div className="hero-copy">
        <p className="hero-kicker">Contract enforcement for tool-using AI agents.</p>
        <h1>
          Agents drift from process.
          <br />
          Complier blocks the drift.
        </h1>
        <p className="hero-subhead">
          Define the workflow your agent is supposed to follow. Complier
          compiles it into a runtime contract and enforces every tool call at
          the boundary.
        </p>
        <div className="hero-actions">
          <a href="/docs" className="button button-primary">
            Get Started
          </a>
          <a
            href="https://github.com/kavishsathia/complier"
            className="button button-secondary"
          >
            GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Product() {
  return (
    <section id="product" className="section section-grid">
      <div className="section-heading">
        <p className="eyebrow">Product</p>
        <h2>Govern what agents do, not just what they say.</h2>
      </div>
      <div className="copy-block">
        <p>
          Prompts can ask an agent to follow a process. Complier makes the
          process executable. It sits beside your existing framework, watches
          wrapped tools, and decides whether each attempted call complies with
          the active contract.
        </p>
      </div>
      <div className="feature-grid">
        {featureCards.map((card) => (
          <article key={card.title} className="feature-card">
            <p>{card.eyebrow}</p>
            <h3>{card.title}</h3>
            <span>{card.body}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function Runtime() {
  return (
    <section id="runtime" className="section runtime-section">
      <div className="section-heading compact">
        <p className="eyebrow">Runtime</p>
        <h2>A contract-aware boundary around your tools.</h2>
      </div>
      <div className="runtime-panel">
        <div className="runtime-diagram" aria-label="Runtime enforcement diagram">
          <div className="flow-row">
            <div className="diagram-node">
              <small>agent</small>
              <strong>attempts tool call</strong>
              <span>send_email(to=&quot;team&quot;)</span>
            </div>
            <div className="flow-line">
              <span>wrapped tool</span>
            </div>
            <div className="diagram-node diagram-node-primary">
              <small>session</small>
              <strong>checks contract</strong>
              <span>is this action allowed now?</span>
            </div>
          </div>
          <div className="decision-split">
            <span />
          </div>
          <div className="decision-grid">
            <div className="decision allowed">
              <small>allowed path</small>
              <strong>tool executes</strong>
              <span>session advances to next step</span>
            </div>
            <div className="decision blocked">
              <small>blocked path</small>
              <strong>call is stopped</strong>
              <span>remediation lists allowed actions</span>
            </div>
          </div>
        </div>
        <div className="runtime-list">
          {runtimeRows.map(([step, title, body]) => (
            <div key={step} className="runtime-row">
              <span>{step}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Syntax() {
  return (
    <section id="syntax" className="section syntax-section">
      <div className="section-heading">
        <p className="eyebrow">Syntax</p>
        <h2>Small authored specs. Concrete runtime behavior.</h2>
      </div>
      <div className="code-window">
        <div className="code-titlebar">
          <span>contract_demo.cpl</span>
          <span>compiled enforcement</span>
        </div>
        <pre>
          <code>
            <span className="code-keyword">guarantee</span>
            {" safe "}
            <span className="code-param">[no_harmful_content]:halt</span>
            {"\n\n"}
            <span className="code-keyword">workflow</span>
            <span className="code-string"> &quot;research&quot;</span>
            <span className="code-decorator"> @always</span>
            {" safe\n"}
            {"    "}
            <span className="code-op">|</span>
            <span className="code-decorator"> @human</span>
            <span className="code-string"> &quot;What topic?&quot;</span>
            {"\n"}
            {"    "}
            <span className="code-op">|</span>
            {" search_web\n"}
            {"    "}
            <span className="code-op">|</span>
            <span className="code-decorator"> @llm</span>
            <span className="code-string"> &quot;Summarize&quot;</span>
            {" "}
            <span className="code-param">([relevant]:3 && [concise]:halt)</span>
            {"\n"}
            {"    "}
            <span className="code-op">|</span>
            {" send_report "}
            <span className="code-param">audience=&quot;team&quot;</span>
          </code>
        </pre>
      </div>
    </section>
  );
}

function Enforcement() {
  return (
    <section className="section enforcement-section">
      <div className="section-heading compact">
        <p className="eyebrow">Tool Calls</p>
        <h2>Allowed calls advance. Non-compliant calls stop.</h2>
      </div>
      <div className="terminal-grid">
        <div className="terminal-card">
          <p>compliant call</p>
          <pre>
            <code>
              <span className="code-comment">agent attempts</span>
              {"\n"}
              {"search_web(topic="}
              <span className="code-string">&quot;rbac&quot;</span>
              {")\n\n"}
              <span className="status-pass">ALLOW</span>
              {" session advances\n"}
              <span className="code-comment">next allowed: summarize</span>
            </code>
          </pre>
        </div>
        <div className="terminal-card">
          <p>blocked call</p>
          <pre>
            <code>
              <span className="code-comment">agent attempts</span>
              {"\n"}
              {"send_email(to="}
              <span className="code-string">&quot;team&quot;</span>
              {")\n\n"}
              <span className="status-block">BLOCK</span>
              {" not allowed now\n"}
              <span className="code-comment">remediation: call summarize first</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <span>complier</span>
      <nav aria-label="Footer navigation">
        <a href="/docs">Documentation</a>
        <a href="https://github.com/kavishsathia/complier">GitHub</a>
        <a href="https://pypi.org/project/complier/">PyPI</a>
      </nav>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="page-frame">
      <Header />
      <Hero />
      <Product />
      <Runtime />
      <Syntax />
      <Enforcement />
      <Footer />
    </main>
  );
}
