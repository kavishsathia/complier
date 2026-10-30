"use client";

// Page 1: installing complier. The harness picker shows what's needed for each; only Claude Code is
// supported so far.

import Link from "next/link";
import { useState } from "react";
import { Code, Note, Step } from "./parts";

type HarnessId = "claude-code" | "codex" | "other";

const HARNESSES: { id: HarnessId; name: string; available: boolean }[] = [
  { id: "claude-code", name: "Claude Code", available: true },
  { id: "codex", name: "Codex", available: false },
  { id: "other", name: "Other harnesses", available: false },
];

export default function Install() {
  const [harness, setHarness] = useState<HarnessId>("claude-code");
  const chosen = HARNESSES.find((h) => h.id === harness)!;

  return (
    <>
      <section className="gs-pick" aria-labelledby="pick-title">
        <h2 id="pick-title">Your agent&apos;s harness</h2>
        <p>complier plugs into the program your agent runs in. Pick yours.</p>
        <div className="gs-harnesses" role="radiogroup" aria-labelledby="pick-title">
          {HARNESSES.map((h) => (
            <button
              key={h.id}
              type="button"
              role="radio"
              aria-checked={harness === h.id}
              className={`gs-harness${harness === h.id ? " is-on" : ""}`}
              onClick={() => setHarness(h.id)}
            >
              <span className="gs-harness-name">{h.name}</span>
              {!h.available && <span className="gs-soon">Not yet</span>}
            </button>
          ))}
        </div>
      </section>

      {!chosen.available ? (
        <Note>
          <p>
            <strong>{chosen.name} isn&apos;t supported yet.</strong> complier needs a hook that runs before and after
            every tool call, and so far it&apos;s wired into Claude Code only.
          </p>
        </Note>
      ) : (
        <ol className="gs-steps">
          <Step n={1} title="Check what you need">
            <p>
              A Mac or a Linux computer (x86_64), <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>,
              and Java 11 or later, which runs complier&apos;s CEL verifier. Both of these should print a version:
            </p>
            <Code>{`java -version
claude --version`}</Code>
          </Step>

          <Step n={2} title="Get FDR and its licence">
            <p>
              FDR proves your contracts and compiles them into the state machine complier runs. It isn&apos;t part of
              complier: you download your own copy from its makers, and it needs its own licence.
            </p>
            <Note tone="warn">
              <p>
                <strong>Licence.</strong> FDR is free for academic work and for personal research. Any other use,
                including work for a company or for clients, needs a commercial licence from its makers. Read{" "}
                <a href="https://cocotec.io/fdr/licensing.html">FDR&apos;s licensing terms</a> before you use it.
              </p>
            </Note>
            <ol className="gs-sub">
              <li>
                Download FDR 4 from <a href="https://cocotec.io/fdr/">cocotec.io/fdr</a>.
              </li>
              <li>
                <strong>macOS:</strong> move <code>FDR4.app</code> to <code>/Applications</code> and open it once. It asks
                which licence applies to you and stores it. On Apple silicon, macOS will offer to install Rosetta.
              </li>
              <li>
                <strong>Linux:</strong> unpack it, set <code>FDR_HOME</code> to the folder, and run <code>refines</code> once
                to get the licence.
              </li>
            </ol>
          </Step>

          <Step n={3} title="Install complier">
            <p>This downloads the build for your computer into <code>~/.complier</code>. There&apos;s nothing to compile:</p>
            <Code>{`curl -fsSL https://raw.githubusercontent.com/kavishsathia/complier/main/install.sh | sh`}</Code>
            <p>
              Put it on your <code>PATH</code>, and add the same line to your shell&apos;s startup file (for example{" "}
              <code>~/.zshrc</code>) so new terminals have it too:
            </p>
            <Code>{`export PATH="$HOME/.complier/bin:$PATH"`}</Code>
          </Step>

          <Step n={4} title="Check it works">
            <Code>{`complier doctor`}</Code>
            <p>
              It checks Java and the CEL verifier, has FDR prove a tiny contract, and finds the Claude Code plugin. Every
              line should have a ✓, ending with <code>ready</code>. A ✗ says what&apos;s missing.
            </p>
          </Step>

          <Step n={5} title="Run something">
            <ul>
              <li>
                <Link href="/get-started/short" prefetch={false}>
                  A short run
                </Link>
                : an agent adds to a page and commits, and complier only lets the commit through if the page&apos;s
                check passed after the last edit. A few minutes, no accounts needed.
              </li>
              <li>
                <Link href="/get-started/long" prefetch={false}>
                  A long run
                </Link>
                : an agent works in rounds for half an hour, with the browser, GitHub and CI.
              </li>
            </ul>
          </Step>
        </ol>
      )}
    </>
  );
}
