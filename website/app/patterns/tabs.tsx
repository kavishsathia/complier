"use client";

// The pattern tabs: one row that scrolls sideways when it doesn't fit, scrolled so the current
// pattern's tab is in view.

import { useEffect, useRef } from "react";

export default function Tabs({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const on = nav?.querySelector<HTMLElement>(".is-on");
    if (nav && on) nav.scrollLeft = on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  }, []);
  return (
    <nav className="pt-tabs" aria-label="Patterns" ref={ref}>
      {children}
    </nav>
  );
}
