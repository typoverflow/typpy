import { ArrowDownToLine, ArrowUpFromLine, GitBranch, Globe, Loader2, PanelRightOpen, RotateCw, Save, ScrollText, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "../lib/cn";
import { useApp, isDocDirty } from "../store/app";
import { api } from "../api/tauri";

interface TopBarProps {
  onCommit: () => void;
}

export function TopBar({ onCommit }: TopBarProps) {
  const repo = useApp((s) => s.repo);
  const git = useApp((s) => s.git);
  const gitLoading = useApp((s) => s.gitLoading);
  const refreshGit = useApp((s) => s.refreshGit);
  const toast = useApp((s) => s.toast);
  const doc = useApp((s) => s.openDoc);
  const saving = useApp((s) => s.saving);
  const saveDoc = useApp((s) => s.saveDoc);
  const dirty = isDocDirty(doc);
  const hugoPort = useApp((s) => s.hugoServerPort);
  const startHugo = useApp((s) => s.startHugo);
  const stopHugo = useApp((s) => s.stopHugo);
  const restartHugo = useApp((s) => s.restartHugo);
  const previewOpen = useApp((s) => s.previewOpen);
  const setPreviewOpen = useApp((s) => s.setPreviewOpen);
  const hugoLogOpen = useApp((s) => s.hugoLogOpen);
  const setHugoLogOpen = useApp((s) => s.setHugoLogOpen);
  const hugoLogs = useApp((s) => s.hugoLogs);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    if (!repo) return;
    const id = setInterval(() => refreshGit(), 15000);
    return () => clearInterval(id);
  }, [repo, refreshGit]);

  if (!repo) return null;
  const changes = git?.files.length ?? 0;
  const branch = git?.branch ?? "—";

  async function doPull() {
    if (!repo || pulling) return;
    setPulling(true);
    try {
      await api.git.pull(repo.root);
      toast("Pulled", "success");
      await refreshGit();
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    } finally {
      setPulling(false);
    }
  }
  async function doPush() {
    if (!repo || pushing) return;
    setPushing(true);
    try {
      await api.git.push(repo.root);
      toast("Pushed", "success");
      await refreshGit();
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="flex h-11 items-center gap-2 border-b border-stone-200 bg-stone-50/80 px-3 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/80">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch size={14} className="shrink-0 text-stone-500 dark:text-stone-400" />
        <span className="truncate text-xs font-medium text-stone-700 dark:text-stone-200">{branch}</span>
        {git && (git.ahead > 0 || git.behind > 0) && (
          <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {git.ahead > 0 ? `↑${git.ahead}` : ""}
            {git.behind > 0 ? `↓${git.behind}` : ""}
          </span>
        )}
        {changes > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            {changes} change{changes === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <TopButton onClick={() => saveDoc()} disabled={!doc || !dirty || saving} title="Save (⌘S)">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span className={cn(!dirty && "opacity-50")}>Save</span>
        </TopButton>
        <TopButton onClick={doPull} disabled={pulling || gitLoading} title="git pull --ff-only">
          {pulling ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />}
          <span>Pull</span>
        </TopButton>
        <TopButton onClick={onCommit} disabled={changes === 0} title="Stage and commit selected files">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          <span>Commit{changes ? ` (${changes})` : ""}</span>
        </TopButton>
        <TopButton onClick={doPush} disabled={pushing || gitLoading} title="git push">
          {pushing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpFromLine size={14} />}
          <span>Push</span>
        </TopButton>
        <div className="mx-1 h-5 w-px bg-stone-200 dark:bg-stone-800" />
        {hugoPort ? (
          <>
            <TopButton onClick={() => openUrl(`http://localhost:${hugoPort}/`)} title={`Open localhost:${hugoPort}`}>
              <Globe size={14} className="text-emerald-500" />
              <span>:{hugoPort}</span>
            </TopButton>
            <TopButton onClick={restartHugo} title="Stop and start again">
              <RotateCw size={12} />
              <span>Restart</span>
            </TopButton>
            <TopButton onClick={stopHugo} title="Stop Hugo server">
              <Square size={12} />
              <span>Stop</span>
            </TopButton>
          </>
        ) : (
          <TopButton onClick={startHugo} title="Start `hugo server -D`">
            <Globe size={14} />
            <span>Start Hugo</span>
          </TopButton>
        )}
        <TopButton onClick={() => setHugoLogOpen(!hugoLogOpen)} title="Show Hugo logs">
          <ScrollText size={14} />
          <span>Logs{hugoLogs.length ? ` (${hugoLogs.length})` : ""}</span>
        </TopButton>
        <TopButton
          onClick={() => setPreviewOpen(!previewOpen)}
          title="Toggle side preview"
          aria-pressed={previewOpen}
        >
          <PanelRightOpen size={14} className={previewOpen ? "text-accent-600" : undefined} />
          <span>Preview</span>
        </TopButton>
      </div>
    </div>
  );
}

function TopButton({
  children,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "no-drag inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition",
        "text-stone-700 hover:bg-stone-200/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        "dark:text-stone-300 dark:hover:bg-stone-800/70",
      )}
    >
      {children}
    </button>
  );
}
