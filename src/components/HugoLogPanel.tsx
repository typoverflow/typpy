import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { useApp } from "../store/app";
import { cn } from "../lib/cn";

const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 80;
const HEADER_HEIGHT = 32;

export function HugoLogPanel() {
  const open = useApp((s) => s.hugoLogOpen);
  const setOpen = useApp((s) => s.setHugoLogOpen);
  const logs = useApp((s) => s.hugoLogs);
  const clear = useApp((s) => s.clearHugoLogs);
  const endRef = useRef<HTMLDivElement | null>(null);

  const [height, setHeight] = useState(() => {
    const stored = localStorage.getItem("typy.hugoLog.height");
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("typy.hugoLog.collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("typy.hugoLog.height", String(height));
  }, [height]);
  useEffect(() => {
    localStorage.setItem("typy.hugoLog.collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs, collapsed]);

  const dragState = useRef<{ startY: number; startH: number } | null>(null);
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragState.current = { startY: e.clientY, startH: height };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      function onMove(ev: MouseEvent) {
        if (!dragState.current) return;
        const delta = dragState.current.startY - ev.clientY;
        const maxH = Math.max(MIN_HEIGHT, window.innerHeight - 120);
        const next = Math.min(maxH, Math.max(MIN_HEIGHT, dragState.current.startH + delta));
        setHeight(next);
        if (collapsed) setCollapsed(false);
      }
      function onUp() {
        dragState.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, collapsed],
  );

  const onDoubleClickHandle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  if (!open) return null;
  const effectiveHeight = collapsed ? HEADER_HEIGHT : height;
  const errCount = logs.filter((l) => l.stream === "stderr").length;

  return (
    <div
      className="relative flex flex-col border-t border-stone-200 bg-stone-950/95 text-stone-100 dark:border-stone-800"
      style={{ height: effectiveHeight }}
    >
      {/* Drag handle (top edge) */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={onDoubleClickHandle}
        className="group absolute inset-x-0 top-0 z-10 -mt-1 flex h-2 cursor-row-resize items-center justify-center"
        title="Drag to resize · double-click to collapse"
      >
        <div className="h-0.5 w-12 rounded-full bg-stone-700 transition group-hover:bg-stone-400" />
      </div>

      <div
        className="flex h-8 shrink-0 items-center gap-2 border-b border-stone-800 px-3"
        onDoubleClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">Hugo logs</span>
        <span className="text-xs text-stone-500">{logs.length} lines</span>
        {errCount > 0 && (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
            {errCount} error{errCount === 1 ? "" : "s"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={clear}
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            title="Clear"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            title="Close panel"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-stone-500">No output yet. Click Start Hugo to run `hugo server`.</div>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "whitespace-pre-wrap",
                  l.stream === "stderr" && "text-rose-300",
                  l.stream === "info" && "text-stone-400",
                )}
              >
                {l.line}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
