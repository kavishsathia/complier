"use client";

import { useEffect, useState } from "react";
import Title from "./slides/title";
import Motivation from "./slides/motivation";
import Problem from "./slides/problem";
import Assumptions from "./slides/assumptions";
import Related from "./slides/related";
import Tradeoff from "./slides/tradeoff";
import Approach from "./slides/approach";
import Fits from "./slides/fits";
import Demo from "./slides/demo";
import Plan from "./slides/plan";
import Outcome from "./slides/outcome";

export type SlideProps = { step: number };

// steps: how many arrow presses a slide takes before the deck moves on.
const slides: { Slide: React.ComponentType<SlideProps>; steps: number }[] = [
  { Slide: Title, steps: 1 },
  { Slide: Motivation, steps: 1 },
  { Slide: Problem, steps: 1 },
  { Slide: Assumptions, steps: 1 },
  { Slide: Related, steps: 2 },
  { Slide: Tradeoff, steps: 1 },
  { Slide: Approach, steps: 1 },
  { Slide: Fits, steps: 1 },
  { Slide: Demo, steps: 1 },
  { Slide: Plan, steps: 1 },
  { Slide: Outcome, steps: 1 },
];

const clamp = (i: number) => Math.min(Math.max(i, 0), slides.length - 1);

type Position = { slide: number; step: number };

function next({ slide, step }: Position): Position {
  if (step < slides[slide].steps - 1) return { slide, step: step + 1 };
  if (slide < slides.length - 1) return { slide: slide + 1, step: 0 };
  return { slide, step };
}

function prev({ slide, step }: Position): Position {
  if (step > 0) return { slide, step: step - 1 };
  if (slide > 0) return { slide: slide - 1, step: slides[slide - 1].steps - 1 };
  return { slide, step };
}

export default function Deck({ initial }: { initial: number }) {
  const [pos, setPos] = useState<Position>({ slide: clamp(initial), step: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let text fields keep their arrow keys, e.g. the demo's chat input.
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setPos(next);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setPos(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", `?s=${pos.slide + 1}`);
  }, [pos.slide]);

  const { Slide } = slides[pos.slide];
  return (
    <main className="deck">
      <Slide step={pos.step} />
    </main>
  );
}
