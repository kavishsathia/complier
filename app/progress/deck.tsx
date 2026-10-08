"use client";

import { useEffect, useState } from "react";
import Title from "./slides/title";

const slides = [Title];

const clamp = (i: number) => Math.min(Math.max(i, 0), slides.length - 1);

export default function Deck({ initial }: { initial: number }) {
  const [index, setIndex] = useState(clamp(initial));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => clamp(i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => clamp(i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", `?s=${index + 1}`);
  }, [index]);

  const Slide = slides[index];
  return (
    <main className="deck">
      <Slide />
    </main>
  );
}
