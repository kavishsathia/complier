import Link from "next/link";
import { Nav } from "./nav";
import styles from "./landing.module.css";

export default function Home() {
  return (
    <>
      <Nav />
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1>Prove the rules your agents run under. Then enforce them.</h1>
          <p className={styles.lede}>
            Complier describes your agents and the world they act on as processes. It proves your
            rules hold on every possible run before anything executes, and blocks any tool call that
            would break them while it runs.
          </p>
          <Link href="/docs" className={styles.cta}>Walk through an example</Link>
        </section>

        <section className={styles.example}>
          <h2>An example</h2>
          <ol>
            <li>
              Two assistants share one bank account. The bank approves a withdrawal if it fits the
              balance.
            </li>
            <li>
              Complier proves that is not enough. If both assistants withdraw before either payment
              settles, the balance goes negative. It finds this without running an agent.
            </li>
            <li>
              Hold approved amounts until they settle, prove again, and the rule holds for any
              amounts over any number of steps.
            </li>
            <li>
              At run time, an assistant that asks for more than is free is blocked and told exactly
              what it can do instead.
            </li>
          </ol>
        </section>

        <section className={styles.steps}>
          <div>
            <h3>Describe</h3>
            <p>
              Write agents and their environment as CSP processes. Rules are what the processes
              allow, not prompts the agent may ignore.
            </p>
          </div>
          <div>
            <h3>Prove</h3>
            <p>
              Complier compiles the system to Horn clauses and asks Z3 for an inductive invariant.
              No bound on data, no bound on run length.
            </p>
          </div>
          <div>
            <h3>Enforce</h3>
            <p>
              At the tool boundary, a call runs only if the law offers it. Otherwise the agent gets
              back what is offered right now.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
