import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { Markdown } from "tiptap-markdown";
import { ResizableImage, ImageRow, insertImageAtDrop, handleImageRowDrop } from "../tiptap/ResizableImage";
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus } from "lucide-react";

interface EditorProps {
  doc: { path: string; body: string; bundleDir: string | null };
  onChange: (markdown: string) => void;
  onImageDrop?: (file: File) => Promise<string | null>; // returns relative filename to insert as ![]()
  onPasteImage?: (file: File) => Promise<string | null>;
}

export function MarkdownEditor({ doc, onChange, onImageDrop, onPasteImage }: EditorProps) {
  const bundleDir = doc.bundleDir;
  const lastEmittedRef = useRef<string>("");
  const docPathRef = useRef<string>(doc.path);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We let Markdown extension serialize/parse; StarterKit nodes feed it.
      }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener" } }),
      ResizableImage.configure({ inline: false, allowBase64: true }),
      ImageRow,
      Placeholder.configure({ placeholder: "Start writing…" }),
      Typography,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: rewriteImageSrcs(doc.body, bundleDir),
    autofocus: false,
    onUpdate({ editor }) {
      const md = editor.storage.markdown.getMarkdown() as string;
      const normalized = unwriteImageSrcs(md, bundleDir);
      if (normalized !== lastEmittedRef.current) {
        lastEmittedRef.current = normalized;
        onChange(normalized);
      }
    },
    editorProps: {
      attributes: {
        class:
          "tiptap font-serif text-[17px] leading-[1.75] text-stone-800 dark:text-stone-200 max-w-2xl mx-auto px-6 py-12 min-h-full",
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        const imageFile = files.find((f) => f.type.startsWith("image/"));
        if (imageFile && onPasteImage) {
          event.preventDefault();
          (async () => {
            const inserted = await onPasteImage(imageFile);
            if (inserted) {
              const url = bundleDir ? convertFileSrc(`${bundleDir}/${inserted}`) : inserted;
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src: url, alt: inserted }),
                ),
              );
            }
          })();
          return true;
        }
        return false;
      },
      handleDrop(view, event, slice, moved) {
        // Merge an existing image dragged onto another image into a row.
        return handleImageRowDrop(view, event as DragEvent, slice, moved);
      },
    },
  });

  // --- File drag & drop (handled at the window level) ---
  // With the window's native dragDropEnabled turned off, OS file drops arrive as
  // standard HTML5 drag events. We listen on the whole window so an image dropped
  // anywhere over the app gets inserted into the open document — and, crucially,
  // we preventDefault so the webview never navigates to (and gets stuck showing)
  // the raw image file.
  useEffect(() => {
    if (!editor) return;
    const view = editor.view;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    function onWinDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    }
    function onWinDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function onWinDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    }
    function onWinDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const imageFile = files.find((f) => f.type.startsWith("image/"));
      if (!imageFile || !onImageDrop) return;
      // Remember the drop point — dropping onto an existing image forms a row.
      const x = e.clientX;
      const y = e.clientY;
      (async () => {
        const inserted = await onImageDrop(imageFile);
        if (!inserted) return;
        const url = bundleDir ? convertFileSrc(`${bundleDir}/${inserted}`) : inserted;
        insertImageAtDrop(view, { src: url, alt: inserted }, x, y);
      })();
    }

    window.addEventListener("dragenter", onWinDragEnter);
    window.addEventListener("dragover", onWinDragOver);
    window.addEventListener("dragleave", onWinDragLeave);
    window.addEventListener("drop", onWinDrop);
    return () => {
      window.removeEventListener("dragenter", onWinDragEnter);
      window.removeEventListener("dragover", onWinDragOver);
      window.removeEventListener("dragleave", onWinDragLeave);
      window.removeEventListener("drop", onWinDrop);
      dragDepth.current = 0;
    };
  }, [editor, bundleDir, onImageDrop]);

  // When the open document changes, replace editor content.
  useEffect(() => {
    if (!editor) return;
    if (doc.path !== docPathRef.current) {
      docPathRef.current = doc.path;
      lastEmittedRef.current = doc.body;
      editor.commands.setContent(rewriteImageSrcs(doc.body, bundleDir), false);
    }
  }, [doc.path, doc.body, bundleDir, editor]);

  return (
    <div className="relative flex-1 overflow-y-auto">
      {editor && <EditorContent editor={editor} />}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-500/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-accent-500/60 bg-white/85 px-6 py-4 text-sm font-medium text-accent-700 shadow-lg dark:bg-stone-900/85 dark:text-accent-300">
            <ImagePlus size={18} />
            Drop image to add &amp; auto-compress
          </div>
        </div>
      )}
    </div>
  );
}

