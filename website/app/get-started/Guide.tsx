"use client";

// The install guide. The harness picker changes the steps that depend on the agent's harness (what
// to have installed, and how to put an agent on a machine); everything else is the same for every
// harness. Only Claude Code is supported so far; the others are listed so people can see where
// it's going.

import Link from "next/link";
import { useState } from "react";

const REPO = "https://github.com/kavishsathia/complier";

type HarnessId = "claude-code" | "codex" | "other";

const HARNESSES: { id: HarnessId; name: string; available: boolean }[] = [
  { id: "claude-code", name: "Claude Code", available: true },
  { id: "codex", name: "Codex", available: false },
  { id: "other", name: "Other harnesses", available: false },
];

function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is still there to select.
    }
  };
  return (
    <div className="gs-code">
      <div className="gs-code-bar">
        <span className="gs-code-label">{label ?? "Terminal"}</span>
        <button type="button" className="gs-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy to clipboard"}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="gs-step" id={`step-${n}`}>
      <span className="gs-n" aria-hidden="true">
        {n}
      </span>
      <div className="gs-body">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Note({ tone = "plain", children }: { tone?: "plain" | "warn"; children: React.ReactNode }) {
  return <div className={`gs-note is-${tone}`}>{children}</div>;
}

export default function Guide() {
  const [harness, setHarness] = useState<HarnessId>("claude-code");
  const chosen = HARNESSES.find((h) => h.id === harness)!;

  return (
    <>
      <section className="gs-pick" aria-labelledby="pick-title">
        <h2 id="pick-title">Your agent&apos;s harness</h2>
        <p>complier plugs into the program your agent runs in. Pick yours; the steps below follow it.</p>
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
            <strong>{chosen.name} isn&apos;t supported yet.</strong> complier needs a hook that runs before every tool
            call, and so far it&apos;s wired into Claude Code only. Follow the repository for other harnesses, or pick
            Claude Code to see the full setup.
          </p>
        </Note>
      ) : (
        <ol className="gs-steps">
          <Step n={1} title="Check what you need">
            <p>complier runs on your own machine, next to your agent. You need:</p>
            <ul>
              <li>macOS or Linux (x86_64).</li>
              <li>
                <a href="https://rustup.rs">Rust</a>, to build the <code>complier</code> command.
              </li>
              <li>A Java Development Kit, version 11 or later, for the CEL verifier that proves translation units.</li>
              <li>
                <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, the harness your agent runs in.
              </li>
              <li>Git, and FDR, which step 2 covers.</li>
            </ul>
            <Code label="Each of these should print a version">{`rustc --version
java -version
claude --version`}</Code>
          </Step>

          <Step n={2} title="Get FDR and its licence">
            <p>
              FDR is the refinement checker that proves your contracts and compiles them into the state machine complier
              runs. It isn&apos;t part of complier: you download your own copy from its makers, and it needs its own
              licence.
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
                which licence applies to you and stores it. FDR for macOS is built for Intel, so on Apple silicon macOS
                will offer to install Rosetta.
              </li>
              <li>
                <strong>Linux:</strong> unpack it, set <code>FDR_HOME</code> to the folder, and run <code>refines</code> once
                to get the licence. Ubuntu 24.04 needs one extra library; the{" "}
                <a href={`${REPO}/tree/main/fdr#setup`}>FDR setup notes</a> walk through it.
              </li>
            </ol>
          </Step>

          <Step n={3} title="Download complier and build its backends">
            <p>
              Two small backends do the proving: Google&apos;s CEL verifier (with Z3) for translation units, and a bridge
              to your FDR for contracts. The first script downloads pinned, checksummed libraries from Maven Central.
            </p>
            <Code>{`git clone ${REPO} ~/complier
cd ~/complier
cel/build.sh                 # the CEL verifier and Z3
fdr/build-complier-fdr.sh    # the bridge to your FDR`}</Code>
          </Step>

          <Step n={4} title="Install the complier command">
            <Code>{`cargo install --path cli --locked
complier --version            # complier 0.1.0`}</Code>
            <Note>
              <p>
                The command finds both backends inside <code>~/complier</code>, so leave the folder where it is. If you
                move it, rebuild, or point <code>COMPLIER_CEL</code> and <code>COMPLIER_FDR</code> at the new{" "}
                <code>backend.json</code> files.
              </p>
            </Note>
          </Step>

          <Step n={5} title="Prove the example contract">
            <p>
              The repository has a small one for a Notion writer: it must draft, then recreate, in turn. A{" "}
              <strong>translation unit</strong> says which tool calls count as which steps, in CEL, and the{" "}
              <strong>contract</strong> says the order the steps may happen in, in CSP:
            </p>
            <Code label="examples/demo/draft.csp">{`datatype Role = writer
datatype Act = draft | recreate | other
Policy = Draft
Draft = Permit(writer, draft, Recreate) [] Deny(writer, other, Draft)
Recreate = Permit(writer, recreate, Draft) [] Deny(writer, other, Recreate)`}</Code>
            <p>
              Prove both. <code>check</code> has the CEL verifier show that no call matches two rules and none falls
              through; <code>verify</code> has FDR show that every attempt gets an answer and nothing deadlocks. Nothing
              runs yet:
            </p>
            <Code>{`complier check examples/demo/draft.yaml
complier verify examples/demo/draft.csp`}</Code>
            <p>Then start a machine, a running copy of the contract. This also starts complier&apos;s background daemon:</p>
            <Code>{`complier machine up demo \\
  --spec examples/demo/draft.csp \\
  --unit examples/demo/draft.yaml`}</Code>
          </Step>

          <Step n={6} title="Put Claude Code on the machine">
            <p>
              Give Claude Code the Notion MCP server under the name the unit uses for it, <code>notion</code>, then sign
              in from inside Claude Code with <code>/mcp</code>:
            </p>
            <Code>{`claude mcp add --transport http notion https://mcp.notion.com/mcp`}</Code>
            <Note>
              <p>
                The name matters: Claude Code calls the tools <code>mcp__notion__…</code>, and that&apos;s how complier
                knows which unit covers them. A Notion you connected through claude.ai is named differently, and its calls
                will be blocked as uncovered.
              </p>
            </Note>
            <p>Start Claude Code with complier&apos;s plugin, in the machine and role it should act as:</p>
            <Code>{`COMPLIER_MACHINE=demo COMPLIER_ROLE=writer \\
  claude --plugin-dir ~/complier/plugin`}</Code>
            <p>
              The plugin&apos;s hook asks complier before every MCP tool call. Ask the agent to edit a page twice: the
              first edit runs as <code>draft</code>, and the second is refused, with the reason, because the contract now
              expects a <code>recreate</code>. Tools the unit doesn&apos;t name are blocked.
            </p>
          </Step>

          <Step n={7} title="Watch it, and stop it">
            <p>The log shows every call the agent made: allowed, denied or refused, and why.</p>
            <Code>{`complier machine log demo --follow
complier machine down demo`}</Code>
          </Step>

          <Step n={8} title="Write your own">
            <ul>
              <li>
                <strong>Translation units</strong> map a service&apos;s tool calls to actions with CEL rules. The{" "}
                <a href={`${REPO}/tree/main/cel`}>unit reference</a> covers the format and what&apos;s proven.
              </li>
              <li>
                <strong>Contracts</strong> are CSP policies built from <code>Permit</code>, <code>Deny</code> and{" "}
                <code>PermitIf</code>, with any of your own <code>assert</code>s. The{" "}
                <a href={`${REPO}/tree/main/fdr`}>contract reference</a> lists what FDR checks.
              </li>
              <li>
                Try rules and contracts in the browser first, in the{" "}
                <Link href="/playground" prefetch={false}>
                  playground
                </Link>{" "}
                and the{" "}
                <Link href="/stepper" prefetch={false}>
                  stepper
                </Link>
                .
              </li>
            </ul>
          </Step>
        </ol>
      )}
    </>
  );
}
