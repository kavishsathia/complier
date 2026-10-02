import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useCases } from "@/lib/usecases";
import type { How } from "@/lib/usecases/types";
import { Nav } from "../../nav";
import { CasePlayground } from "./case-playground";
import styles from "../use-cases.module.css";

const LABEL: Record<How, string> = {
  enforced: "Enforced",
  deadline: "Deadline",
  "not-encoded": "Not encoded",
};

export function generateStaticParams() {
  return useCases.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const uc = useCases.find((u) => u.slug === slug);
  return { title: uc ? `${uc.title} · complier` : "Use cases · complier", description: uc?.summary };
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = useCases.findIndex((u) => u.slug === slug);
  if (index < 0) notFound();
  const uc = useCases[index];
  const prev = useCases[index - 1];
  const next = useCases[index + 1];

  return (
    <>
      <Nav />
      <div className={styles.layout}>
        <nav className={styles.index} aria-label="Use cases">
          <ol>
            {useCases.map((u, i) => (
              <li key={u.slug}>
                <Link href={`/use-cases/${u.slug}`} aria-current={i === index ? "page" : undefined}>
                  {u.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <article className={styles.prose}>
          <details className={styles.smallIndex}>
            <summary>Use case {index + 1} of {useCases.length}</summary>
            <ol>
              {useCases.map((u) => (
                <li key={u.slug}><Link href={`/use-cases/${u.slug}`}>{u.title}</Link></li>
              ))}
            </ol>
          </details>
          <p className={styles.position}>Use case {index + 1} of {useCases.length}</p>
          <h1>{uc.title}</h1>
          <p className={styles.lede}>{uc.summary}</p>

          <h2>Constraints</h2>
          <ul className={styles.constraints}>
            {uc.constraints.map((c) => (
              <li key={c.text}>
                <p className={styles.text}>{c.text}</p>
                <p className={styles.detail}>
                  <span className={styles[c.how]}>{LABEL[c.how]}</span> {c.detail}
                </p>
              </li>
            ))}
          </ul>

          <h2>Reading this</h2>
          <p className={styles.note}>
            <b>Enforced</b> means the law only offers events that satisfy the constraint, so a
            breaking tool call is blocked, and Prove checks it over every run. <b>Deadline</b> means
            time is modelled as <code>tock</code> events: the law cannot stop time or make the agent
            act, so a missed deadline is caught and leaves the agent nothing to do but escalate.{" "}
            <b>Not encoded</b> means the constraint needs a judgment the events do not carry.
            Collections like 200 applicants are shown with two or three stand-ins, which is sound
            when items do not interact; shared totals are kept as counters.
          </p>

          <div className={styles.pager}>
            {prev ? <Link href={`/use-cases/${prev.slug}`}>Previous: {prev.title}</Link> : <span />}
            {next ? <Link href={`/use-cases/${next.slug}`}>Next: {next.title}</Link> : <span />}
          </div>
        </article>

        <div className={styles.pane}>
          <CasePlayground key={uc.slug} source={uc.source} file={`${uc.slug}.csp`} />
        </div>
      </div>
    </>
  );
}