// Rewrite relative image paths in markdown -> tauri asset URLs so the editor can render them.
// Handles both the ![]() markdown syntax AND raw <img src="..."> HTML tags (which the user's
// blog uses heavily via <center>/<figure> wrappers).
function rewriteImageSrcs(md: string, bundleDir: string | null): string {
  if (!bundleDir) return md;
  let out = md.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (full, alt, src, titlePart) => {
    const abs = relToAbs(src, bundleDir);
    return abs ? `![${alt}](${convertFileSrc(abs)}${titlePart ?? ""})` : full;
  });
  // HTML <img src="..."> or <img src=foo.jpg> (Hugo posts often have unquoted attrs).
  out = out.replace(/(<img\b[^>]*\bsrc=)("[^"]+"|'[^']+'|[^\s>]+)/gi, (full, head, srcExpr) => {
    const { value, quote } = parseAttr(srcExpr);
    const abs = relToAbs(value, bundleDir);
    if (!abs) return full;
    const url = convertFileSrc(abs);
    return `${head}${quote}${url}${quote}`;
  });
  return out;
}

// Reverse the rewrite on output so we store relative paths on disk.
function unwriteImageSrcs(md: string, bundleDir: string | null): string {
  if (!bundleDir) return md;
  let out = md.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (full, alt, src, titlePart) => {
    const rel = absUrlToRel(src, bundleDir);
    return rel ? `![${alt}](${rel}${titlePart ?? ""})` : full;
  });
  out = out.replace(/(<img\b[^>]*\bsrc=)("[^"]+"|'[^']+'|[^\s>]+)/gi, (full, head, srcExpr) => {
    const { value, quote } = parseAttr(srcExpr);
    const rel = absUrlToRel(value, bundleDir);
    return rel ? `${head}${quote}${rel}${quote}` : full;
  });
  return out;
}

function relToAbs(src: string, bundleDir: string): string | null {
  if (!src) return null;
  if (/^[a-z]+:\/\//i.test(src)) return null;
  if (src.startsWith("data:")) return null;
  if (src.startsWith("/")) return null;
  if (src.startsWith("./")) src = src.slice(2);
  return `${bundleDir.replace(/\/$/, "")}/${src}`;
}

function absUrlToRel(src: string, bundleDir: string): string | null {
  try {
    const url = new URL(src);
    const isAsset =
      url.protocol === "asset:" ||
      (url.protocol === "https:" && url.hostname === "asset.localhost") ||
      url.hostname === "localhost";
    if (!isAsset) return null;
    const decoded = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const prefix = bundleDir.endsWith("/") ? bundleDir.slice(1) : bundleDir.slice(1) + "/";
    // On macOS asset URLs strip the leading slash on the absolute path, so the
    // pathname looks like 'Users/.../bundle/img.jpg'. Match both forms.
    const prefixWithSlash = bundleDir.endsWith("/") ? bundleDir : bundleDir + "/";
    if (decoded.startsWith(prefixWithSlash.slice(1))) {
      return decoded.slice(prefixWithSlash.slice(1).length);
    }
    if (decoded.startsWith(prefix)) {
      return decoded.slice(prefix.length);
    }
    if (decoded.startsWith(prefixWithSlash)) {
      return decoded.slice(prefixWithSlash.length);
    }
  } catch {
    // Not a URL — must already be relative.
    return null;
  }
  return null;
}

function parseAttr(expr: string): { value: string; quote: string } {
  if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
    return { value: expr.slice(1, -1), quote: expr[0] };
  }
  return { value: expr, quote: '"' };
}
