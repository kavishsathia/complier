import { useState, useRef, useEffect } from "react";

interface InlineEditProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export default function InlineEdit({ value, placeholder = "...", onChange }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, value]);

  function commit() {
    setEditing(false);
    if (draft !== value) onChange(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="inline-edit-input nodrag nopan nowheel"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="inline-edit nodrag nopan"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="inline-edit-text">{value || placeholder}</span>
      <span className="inline-edit-pencil">&#9998;</span>
    </span>
  );
}
