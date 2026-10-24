import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Diagram from "./_landing/Diagram";
import Nav from "./_landing/Nav";
import Workbench from "./_landing/Workbench";
import mascot from "./controllable-chaos.png";
import "./_landing/landing.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "complier: give your agents rules, not just instructions",
  description:
    "complier checks every tool call an agent makes against a contract you write, and refuses calls that are out of turn before they reach the service.",
  openGraph: {
    title: "complier: give your agents rules, not just instructions",
    description:
      "Write which tool calls count as which steps and the order those steps may happen in. complier refuses the rest before it reaches the service.",
    type: "website",
    siteName: "complier",
  },
};

export default function Home() {
  return (
    <div className={`landing ${sans.variable} ${mono.variable}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <Link href="/" className="brand" aria-label="complier home">
          <Image src={mascot} alt="" width={34} height={36} priority />
          <span>complier</span>
        </Link>
        <Nav repo={REPO} />
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <h1 id="hero-title">
              Give your agents rules.
              <br />
              Not just instructions.
            </h1>
            <p className="lede">
              A prompt asks an agent to publish only after a review. complier makes it so. You write which tool calls count as which
              steps, and the order the steps may happen in. Every call is checked before it reaches the service, and refused if
              it&apos;s out of turn.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="#get-started">
                Get started
                <span aria-hidden="true">→</span>
              </a>
              <a className="btn btn-outline" href="#demo">
                Try the live demo
              </a>
            </div>
            <ul className="facts" aria-label="At a glance">
              <li>Sits between your agent and its MCP tools</li>
              <li>Rules are proven before they load</li>
              <li>Refuses before anything is sent</li>
            </ul>
          </div>
          <figure className="hero-mascot">
            <Image
              src={mascot}
              alt="Controllable Chaos, complier's mascot: a purple axolotl with mint gills, standing calmly"
              sizes="(max-width: 760px) 200px, 340px"
              priority
            />
            <figcaption>Controllable Chaos</figcaption>
          </figure>
        </section>

        <section id="demo" className="section" aria-labelledby="demo-title">
          <div className="section-head">
            <h2 id="demo-title">Try changing the rules.</h2>
            <p>
              A writer agent drafts a post in Notion, gets it reviewed and publishes it. Edit the translation or the contract, then run
              the same calls again. It all runs in your browser: Google&apos;s cel-java and its verifier for the translation, as in the CLI,
              and the CSP engine behind complier&apos;s{" "}
              <Link href="/stepper" prefetch={false}>
                stepper
              </Link>{" "}
              for the contract. Nothing is sent to Notion or to a model.
            </p>
          </div>
          <Workbench />
        </section>

        <section id="how" className="section" aria-labelledby="how-title">
          <h2 id="how-title" className="how-title">Out-of-turn calls never leave.</h2>
          <Diagram />
        </section>

        <section id="get-started" className="cta" aria-labelledby="start-title">
          <Image src={mascot} alt="" className="cta-mascot" sizes="96px" />
          <div className="cta-text">
            <h2 id="start-title">Put your agents on a contract.</h2>
            <p>A research project. Build it from the repository.</p>
          </div>
          <div className="ctas">
            <a className="btn btn-primary" href={REPO}>
              Open the repository
              <span aria-hidden="true">→</span>
            </a>
            <Link className="btn btn-outline" href="/stepper" prefetch={false}>
              Step through a contract
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span className="footer-brand">complier</span>
        <nav aria-label="Footer">
          <a href={REPO}>GitHub</a>
          <Link href="/stepper" prefetch={false}>
            Stepper
          </Link>
          <Link href="/progress" prefetch={false}>
            Research
          </Link>
        </nav>
      </footer>
    </div>
  );
}
