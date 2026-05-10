import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApp } from "../store/app";
import { api } from "../api/tauri";
import { cn } from "../lib/cn";

interface Props {
  onClose: () => void;
}

export function CommitDialog({ onClose }: Props) {
  const repo = useApp((s) => s.repo);
  const git = useApp((s) => s.git);
  const refreshGit = useApp((s) => s.refreshGit);
  const toast = useApp((s) => s.toast);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (git) setSelected(new Set(git.files.map((f) => f.path)));
  }, [git]);

  const allFiles = git?.files ?? [];
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of allFiles) {
      counts[f.status] = (counts[f.status] ?? 0) + 1;
    }
    return counts;
  }, [allFiles]);

  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function submit() {
    if (!repo || selected.size === 0 || !message.trim()) return;
    setBusy(true);
    try {
      await api.git.commit({
        repoRoot: repo.root,
        files: Array.from(selected),
        message: message.trim(),
      });
      toast("Committed", "success");
      await refreshGit();
      onClose();
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm">
      <div className="w-[36rem] max-w-[90%] rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Commit changes</h2>
          <div className="text-xs text-stone-500 dark:text-stone-400">
            {Object.entries(stats)
              .map(([k, v]) => `${v} ${k}`)
              .join(" · ")}
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800">
          {allFiles.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-stone-500 dark:text-stone-400">
              Nothing to commit.
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {allFiles.map((f) => (
                <li key={f.path} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    className="size-4 rounded border-stone-300 text-accent-600 focus:ring-accent-500 dark:border-stone-700 dark:bg-stone-900"
                  />
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                      f.status === "added" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
                      f.status === "modified" && "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
                      f.status === "deleted" && "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
                      f.status === "untracked" && "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
                    )}
                  >
                    {f.status[0].toUpperCase()}
                  </span>
                  <span className="truncate font-mono text-xs">{f.path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Commit message"
          className="mt-3 w-full resize-y rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="no-drag rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || selected.size === 0 || !message.trim()}
            className="no-drag inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-100"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Commit {selected.size}
          </button>
        </div>
      </div>
    </div>
  );
}
