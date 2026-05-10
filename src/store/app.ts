import { create } from "zustand";
import { api, type ContentNode, type GitStatus, type HugoVersion, type PostDoc, type RepoInfo, type Settings } from "../api/tauri";

export interface OpenDoc {
  path: string;
  bundleDir: string | null;
  frontmatterKind: string;
  frontmatter: Record<string, unknown>;
  body: string;
  pristine: { frontmatter: string; body: string };
}

export interface ToastMsg {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export interface HugoLogEntry {
  id: number;
  stream: "stdout" | "stderr" | "info";
  line: string;
  ts: number;
}

interface AppState {
  settings: Settings | null;
  hugoVersion: HugoVersion | null;
  hugoServerPort: number | null;
  hugoLogs: HugoLogEntry[];
  hugoLogOpen: boolean;

  previewOpen: boolean;

  repo: RepoInfo | null;
  tree: ContentNode[] | null;
  treeLoading: boolean;

  openDoc: OpenDoc | null;
  docLoading: boolean;
  saving: boolean;

  git: GitStatus | null;
  gitLoading: boolean;

  toasts: ToastMsg[];

  pushHugoLog: (entry: Omit<HugoLogEntry, "id" | "ts">) => void;
  clearHugoLogs: () => void;
  setHugoLogOpen: (open: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  bootstrap: () => Promise<void>;
  openRepo: (path: string) => Promise<void>;
  closeRepo: () => void;
  refreshTree: () => Promise<void>;
  openDocAt: (path: string) => Promise<void>;
  setDocBody: (body: string) => void;
  setDocFrontmatter: (fm: Record<string, unknown>) => void;
  saveDoc: () => Promise<void>;
  refreshGit: () => Promise<void>;
  startHugo: () => Promise<void>;
  stopHugo: () => Promise<void>;
  restartHugo: () => Promise<void>;
  syncHugo: () => Promise<void>;
  setHugoPort: (port: number | null) => void;
  toast: (text: string, kind?: ToastMsg["kind"]) => void;
  dismissToast: (id: number) => void;
}

let toastCounter = 1;
let logCounter = 1;

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  hugoVersion: null,
  hugoServerPort: null,
  hugoLogs: [],
  hugoLogOpen: false,
  previewOpen: false,
  repo: null,
  tree: null,
  treeLoading: false,
  openDoc: null,
  docLoading: false,
  saving: false,
  git: null,
  gitLoading: false,
  toasts: [],

  async bootstrap() {
    const settings = await api.settings.get();
    set({ settings });
    try {
      const v = await api.hugo.detect();
      set({ hugoVersion: v });
    } catch (e) {
      // hugo missing — surface later when user tries to start
    }
    // If a previous hugo session is still alive in the backend, surface it.
    await get().syncHugo();
    if (settings.last_repo) {
      try {
        await get().openRepo(settings.last_repo);
      } catch (e: any) {
        get().toast(`Couldn't reopen ${settings.last_repo}: ${e?.message ?? e}`, "error");
      }
    }
  },

  async openRepo(path) {
    try {
      const info = await api.repo.open(path);
      set({ repo: info, openDoc: null, tree: null, git: null });
      const settings = await api.settings.get();
      set({ settings });
      await Promise.all([get().refreshTree(), get().refreshGit()]);
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
      throw e;
    }
  },

  closeRepo() {
    set({ repo: null, tree: null, openDoc: null, git: null });
  },

  async refreshTree() {
    const repo = get().repo;
    if (!repo) return;
    set({ treeLoading: true });
    try {
      const tree = await api.repo.contentTree(repo.root);
      set({ tree });
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    } finally {
      set({ treeLoading: false });
    }
  },

  async openDocAt(path) {
    set({ docLoading: true });
    try {
      const doc: PostDoc = await api.post.read(path);
      const fm = (doc.frontmatter ?? {}) as Record<string, unknown>;
      const open: OpenDoc = {
        path: doc.path,
        bundleDir: doc.bundle_dir,
        frontmatterKind: doc.frontmatter_kind,
        frontmatter: fm,
        body: doc.body,
        pristine: { frontmatter: JSON.stringify(fm), body: doc.body },
      };
      set({ openDoc: open });
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    } finally {
      set({ docLoading: false });
    }
  },

  setDocBody(body) {
    const d = get().openDoc;
    if (!d) return;
    set({ openDoc: { ...d, body } });
  },

  setDocFrontmatter(fm) {
    const d = get().openDoc;
    if (!d) return;
    set({ openDoc: { ...d, frontmatter: fm } });
  },

  async saveDoc() {
    const d = get().openDoc;
    if (!d) return;
    set({ saving: true });
    try {
      await api.post.write({
        path: d.path,
        kind: d.frontmatterKind || "yaml",
        frontmatter: d.frontmatter,
        body: d.body,
      });
      set({
        openDoc: {
          ...d,
          pristine: { frontmatter: JSON.stringify(d.frontmatter), body: d.body },
        },
      });
      get().toast("Saved", "success");
      await get().refreshGit();
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    } finally {
      set({ saving: false });
    }
  },

  async refreshGit() {
    const repo = get().repo;
    if (!repo) return;
    set({ gitLoading: true });
    try {
      const git = await api.git.status(repo.root);
      set({ git });
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    } finally {
      set({ gitLoading: false });
    }
  },

  async startHugo() {
    const repo = get().repo;
    if (!repo) return;
    const settings = get().settings;
    set({ hugoLogOpen: true });
    // If the backend already has a server, restart it rather than erroring out.
    const existing = await api.hugo.status().catch(() => null);
    if (existing) {
      try {
        await api.hugo.stop();
        set({ hugoServerPort: null });
      } catch {
        // best-effort — fall through to start
      }
    }
    try {
      const port = await api.hugo.start({
        repoRoot: repo.root,
        port: settings?.hugo_port ?? 1313,
      });
      set({ hugoServerPort: port });
      get().toast(`Hugo server starting on :${port}…`, "info");
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    }
  },

  async stopHugo() {
    try {
      await api.hugo.stop();
      set({ hugoServerPort: null });
    } catch (e: any) {
      get().toast(e?.message ?? String(e), "error");
    }
  },

  async restartHugo() {
    // Same as startHugo, which already stops first if needed.
    await get().startHugo();
  },

  async syncHugo() {
    try {
      const port = await api.hugo.status();
      set({ hugoServerPort: port ?? null });
    } catch {
      // ignore
    }
  },

  setHugoPort(port) {
    set({ hugoServerPort: port });
  },

  pushHugoLog(entry) {
    const next: HugoLogEntry = { ...entry, id: logCounter++, ts: Date.now() };
    set((s) => {
      const arr = [...s.hugoLogs, next];
      // Keep last 500 entries.
      if (arr.length > 500) arr.splice(0, arr.length - 500);
      return { hugoLogs: arr };
    });
  },
  clearHugoLogs() {
    set({ hugoLogs: [] });
  },
  setHugoLogOpen(open) {
    set({ hugoLogOpen: open });
  },
  setPreviewOpen(open) {
    set({ previewOpen: open });
  },

  toast(text, kind = "info") {
    const id = toastCounter++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function isDocDirty(d: OpenDoc | null): boolean {
  if (!d) return false;
  return JSON.stringify(d.frontmatter) !== d.pristine.frontmatter || d.body !== d.pristine.body;
}
