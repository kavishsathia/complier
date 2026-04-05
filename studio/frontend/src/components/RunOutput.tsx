interface RunOutputProps {
  output: string;
  onClose: () => void;
}

export default function RunOutput({ output, onClose }: RunOutputProps) {
  return (
    <div className="run-panel">
      <div className="run-panel-header">
        <h3 className="run-panel-title">Output</h3>
        <button className="run-panel-close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="run-panel-body">{output}</div>
    </div>
  );
}
