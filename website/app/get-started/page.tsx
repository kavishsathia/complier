import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Nav from "../_landing/Nav";
import mascot from "../controllable-chaos.png";
import Guide from "./Guide";
import "../_landing/landing.css";
import "./get-started.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "Get started | complier",
  description:
    "Install complier, prove a contract, and put your agent on it: step-by-step setup for Claude Code, with your own FDR.",
};

export default function GetStarted() {
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

      <main id="main" className="gs">
        <header className="gs-head">
          <h1>Get started</h1>
          <p className="lede">
            Install complier on your machine, prove a contract, and put your agent on it. About fifteen minutes, most
            of it waiting for builds.
          </p>
          <p className="gs-meta">A research project: macOS and Linux, built from source.</p>
        </header>

        <Guide />
      </main>

      <footer className="footer">
        <span className="footer-brand">complier</span>
        <nav aria-label="Footer">
          <a href={REPO}>GitHub</a>
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
