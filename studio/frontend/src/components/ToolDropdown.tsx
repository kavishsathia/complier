import { useState, useRef, useEffect } from "react";
import type { MCPToolInfo } from "../types.ts";

interface ToolGroup {
  serverName: string;
  tools: MCPToolInfo[];
}

interface ToolDropdownProps {
  groups: ToolGroup[];
  value: string;
  onSelect: (toolName: string) => void;
}

export default function ToolDropdown({ groups, value, onSelect }: ToolDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const lowerSearch = search.toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      tools: g.tools.filter(
        (t) =>
          t.name.toLowerCase().includes(lowerSearch) ||
          (t.description ?? "").toLowerCase().includes(lowerSearch)
      ),
    }))
    .filter((g) => g.tools.length > 0);

  function handleSelect(toolName: string) {
    onSelect(toolName);
    setSearch("");
    setOpen(false);
  }

  return (
    <div className="tool-dropdown" ref={containerRef}>
      <button
        ref={triggerRef}
        className="tool-dropdown-trigger"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className={value ? "tool-dropdown-value" : "tool-dropdown-placeholder"}>
          {value || "Select a tool..."}
        </span>
        <span className="tool-dropdown-arrow">{open ? "\u25B4" : "\u25BE"}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="tool-dropdown-menu"
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
          <input
            ref={inputRef}
            className="tool-dropdown-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <div className="tool-dropdown-list">
            {filtered.length === 0 && (
              <div className="tool-dropdown-empty">No tools found</div>
            )}
            {filtered.map((g) => (
              <div key={g.serverName} className="tool-dropdown-group">
                <div className="tool-dropdown-group-label">{g.serverName}</div>
                {g.tools.map((t) => (
                  <button
                    key={t.name}
                    className={`tool-dropdown-item${t.name === value ? " tool-dropdown-item--active" : ""}`}
                    onClick={() => handleSelect(t.name)}
                    type="button"
                  >
                    <span className="tool-dropdown-item-name">{t.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
