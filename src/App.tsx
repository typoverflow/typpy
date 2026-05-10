import { useEffect, useState } from "react";
import { Welcome } from "./components/Welcome";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { MarkdownEditor } from "./components/Editor";
import { FrontMatterPanel } from "./components/FrontMatterPanel";
import { CommitDialog } from "./components/CommitDialog";
import { NewPostDialog } from "./components/NewPostDialog";
import { Toasts } from "./components/Toasts";
import { ImageOptionsButton } from "./components/ImageOptionsButton";
import { HugoLogPanel } from "./components/HugoLogPanel";
import { PreviewPane } from "./components/PreviewPane";
import { useApp, isDocDirty } from "./store/app";
import { api } from "./api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open as openDirDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Image as ImageIcon } from "lucide-react";

export default function App() {
  const bootstrap = useApp((s) => s.bootstrap);
  const repo = useApp((s) => s.repo);
  const doc = useApp((s) => s.openDoc);
  const settings = useApp((s) => s.settings);
  const setDocBody = useApp((s) => s.setDocBody);
  const setDocFm = useApp((s) => s.setDocFrontmatter);
  const saveDoc = useApp((s) => s.saveDoc);
  const toast = useApp((s) => s.toast);
  const openRepo = useApp((s) => s.openRepo);

  const [commitOpen, setCommitOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Apply theme: settings.theme = "system" follows OS, else explicit.
  useEffect(() => {
    function apply() {
      const pref = settings?.theme ?? "system";
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const isDark = pref === "dark" || (pref === "system" && mql.matches);
      document.documentElement.classList.toggle("dark", isDark);
    }
    apply();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [settings?.theme]);

  // Hugo server state + log listeners
  useEffect(() => {
    const unsubState = listen<{ running: boolean; port: number | null }>("hugo:state", (e) => {
      useApp.setState({ hugoServerPort: e.payload.running ? e.payload.port : null });
      if (!e.payload.running) {
        // If hugo died unexpectedly, surface logs so the user can debug.
        const logs = useApp.getState().hugoLogs;
        const hasErr = logs.slice(-15).some((l) => l.stream === "stderr");
        if (hasErr) useApp.getState().setHugoLogOpen(true);
      }
    });
    const unsubLog = listen<{ stream: "stdout" | "stderr" | "info"; line: string }>(
      "hugo:log",
      (e) => {
        useApp.getState().pushHugoLog({ stream: e.payload.stream, line: e.payload.line });
      },
    );
    return () => {
      unsubState.then((fn) => fn());
      unsubLog.then((fn) => fn());
    };
  }, []);

  // Cmd+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (doc && isDocDirty(doc)) saveDoc();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, saveDoc]);

  // Drop-image / paste-image handler
  async function handleImage(file: File): Promise<string | null> {
    if (!doc?.bundleDir) {
      toast("Open a page-bundle (folder/index.md) to add images.", "error");
      return null;
    }
    try {
      // We can't pass a File to Rust directly — write it to a tmp file first.
      const arr = await file.arrayBuffer();
      const tmp = await writeTempBlob(arr, file.name);
      const result = await api.image.import({
        src: tmp,
        bundleDir: doc.bundleDir,
        desiredStem: stem(file.name),
        options: settings?.image_defaults
          ? {
              max_width: settings.image_defaults.max_width ?? undefined,
              quality: settings.image_defaults.quality ?? undefined,
              format: (settings.image_defaults.format ?? "keep") as any,
            }
          : undefined,
      });
      // result.path is the relative filename inside bundle (we set it on the Rust side).
      const rel = result.path.toString();
      toast(`Imported ${rel} (${friendlyBytes(result.bytes_before)} → ${friendlyBytes(result.bytes_after)})`, "success");
      return rel;
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
      return null;
    }
  }

  if (!repo) {
    return (
      <div className="h-full">
        <Welcome />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-stone-50 dark:bg-stone-950">
      <TopBar onCommit={() => setCommitOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar onNewPost={() => setNewOpen(true)} />
        <main className="flex min-w-0 flex-1 flex-col">
          {doc ? (
            <>
              <DocHeader />
              <FrontMatterPanel doc={doc} onChange={setDocFm} />
              <div className="flex items-center justify-end gap-2 border-b border-stone-200 bg-stone-50/50 px-4 py-1 dark:border-stone-800 dark:bg-stone-900/30">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <ImageIcon size={11} className="-mt-0.5 mr-1 inline" />
                  drag images here · auto-compresses
                </span>
                <ImageOptionsButton />
              </div>
              <MarkdownEditor
                doc={{ path: doc.path, body: doc.body, bundleDir: doc.bundleDir }}
                onChange={setDocBody}
                onImageDrop={handleImage}
                onPasteImage={handleImage}
              />
            </>
          ) : (
            <EmptyState onOpen={async () => {
              const dir = await openDirDialog({ directory: true, multiple: false });
              if (typeof dir === "string") await openRepo(dir);
            }} />
          )}
        </main>
        <PreviewPane />
      </div>
      <HugoLogPanel />
      {commitOpen && <CommitDialog onClose={() => setCommitOpen(false)} />}
      {newOpen && <NewPostDialog onClose={() => setNewOpen(false)} />}
      <Toasts />
    </div>
  );
}

function DocHeader() {
  const doc = useApp((s) => s.openDoc);
  const repo = useApp((s) => s.repo);
  if (!doc || !repo) return null;
  const dirty = isDocDirty(doc);
  const relPath = doc.path.startsWith(repo.root) ? doc.path.slice(repo.root.length + 1) : doc.path;
  return (
    <div className="flex items-center gap-2 border-b border-stone-200 bg-white/50 px-6 py-2 text-xs text-stone-500 backdrop-blur dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-400">
      <span className="truncate font-mono">{relPath}</span>
      {dirty && <span className="inline-block size-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
    </div>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-stone-500 dark:text-stone-400">
      <div className="text-sm">Select a post from the sidebar to start editing.</div>
      <button
        onClick={onOpen}
        className="no-drag mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        <FolderOpen size={12} />
        Open another project
      </button>
    </div>
  );
}

// --- helpers ---

async function writeTempBlob(arr: ArrayBuffer, originalName: string): Promise<string> {
  const target = await api.fs.tempPath(originalName);
  await api.fs.writeBytes(target, new Uint8Array(arr));
  return target;
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function friendlyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

