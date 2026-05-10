import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe, RotateCw, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../store/app";

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 320;
const EDITOR_MIN_WIDTH = 480;

/** Derive a Hugo URL path from a content file path. Mirrors Hugo's default permalink scheme. */
function deriveUrlPath(repoRoot: string, docPath: string, frontmatter: Record<string, unknown>): string {
  // If front matter has explicit url, use it.
  const url = typeof frontmatter.url === "string" ? frontmatter.url : null;
  if (url) return url.startsWith("/") ? url : `/${url}`;

  const rel = docPath.startsWith(repoRoot) ? docPath.slice(repoRoot.length) : docPath;
  const norm = rel.replace(/^\/+/, "").replace(/^content\//, "");
  let withoutFile = norm;
  if (norm.endsWith("/index.md") || norm.endsWith("/_index.md")) {
    withoutFile = norm.replace(/\/_?index\.md$/, "");
  } else if (norm.endsWith(".md")) {
    withoutFile = norm.replace(/\.md$/, "");
  }

  // If front matter has `slug`, use it as the leaf.
  const slug = typeof frontmatter.slug === "string" && frontmatter.slug ? frontmatter.slug : null;
  if (slug) {
    const parts = withoutFile.split("/");
    parts[parts.length - 1] = slug;
    withoutFile = parts.join("/");
  }

  return `/${withoutFile}/`.replace(/\/+/g, "/");
}

export function PreviewPane() {
  const open = useApp((s) => s.previewOpen);
  const setOpen = useApp((s) => s.setPreviewOpen);
  const port = useApp((s) => s.hugoServerPort);
  const startHugo = useApp((s) => s.startHugo);
  const repo = useApp((s) => s.repo);
  const doc = useApp((s) => s.openDoc);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [bust, setBust] = useState(0);

  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem("typpy.previewPane.width");
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH;
  });
  useEffect(() => {
    localStorage.setItem("typpy.previewPane.width", String(width));
  }, [width]);

  // Clamp the width if the user resizes the window smaller than the current pane.
  useEffect(() => {
    function clamp() {
      const max = Math.max(MIN_WIDTH, window.innerWidth - EDITOR_MIN_WIDTH);
      setWidth((w) => Math.min(w, max));
    }
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const dragState = useRef<{ startX: number; startW: number } | null>(null);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Prevent iframe from stealing mousemove events.
    if (iframeRef.current) iframeRef.current.style.pointerEvents = "none";
    function onMove(ev: MouseEvent) {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      const maxW = Math.max(MIN_WIDTH, window.innerWidth - EDITOR_MIN_WIDTH);
      const next = Math.min(maxW, Math.max(MIN_WIDTH, dragState.current.startW + delta));
      setWidth(next);
    }
    function onUp() {
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (iframeRef.current) iframeRef.current.style.pointerEvents = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  const urlPath = useMemo(() => {
    if (!repo || !doc) return "/";
    return deriveUrlPath(repo.root, doc.path, doc.frontmatter);
  }, [repo, doc]);

  const fullUrl = port ? `http://localhost:${port}${urlPath}` : null;

  // Re-load iframe on save (when pristine matches body — implies a save just happened) and on doc change.
  useEffect(() => {
    if (!open || !fullUrl || !iframeRef.current) return;
    iframeRef.current.src = `${fullUrl}?_=${bust}`;
  }, [open, fullUrl, bust]);

  // Auto-refresh on doc save.
  useEffect(() => {
    if (!doc) return;
    setBust((b) => b + 1);
  }, [doc?.pristine.body, doc?.pristine.frontmatter]);

  if (!open) return null;

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
      style={{ width }}
    >
      <div
        onMouseDown={onDragStart}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        className="group absolute inset-y-0 left-0 z-10 -ml-1 flex w-2 cursor-col-resize items-center justify-center"
        title="Drag to resize · double-click to reset"
      >
        <div className="h-12 w-0.5 rounded-full bg-stone-300 transition group-hover:bg-stone-500 dark:bg-stone-700 dark:group-hover:bg-stone-400" />
      </div>
      <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-1.5 dark:border-stone-800">
        <Globe size={14} className={port ? "text-emerald-500" : "text-stone-400"} />
        <span className="truncate font-mono text-xs text-stone-700 dark:text-stone-300">
          {fullUrl ?? "Hugo server not running"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {fullUrl && (
            <>
              <button
                onClick={() => setBust((b) => b + 1)}
                className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                title="Reload"
              >
                <RotateCw size={13} />
              </button>
              <button
                onClick={() => openUrl(fullUrl)}
                className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                title="Open in browser"
              >
                <ExternalLink size={13} />
              </button>
            </>
          )}
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            title="Close preview"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 bg-stone-100 dark:bg-stone-950">
        {fullUrl ? (
          <iframe
            ref={iframeRef}
            className="size-full border-0"
            src={`${fullUrl}?_=${bust}`}
            title="Preview"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-stone-500 dark:text-stone-400">
            <Globe size={28} strokeWidth={1.5} />
            <div>Start the Hugo server to see your post rendered with the theme.</div>
            <button
              onClick={() => startHugo()}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-100"
            >
              Start Hugo
            </button>
            <button
              onClick={() => useApp.getState().setHugoLogOpen(true)}
              className="text-xs underline-offset-2 hover:underline"
            >
              Show Hugo logs
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
