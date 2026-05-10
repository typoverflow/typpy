import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { useApp } from "../store/app";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "toast pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-3.5 py-2 text-sm shadow-lg backdrop-blur-md",
            t.kind === "error"
              ? "bg-rose-600 text-white"
              : t.kind === "success"
              ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900"
              : "bg-stone-800 text-white",
          )}
        >
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
