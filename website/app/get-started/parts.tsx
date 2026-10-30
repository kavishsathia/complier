"use client";

// Building blocks the three get-started pages share: copyable code blocks, numbered steps, notes.

import { useState } from "react";

export function Code({ children, label, wrap }: { children: string; label?: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is still there to select.
    }
  };
  return (
    <div className={`gs-code${wrap ? " is-wrapped" : ""}`}>
      <div className="gs-code-bar">
        <span className="gs-code-label">{label ?? "Terminal"}</span>
        <button type="button" className="gs-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy to clipboard"}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="gs-step" id={`step-${n}`}>
      <span className="gs-n" aria-hidden="true">
        {n}
      </span>
      <div className="gs-body">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

export function Note({ tone = "plain", children }: { tone?: "plain" | "warn"; children: React.ReactNode }) {
  return <div className={`gs-note is-${tone}`}>{children}</div>;
}
