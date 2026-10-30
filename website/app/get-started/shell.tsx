// The frame the three get-started pages share: the site's header and footer, the page title, and
// tabs between Install, Short run and Long run.

import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import Nav from "../_landing/Nav";
import mascot from "../controllable-chaos.png";
import "../_landing/landing.css";
import "./get-started.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const REPO = "https://github.com/kavishsathia/complier";

const PAGES = [
  { href: "/get-started", label: "1. Install" },
  { href: "/get-started/short", label: "2. Short run" },
  { href: "/get-started/long", label: "3. Long run" },
];

export default function Shell({ current, title, lede, children }: { current: string; title: string; lede: string; children: React.ReactNode }) {
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
        <nav className="gs-tabs" aria-label="Get started">
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href} prefetch={false} aria-current={p.href === current ? "page" : undefined} className={p.href === current ? "is-on" : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
        <header className="gs-head">
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
        </header>
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
          <Link href="/progress" prefetch={false}>
            Research
          </Link>
        </nav>
      </footer>
    </div>
  );
}
