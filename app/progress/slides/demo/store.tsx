import { useEffect, useRef, useState } from "react";
import { PRICE } from "./machine";
import type { State } from "./state";

const CAPACITY = 10;

export default function Store({
  state,
  send,
}: {
  state: State;
  send: (text: string) => void;
}) {
  const { m, chat } = state;
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const messages = chat.filter((c) => c.from !== "supplier");
  const supplierNote = [...chat].reverse().find((c) => c.from === "supplier");

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="store">
      <header>
        <span className="brand">Cube Shop</span>
        <span className="eyebrow">17 · Progress and initial results</span>
      </header>

      <div className="product">
        <div className="stage">
          <div className="cube">
            {["front", "back", "right", "left", "top", "bottom"].map((f) => (
              <span key={f} className={f} />
            ))}
          </div>
        </div>
        <div className="info">
          <h3>Tungsten Cube</h3>
          <p className="desc">Solid tungsten. One inch. Unreasonably heavy.</p>
          <p className="price">
            {PRICE} <span>cr</span>
          </p>
          <div className="stock">
            <div className="meter" aria-hidden="true">
              {Array.from({ length: CAPACITY }, (_, i) => (
                <span key={i} className={i < m.stock ? "on" : undefined} />
              ))}
            </div>
            <span className="count">
              <strong>{m.stock}</strong> in stock
            </span>
          </div>
        </div>
      </div>

      <div className={`supplier ${m.supplier}`}>
        <span className="dot" />
        <span className="who">Supplier agent</span>
        <span className="what">
          {m.supplier === "ordering"
            ? supplierNote?.text
            : supplierNote
              ? `Idle · ${supplierNote.text}`
              : "Idle · wakes when stock runs low"}
        </span>
      </div>

      <div className="chat">
        <div className="log" ref={log}>
          {messages.map((c, i) => (
            <p key={i} className={c.from}>
              {c.text}
            </p>
          ))}
          {m.shopper === "buying" && <p className="agent typing">…</p>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            send(draft.trim());
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            placeholder="Ask the shop agent, e.g. “buy 2 cubes”"
          />
        </form>
      </div>
    </div>
  );
}
