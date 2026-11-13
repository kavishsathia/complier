import type { Metadata } from "next";
import Link from "next/link";
import { Code, Note, Step } from "../parts";
import Shell from "../shell";

export const metadata: Metadata = {
  title: "Get started: two agents | complier",
  description: "Two Claude Code sessions, a writer and a reviewer, on one complier machine: each can take only its own role's steps.",
};

export default function TwoAgents() {
  return (
    <Shell
      current="/get-started/two-agents"
      title="Two agents"
      lede="A writer and a reviewer, two Claude Code sessions, share one machine and take turns. The writer can't publish until the reviewer approves, and while one works, complier holds the other."
    >
      <Note>
        <p>
          You need complier installed, with <code>complier doctor</code> saying <code>ready</code>. See{" "}
          <Link href="/get-started" prefetch={false}>
            Install
          </Link>
          . You&apos;ll use four terminals.
        </p>
      </Note>
      <ol className="gs-steps">
        <Step n={1} title="Copy the demo">
          <p>It comes with complier. Copy it somewhere you can work in:</p>
          <Code>{`cp -R ~/.complier/examples/two-agents ~/two-agents`}</Code>
        </Step>

        <Step n={2} title="Read the contract">
          <p>
            It&apos;s in <code>~/two-agents/review-gate.csp</code>. Each step belongs to a role, and the review&apos;s
            result decides what comes next:
          </p>
          <Code label="review-gate.csp">{`datatype Role = writer | reviewer

Writing  = Permit(writer, submit, \\ v @ if v == done then InReview else Writing)
        [] Permit(writer, other, \\ _ @ Writing)
InReview = Permit(reviewer, review, \\ v @ if v == approved then Approved
                                         else if v == rejected then Writing else InReview)
        [] Permit(reviewer, other, \\ _ @ InReview)
        [] Deny(writer, publish, InReview)
Approved = Permit(writer, publish, \\ v @ if v == done then SKIP else Approved)
        [] Permit(writer, other, \\ _ @ Approved)

Agent = ||| r : Role @ ControllableCHAOS(r)`}</Code>
          <p>
            <code>Agent</code> is one <code>ControllableCHAOS</code> per role: FDR proves the contract against two
            independent agents. The agents take turns. In each state only one role has anything to do, and{" "}
            <code>other</code> (writing the draft, reading the board) is only offered to that role. The other agent
            ends its turn, and complier holds it until it&apos;s its turn again.
          </p>
        </Step>

        <Step n={3} title="Start the machine">
          <p>FDR proves the contract and the CEL verifier proves the unit before anything runs:</p>
          <Code>{`complier machine up review-gate ~/two-agents`}</Code>
        </Step>

        <Step n={4} title="Watch it">
          <p>In a second terminal:</p>
          <Code>{`complier machine log review-gate --follow`}</Code>
        </Step>

        <Step n={5} title="Start the writer">
          <p>In a third terminal, go to the shared folder:</p>
          <Code>{`cd ~/two-agents/workspace`}</Code>
          <p>Start Claude Code as the writer:</p>
          <Code>{`COMPLIER_MACHINE=review-gate COMPLIER_ROLE=writer claude --plugin-dir ~/.complier/plugin`}</Code>
          <p>Trust the folder if it asks, then give it:</p>
          <Code label="prompt">{`You are the writer: follow WRITER.md.`}</Code>
        </Step>

        <Step n={6} title="Start the reviewer">
          <p>In a fourth terminal, the same folder:</p>
          <Code>{`cd ~/two-agents/workspace`}</Code>
          <p>Start Claude Code as the reviewer:</p>
          <Code>{`COMPLIER_MACHINE=review-gate COMPLIER_ROLE=reviewer claude --plugin-dir ~/.complier/plugin`}</Code>
          <p>Then give it:</p>
          <Code label="prompt">{`You are the reviewer: follow REVIEWER.md.`}</Code>
        </Step>

        <Step n={7} title="What to look for">
          <p>In the log, within a minute or so:</p>
          <ul>
            <li>The reviewer waits without making a call: complier holds it until there&apos;s a submission.</li>
            <li>
              The writer submits, then tries to publish before review: <strong>denied</strong>. It ends its turn and
              complier holds it.
            </li>
            <li>
              The reviewer is told to continue, and rejects or approves. A rejection wakes the writer to revise and
              submit again.
            </li>
            <li>
              After the approval, complier wakes the writer, it publishes, and the log ends with{" "}
              <code>finished</code>. Both sessions are free to stop.
            </li>
          </ul>
        </Step>

        <Step n={8} title="Stop the machine">
          <Code>{`complier machine down review-gate`}</Code>
        </Step>
      </ol>
    </Shell>
  );
}
