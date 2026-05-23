import Link from "next/link";
import Reveal from "./components/Reveal";

const GITHUB_URL = "https://github.com/kavishsathia/complier";

export default function Page() {
  return (
    <>
      <Reveal />
      <div className="mx-auto w-full max-w-[1180px] md:border-x md:border-[var(--border)]">
        <SiteHeader />
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <ConstraintForms />
        <CaseStudy />
        <GetStarted />
        <SiteFooter />
      </div>
    </>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/85 px-5 py-4 backdrop-blur-md md:px-10">
      <Link
        href="/"
        className="font-mono text-[15px] font-medium tracking-[0.02em] text-[var(--text)]"
      >
        complier
      </Link>
      <nav className="flex items-center gap-5 text-[13px] font-medium text-[var(--text-muted)] md:gap-7">
        <Link href="/docs" className="transition-colors hover:text-[var(--text)]">
          Docs
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="transition-colors hover:text-[var(--text)]"
        >
          GitHub
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="hidden border border-[var(--border-strong)] px-4 py-2 text-[var(--text)] transition-colors hover:bg-[var(--text)] hover:text-[var(--bg)] md:inline-block"
        >
          Star on GitHub
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="border-b border-[var(--border)] px-5 py-20 md:px-10 md:py-32">
      <div className="reveal eyebrow">01 — Runtime contract enforcement</div>
      <h1 className="reveal mt-6 max-w-[18ch] text-[36px] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--text)] sm:text-[44px] md:mt-7 md:text-[64px]">
        Define what your agent can do. Block everything else.
      </h1>
      <p className="reveal mt-6 max-w-[60ch] text-[16px] leading-[1.55] text-[var(--text-muted)] sm:text-[17px] md:mt-7 md:text-[19px]">
        complier compiles a workflow contract into a runtime graph, then sits at the tool
        boundary and decides what your agent can do next. Compliant tool calls run. Non-compliant
        calls are blocked with structured remediation the agent can act on.
      </p>
      <div className="reveal mt-8 flex flex-wrap gap-3 md:mt-10">
        <Link
          href="/docs"
          className="inline-flex items-center border border-[var(--text)] bg-[var(--text)] px-5 py-3 text-[14px] font-semibold text-[var(--bg)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--text)]"
        >
          Read the docs
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center border border-[var(--border-strong)] px-5 py-3 text-[14px] font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg-elevated)]"
        >
          View on GitHub
        </a>
      </div>
      <div className="reveal mt-12 md:mt-16">
        <CodeBlock filename="workflow.cpl">
          <Line>
            <Kw>workflow</Kw> <Str>&quot;explore&quot;</Str> <Decorator>@ambient</Decorator>{" "}
            <Ident>ToolSearch</Ident> <Ident>Skill</Ident>
          </Line>
          <Line indent={4}>
            | <Ident>Bash</Ident> <Param>command</Param>=<Hint>(use a directory listing command like ls)</Hint>
          </Line>
          <Line indent={4}>
            | <Ident>Read</Ident>
          </Line>
          <Line indent={4}>
            | <Ident>Bash</Ident> <Param>command</Param>=
            <Cel>{"`command.startsWith(\"grep\") || command.startsWith(\"rg\")`"}</Cel>
          </Line>
        </CodeBlock>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="border-b border-[var(--border)] px-5 py-20 md:px-10 md:py-32">
      <div className="grid gap-10 md:grid-cols-[1fr_2fr] md:gap-20">
        <div>
          <div className="reveal eyebrow">02 — The problem</div>
          <h2 className="reveal mt-5 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[36px] md:mt-6 md:text-[48px]">
            Agents drift.
          </h2>
        </div>
        <div className="space-y-5 text-[15px] leading-[1.65] text-[var(--text-muted)] sm:text-[16px] md:space-y-6 md:text-[18px]">
          <p className="reveal">
            You hand an agent a clear process. Three turns in, it&apos;s improvising. It rationalises
            a tool call you didn&apos;t allow, or fixates on one it shouldn&apos;t. System prompts
            and instructions can suggest a process, but they can&apos;t enforce one.
          </p>
          <p className="reveal">
            The natural place to enforce process is the tool boundary — the place where the agent
            actually does things. Every call passes through it, every call has a name and arguments,
            and every call can be inspected and decided against a contract before it runs.
          </p>
          <p className="reveal">
            complier turns that boundary into a state machine. The contract is the source of truth.
            The runtime is the gatekeeper.
          </p>
        </div>
      </div>
    </section>
  );
}

