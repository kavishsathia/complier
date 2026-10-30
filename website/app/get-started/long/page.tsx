import type { Metadata } from "next";
import Link from "next/link";
import { Code, Note, Step } from "../parts";
import Shell from "../shell";

export const metadata: Metadata = {
  title: "Get started: a long run | complier",
  description: "Run an agent in rounds for half an hour, with the browser, GitHub and CI, under one contract.",
};

export default function Long() {
  return (
    <Shell
      current="/get-started/long"
      title="A long run"
      lede="An agent improves a web page in rounds for half an hour: edit, check it in the browser, commit, push, watch CI, notify you, repeat."
    >
      <Note>
        <p>
          You need complier installed, with <code>complier doctor</code> saying <code>ready</code> (see{" "}
          <Link href="/get-started" prefetch={false}>
            Install
          </Link>
          ), the <a href="https://cli.github.com">GitHub CLI</a> signed in, and Claude in Chrome connected to Claude Code.
        </p>
      </Note>
      <ol className="gs-steps">
        <Step n={1} title="Read the contract">
          <p>
            It&apos;s in <code>~/.complier/examples/loop/workflow.csp</code>. Each round: check the time, make up to 15
            edits, look at the page in the browser (the only way out of editing), commit, push, watch CI, notify you,
            and check the time again. The time check&apos;s result is bound at the start and compared at the end:
          </p>
          <Code label="workflow.csp">{`Policy = Permit(check_time, Start)
Start(minutes.t) = Edit(t, 0)

Check(s) = Permit(check_time, \\ v @ Decide(s, v))
Decide(s, minutes.now) = if (now - s + 120) % 120 >= 30 then SKIP else Edit(s, 0)`}</Code>
          <p>Under 30 minutes, another round; otherwise it&apos;s done. Until then, complier won&apos;t let the agent stop.</p>
        </Step>

        <Step n={2} title="Make your own copy of the page">
          <p>The agent pushes, so it works on a copy in your own GitHub account, with CI:</p>
          <Code>{`git clone https://github.com/kavishsathia/complier-loop-test ~/loop-long
cd ~/loop-long`}</Code>
          <Code>{`git remote remove origin
gh repo create loop-long --private --source . --push`}</Code>
          <p>Serve the page so the browser can open it, and leave this running:</p>
          <Code>{`python3 -m http.server 8799`}</Code>
        </Step>

        <Step n={3} title="Start the machine">
          <p>In a new terminal:</p>
          <Code>{`cd ~/.complier/examples/loop
complier machine up loop --spec workflow.csp --unit claude-code.yaml --unit chrome.yaml`}</Code>
          <Code>{`complier machine log loop --follow`}</Code>
          <Note>
            <p>
              For a quick try, lower <code>30</code> in <code>workflow.csp</code> to a few minutes before starting it.
            </p>
          </Note>
        </Step>

        <Step n={4} title="Start Claude Code on it">
          <p>
            In another terminal. Check the browser is connected with <code>/chrome</code> once it opens:
          </p>
          <Code>{`cd ~/loop-long
COMPLIER_MACHINE=loop COMPLIER_ROLE=dev claude --chrome --plugin-dir ~/.complier/plugin`}</Code>
          <p>Then give it the task:</p>
          <Code label="prompt" wrap>{`Keep improving the field notes page in this repository (index.html and style.css): for example, add a
few more birds with a short note on each, and make the page look nicer. Only edit those two
existing files.

Work in rounds, in exactly this order:
1. Check the time with \`date +%s\`.
2. Make your edits with Edit or Write: at most 15 per round.
3. Look at the page in Chrome at http://localhost:8799/ (at least one browser action). Once you've
   started checking in the browser, you can't edit again this round.
4. Commit with \`git commit -am "..."\`, then push with \`git push\`.
5. Watch the CI run for that push with the Monitor tool (for example \`gh run watch --exit-status\`).
6. Send me a push notification that the commit is done.
7. Check the time again with \`date +%s\`.

complier enforces this order and decides when the work is done: keep going round after round
until it lets you stop.`}</Code>
        </Step>

        <Step n={5} title="When it's done">
          <p>
            The log ends with <code>finished</code> once a round ends 30 minutes after the first time check. Stop the
            machine with <code>complier machine down loop</code>, and the page server with Ctrl-C.
          </p>
        </Step>
      </ol>
    </Shell>
  );
}
