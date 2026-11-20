// The frame the pattern pages share: the site's header and footer, and the pattern pages' own tabs.

import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Nav from "../_landing/Nav";
import mascot from "../controllable-chaos.png";
import { PATTERNS } from "./_data/patterns.ts";
import Tabs from "./tabs";
import "../_landing/landing.css";
import "../get-started/get-started.css";
import "./patterns.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const REPO = "https://github.com/kavishsathia/complier";

export default function Shell({ current, children }: { current: string; children: React.ReactNode }) {
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

      <main id="main" className="gs pt">
        <Tabs>
          <Link href="/patterns" prefetch={false} aria-current={current === "" ? "page" : undefined} className={current === "" ? "is-on" : undefined}>
            All patterns
          </Link>
          {PATTERNS.map((p) => (
            <Link
              key={p.slug}
              href={`/patterns/${p.slug}`}
              prefetch={false}
              aria-current={p.slug === current ? "page" : undefined}
              className={p.slug === current ? "is-on" : undefined}
            >
              {p.name}
            </Link>
          ))}
        </Tabs>
        {children}
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
          <Link href="/illustrations" prefetch={false}>
            Illustrations
          </Link>
        </nav>
      </footer>
    </div>
  );
}
