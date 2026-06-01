import { createContext, useContext, useMemo, useState } from "react";
import {
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/app";
import type { ContentNode } from "../api/tauri";
import { NewPostDialog } from "./NewPostDialog";
import { NewSectionDialog } from "./NewSectionDialog";
import { ConfirmDialog } from "./ConfirmDialog";

interface RowActions {
  newPost: (section: string) => void;
  newSection: (parent: string) => void;
  remove: (node: ContentNode) => void;
  sectionRel: (node: ContentNode) => string;
}

const RowActionsContext = createContext<RowActions | null>(null);

export function Sidebar() {
  const tree = useApp((s) => s.tree);
  const loading = useApp((s) => s.treeLoading);
  const refresh = useApp((s) => s.refreshTree);
  const deleteNode = useApp((s) => s.deleteNode);
  const repo = useApp((s) => s.repo);
  const [filter, setFilter] = useState("");

  // Dialog state.
  const [newPost, setNewPost] = useState<{ section?: string } | null>(null);
  const [newSection, setNewSection] = useState<{ parent?: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ContentNode | null>(null);

  const filtered = useMemo(() => {
    if (!tree) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return tree;
    return tree.map((n) => filterNode(n, q)).filter(Boolean) as ContentNode[];
  }, [tree, filter]);

  // Relative path of a section under content/ (e.g. "blog/travel").
  function sectionRel(node: ContentNode): string {
    const prefix = repo ? `${repo.root}/content/` : "";
    const p = node.path.replace(/\\/g, "/");
    return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : node.name;
  }

  const actions: RowActions = {
    newPost: (section) => setNewPost({ section }),
    newSection: (parent) => setNewSection({ parent }),
    remove: (node) => setPendingDelete(node),
    sectionRel,
  };

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
          onClick={() => setNewSection({ parent: "" })}
          title="New section"
        >
          <FolderPlus size={14} />
        </button>
        <button
          className="no-drag rounded-md p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          onClick={() => setNewPost({})}
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
            <RowActionsContext.Provider value={actions}>
              <ul className="space-y-0.5">
                {filtered.map((n) => (
                  <TreeRow key={n.path} node={n} depth={0} />
                ))}
              </ul>
            </RowActionsContext.Provider>
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

      {newPost && (
        <NewPostDialog initialSection={newPost.section} onClose={() => setNewPost(null)} />
      )}
      {newSection && (
        <NewSectionDialog parent={newSection.parent} onClose={() => setNewSection(null)} />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === "section" ? "Delete section" : "Delete post"}
          message={deleteMessage(pendingDelete)}
          onConfirm={() => deleteNode(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

function deleteMessage(node: ContentNode): string {
  const label = node.title ?? node.name;
  if (node.kind === "section") {
    return `Delete the section “${label}” and everything inside it? This permanently removes all posts and assets in this folder. This cannot be undone.`;
  }
  if (node.kind === "bundle") {
    return `Delete “${label}”? This permanently removes the post folder and its images. This cannot be undone.`;
  }
  return `Delete “${label}”? This cannot be undone.`;
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

function IconAction({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={cn(
        "no-drag rounded p-1 text-stone-400 transition",
        danger
          ? "hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
          : "hover:bg-stone-300/60 hover:text-stone-700 dark:hover:bg-stone-700/60 dark:hover:text-stone-200",
      )}
    >
      {children}
    </button>
  );
}

function TreeRow({ node, depth }: { node: ContentNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const openDoc = useApp((s) => s.openDocAt);
  const current = useApp((s) => s.openDoc?.path);
  const actions = useContext(RowActionsContext);
  const isOpen = current === node.path;

  if (node.kind === "section") {
    const rel = actions?.sectionRel(node) ?? node.name;
    return (
      <li>
        <div
          className="no-drag group flex items-center rounded-md text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/60"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm"
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
          <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <IconAction title="New post here" onClick={() => actions?.newPost(rel)}>
              <FilePlus size={13} />
            </IconAction>
            <IconAction title="New subsection" onClick={() => actions?.newSection(rel)}>
              <FolderPlus size={13} />
            </IconAction>
            <IconAction title="Delete section" danger onClick={() => actions?.remove(node)}>
              <Trash2 size={13} />
            </IconAction>
          </div>
        </div>
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
      <div
        className={cn(
          "no-drag group flex items-start rounded-md",
          isOpen
            ? "bg-accent-500/15 text-stone-900 dark:bg-accent-500/20 dark:text-stone-100"
            : "text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/60",
        )}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        <button
          onClick={() => openDoc(node.path)}
          className="flex min-w-0 flex-1 items-start gap-1.5 py-1 text-left text-sm"
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
        <div className="flex shrink-0 items-center gap-0.5 pr-1 pt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <IconAction title="Delete post" danger onClick={() => actions?.remove(node)}>
            <Trash2 size={13} />
          </IconAction>
        </div>
      </div>
    </li>
  );
}

function formatDate(d: string): string {
  // Trim time component if it's present.
  return d.length > 10 ? d.slice(0, 10) : d;
}
