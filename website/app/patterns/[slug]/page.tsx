// One pattern: what it is, its flow animated, what complier holds, the library process behind it, the
// guarantee FDR proves, and the commands to play the flow by hand.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Code, Note, Step } from "../../get-started/parts";
import { EXAMPLES } from "../_data/compiled.ts";
import { PATTERNS, bySlug } from "../_data/patterns.ts";
import { script } from "../flow.ts";
import { assertions, definitions } from "../library.ts";
import Shell, { REPO } from "../shell";
import Stage from "../Stage";

export const dynamicParams = false;

export function generateStaticParams() {
  return PATTERNS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = bySlug((await params).slug);
  return p ? { title: `${p.name} · complier patterns`, description: p.short } : {};
}

export default async function PatternPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = bySlug((await params).slug);
  if (!p) notFound();
  const example = EXAMPLES[p.slug]!;
  const i = PATTERNS.indexOf(p);
  const prev = PATTERNS[i - 1];
  const next = PATTERNS[i + 1];
  const file = `${p.slug}.csp`;

  return (
    <Shell current={p.slug}>
      <header className="gs-head pt-head">
        <p className="pt-kicker">Pattern {i + 1} of {PATTERNS.length}</p>
        <h1>{p.name}</h1>
        <p className="lede">{p.short}</p>
      </header>

      <section className="pt-section">
        <p className="pt-what">{p.what}</p>
        <Stage pattern={p} />
      </section>

      <section className="pt-section">
        <h2>What complier holds</h2>
        <p>{p.enforced}</p>
      </section>

      <section className="pt-section">
        <h2>In a spec</h2>
        <p>The example&apos;s policy is one line from the library:</p>
        <Code label={file}>{`Policy = ${p.call}`}</Code>
        <p>{p.args}</p>
        <details className="pt-details">
          <summary>The definitions, from patterns.csp</summary>
          <Code label="patterns.csp">{definitions(p.defines)}</Code>
        </details>
      </section>

      <section className="pt-section">
        <h2>The guarantee</h2>
        <p>
          {p.guarantee} The spec states it as its own assertion, and FDR proves it against the most general agents (one{" "}
          <code>ControllableCHAOS</code> per role) before the machine starts. A spec that breaks the pattern isn&apos;t admitted.
        </p>
        <Code label={file}>{assertions(example.spec)}</Code>
      </section>

      <section className="pt-section">
        <h2>Try it</h2>
        <Note>
          You need complier with FDR, with <code>complier doctor</code> saying <code>ready</code> (see <Link href="/get-started">Install</Link>).
          The pattern library, held calls and agents acting at the same time are new: until a release has them, build complier from a
          checkout of <a href={REPO}>main</a>. No agents needed: each command acts as an agent would.
        </Note>
        <ol className="gs-steps">
          <Step n={1} title="Save the spec">
            <Code label="Terminal">{`cat > ${file} <<'EOF'\n${example.spec}EOF`}</Code>
          </Step>
          <Step n={2} title="Start the machine">
            <p>FDR proves the policy and the pattern&apos;s guarantee before anything runs:</p>
            <Code label="Terminal">{`complier machine up ${p.slug} --spec ${file}`}</Code>
            <p>
              To watch it, run <code>complier machine log {p.slug} --follow</code> in a second terminal.
            </p>
          </Step>
          <Step n={3} title="Play the flow">
            <p>
              Each line is one step of the animation above. <code>act</code> attempts a step as the agent in that role; <code>result</code> gives
              its call&apos;s result.
              {script(p).includes("&") ? " A held call waits for its verdict, so it runs in the background and prints the verdict when it comes." : ""}
            </p>
            <Code label="Terminal">{script(p)}</Code>
          </Step>
          <Step n={4} title="Stop it">
            <Code label="Terminal">{`complier machine down ${p.slug}`}</Code>
          </Step>
        </ol>
        <p className="pt-agents">
          With real agents, a translation unit names which tool calls are which steps, and each agent starts in its role:{" "}
          <code>COMPLIER_MACHINE={p.slug} COMPLIER_ROLE={p.nodes[0]!.role} claude --plugin-dir plugin</code>. The{" "}
          <Link href="/get-started/two-agents">two-agent guide</Link> walks through one.
        </p>
      </section>

      <nav className="pt-pager" aria-label="More patterns">
        {prev ? (
          <Link href={`/patterns/${prev.slug}`} prefetch={false}>
            <span>Previous</span>
            {prev.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/patterns/${next.slug}`} prefetch={false} className="is-next">
            <span>Next</span>
            {next.name}
          </Link>
        ) : (
          <Link href="/patterns" prefetch={false} className="is-next">
            <span>Back to</span>
            All patterns
          </Link>
        )}
      </nav>
    </Shell>
  );
}
