import { useEffect, useRef } from "react";
import { LOW, offered, RESTOCK } from "./machine";
import type { State } from "./state";

function Nodes({ nodes, current }: { nodes: string[]; current: string }) {
  return (
    <div className="nodes">
      {nodes.map((n, i) => (
        <span key={n} className="pair">
          {i > 0 && <span className="arrow">→</span>}
          <span className={`node${n === current ? " current" : ""}`}>{n}</span>
        </span>
      ))}
    </div>
  );
}

export default function Panel({ state, reset }: { state: State; reset: () => void }) {
  const { m, trace } = state;
  const list = useRef<HTMLOListElement>(null);
  const band = m.stock === 0 ? "n = 0" : m.stock <= LOW ? `n ≤ ${LOW}` : `n > ${LOW}`;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [trace.length]);

  return (
    <div className="panel">
      <header>
        <span className="title">CSP state machine</span>
        <span className="steps">step {trace.length}</span>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </header>

      <div className="spec">
        <p>
          Shopper = ask?q → (buy!q → Shopper ⊓ cancel → Shopper)
        </p>
        <p>
          Inventory(n) = buy?q:{"{"}1..n{"}"} → Inventory(n − q)
        </p>
        <p className="cont">□ n ≤ {LOW} &amp; low → Inventory(n)</p>
        <p className="cont">□ restock?k → Inventory(n + k)</p>
        <p>Supplier = low → restock!{RESTOCK} → Supplier</p>
        <p>
          System = Shopper ‖<sub>{"{"}buy{"}"}</sub> Inventory ‖
          <sub>{"{"}low, restock{"}"}</sub> Supplier
        </p>
      </div>

      <div className="procs">
        <div className="proc">
          <span className="name">Shopper</span>
          <Nodes nodes={["Idle", "Buying"]} current={m.shopper === "idle" ? "Idle" : "Buying"} />
          <span className="param">{m.q !== null ? `q = ${m.q}` : " "}</span>
        </div>
        <div className="proc">
          <span className="name">Inventory({m.stock})</span>
          <Nodes nodes={[`n > ${LOW}`, `n ≤ ${LOW}`, "n = 0"]} current={band} />
          <span className="param">n = {m.stock}</span>
        </div>
        <div className="proc">
          <span className="name">Supplier</span>
          <Nodes
            nodes={["Idle", "Ordering"]}
            current={m.supplier === "idle" ? "Idle" : "Ordering"}
          />
          <span className="param"> </span>
        </div>
      </div>

      <div className="offered">
        <span className="label">Offered</span>
        {offered(m).map((e) => (
          <code key={e}>{e}</code>
        ))}
      </div>

      <div className="trace">
        <span className="label">Trace</span>
        <ol ref={list}>
          {trace.length === 0 && <li className="empty">No events yet</li>}
          {trace.map((t) => (
            <li key={t.n} className={t.ok ? "ok" : "refused"}>
              <span className="n">{t.n}</span>
              <code>{t.label}</code>
              <span className="actor">{t.actor}</span>
              <span className="verdict">{t.ok ? "accepted" : `refused · ${t.reason}`}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
