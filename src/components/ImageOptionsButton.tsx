import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useApp } from "../store/app";
import { api } from "../api/tauri";

export function ImageOptionsButton() {
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);

  if (!settings) return null;
  const opts = settings.image_defaults;

  async function update(partial: { max_width?: number; quality?: number; format?: string }) {
    try {
      const next = {
        image_defaults: {
          max_width: opts.max_width,
          quality: opts.quality,
          format: opts.format,
          ...partial,
        },
      };
      await api.settings.update(next as any);
      // Reload settings
      const s = await api.settings.get();
      useApp.setState({ settings: s });
    } catch (e: any) {
      toast(e?.message ?? String(e), "error");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="no-drag rounded-md p-1.5 text-stone-500 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-800"
        title="Image compression defaults"
      >
        <SettingsIcon size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Image compression
            </div>
            <label className="block text-xs text-stone-600 dark:text-stone-300">Max width (px)</label>
            <input
              type="number"
              value={opts.max_width ?? 2000}
              onChange={(e) => update({ max_width: Number(e.target.value) })}
              className="mt-1 mb-2 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
            <label className="block text-xs text-stone-600 dark:text-stone-300">Quality (1–100)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={opts.quality ?? 85}
              onChange={(e) => update({ quality: Number(e.target.value) })}
              className="mt-1 mb-2 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
            <label className="block text-xs text-stone-600 dark:text-stone-300">Output format</label>
            <select
              value={opts.format ?? "keep"}
              onChange={(e) => update({ format: e.target.value })}
              className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-950"
            >
              <option value="keep">Keep source format</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP (lossless)</option>
              <option value="png">PNG</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
