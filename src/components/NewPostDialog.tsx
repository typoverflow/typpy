import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApp } from "../store/app";
import { api } from "../api/tauri";

interface Props {
  onClose: () => void;
}

export function NewPostDialog({ onClose }: Props) {
  const repo = useApp((s) => s.repo);
  const tree = useApp((s) => s.tree);
  const refreshTree = useApp((s) => s.refreshTree);
  const openDocAt = useApp((s) => s.openDocAt);
  const toast = useApp((s) => s.toast);

  const sections = useMemo(() => {
    return (tree ?? []).filter((n) => n.kind === "section").map((n) => n.name);
  }, [tree]);

  const [section, setSection] = useState(sections[0] ?? "post");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  function suggestedSlug(t: string): string {
    const s = t.trim().toLowerCase();
    if (!s) return "";
    const ascii = s
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (ascii) return ascii;
    // CJK or other non-ascii title — use today's date as fallback.
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }

  async function submit() {
    if (!repo) return;
    const finalSlug = slug.trim() || suggestedSlug(title);
    const finalSection = section.trim();
    if (!finalSlug || !finalSection || !title.trim()) {
      toast("Section, title, and slug are required", "error");
      return;
    }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fm: Record<string, unknown> = {
        title: title.trim(),
        description: "",
        date: today,
        draft: true,
      };
      const path = await api.post.create({
        repoRoot: repo.root,
        section: finalSection,
        slug: finalSlug,
        frontmatter: fm,
      });
      await refreshTree();
      await openDocAt(path);
      toast("Created", "success");
      onClose();
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm">
      <div className="w-[32rem] max-w-[90%] rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-4 text-sm font-semibold">New post</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
              Section
            </label>
            <input
              type="text"
              list="section-suggestions"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
            <datalist id="section-suggestions">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => {
                const t = e.target.value;
                setTitle(t);
                if (!slug || slug === suggestedSlug(title)) setSlug(suggestedSlug(t));
              }}
              className="w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
              Slug <span className="font-normal text-stone-400">(folder name)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-post"
              className="w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </div>
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
            disabled={busy || !title.trim()}
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
