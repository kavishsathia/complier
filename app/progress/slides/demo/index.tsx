"use client";

import { useEffect, useReducer } from "react";
import { LOW } from "./machine";
import { reducer, start } from "./state";
import Store from "./store";
import Panel from "./panel";

export default function Demo() {
  const [state, dispatch] = useReducer(reducer, start);
  const { m } = state;

  // The shop agent takes a moment between being asked and buying.
  useEffect(() => {
    if (m.shopper !== "buying") return;
    const t = setTimeout(() => dispatch({ type: "commit" }), 900);
    return () => clearTimeout(t);
  }, [m.shopper]);

  // The supplier agent wakes when the composition offers low.
  useEffect(() => {
    if (m.supplier !== "idle" || m.stock > LOW) return;
    const t = setTimeout(() => dispatch({ type: "low" }), 700);
    return () => clearTimeout(t);
  }, [m.supplier, m.stock]);

  useEffect(() => {
    if (m.supplier !== "ordering") return;
    const t = setTimeout(() => dispatch({ type: "restock" }), 3500);
    return () => clearTimeout(t);
  }, [m.supplier]);

  return (
    <section className="slide demo">
      <Store state={state} send={(text) => dispatch({ type: "user", text })} />
      <Panel state={state} reset={() => dispatch({ type: "reset" })} />
    </section>
  );
}
