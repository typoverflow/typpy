import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Sparkles } from "lucide-react";
import { useApp } from "../store/app";

export function Welcome() {
  const settings = useApp((s) => s.settings);
  const openRepo = useApp((s) => s.openRepo);
  const toast = useApp((s) => s.toast);

  async function pick() {
    try {
      const dir = await open({ directory: true, multiple: false, title: "Open Hugo project" });
      if (typeof dir === "string") {
        await openRepo(dir);
      }
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    }
  }

  const recent = settings?.recent_repos ?? [];

  return (
    <div className="flex h-full items-center justify-center bg-stone-50 dark:bg-stone-950">
      <div className="w-[28rem] max-w-[90%] space-y-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-accent-500/10 p-4 text-accent-600 dark:text-accent-400">
            <Sparkles size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">typpy</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              A local editor for Hugo blogs.
            </p>
          </div>
        </div>

        <button
          onClick={pick}
          className="no-drag inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-100"
        >
          <FolderOpen size={16} />
          Open Hugo project…
        </button>

        {recent.length > 0 && (
          <div className="text-left">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Recent
            </div>
            <ul className="space-y-1">
              {recent.map((path) => (
                <li key={path}>
                  <button
                    onClick={() => openRepo(path)}
                    className="no-drag w-full truncate rounded-lg px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/60"
                    title={path}
                  >
                    <span className="font-medium">{path.split("/").pop()}</span>
                    <span className="ml-2 text-stone-400 dark:text-stone-500">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
