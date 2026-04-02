import Image from "next/image";

function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="animate-fade-in-up">
        <Image
          src="/logo-transparent.png"
          alt="complier logo"
          width={280}
          height={124}
          priority
          className="mx-auto mb-8 h-auto"
        />
      </div>

      <p className="animate-fade-in-up-delay-1 text-secondary text-base md:text-lg max-w-xl leading-relaxed">
        a compiled DSL that enforces workflow contracts
        <br />
        on tool-using AI agents — at runtime
      </p>

      <div className="animate-fade-in-up-delay-2 flex gap-3 mt-8">
        <a
          href="/docs"
          className="px-5 py-2.5 bg-accent text-[#0a0a0a] text-sm font-medium rounded hover:brightness-110 transition-all"
        >
          get started
        </a>
        <a
          href="https://github.com/kavishsathia/complier#features"
          className="px-5 py-2.5 border border-border text-secondary text-sm rounded hover:border-secondary hover:text-foreground transition-all"
        >
          documentation
        </a>
      </div>

      <div className="animate-fade-in-up-delay-3 mt-20 text-muted text-xs animate-pulse-slow hidden md:block">
        ↓
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="py-24 px-6 border-t border-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl md:text-2xl font-medium mb-4">the problem</h2>
        <p className="text-secondary text-base leading-relaxed max-w-2xl mb-12">
          AI agents with tool access can do anything — and that&apos;s the
          problem. A prompt says &quot;only search then summarize&quot;, but
          nothing enforces it. The agent can call any tool, in any order, at any
          time. You only find out it went wrong after the damage is done.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded border border-border bg-card p-5">
            <div className="text-muted text-sm mb-3 uppercase tracking-wider">
              what you wrote
            </div>
            <pre className="text-base leading-relaxed">
              <code>
                <span className="code-string">
                  &quot;Search the web for the topic,
                </span>
                {"\n"}
                <span className="code-string">
                  {" "}then summarize the results.
                </span>
                {"\n"}
                <span className="code-string">
                  {" "}Do NOT send any emails.&quot;
                </span>
              </code>
            </pre>
          </div>
          <div className="rounded border border-border bg-card p-5">
            <div className="text-muted text-sm mb-3 uppercase tracking-wider">
              what it did
            </div>
            <pre className="text-base leading-relaxed">
              <code>
                <span className="code-comment">
                  # searched web ✓
                </span>
                {"\n"}
                <span className="code-comment"># summarized ✓</span>
                {"\n"}
                <span className="text-red-400">
                  send_email(to=&quot;boss@work.com&quot;)
                </span>
                {"\n"}
                <span className="code-comment">
                  # ...oops
                </span>
              </code>
            </pre>
          </div>
        </div>

        <p className="text-muted text-sm mt-6 text-center">
          natural language directives are suggestions — not guarantees
        </p>
      </div>
    </section>
  );
}

