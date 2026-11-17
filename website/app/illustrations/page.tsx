import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Nav from "../_landing/Nav";
import mascot from "../controllable-chaos.png";
import DeskIllustration from "./_desk/Desk";
import PairIllustration from "./_pair/Pair";
import "../_landing/landing.css";
import "./illustrations.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "complier · illustrations",
};

export default function Illustrations() {
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
        <header className="il-head">
          <h1>Illustrations</h1>
          <p className="lede">A warehouse order desk run by fulfilment agents, with and without complier. Running an agent needs the demo password.</p>
        </header>

        <section id="one-agent" className="section" aria-labelledby="one-agent-title">
          <div className="section-head">
            <h2 id="one-agent-title">One fulfilment agent</h2>
          </div>
          <DeskIllustration />
        </section>

        <section id="two-agents" className="section" aria-labelledby="two-agents-title">
          <div className="section-head">
            <h2 id="two-agents-title">Two fulfilment agents</h2>
          </div>
          <PairIllustration />
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
          <Link href="/illustrations" prefetch={false}>
            Illustrations
          </Link>
        </nav>
      </footer>
    </div>
  );
}
