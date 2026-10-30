import type { Metadata } from "next";
import Link from "next/link";
import { Code, Note, Step } from "../parts";
import Shell from "../shell";

export const metadata: Metadata = {
  title: "Get started: a short run | complier",
  description: "Run an agent under a pre-commit gate: it may only commit once the page's check passes after its last edit.",
};

export default function Short() {
  return (
    <Shell
      current="/get-started/short"
      title="A short run"
      lede="An agent adds to a web page and commits it. complier only lets the commit through if the page's check passed after the agent's last edit."
    >
      <Note>
        <p>
          You need complier installed, with <code>complier doctor</code> saying <code>ready</code>. See{" "}
          <Link href="/get-started" prefetch={false}>
            Install
          </Link>
          .
        </p>
      </Note>
      <ol className="gs-steps">
        <Step n={1} title="Get a page to work on">
          <p>A small page with a check script (it fails if a link is broken or the title is missing):</p>
          <Code>{`git clone https://github.com/kavishsathia/complier-loop-test ~/loop-test
cd ~/loop-test`}</Code>
        </Step>

        <Step n={2} title="Read the contract">
          <p>
            It&apos;s in <code>~/.complier/examples/short/workflow.csp</code>. Running the check is a call like any
            other, and its result, <code>done</code> if it passed or <code>failed</code> if not, decides what comes
            next:
          </p>
          <Code label="workflow.csp">{`Unchecked = Permit(edit, \\ _ @ Unchecked)
         [] Permit(check, \\ v @ (if v == done then Checked else Unchecked))
         [] Deny(commit, Unchecked)
Checked   = Permit(edit, \\ _ @ Unchecked)
         [] Permit(check, \\ v @ (if v == done then Checked else Unchecked))
         [] Permit(commit, \\ _ @ SKIP)`}</Code>
          <p>
            Its unit, <code>claude-code.yaml</code>, says which of Claude Code&apos;s tool calls count as{" "}
            <code>edit</code>, <code>check</code> and <code>commit</code>.
          </p>
        </Step>

        <Step n={3} title="Start the machine">
          <p>In a new terminal. FDR proves the contract and the CEL verifier proves the unit before anything runs:</p>
          <Code>{`cd ~/.complier/examples/short
complier machine up short --spec workflow.csp --unit claude-code.yaml`}</Code>
          <p>Then watch it. Every call shows up as allowed, denied or refused, and every result as it comes back:</p>
          <Code>{`complier machine log short --follow`}</Code>
        </Step>

        <Step n={4} title="Start Claude Code on it">
          <p>In another terminal:</p>
          <Code>{`cd ~/loop-test
COMPLIER_MACHINE=short COMPLIER_ROLE=dev claude --plugin-dir ~/.complier/plugin`}</Code>
          <p>Then give it the task:</p>
          <Code label="prompt" wrap>{`Add two more birds to index.html, each with a short note, then commit with \`git commit -am "..."\`.
Before committing, run the page's check with \`python3 check.py\`: the commit is only allowed if that
check passed after your last edit.`}</Code>
        </Step>

        <Step n={5} title="What to look for">
          <ul>
            <li>A commit before the check, or after an edit since the last check, is denied, with the reason.</li>
            <li>
              Try breaking the page (ask the agent to link to a file that doesn&apos;t exist): the check fails, the result
              is <code>failed</code>, and the commit stays denied until a later check passes.
            </li>
            <li>
              Once the commit is through, the log ends with <code>finished</code>. Stop the machine with{" "}
              <code>complier machine down short</code>.
            </li>
          </ul>
        </Step>
      </ol>
    </Shell>
  );
}
