"use client";

// The header's links. On a phone they fold into a menu behind a button, which comes first so Tab
// goes from it into the open menu; Escape, a tap outside or following a link closes it. Wider
// screens show the list as it is and never see the button.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function Nav({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <nav aria-label="Main" ref={ref} className={open ? "is-open" : undefined}>
      <button
        ref={toggle}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
          <path
            d={open ? "M5 5l10 10M15 5L5 15" : "M3 6h14M3 10h14M3 14h14"}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        Menu
      </button>
      <ul id="nav-menu">
        <li>
          <Link href="/playground" prefetch={false} onClick={close}>
            Playground
          </Link>
        </li>
        <li className="nav-mid">
          <a href="#how" onClick={close}>
            How it works
          </a>
        </li>
        <li>
          <a href="#get-started" onClick={close}>
            Get started
          </a>
        </li>
        <li className="nav-wide">
          <Link href="/progress" prefetch={false} onClick={close}>
            Research
          </Link>
        </li>
      </ul>
      <a href={repo} className="nav-gh" aria-label="complier on GitHub">
        <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
    </nav>
  );
}
