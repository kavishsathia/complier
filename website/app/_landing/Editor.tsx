"use client";

// A plain textarea over a highlighted copy of its text. The textarea does all the editing, so
// keyboard, selection, undo and screen readers behave as they do anywhere; the layer underneath
// only paints. Both wrap the same way, so line numbers stay on their lines. On a phone neither
// wraps: the code keeps its indentation and scrolls sideways as one piece.

import { forwardRef, type ReactNode } from "react";

export type Language = "yaml" | "csp";

type Props = {
  id: string;
  label: string;
  language: Language;
  value: string;
  onChange: (v: string) => void;
  onEdit?: () => void;
  errorLines: number[];
  describedBy?: string;
};

const Editor = forwardRef<HTMLTextAreaElement, Props>(function Editor(
  { id, label, language, value, onChange, onEdit, errorLines, describedBy },
  ref,
) {
  const lines = value.split("\n");
  return (
    <div className="editor">
      <div className="editor-code">
        <div className="editor-layer" aria-hidden="true">
          {lines.map((line, i) => (
            <div key={i} className={`editor-line${errorLines.includes(i + 1) ? " has-error" : ""}`} data-n={i + 1}>
              {highlight(line, language)}
              {"​"}
            </div>
          ))}
        </div>
        <textarea
          ref={ref}
          id={id}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={errorLines.length > 0 || undefined}
          className="editor-input"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          onChange={(e) => {
            onChange(e.target.value);
            onEdit?.();
          }}
        />
      </div>
    </div>
  );
});

export default Editor;

const span = (cls: string, text: string, k: number) => (
  <span key={k} className={cls}>
    {text}
  </span>
);

function highlight(line: string, language: Language): ReactNode[] {
  return language === "yaml" ? yaml(line) : csp(line);
}

function yaml(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  // A comment starts at # at the line's start or after a space, outside quotes.
  let comment = -1;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      comment = i;
      break;
    }
  }
  const code = comment < 0 ? line : line.slice(0, comment);
  const key = /^(\s*(?:-\s+)?)([A-Za-z_][\w-]*)(:)(?=\s|$)/.exec(code);
  let rest = code;
  if (key) {
    out.push(key[1], span("tk-key", key[2], k++), span("tk-punct", key[3], k++));
    rest = code.slice(key[0].length);
    if (key[2] === "emit") {
      const m = /^(\s*)(\S+)(.*)$/.exec(rest);
      if (m) {
        out.push(m[1], span("tk-event", m[2], k++));
        rest = m[3];
      }
    }
  }
  for (const part of rest.split(/('[^']*'?|"[^"]*"?|&&|\|\||==|!=|>-)/)) {
    if (!part) continue;
    if (/^['"]/.test(part)) out.push(span("tk-string", part, k++));
    else if (/^(&&|\|\||==|!=|>-)$/.test(part)) out.push(span("tk-op", part, k++));
    else out.push(part);
  }
  if (comment >= 0) out.push(span("tk-comment", line.slice(comment), k++));
  return out;
}

function csp(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  const at = line.indexOf("--");
  const code = at < 0 ? line : line.slice(0, at);
  for (const part of code.split(/(\[\]|->|\|~\||\|\|\||[!?^~][a-z_]\w*|\b[A-Z][A-Za-z0-9_']*\b|\b(?:channel)\b|=)/)) {
    if (!part) continue;
    if (/^[!^][a-z_]/.test(part)) out.push(span("tk-event", part, k++));
    else if (/^[?~][a-z_]/.test(part)) out.push(span("tk-world", part, k++));
    else if (/^(STOP|SKIP|channel)$/.test(part)) out.push(span("tk-key", part, k++));
    else if (/^[A-Z]/.test(part)) out.push(span("tk-proc", part, k++));
    else if (/^(\[\]|->|\|~\||\|\|\||=)$/.test(part)) out.push(span("tk-op", part, k++));
    else out.push(part);
  }
  if (at >= 0) out.push(span("tk-comment", line.slice(at), k++));
  return out;
}
