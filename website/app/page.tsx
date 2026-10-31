import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Diagram from "./_landing/Diagram";
import Game from "./_landing/Game";
import Journey from "./_landing/Journey";
import Nav from "./_landing/Nav";
import mascot from "./controllable-chaos.png";
import "./_landing/landing.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "complier: give your agents rules, not just instructions",
  description:
    "complier checks every tool call an agent attempts against a contract you write. Your agent's harness asks before it runs a call, and out-of-turn calls are refused.",
  openGraph: {
    title: "complier: give your agents rules, not just instructions",
    description:
      "Write which tool calls count as which steps and the order those steps may happen in. complier refuses the rest before the harness runs them.",
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
              steps, and the order the steps may happen in. Your agent&apos;s harness checks every call with complier before it runs
              it, and a call that&apos;s out of turn is refused.
            </p>
            <div className="ctas">
              <Link className="btn btn-primary" href="/get-started" prefetch={false}>
                Get started
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="btn btn-outline" href="/playground" prefetch={false}>
                Open the playground
              </Link>
            </div>
            <ul className="facts" aria-label="At a glance">
              <li>Runs in your agent&apos;s pre-tool hook</li>
              <li>Rules are proven before they load</li>
              <li>Refused calls never run</li>
            </ul>
          </div>
          <figure className="hero-mascot">
            <Image
              src={mascot}
              alt="Controllable Chaos, complier's mascot: a purple axolotl with mint gills, standing calmly"
              sizes="(max-width: 760px) 200px, 340px"
              priority
            />
          </figure>
        </section>

        <section id="game" className="section" aria-labelledby="game-title">
          <div className="section-head">
            <h2 id="game-title">Get it to send you more than $100.</h2>
            <p>
              Controllable Chaos holds $500 of fake money and does whatever you ask. Pick a defense, then try to get more than $100 out
              of it in total, in one challenge. Each defense is a real mechanism on the same tool, and what it decides is shown as it
              happens.
            </p>
          </div>
          <Game />
        </section>

        <section id="refusals" className="section" aria-labelledby="refusals-title">
          <div className="section-head">
            <h2 id="refusals-title">A refusal changes nothing.</h2>
            <p>The out-of-turn call doesn&apos;t run, and the contract stays where it was.</p>
          </div>
          <Journey />
          <p className="journey-link">
            <Link href="/playground" prefetch={false}>
              Run these calls in the playground
              <span aria-hidden="true"> →</span>
            </Link>
          </p>
        </section>

        <section id="how" className="section" aria-labelledby="how-title">
          <h2 id="how-title" className="how-title">The harness asks first.</h2>
          <Diagram />
        </section>

        <section id="get-started" className="cta" aria-labelledby="start-title">
          <Image src={mascot} alt="" className="cta-mascot" sizes="96px" />
          <div className="cta-text">
            <h2 id="start-title">Put your agents on a contract.</h2>
            <p>A research project for macOS and Linux. Setup takes about fifteen minutes.</p>
          </div>
          <div className="ctas">
            <Link className="btn btn-primary" href="/get-started" prefetch={false}>
              Get started
              <span aria-hidden="true">→</span>
            </Link>
            <a className="btn btn-outline" href={REPO}>
              Open the repository
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span className="footer-brand">complier</span>
        <nav aria-label="Footer">
          <a href={REPO}>GitHub</a>
          <Link href="/get-started" prefetch={false}>
            Get started
          </Link>
          <Link href="/playground" prefetch={false}>
            Playground
          </Link>
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
