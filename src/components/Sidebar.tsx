import { useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Plus, RefreshCcw } from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/app";
import type { ContentNode } from "../api/tauri";

interface SidebarProps {
  onNewPost: () => void;
}

export function Sidebar({ onNewPost }: SidebarProps) {
  const tree = useApp((s) => s.tree);
  const loading = useApp((s) => s.treeLoading);
  const refresh = useApp((s) => s.refreshTree);
  const repo = useApp((s) => s.repo);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!tree) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return tree;
    return tree.map((n) => filterNode(n, q)).filter(Boolean) as ContentNode[];
  }, [tree, filter]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-stone-200 bg-stone-100/60 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="flex items-center gap-1 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {repo?.name ?? "Content"}
          </div>
        </div>
        <button
          className="no-drag rounded-md p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          onClick={() => refresh()}
          title="Refresh"
        >
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <button
          className="no-drag rounded-md p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          onClick={onNewPost}
          title="New post"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="px-3 py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="no-drag w-full rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm shadow-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {filtered ? (
          filtered.length ? (
            <ul className="space-y-0.5">
              {filtered.map((n) => (
                <TreeRow key={n.path} node={n} depth={0} />
              ))}
            </ul>
          ) : (
            <div className="px-3 py-4 text-center text-xs text-stone-500 dark:text-stone-400">
              {filter ? "No matches" : "No content yet — click + to create your first post."}
            </div>
          )
        ) : (
          <div className="px-3 py-4 text-center text-xs text-stone-500 dark:text-stone-400">
            {loading ? "Loading…" : "—"}
          </div>
        )}
      </div>
    </aside>
  );
}

function filterNode(n: ContentNode, q: string): ContentNode | null {
  const titleMatch = (n.title ?? "").toLowerCase().includes(q);
  const nameMatch = n.name.toLowerCase().includes(q);
  if (n.kind !== "section") {
    return titleMatch || nameMatch ? n : null;
  }
  const kept = n.children.map((c) => filterNode(c, q)).filter(Boolean) as ContentNode[];
  if (kept.length === 0 && !titleMatch && !nameMatch) return null;
  return { ...n, children: kept };
}

function TreeRow({ node, depth }: { node: ContentNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const openDoc = useApp((s) => s.openDocAt);
  const current = useApp((s) => s.openDoc?.path);
  const isOpen = current === node.path;

  if (node.kind === "section") {
    return (
      <li>
        <button
          onClick={() => setOpen((o) => !o)}
          className="no-drag flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/60"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <ChevronRight
            size={12}
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
          />
          {open ? (
            <FolderOpen size={14} className="shrink-0 text-stone-500 dark:text-stone-400" />
          ) : (
            <Folder size={14} className="shrink-0 text-stone-500 dark:text-stone-400" />
          )}
          <span className="truncate">{node.title ?? node.name}</span>
        </button>
        {open && node.children.length > 0 && (
          <ul className="space-y-0.5">
            {node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => openDoc(node.path)}
        className={cn(
          "no-drag group flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-sm",
          isOpen
            ? "bg-accent-500/15 text-stone-900 dark:bg-accent-500/20 dark:text-stone-100"
            : "text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/60",
        )}
        style={{ paddingLeft: 12 + depth * 12 }}
        title={node.path}
      >
        <FileText size={14} className="mt-0.5 shrink-0 text-stone-500 dark:text-stone-400" />
        <span className="min-w-0 flex-1">
          <div className="truncate font-medium">{node.title ?? node.name}</div>
          {node.date && (
            <div className="truncate text-[10px] text-stone-500 dark:text-stone-500">
              {formatDate(node.date)}
              {node.draft ? " · draft" : ""}
            </div>
          )}
        </span>
      </button>
    </li>
  );
}

function formatDate(d: string): string {
  // Trim time component if it's present.
  return d.length > 10 ? d.slice(0, 10) : d;
}
