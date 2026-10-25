import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Workbench from "../_landing/Workbench";
import mascot from "../controllable-chaos.png";
import "../_landing/landing.css";
import "./playground.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const REPO = "https://github.com/kavishsathia/complier";

export const metadata: Metadata = {
  title: "complier · playground",
  description:
    "Edit a translation unit and a contract, then run an agent's tool calls through the same checks complier's hook makes. Runs in your browser.",
};

// The live demo, given the whole window: a slim header, one line on what's happening, and the
// workbench filling the rest.
export default function Playground() {
  return (
    <div className={`landing playground ${sans.variable} ${mono.variable}`}>
      <header className="pg-head">
        <Link href="/" className="brand" aria-label="complier home">
          <Image src={mascot} alt="" width={30} height={32} priority />
          <span>complier</span>
        </Link>
        <span className="pg-title">Playground</span>
        <nav aria-label="Site" className="pg-nav">
          <Link href="/stepper" prefetch={false}>
            Stepper
          </Link>
          <a href={REPO}>GitHub</a>
        </nav>
      </header>
      <main className="pg-main">
        <h1 className="sr-only">complier playground</h1>
        <p className="pg-intro">
          A writer agent drafts a post in Notion, gets it reviewed and publishes it. Each call it attempts is checked as
          complier&apos;s pre-tool hook would: the translation names its event, the contract allows or refuses it, and only an
          allowed call goes on to run in the agent&apos;s harness. Everything here runs in your browser; nothing reaches Notion or a
          model.
        </p>
        <Workbench />
      </main>
    </div>
  );
}
