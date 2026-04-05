interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function CodeEditor({ value, onChange }: CodeEditorProps) {
  return (
    <div className="code-editor">
      <textarea
        className="code-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={'workflow "MyWorkflow"\n    | my_tool'}
      />
    </div>
  );
}