function Solution() {
  return (
    <section className="py-24 px-6 bg-bg-secondary border-t border-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl md:text-2xl font-medium mb-4">the solution</h2>
        <p className="text-secondary text-base leading-relaxed max-w-2xl mb-14">
          Write a contract in complier&apos;s DSL. It compiles into a runtime
          graph that sits alongside your agent. Every tool call is checked
          against the graph — allowed calls pass through, disallowed calls are
          blocked with structured remediation.
        </p>

        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10 mb-16">
          {[
            { symbol: "◇", label: "define", sub: "write a .cpl contract" },
            { symbol: "▷", label: "compile", sub: "parse → AST → graph" },
            { symbol: "◈", label: "enforce", sub: "intercept every tool call" },
          ].map((step, i) => (
            <div key={step.label} className="flex items-center gap-6 md:gap-10">
              <div className="text-center">
                <div className="text-2xl mb-2 text-accent">{step.symbol}</div>
                <div className="text-base font-medium">{step.label}</div>
                <div className="text-sm text-muted mt-1">{step.sub}</div>
              </div>
              {i < 2 && (
                <div className="hidden md:block text-muted text-lg">→</div>
              )}
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              title: "runtime enforcement",
              desc: "blocks bad calls before they execute — not after",
            },
            {
              title: "framework agnostic",
              desc: "wraps your tools, doesn't replace your agent framework",
            },
            {
              title: "HATEOAS-inspired",
              desc: "the agent always knows what it can do next",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded border border-border bg-card p-5"
            >
              <div className="text-base font-medium mb-2">{card.title}</div>
              <div className="text-sm text-secondary leading-relaxed">
                {card.desc}
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
    <section className="py-24 px-6 border-t border-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl md:text-2xl font-medium mb-4">the language</h2>
        <p className="text-secondary text-base leading-relaxed max-w-2xl mb-10">
          A purpose-built DSL for defining agent workflows. Supports tool calls,
          branching, loops, parallel execution, contract checks, and reusable
          guarantees — all compiled into a directed runtime graph.
        </p>

        <div className="rounded border border-border bg-[#0c0c0c] p-6 overflow-x-auto">
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
              <span className="code-string">
                {" "}&quot;What topic?&quot;
              </span>
              {"\n"}
              {"    "}
              <span className="code-op">|</span>
              {" search_web\n"}
              {"    "}
              <span className="code-op">|</span>
              {" summarize "}
              <span className="code-param">
                style=([relevant] && [concise]):halt
              </span>
              {"\n"}
              {"    "}
              <span className="code-op">|</span>
              <span className="code-decorator"> @branch</span>
              {"\n"}
              {"        "}
              <span className="code-keyword">-when</span>
              <span className="code-string"> &quot;technical&quot;</span>
              {"\n"}
              {"            "}
              <span className="code-op">|</span>
              <span className="code-decorator"> @llm</span>
              <span className="code-string">
                {" "}&quot;Write detailed analysis&quot;
              </span>
              {"\n"}
              {"        "}
              <span className="code-keyword">-else</span>
              {"\n"}
              {"            "}
              <span className="code-op">|</span>
              <span className="code-decorator"> @llm</span>
              <span className="code-string">
                {" "}&quot;Write brief summary&quot;
              </span>
              {"\n"}
              {"    "}
              <span className="code-op">|</span>
              <span className="code-decorator"> @call</span>
              {" send_report"}
            </code>
          </pre>
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-4">
          <div className="rounded border border-border bg-card p-5">
            <div className="text-base font-medium mb-3">constructs</div>
            <div className="text-sm text-secondary leading-loose">
              <span className="code-decorator">@branch</span>{" "}
              <span className="code-decorator">@loop</span>{" "}
              <span className="code-decorator">@unordered</span>{" "}
              <span className="code-decorator">@fork</span>/
              <span className="code-decorator">@join</span>{" "}
              <span className="code-decorator">@call</span>{" "}
              <span className="code-decorator">@use</span>{" "}
              <span className="code-decorator">@inline</span>{" "}
              <span className="code-decorator">@llm</span>{" "}
              <span className="code-decorator">@human</span>
            </div>
          </div>
          <div className="rounded border border-border bg-card p-5">
            <div className="text-base font-medium mb-3">checks</div>
            <div className="text-sm text-secondary leading-loose">
              <span className="code-param">[model]</span>{" "}
              model-evaluated
              <br />
              <span className="code-string">{"{human}"}</span>{" "}
              human-approved
              <br />
              <span className="code-keyword">#{"{learned}"}</span>{" "}
              memory-backed
              <br />
              <span className="code-param">(expr):policy</span>{" "}
              expression-level policy
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="py-24 px-6 bg-bg-secondary border-t border-border">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl md:text-2xl font-medium mb-4">how it works</h2>
        <p className="text-secondary text-base leading-relaxed max-w-2xl mb-12">
          Wrap your existing tools. The session checks every call against the
          compiled graph and either lets it through or returns remediation info.
        </p>

        <div className="rounded border border-border bg-[#0c0c0c] p-6 overflow-x-auto">
          <pre>
            <code>
              <span className="code-keyword">from</span>
              {" complier "}
              <span className="code-keyword">import</span>
              {" Contract, wrap_function\n\n"}
              <span className="code-comment">
                # compile the contract
              </span>
              {"\n"}
              {"contract = Contract.from_file("}
              <span className="code-string">&quot;workflow.cpl&quot;</span>
              {")\n"}
              {"session = contract.create_session()\n\n"}
              <span className="code-comment">
                # wrap your tools — enforcement is transparent
              </span>
              {"\n"}
              {"safe_search = wrap_function(session, search_web)\n"}
              {"safe_summarize = wrap_function(session, summarize)\n\n"}
              <span className="code-comment">
                # if the agent calls a tool out of order:
              </span>
              {"\n"}
              <span className="code-comment">
                # → BlockedToolResponse with remediation info
              </span>
              {"\n"}
              <span className="code-comment">
                # if the call is allowed:
              </span>
              {"\n"}
              <span className="code-comment">
                # → executes normally, session advances
              </span>
            </code>
          </pre>
        </div>

        <div className="mt-10 flex flex-col gap-0">
          {[
            {
              step: "01",
              title: "agent calls wrapped tool",
              desc: "your agent framework calls search_web() as usual",
            },
            {
              step: "02",
              title: "session checks the graph",
              desc: "is this tool allowed at this point in the workflow?",
            },
            {
              step: "03",
              title: "guards are evaluated",
              desc: "model checks, human checks, learned checks — all run",
            },
            {
              step: "04",
              title: "allow or block",
              desc: "allowed → tool executes. blocked → remediation info returned to the agent",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex gap-5 py-4 border-b border-border last:border-0"
            >
              <div className="text-accent text-sm font-medium mt-0.5 shrink-0">
                {item.step}
              </div>
              <div>
                <div className="text-base font-medium">{item.title}</div>
                <div className="text-sm text-secondary mt-1">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-10 px-6 border-t border-border text-center">
      <div className="text-sm text-muted">
        <a
          href="https://github.com/kavishsathia/complier"
          className="hover:text-secondary transition-colors"
        >
          github
        </a>
        <span className="mx-2">·</span>
        <a
          href="https://pypi.org/project/complier/"
          className="hover:text-secondary transition-colors"
        >
          pypi
        </a>
        <span className="mx-2">·</span>
        <span>MIT — Kavish Sathia, 2026</span>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main>
      <Hero />
      <Problem />
      <Solution />
      <Syntax />
      <HowItWorks />
      <Footer />
    </main>
  );
}
