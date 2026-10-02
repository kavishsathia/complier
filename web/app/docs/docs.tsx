"use client";

import { ReactNode, useRef, useState } from "react";
import { heldAccount, naiveAccount } from "@/lib/csp/examples";
import { Playground } from "./playground";
import styles from "./docs.module.css";

type Tab = "proof" | "run";

function Line({ csp, children }: { csp: string; children: ReactNode }) {
  return (
    <div className={styles.line}>
      <code>{csp}</code>
      <p>{children}</p>
    </div>
  );
}

export function Docs() {
  const [source, setSource] = useState(naiveAccount);
  const [tab, setTab] = useState<Tab>("run");
  const [loads, setLoads] = useState(0); // remounts the run panel even when the source is unchanged
  const pane = useRef<HTMLDivElement>(null);

  function load(src: string, nextTab: Tab) {
    setSource(src);
    setTab(nextTab);
    setLoads((n) => n + 1);
    if (window.matchMedia("(max-width: 960px)").matches) {
      pane.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className={styles.layout}>
      <article className={styles.prose}>
        <h1>Two assistants, one account</h1>
        <p className={styles.lede}>
          Alice and Bob share a bank account, and each has an assistant that can pay for things.
          You will write the rules, watch them stop a bad payment, ask for a proof, find out the
          rules are wrong anyway, and fix them. The playground holds the rules as CSP. This page
          says what each line means.
        </p>

        <h2><span>1</span>The world and the agents</h2>
        <p>The playground starts with these rules already loaded.</p>
        <Line csp="datatype Agent = Alice | Bob">There are two people, Alice and Bob.</Line>
        <Line csp="channel withdraw, settle : Agent.Int">
          Two kinds of event can happen. An assistant asks to withdraw an amount, and a payment
          settles. Each event says whose assistant and how much.
        </Line>
        <Line csp="Account(bal) = withdraw?a?x:{1..bal} -> Account(bal)">
          The bank approves a withdrawal of any amount from 1 up to the balance. Approving does
          not move any money.
        </Line>
        <Line csp="[] settle?a?x -> Account(bal - x)">
          Or a payment settles, and the balance drops by that amount.
        </Line>
        <Line csp="Assistant(a) = withdraw!a?x -> Paying(a, x)">
          An assistant picks an amount and asks to withdraw it for its owner.
        </Line>
        <Line csp="Paying(a, x) = settle!a!x -> Assistant(a)">
          It then waits for exactly that payment to settle, and is free again.
        </Line>
        <Line csp="System = (… ||| …) [| {| withdraw, settle |} |] Account(100)">
          Both assistants run side by side without waiting on each other. The bank must agree to
          every withdrawal and settlement. It starts with 100.
        </Line>
        <Line csp="assert Account :[always bal >= 0]">The rule we care about: the balance never goes below zero.</Line>
        <p>
          Open the <b>Run</b> tab. You play both assistants by typing events. Send{" "}
          <code>withdraw.Alice.80</code>: it is allowed. Now send <code>withdraw.Bob.120</code>:
          it is blocked, because the bank never offers more than the balance. The block lists what
          is allowed instead. That list is what an agent would get back in place of a tool result.
        </p>
        <button className={styles.open} onClick={() => load(naiveAccount, "run")}>Reset the playground to step 1</button>

        <h2><span>2</span>Ask for a proof</h2>
        <p>
          Press <b>Prove</b>. The rule is <b>violated</b>, and the playground shows a run that
          breaks it. Z3 picks the amounts, so yours may differ, but the shape is the same: Alice
          asks for 100 and is approved, Bob asks for 99 and is also approved because nothing has
          settled yet, then both payments settle and the balance ends below zero.
        </p>
        <p>
          Every event in that run was allowed. The agents followed the rules; the rules were wrong.
          No agent ran to find this. Z3 reasoned about every possible run at once.
        </p>
        <button className={styles.open} onClick={() => load(naiveAccount, "proof")}>Load step 2</button>

        <h2><span>3</span>Fix the rules</h2>
        <p>The bank needs to remember what it has already promised. Three lines change.</p>
        <Line csp="Account(bal, held)">
          The bank also tracks how much is held for payments it approved that have not settled.
        </Line>
        <Line csp="withdraw?a?x:{1..bal - held} -> Account(bal, held + x)">
          It only approves what is not already held, and holds what it approves.
        </Line>
        <Line csp="settle?a?x -> Account(bal - x, held - x)">
          When a payment settles, the money leaves and its hold is released.
        </Line>
        <p>
          Load it and press <b>Prove</b>. The rule now <b>holds</b>, for any amounts and any number
          of events. Open <b>Why it holds</b> to see the proof: facts like &ldquo;while both
          assistants are paying, their two amounts together are at most what is held, and at most
          the balance&rdquo;. Each fact is true at the start and stays true after every event, so no
          run can ever reach a negative balance.
        </p>
        <button className={styles.open} onClick={() => load(heldAccount, "proof")}>Load step 3</button>

        <h2><span>4</span>Run under the fixed rules</h2>
        <p>
          In <b>Run</b>, send <code>withdraw.Alice.80</code>, then <code>withdraw.Bob.50</code>.
          Bob&apos;s request is blocked even though the balance is still 100, because 80 is held.
          The allowed list says what Bob&apos;s assistant can do instead: ask for at most 20, or
          wait for Alice&apos;s payment to settle.
        </p>
        <button className={styles.open} onClick={() => load(heldAccount, "run")}>Load step 4</button>

        <h2><span>5</span>What is running</h2>
        <ul>
          <li>
            The editor takes a fragment of CSP: datatypes, channels, processes with parameters,
            guarded events with choice, and parallel composition in <code>System</code>.
          </li>
          <li>Run executes the operational semantics of that fragment in your browser.</li>
          <li>
            Prove compiles the system to constrained Horn clauses and runs Z3&apos;s Spacer engine
            on them. When a rule fails, a bounded search finds the shortest run that shows it.
          </li>
          <li>
            Here you type the events yourself. Connected to an agent, each tool call becomes an
            event and goes through the same check.
          </li>
        </ul>

        <h2>Syntax</h2>
        <table className={styles.syntax}>
          <tbody>
            <tr><td><code>datatype T = A | B</code></td><td>a type with named values</td></tr>
            <tr><td><code>channel c : T.Int</code></td><td>events on c carry a T and a whole number</td></tr>
            <tr><td><code>P(x) = …</code></td><td>a process with parameters</td></tr>
            <tr><td><code>c!e</code>, <code>c.e</code></td><td>the field equals e</td></tr>
            <tr><td><code>c?x</code></td><td>accept any value and call it x</td></tr>
            <tr><td><code>c?x:{'{'}lo..hi{'}'}</code></td><td>accept a value between lo and hi</td></tr>
            <tr><td><code>g &amp; c -&gt; Q(…)</code></td><td>offer the event only when g is true, then become Q</td></tr>
            <tr><td><code>A [] B</code></td><td>offer both, the first event decides</td></tr>
            <tr><td><code>STOP</code></td><td>offer nothing</td></tr>
            <tr><td><code>P ||| Q</code></td><td>run side by side, independently</td></tr>
            <tr><td><code>P [| {'{|'} c {'|}'} |] Q</code></td><td>run side by side, both must agree on c</td></tr>
            <tr><td><code>assert P :[always e]</code></td><td>whenever a part of the system is P, e holds</td></tr>
          </tbody>
        </table>
      </article>

      <div className={styles.pane} ref={pane}>
        <Playground source={source} onSource={setSource} tab={tab} onTab={setTab} runKey={loads} />
      </div>
    </div>
  );
}
