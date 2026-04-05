import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// -- CPL language definition (matches landing page) --

const cplLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match(/^"([^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^#\{[a-zA-Z_][a-zA-Z0-9_]*\}/)) return "atom";
    if (stream.match(/^\[[a-zA-Z_][a-zA-Z0-9_]*\]/)) return "attributeName";
    if (stream.match(/^\{[a-zA-Z_][a-zA-Z0-9_]*\}/)) return "attributeValue";
    if (stream.match(/^@[a-zA-Z_][a-zA-Z0-9_]*/)) return "annotation";
    if (stream.match(/^-when\b|^-else\b|^-until\b|^-step\b/)) return "keyword";
    if (stream.match(/^guarantee\b|^workflow\b/)) return "keyword";
    if (stream.match(/^\|\|?|^&&|^!|^:|^=|^\(|^\)/)) return "operator";
    if (stream.match(/^(true|false|null)\b/)) return "bool";
    if (stream.match(/^[0-9]+\b/)) return "number";
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) return "variableName";

    stream.next();
    return null;
  },
});

const cplHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#2dd4bf" },
  { tag: tags.string, color: "#93e0fb" },
  { tag: tags.number, color: "#93e0fb" },
  { tag: tags.bool, color: "#93e0fb" },
  { tag: tags.annotation, color: "#fdad5c" },
  { tag: tags.operator, color: "#a0a0a0" },
  { tag: tags.atom, color: "#2dd4bf" },
  { tag: tags.attributeName, color: "#b9a1fa" },
  { tag: tags.attributeValue, color: "#93e0fb" },
  { tag: tags.variableName, color: "#f0f0f0" },
]);

const darkTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "#f0f0f0",
    fontSize: "13px",
    fontFamily: '"SF Mono", "Menlo", "Consolas", monospace',
    height: "100%",
  },
  ".cm-content": {
    padding: "60px 24px 24px",
    caretColor: "#2dd4bf",
  },
  ".cm-cursor": {
    borderLeftColor: "#2dd4bf",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(45, 212, 191, 0.2) !important",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.6",
  },
});

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function CodeEditor({ value, onChange }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          darkTheme,
          cplLanguage,
          syntaxHighlighting(cplHighlightStyle),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.lineWrapping,
          keymap.of([]),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g. switching from Flow to Code)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={containerRef} className="code-editor" />;
}
