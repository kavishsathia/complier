import Link from "next/link";

const GITHUB_URL = "https://github.com/kavishsathia/complier";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-20 md:px-0">
      <SiteHeader />
      <TitleBlock />
      <Abstract />
      <main>
        <SectionEncoding />
        <SectionEnforcement />
        <SectionFpga />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] py-4 text-[15px]">
      <Link href="/" className="italic">
        complier
      </Link>
      <nav className="flex gap-6">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="paper-link">
          GitHub
        </a>
      </nav>
    </header>
  );
}

function TitleBlock() {
  return (
    <div className="pt-16 text-center md:pt-24">
      <h1 className="mx-auto max-w-[26ch] text-[28px] leading-[1.25] font-bold sm:text-[32px]">
        Complier: A Language for Encoding and Enforcing Agentic Workflows
      </h1>
      <div className="mt-6 text-[17px]">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="paper-link"
        >
          Kavish Sathia
        </a>
      </div>
      <div className="mt-1 text-[16px] text-[var(--text-muted)]">July 2026</div>
    </div>
  );
}

function Abstract() {
  return (
    <section className="mx-auto mt-12 max-w-[58ch] md:mt-16">
      <h2 className="text-center text-[18px] font-bold">Abstract</h2>
      <p className="paper-prose mt-4 text-[16px] leading-[1.5]">
        The current methods for prompting AI agents are largely unstructured and unenforceable.
        Today, these concerns live in two disconnected places: natural-language system prompts
        express what the agent <em>should</em> do, while workflow-agnostic guardrails block what
        it should <em>not</em>. However, the guardrails do not know the workflow, and the prompts
        cannot enforce the workflow themselves. This project proposes a single representation
        that unifies both.
      </p>
    </section>
  );
}

function SectionEncoding() {
  return (
    <section className="mt-14 md:mt-20">
      <h2 className="text-[22px] font-bold">1&ensp;Encoding workflows</h2>
      <div className="mt-5 grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
        <div className="paper-prose space-y-4 text-[17px]">
          <p>
            A workflow is written once, in a small declarative language, as a{" "}
            <code>.cpl</code> contract: the steps the agent should take, the tools each step may
            use, and the constraints their arguments must satisfy. The contract compiles to a
            runtime graph in which every node knows what came before it, what is permitted now,
            and what comes next.
          </p>
        </div>
        <figure>
          <Listing filename="workflow.cpl">
            <Line>
              workflow <Str>&quot;explore&quot;</Str>
            </Line>
            <Line indent={4}>| Bash <Dim>command=</Dim><Hint>(list the directory)</Hint></Line>
            <Line indent={4}>| Read</Line>
            <Line indent={4}>
              | Bash <Dim>command=</Dim>
            </Line>
            <Line indent={8}>
              <Cel>{"`command.startsWith(\"grep\")`"}</Cel>
            </Line>
          </Listing>
          <figcaption className="paper-caption mt-3 text-[var(--text-muted)]">
            Figure 1: A contract declaring an <code>explore</code> workflow. Calls that do not
            match the current step are blocked and remediated.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function SectionEnforcement() {
  return (
    <section className="mt-14 md:mt-20">
      <h2 className="text-[22px] font-bold">2&ensp;Enforcement at the tool boundary</h2>
      <div className="paper-prose mt-5 space-y-4 text-[17px]">
        <p>
          At runtime, complier sits between the agent and its tools as enforcing middleware.
          Every tool call is checked against the compiled graph before it executes: compliant
          calls pass through untouched, while non-compliant calls are blocked and answered with
          a structured remediation, stating what was violated and what is permitted next, that
          the agent uses to steer itself back onto the workflow. The same artifact that describes
          the process is the one that enforces it.
        </p>
      </div>
    </section>
  );
}

function SectionFpga() {
  return (
    <section className="mt-14 md:mt-20">
      <h2 className="text-[22px] font-bold">3&ensp;An analogy to FPGAs</h2>
      <div className="paper-prose mt-5 space-y-4 text-[17px]">
        <p>
          A growing practice, sometimes called <em>loop engineering</em>, is concerned with
          governing how agents behave over long autonomous horizons. Practitioners today have
          two options: steer a general-purpose harness with natural-language prompts, which
          cannot be enforced, or build a bespoke harness, which means rebuilding tooling,
          context management, and the agent loop from scratch.
        </p>
        <p>
          Hardware faced the same trade-off between general-purpose processors and custom
          silicon, and resolved it with the FPGA: generic fabric that ships with everything
          expensive already built, onto which engineers program their own circuitry. complier
          proposes the same resolution for agents. A powerful existing harness such as Claude
          Code is the fabric, and the contract is the bitstream. Instead of building a harness
          to obtain enforceable behavior, you program the one you already have.
        </p>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--border)] pt-5 text-center text-[14px] text-[var(--text-muted)] md:mt-28">
      complier is released under the MIT license.{" "}
      <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="paper-link">
        Source
      </a>
    </footer>
  );
}

function Listing({ filename, children }: { filename: string; children: React.ReactNode }) {
  return (
    <div className="border-y border-[var(--border-strong)]">
      <div className="border-b border-[var(--border)] py-2 text-center font-mono text-[13px] text-[var(--text-muted)]">
        {filename}
      </div>
      <pre className="px-1 py-4">
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

function Str({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}
function Dim({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-faint)]">{children}</span>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="italic text-[var(--text-faint)]">{children}</span>;
}
function Cel({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--pass)]">{children}</span>;
}
