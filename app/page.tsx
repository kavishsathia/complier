import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Diagram from "./_landing/Diagram";
import Workbench from "./_landing/Workbench";
import mascot from "./controllable-chaos.png";
import "./_landing/landing.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "complier: give your agents rules, not just instructions",
  description:
    "complier checks every tool call an agent makes against a contract you write, and refuses calls that are out of turn before they reach the service.",
  openGraph: {
    title: "complier: give your agents rules, not just instructions",
    description:
      "Write which tool calls count as which steps and the order those steps may happen in. complier refuses the rest before it reaches the service.",
    type: "website",
    siteName: "complier",
  },
};

export default function Home() {
  return (
    <div className={`landing ${sans.variable} ${mono.variable}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <Link href="/" className="brand" aria-label="complier home">
          <Image src={mascot} alt="" width={34} height={36} priority />
          <span>complier</span>
        </Link>
        <nav aria-label="Main">
          <ul>
            <li>
              <a href="#demo">Demo</a>
            </li>
            <li className="nav-mid">
              <a href="#how">How it works</a>
            </li>
            <li>
              <a href="#get-started">Get started</a>
            </li>
            <li className="nav-wide">
              <Link href="/progress" prefetch={false}>
                Research
              </Link>
            </li>
            <li>
              <a href={REPO} className="nav-gh" aria-label="complier on GitHub">
                <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                  />
                </svg>
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <h1 id="hero-title">
              Give your agents rules.
              <br />
              Not just instructions.
            </h1>
            <p className="lede">
              A prompt asks an agent to publish only after a review. complier makes it so. You write which tool calls count as which
              steps, and the order the steps may happen in. Every call is checked before it reaches the service, and refused if
              it&apos;s out of turn.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="#get-started">
                Get started
                <span aria-hidden="true">→</span>
              </a>
              <a className="btn btn-outline" href="#demo">
                Try the live demo
              </a>
            </div>
            <ul className="facts" aria-label="At a glance">
              <li>Sits between your agent and its MCP tools</li>
              <li>Rules are proven before they load</li>
              <li>Refuses before anything is sent</li>
            </ul>
          </div>
          <figure className="hero-mascot">
            <Image
              src={mascot}
              alt="Controllable Chaos, complier's mascot: a purple axolotl with mint gills, standing calmly"
              sizes="(max-width: 760px) 200px, 340px"
              priority
            />
            <figcaption>Controllable Chaos</figcaption>
          </figure>
        </section>

        <section id="demo" className="section" aria-labelledby="demo-title">
          <div className="section-head">
            <h2 id="demo-title">Try changing the rules.</h2>
            <p>
              A writer agent drafts a post in Notion, gets it reviewed and publishes it. Edit the translation or the contract, then run
              the same calls again. It all runs in your browser: Google&apos;s cel-java and its verifier for the translation, as in the CLI,
              and the CSP engine behind complier&apos;s{" "}
              <Link href="/stepper" prefetch={false}>
                stepper
              </Link>{" "}
              for the contract. Nothing is sent to Notion or to a model.
            </p>
          </div>
          <Workbench />
        </section>

        <section id="how" className="section" aria-labelledby="how-title">
          <div className="section-head">
            <h2 id="how-title">Where each check happens.</h2>
            <p>
              complier is an MCP proxy plus a small daemon that holds each contract&apos;s state. The proofs happen once, when rules
              load. After that, each call costs one CEL evaluation and one step of the contract.
            </p>
          </div>
          <Diagram />
        </section>

        <section className="section prose-section" aria-labelledby="files-title">
          <div className="block">
            <h2 id="files-title">Where the rules live.</h2>
            <div className="prose">
              <p>
                Two files you write and one that&apos;s generated, all plain text next to your code, so rules go through review like
                any other change.
              </p>
              <dl className="defs">
                <dt>The translation unit</dt>
                <dd>
                  A YAML file per service. It names the tools it covers, types the arguments it reads, and gives each rule a CEL
                  predicate and the event it emits. A generated fallback catches every call no rule matches, and that event still has
                  to be allowed by the contract. Read-only tools can be listed as hidden, and pass through unchecked.
                </dd>
                <dt>The contract</dt>
                <dd>
                  A CSP process: which events may happen, in what order, and which role performs them. Several agents can share one
                  contract, each joining as a role, so one agent&apos;s step can unblock another&apos;s.
                </dd>
                <dt>The service&apos;s metadata</dt>
                <dd>
                  <code>complier gen</code> records every tool a server offers with a hash of its input schema. A unit can only name
                  those tools, and the proxy drops any tool whose schema has changed since.
                </dd>
              </dl>
            </div>
          </div>

          <div className="block">
            <h2>What it stops.</h2>
            <div className="prose">
              <ul className="stops">
                <li>
                  <strong>Steps out of order.</strong> Publishing before a review, or paying before an approval, is refused while the
                  contract is in the wrong state.
                </li>
                <li>
                  <strong>Calls nobody wrote a rule for.</strong> A <code>replace_content</code> where only edits were planned becomes the
                  fallback event, which your contract can leave out.
                </li>
                <li>
                  <strong>Two agents in the same critical section.</strong> A shared contract can act as a lock: once one agent reads the
                  next order, no other agent can until it&apos;s sent or rejected.
                </li>
                <li>
                  <strong>Ambiguous or malformed calls.</strong> Arguments of the wrong type, calls outside the unit&apos;s domain and calls
                  two rules match are refused, never guessed at.
                </li>
                <li>
                  <strong>Going around it.</strong> Tools no unit names are never offered, and inside a machine the plugin blocks direct
                  calls to other MCP servers and edits to complier&apos;s own configuration.
                </li>
              </ul>
            </div>
          </div>

          <div className="block">
            <h2>What it doesn&apos;t claim.</h2>
            <div className="prose">
              <p>
                complier checks the calls an agent makes, not what the agent writes in them: a published post can still be a bad post.
                It doesn&apos;t watch the world either; only the agents&apos; own calls move a contract. The proofs are about translation:
                that every call gets exactly one event. They say nothing about whether your contract describes the process you meant,
                which is why it&apos;s a short file you can read.
              </p>
            </div>
          </div>

          <div className="block">
            <h2>Fits the harness you have.</h2>
            <div className="prose">
              <p>
                The agent connects to <code>complier proxy</code> as one MCP server, through a Claude Code plugin in the repository. Its
                hooks tell the agent which role it plays and what the contract allows next, and when a call is refused the agent gets the
                reason, so it can wait or do something else. The upstream server&apos;s credentials stay in the proxy; the agent never
                sees them.
              </p>
            </div>
          </div>
        </section>

        <section id="get-started" className="section prose-section" aria-labelledby="start-title">
          <div className="block">
            <h2 id="start-title">Get started.</h2>
            <div className="prose">
              <p>
                complier is a research project and isn&apos;t packaged yet: you build the CLI from the repository. The repository has the
                Notion unit and a demo contract to start from.
              </p>
              <ol className="steps">
                <li>
                  <strong>Build the CLI</strong> from <code>cli/</code> with Cargo, and its CEL backend with <code>cel/build.sh</code>{" "}
                  (it needs a JDK). Register a server with <code>complier add notion --url https://mcp.notion.com/mcp</code>.
                </li>
                <li>
                  <strong>Write a unit and a contract</strong>, or start from the ones in <code>units/</code> and <code>demo/</code>. The
                  demo above is a good place to try rules first.
                </li>
                <li>
                  <strong>Start a machine</strong> with <code>complier machine up demo --spec &lt;contract&gt; --unit &lt;unit&gt;</code>.
                  It refuses to start if a unit isn&apos;t proven.
                </li>
                <li>
                  <strong>Run your agent in it</strong> with <code>COMPLIER_MACHINE=demo COMPLIER_ROLE=writer claude --plugin-dir plugin</code>.
                </li>
              </ol>
              <div className="ctas">
                <a className="btn btn-primary" href={REPO}>
                  Open the repository
                  <span aria-hidden="true">→</span>
                </a>
                <Link className="btn btn-outline" href="/stepper" prefetch={false}>
                  Step through a contract
                </Link>
              </div>
              <p className="aside">
                Curious how the semantics work? The{" "}
                <Link href="/stepper" prefetch={false}>
                  stepper
                </Link>{" "}
                shows every transition and the rule that proves it, and the{" "}
                <Link href="/progress" prefetch={false}>
                  research deck
                </Link>{" "}
                covers the theory behind the contracts.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span className="footer-brand">complier</span>
        <nav aria-label="Footer">
          <a href={REPO}>GitHub</a>
          <Link href="/stepper" prefetch={false}>
            Stepper
          </Link>
          <Link href="/progress" prefetch={false}>
            Research
          </Link>
        </nav>
      </footer>
    </div>
  );
}
