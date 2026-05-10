import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../lib/cn";
import type { OpenDoc } from "../store/app";

interface Props {
  doc: OpenDoc;
  onChange: (fm: Record<string, unknown>) => void;
}

// Field order — anything not in this list is appended at the end alphabetically.
const KNOWN_ORDER = [
  "title",
  "description",
  "subtitle",
  "date",
  "lastmod",
  "slug",
  "draft",
  "image",
  "categories",
  "tags",
  "series",
  "weight",
  "hidden",
  "summary",
  "author",
  "aliases",
];

export function FrontMatterPanel({ doc, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const fm = doc.frontmatter;

  const keys = useMemo(() => {
    const all = Object.keys(fm);
    const known = KNOWN_ORDER.filter((k) => all.includes(k));
    const unknown = all.filter((k) => !KNOWN_ORDER.includes(k)).sort();
    return [...known, ...unknown];
  }, [fm]);

  function update(k: string, v: unknown) {
    const next = { ...fm, [k]: v };
    onChange(next);
  }

  function remove(k: string) {
    const next = { ...fm };
    delete next[k];
    onChange(next);
  }

  function addField(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed in fm) return;
    onChange({ ...fm, [trimmed]: "" });
  }

  if (doc.frontmatterKind === "toml") {
    const raw = (fm["__raw_toml__"] as string) ?? "";
    return (
      <div className="border-b border-stone-200 bg-stone-50 px-6 py-4 dark:border-stone-800 dark:bg-stone-900/50">
        <PanelHeader collapsed={collapsed} setCollapsed={setCollapsed} label="Front matter (TOML)" />
        {!collapsed && (
          <textarea
            value={raw}
            onChange={(e) => onChange({ __raw_toml__: e.target.value })}
            spellCheck={false}
            className="mt-2 w-full resize-y rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            rows={Math.min(14, Math.max(4, raw.split("\n").length + 1))}
          />
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-stone-200 bg-stone-50/70 px-6 py-3 dark:border-stone-800 dark:bg-stone-900/30">
      <PanelHeader collapsed={collapsed} setCollapsed={setCollapsed} label="Front matter" />
      {!collapsed && (
        <div className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 items-start">
          {keys.map((k) => (
            <FieldRow
              key={k}
              field={k}
              value={fm[k]}
              onChange={(v) => update(k, v)}
              onRemove={() => remove(k)}
              bundleDir={doc.bundleDir}
            />
          ))}
          <AddField onAdd={addField} existing={keys} />
        </div>
      )}
    </div>
  );
}

function PanelHeader({
  collapsed,
  setCollapsed,
  label,
}: {
  collapsed: boolean;
  setCollapsed: (b: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      className="no-drag flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
    >
      <ChevronDown size={12} className={cn("transition-transform", collapsed && "-rotate-90")} />
      {label}
    </button>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  onRemove,
  bundleDir,
}: {
  field: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onRemove: () => void;
  bundleDir: string | null;
}) {
  const isImageField = field === "image" || field === "cover" || field === "thumbnail";
  const imgUrl = useMemo(() => {
    if (!isImageField || !bundleDir || typeof value !== "string" || !value) return null;
    if (/^[a-z]+:\/\//i.test(value) || value.startsWith("data:")) return value;
    const path = value.startsWith("/") ? value : `${bundleDir.replace(/\/$/, "")}/${value}`;
    return convertFileSrc(path);
  }, [isImageField, bundleDir, value]);

  return (
    <>
      <div className="pt-1.5 text-right font-mono text-[11px] text-stone-500 dark:text-stone-400">{field}</div>
      <div className="flex items-start gap-2">
        {imgUrl && (
          <img
            src={imgUrl}
            alt=""
            className="mt-0.5 size-10 shrink-0 rounded border border-stone-200 object-cover dark:border-stone-700"
          />
        )}
        <div className="flex flex-1 items-start gap-1">
          <ValueInput field={field} value={value} onChange={onChange} />
          <button
            onClick={onRemove}
            className="no-drag mt-1.5 rounded p-1 text-stone-400 opacity-50 transition hover:bg-stone-200 hover:text-stone-700 hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            title="Remove field"
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <label className="no-drag inline-flex items-center gap-2 pt-1 text-sm">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 rounded border-stone-300 text-accent-600 focus:ring-accent-500 dark:border-stone-700 dark:bg-stone-900"
        />
        <span className="text-stone-600 dark:text-stone-400">{value ? "true" : "false"}</span>
      </label>
    );
  }
  if (Array.isArray(value)) {
    const text = value.map((v) => String(v)).join(", ");
    return (
      <input
        type="text"
        value={text}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder="comma-separated"
        className={inputClass}
      />
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className={inputClass}
      />
    );
  }
  const str = value == null ? "" : String(value);
  const isLong = str.length > 80 || /\n/.test(str);
  const isDate = field === "date" || field === "lastmod" || field === "publishDate";
  if (isLong) {
    return (
      <textarea
        value={str}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={true}
        rows={Math.min(6, Math.max(2, str.split("\n").length + 1))}
        className={cn(inputClass, "resize-y font-sans")}
      />
    );
  }
  return (
    <input
      type={isDate ? "text" : "text"}
      value={str}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field}
      className={inputClass}
    />
  );
}

const inputClass =
  "no-drag w-full rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

function AddField({ onAdd, existing }: { onAdd: (name: string) => void; existing: string[] }) {
  const [name, setName] = useState("");
  const suggestions = KNOWN_ORDER.filter((k) => !existing.includes(k));
  return (
    <>
      <div className="pt-1.5 text-right text-[11px] text-stone-400">+</div>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onAdd(name);
              setName("");
            }
          }}
          placeholder="Add field…"
          className={cn(inputClass, "max-w-[10rem]")}
        />
        {suggestions.slice(0, 4).map((s) => (
          <button
            key={s}
            onClick={() => onAdd(s)}
            className="no-drag rounded-md border border-dashed border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 transition hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
          >
            + {s}
          </button>
        ))}
      </div>
    </>
  );
}
