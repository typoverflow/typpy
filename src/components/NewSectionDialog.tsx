import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useApp } from "../store/app";

interface Props {
  /** Relative path of the parent section, or "" for a top-level section. */
  parent?: string;
  onClose: () => void;
}

export function NewSectionDialog({ parent = "", onClose }: Props) {
  const createSection = useApp((s) => s.createSection);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function sanitize(n: string): string {
    return n
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function submit() {
    const finalName = sanitize(name);
    if (!finalName) {
      toast("A section name is required", "error");
      return;
    }
    setBusy(true);
    try {
      await createSection(parent, finalName);
      onClose();
    } catch {
      // Error already surfaced via toast; keep dialog open.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm">
      <div className="w-[28rem] max-w-[90%] rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-1 text-sm font-semibold">New section</h2>
        <p className="mb-4 text-xs text-stone-500 dark:text-stone-400">
          Inside <span className="font-mono">content/{parent ? parent + "/" : ""}</span>
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
            Name <span className="font-normal text-stone-400">(folder name)</span>
          </label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="travel"
            className="w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          />
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="no-drag rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="no-drag inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-100"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
