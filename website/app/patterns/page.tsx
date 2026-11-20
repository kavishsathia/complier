// The pattern library's front page: what the patterns are built from, how a spec uses them, and the
// eight topologies.

import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "../get-started/parts";
import { PATTERNS, type Pattern } from "./_data/patterns.ts";
import Shell, { REPO } from "./shell";

export const metadata: Metadata = {
  title: "Patterns · complier",
  description: "Multi-agent topologies as complier policies: the order between agents enforced and proven, not just asked for.",
};

// A pattern's agents and links, small.
function Thumb({ p }: { p: Pattern }) {
  const at = Object.fromEntries(p.nodes.map((n) => [n.role, n]));
  return (
    <svg viewBox="0 0 720 260" aria-hidden="true" className="pt-thumb">
      {p.links.map(([a, b]) => {
        const both = p.links.some(([c, d]) => c === b && d === a);
        const A = at[a]!;
        const B = at[b]!;
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        const nx = both ? (-(B.y - A.y) / len) * 14 : 0;
        const ny = both ? ((B.x - A.x) / len) * 14 : 0;
        return <line key={`${a}>${b}`} x1={A.x + nx} y1={A.y + ny} x2={B.x + nx} y2={B.y + ny} />;
      })}
      {p.nodes.map((n) => (
        <rect key={n.role} x={n.x - 62} y={n.y - 26} width={124} height={52} rx={14} />
      ))}
    </svg>
  );
}

export default function PatternsPage() {
  return (
    <Shell current="">
      <header className="gs-head pt-head">
        <h1>Patterns</h1>
        <p className="lede">
          The familiar ways to arrange agents, as complier policies. Each one is a CSP process in complier&apos;s pattern library, and each
          comes with what it guarantees, proven by FDR before any agent runs.
        </p>
      </header>

      <section className="pt-section">
        <p>
          When agents are separate sessions, nothing makes them keep to a topology: a reviewer can act before there is anything to
          review, and a writer can publish without waiting for the critic. Here the topology is the policy. Each agent&apos;s tool calls
          are checked against it before they run, so an agent that acts out of turn is refused and told why, and an agent whose turn
          hasn&apos;t come is held until it has.
        </p>
      </section>

      <ul className="pt-grid">
        {PATTERNS.map((p, i) => (
          <li key={p.slug}>
            <Link href={`/patterns/${p.slug}`} prefetch={false} className="pt-card">
              <Thumb p={p} />
              <span className="pt-card-n">{i + 1}</span>
              <span className="pt-card-name">{p.name}</span>
              <span className="pt-card-short">{p.short}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="pt-section">
        <h2>What they&apos;re built from</h2>
        <div className="pt-blocks">
          <div>
            <h3>Phases</h3>
            <p>A phase is a process that ends when its part of the work is done. Most patterns take phases and arrange them.</p>
            <Code label="a phase" wrap>{`Step(writer, draft)
Draft = Permit(writer, edit, \\ _ @ Draft) [] Step(writer, submit)`}</Code>
          </div>
          <div>
            <h3>Judgements</h3>
            <p>A judgement runs, then carries on as one of two processes: pass or fail. Critics and judges are judgements.</p>
            <Code label="a judgement" wrap>{`Judgement(critic, review, {pass})
-- J(Pass, Fail): the critic's review passes on pass`}</Code>
          </div>
          <div>
            <h3>Held calls</h3>
            <p>
              A held call is taken, and answered only once other agents have acted. The agent&apos;s tool call waits meanwhile, and the
              agents acting are shown it. Delegation, advice and guards are held calls.
            </p>
            <Code label="a held call" wrap>{`Hold(writer, research, Assistant, \\ _ @ Write)
-- writer's research waits while Assistant works`}</Code>
          </div>
        </div>
      </section>

      <section className="pt-section">
        <h2>Using one</h2>
        <p>
          A spec with roles includes the library. complier supplies <code>patterns.csp</code>, so there&apos;s no file to copy, and its
          patterns compose like any other process:
        </p>
        <Code label="review.csp">{`include "patterns.csp"
datatype Role = writer | critic
datatype Act = draft | review | publish
datatype Value = done | failed | pass | fail
Returns(review) = {pass, fail, failed}
Returns(_)      = {done, failed}

Policy = GeneratorCritic(Step(writer, draft), Judgement(critic, review, {pass})) ; Step(writer, publish)

assert Before({result.critic.review.pass}, {|attempt.writer.publish|}) [T= Policy`}</Code>
        <p>
          With roles, agents act at the same time: each has its own call in flight, and the policy decides whose turn it is. The library
          also has <code>Before</code>, <code>AtMost</code> and <code>Alternate</code> for stating what a policy guarantees. The whole of
          it is <a href={`${REPO}/blob/main/patterns/patterns.csp`}>patterns/patterns.csp</a>.
        </p>
      </section>
    </Shell>
  );
}
