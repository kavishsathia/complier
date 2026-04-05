import { useState, useRef, useEffect } from "react";
import * as bridge from "../lib/bridge.ts";

interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

interface ChatPanelProps {
  ollamaUrl: string;
  ollamaModel: string;
}

export default function ChatPanel({ ollamaUrl, ollamaModel }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const history = updated.map((m) => ({
        role: m.role === "tool" ? "assistant" : m.role,
        content: m.content,
      }));
      const result = await bridge.chat(ollamaUrl, ollamaModel, history);
      setMessages((prev) => [...prev, { role: "assistant", content: result }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">Chat</span>
        <span className="chat-header-model">{ollamaModel}</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Talk to {ollamaModel}. It has access to a generate_random_num tool.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            <div className="chat-msg-content">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-content chat-typing">Thinking...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="Message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="chat-send"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          &uarr;
        </button>
      </div>
    </div>
  );
}
