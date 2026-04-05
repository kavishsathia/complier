import { useState, useEffect } from "react";
import * as bridge from "../lib/bridge.ts";

interface SettingsProps {
  ollamaUrl: string;
  ollamaModel: string;
  onSave: (url: string, model: string) => void;
  onClose: () => void;
}

export default function Settings({
  ollamaUrl,
  ollamaModel,
  onSave,
  onClose,
}: SettingsProps) {
  const [url, setUrl] = useState(ollamaUrl);
  const [model, setModel] = useState(ollamaModel);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    bridge.listOllamaModels(url).then(setModels);
  }, [url]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="settings-title">Settings</h2>
        <div className="settings-field">
          <label>
            <span className="config-label">Ollama URL</span>
            <input
              className="config-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        </div>
        <div className="settings-field">
          <label>
            <span className="config-label">Model</span>
            {models.length > 0 ? (
              <select
                className="config-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="config-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. gemma4"
              />
            )}
          </label>
        </div>
        <div className="settings-actions">
          <button className="settings-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="settings-btn-primary"
            onClick={() => onSave(url, model)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