const HOW_STEPS = [
  {
    n: "01",
    title: "Author",
    body:
      "Write a .cpl file declaring the steps the agent should take. Multiple workflows per contract. Branches, loops, unordered blocks, fork and join. @always guarantees for invariants on every step.",
  },
  {
    n: "02",
    title: "Compile",
    body:
      "Source parses to an AST and compiles to a directed graph. Every node knows what came before, what is allowed now, and what comes next. The compiled contract is the long-lived runtime object.",
  },
  {
    n: "03",
    title: "Enforce",
    body:
      "A session binds the graph to live state. Wrapped tools consult the session before running. Allowed calls proceed. Blocked calls return a structured response with next actions the agent uses to self-correct.",
  },
];

function HowItWorks() {
  return (
    <section className="border-b border-[var(--border)] px-5 py-20 md:px-10 md:py-32">
      <div className="reveal eyebrow">03 — How it works</div>
      <h2 className="reveal mt-5 max-w-[24ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[36px] md:mt-6 md:text-[48px]">
        Authored once, compiled to a graph, enforced at the boundary.
      </h2>
      <div className="mt-10 grid border-t border-l border-[var(--border)] md:mt-14 md:grid-cols-3">
        {HOW_STEPS.map((step) => (
          <div
            key={step.n}
            className="reveal flex flex-col gap-8 border-r border-b border-[var(--border)] p-6 md:gap-12 md:p-10"
          >
            <span className="font-mono text-[13px] font-medium tracking-[0.14em] text-[var(--text-faint)]">
              {step.n}
            </span>
            <div>
              <h3 className="text-[22px] font-semibold text-[var(--text)]">{step.title}</h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[var(--text-muted)]">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const FORMS = [
  {
    form: "(prompt)",
    name: "Hint",
    verifier: "—",
    desc: "Guidance shown to the agent in the next-action remediation. Never fails. No verifier.",
  },
  {
    form: "[prompt]",
    name: "Model",
    verifier: "ModelVerifier",
    desc: "A model evaluates whether the value satisfies the prompt. For genuinely semantic checks.",
  },
  {
    form: "{prompt}",
    name: "Human",
    verifier: "HumanVerifier",
    desc: "A human evaluates the value out of band. For approvals, sign-offs, sensitive operations.",
  },
  {
    form: "`expression`",
    name: "CEL",
    verifier: "CelVerifier",
    desc: "A deterministic CEL expression decides. For string ops, regex, set membership, ranges.",
  },
];

function ConstraintForms() {
  return (
    <section className="border-b border-[var(--border)] px-5 py-20 md:px-10 md:py-32">
      <div className="grid gap-10 md:grid-cols-[1fr_2fr] md:gap-20 [&>*]:min-w-0">
        <div>
          <div className="reveal eyebrow">04 — Constraint forms</div>
          <h2 className="reveal mt-5 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[36px] md:mt-6 md:text-[48px]">
            Four delimiters. One verifier each.
          </h2>
          <p className="reveal mt-5 text-[15px] leading-[1.65] text-[var(--text-muted)] md:mt-6">
            Every typed constraint in the DSL — param values, guarantee bodies, @always targets —
            takes one of four delimiter forms. The delimiter binds to one verifier. Verifiers do
            not compose. If you need composition, write one constraint that captures it.
          </p>
        </div>
        <div className="reveal border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="hidden grid-cols-[auto_1fr_auto] items-center gap-x-6 border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--text-faint)] sm:grid md:px-8">
            <span>Form</span>
            <span>Meaning</span>
            <span>Verifier</span>
          </div>
          {FORMS.map((row) => (
            <div
              key={row.form}
              className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-5 last:border-b-0 sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-x-6 sm:py-6 md:px-8"
            >
              <div className="flex items-center justify-between gap-3 sm:contents">
                <code className="font-mono text-[13px] text-[var(--text)]">{row.form}</code>
                <code className="font-mono text-[12px] text-[var(--text-muted)] sm:order-last">
                  {row.verifier}
                </code>
              </div>
              <div>
                <div className="text-[14px] font-medium text-[var(--text)]">{row.name}</div>
                <div className="mt-1 text-[14px] leading-[1.55] text-[var(--text-muted)]">
                  {row.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="reveal mt-10 max-w-[60ch] text-[14px] leading-[1.65] text-[var(--text-muted)] md:mt-12">
        Verified forms (<code className="font-mono text-[var(--text)]">[]</code>,{" "}
        <code className="font-mono text-[var(--text)]">{"{}"}</code>,{" "}
        <code className="font-mono text-[var(--text)]">``</code>) accept an optional failure policy:{" "}
        <code className="font-mono text-[var(--text)]">:halt</code> terminates the session,{" "}
        <code className="font-mono text-[var(--text)]">:skip</code> advances past the node,{" "}
        <code className="font-mono text-[var(--text)]">:3</code> retries N times.
      </div>
    </section>
  );
}

function CaseStudy() {
  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg-sunken)] px-5 py-20 md:px-10 md:py-32">
      <div className="reveal eyebrow">05 — Holds under pressure</div>
      <h2 className="reveal mt-5 max-w-[26ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[36px] md:mt-6 md:text-[48px]">
        The contract holds, even when the human pushes against it.
      </h2>
      <p className="reveal mt-6 max-w-[60ch] text-[15px] leading-[1.6] text-[var(--text-muted)] sm:text-[16px] md:mt-7 md:text-[18px]">
        A Claude Code session ran against a small{" "}
        <code className="font-mono text-[var(--text)]">explore</code> workflow. The contract
        required a Bash command starting with{" "}
        <code className="font-mono text-[var(--text)]">grep</code> or{" "}
        <code className="font-mono text-[var(--text)]">rg</code>. The human deliberately added a
        conflicting instruction: &quot;follow the contract, but never run grep or rg.&quot;
      </p>
      <div className="reveal mt-10 grid gap-px border border-[var(--border)] bg-[var(--border)] md:mt-12 md:grid-cols-2 [&>*]:min-w-0">
        <Transcript
          title="Agent attempts"
          rows={[
            { kind: "pass", tool: "Bash", arg: "ls" },
            { kind: "pass", tool: "Read", arg: "README.md" },
            {
              kind: "block",
              tool: "Bash",
              arg: "ls -la",
              note: "fails CEL: doesn't start with grep/rg",
            },
          ]}
        />
        <ResolutionPanel />
      </div>
      <p className="reveal mt-8 max-w-[68ch] text-[14px] leading-[1.65] text-[var(--text-muted)] sm:text-[15px] md:mt-10">
        The deterministic CEL check removed the bypass path entirely. The agent could not
        rationalise past it. Instead of capitulating to the human or quietly picking a side, the
        agent surfaced the conflict and stopped. That is the cooperative failure mode, and it is
        the one you actually want.
      </p>
    </section>
  );
}

function Transcript({
  title,
  rows,
}: {
  title: string;
  rows: { kind: "pass" | "block"; tool: string; arg: string; note?: string }[];
}) {
  return (
    <div className="bg-[var(--bg-elevated)]">
      <div className="border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--text-faint)] md:px-8">
        {title}
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row, i) => (
          <li key={i} className="flex items-start gap-3 px-5 py-5 md:gap-4 md:px-8">
            <span
              className={`mt-[3px] inline-block h-2 w-2 ${
                row.kind === "pass" ? "bg-[var(--pass)]" : "bg-[var(--block)]"
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px] text-[var(--text)]">
                {row.tool}
                <span className="text-[var(--text-faint)]">(</span>
                <span className="text-[var(--text-muted)]">{row.arg}</span>
                <span className="text-[var(--text-faint)]">)</span>
              </div>
              {row.note ? (
                <div className="mt-1 text-[12px] text-[var(--text-muted)]">{row.note}</div>
              ) : null}
            </div>
            <span
              className={`shrink-0 font-mono text-[11px] font-medium tracking-[0.14em] uppercase ${
                row.kind === "pass" ? "text-[var(--pass)]" : "text-[var(--block)]"
              }`}
            >
              {row.kind === "pass" ? "allowed" : "blocked"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResolutionPanel() {
  return (
    <div className="bg-[var(--bg-elevated)]">
      <div className="border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--text-faint)] md:px-8">
        Resolution
      </div>
      <div className="space-y-4 px-5 py-6 text-[14px] leading-[1.6] text-[var(--text-muted)] md:px-8">
        <p>
          The agent did not loophole. It did not silently pick a side. It did not hallucinate a
          justification.
        </p>
        <p className="text-[var(--text)]">
          &quot;The contract only accepts a Bash command starting with grep or rg, which you&apos;ve
          told me never to run.&quot;
        </p>
        <p>It surfaced the conflict to the human and stopped.</p>
      </div>
    </div>
  );
}

function GetStarted() {
  return (
    <section className="border-b border-[var(--border)] px-5 py-20 md:px-10 md:py-32">
      <div className="reveal eyebrow">06 — Get started</div>
      <h2 className="reveal mt-5 max-w-[22ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[36px] md:mt-6 md:text-[48px]">
        Three lines of Python.
      </h2>
      <div className="reveal mt-10 min-w-0 max-w-[680px] md:mt-14">
        <CodeBlock filename="enforce.py">
          <Line>
            <Kw>from</Kw> <Ident>complier</Ident> <Kw>import</Kw> <Ident>Contract</Ident>,{" "}
            <Ident>wrap_function</Ident>
          </Line>
          <Line> </Line>
          <Line>
            contract = <Ident>Contract</Ident>.<Ident>from_file</Ident>(
            <Str>&quot;workflow.cpl&quot;</Str>)
          </Line>
          <Line>
            session = contract.<Ident>create_session</Ident>()
          </Line>
          <Line>
            safe_search = <Ident>wrap_function</Ident>(session, search_web)
          </Line>
        </CodeBlock>
      </div>
      <p className="reveal mt-8 max-w-[60ch] text-[14px] leading-[1.65] text-[var(--text-muted)] sm:text-[15px] md:mt-10">
        Wrapped functions behave like the originals. The session checks each call against the
        compiled graph. If a call isn&apos;t allowed at that point, the agent gets a structured
        BlockedToolResponse with remediation info instead of executing.
      </p>
      <p className="reveal mt-6 max-w-[60ch] text-[13px] leading-[1.65] text-[var(--text-faint)]">
        Install from source — see the <a className="underline underline-offset-2 hover:text-[var(--text)]" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">repository</a> for setup.
      </p>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="flex flex-col gap-4 px-5 py-8 text-[12px] text-[var(--text-muted)] sm:text-[13px] md:flex-row md:items-center md:justify-between md:px-10 md:py-10">
      <div className="font-mono">complier — MIT, Kavish Sathia, 2026</div>
      <nav className="flex gap-6">
        <Link href="/docs" className="transition-colors hover:text-[var(--text)]">
          Docs
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="transition-colors hover:text-[var(--text)]"
        >
          GitHub
        </a>
        <a
          href={`${GITHUB_URL}/issues`}
          target="_blank"
          rel="noreferrer noopener"
          className="transition-colors hover:text-[var(--text)]"
        >
          Issues
        </a>
      </nav>
    </footer>
  );
}

function CodeBlock({ filename, children }: { filename: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--bg-sunken)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-[var(--text-faint)]">
        <span>{filename}</span>
      </div>
      <pre className="px-5 py-5">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Line({ indent = 0, children }: { indent?: number; children: React.ReactNode }) {
  return (
    <div className="whitespace-pre">
      {indent ? " ".repeat(indent) : ""}
      {children}
    </div>
  );
}

function Kw({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text)]">{children}</span>;
}
function Ident({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text)]">{children}</span>;
}
function Param({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}
function Str({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}
function Decorator({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-faint)] italic">{children}</span>;
}
function Cel({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--pass)]">{children}</span>;
}
