import Image from "@tiptap/extension-image";
import { Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

// Images that can be:
//  - resized by dragging a corner handle (as a % of the column width),
//  - centered by default,
//  - given an editable caption (rendered as <figure><figcaption>), and
//  - placed side by side in a row by dropping one onto another.
//
// Resized / captioned / rowed images persist to markdown as self-contained HTML
// with inline styles, so they render the same on the published Hugo site.

const MIN_PERCENT = 10;
const MAX_PERCENT = 100;

const IMAGE_ROW_STYLE =
  "display: flex; gap: 8px; justify-content: center; align-items: flex-start;";

function normalizeWidth(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return v;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function captionText(node: PMNode): string {
  return (node.textContent || "").trim();
}

function imgTag(node: PMNode, extraStyle = ""): string {
  const src = node.attrs.src ?? "";
  const alt = node.attrs.alt ? ` alt="${escapeAttr(String(node.attrs.alt))}"` : "";
  const title = node.attrs.title ? ` title="${escapeAttr(String(node.attrs.title))}"` : "";
  const width = normalizeWidth(node.attrs.width);
  const style = `width: ${width ?? "100%"};${extraStyle ? " " + extraStyle : ""}`;
  return `<img src="${src}"${alt}${title} style="${style}" />`;
}

function figureHtml(node: PMNode, centered: boolean): string {
  const figStyle = centered ? ' style="text-align: center;"' : "";
  const imgStyle = centered ? "display: block; margin: 0 auto;" : "";
  return (
    `<figure data-type="image"${figStyle}>\n` +
    `${imgTag(node, imgStyle)}\n` +
    `<figcaption>${escapeHtml(captionText(node))}</figcaption>\n` +
    `</figure>`
  );
}

// ---------------------------------------------------------------------------
// Image node (resizable, centered, captioned)
// ---------------------------------------------------------------------------

export const ResizableImage = Image.extend({
  content: "inline*",
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = normalizeWidth(attributes.width);
          return width ? { style: `width: ${width}` } : {};
        },
      },
    };
  },

  parseHTML() {
    const imgAttrs = (img: HTMLImageElement | null) =>
      img
        ? {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            width: normalizeWidth(img.style.width || img.getAttribute("width")),
          }
        : false;
    return [
      {
        tag: "figure",
        contentElement: "figcaption",
        getAttrs: (el: HTMLElement) => imgAttrs(el.querySelector("img")),
      },
      {
        tag: "img[src]",
        getAttrs: (el: HTMLElement) => imgAttrs(el as HTMLImageElement),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src;
    const width = normalizeWidth(HTMLAttributes.width);
    const imgAttrs: Record<string, unknown> = { src };
    if (HTMLAttributes.alt) imgAttrs.alt = HTMLAttributes.alt;
    if (HTMLAttributes.title) imgAttrs.title = HTMLAttributes.title;
    if (width) imgAttrs.style = `width: ${width}`;
    return ["figure", { "data-type": "image" }, ["img", imgAttrs], ["figcaption", 0]];
  },

  addKeyboardShortcuts() {
    // Backspace at the very start of an image's caption deletes the whole image.
    const removeAtStart = () => {
      const { state, view } = this.editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const $from = selection.$from;
      if ($from.parent.type.name === "image" && $from.parentOffset === 0) {
        const pos = $from.before();
        view.dispatch(state.tr.delete(pos, pos + $from.parent.nodeSize));
        return true;
      }
      return false;
    };
    return { Backspace: removeAtStart, "Mod-Backspace": removeAtStart };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any, parent: any, index: any) {
          const width = normalizeWidth(node.attrs.width);
          if (captionText(node)) {
            state.write(figureHtml(node, true));
          } else if (width && width !== "100%") {
            state.write(imgTag(node, "display: block; margin: 0 auto;"));
          } else {
            defaultMarkdownSerializer.nodes.image(state, node, parent, index);
          }
          state.closeBlock(node);
        },
        parse: {
          // <figure>/<img> handled by markdown-it (html: true) + parseHTML above.
        },
      },
    };
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      let node = props.node;
      const { editor, getPos } = props;

      const figure = document.createElement("figure");
      figure.className = "tiptap-image";

      const frame = document.createElement("div");
      frame.className = "tiptap-image__frame";
      figure.appendChild(frame);

      const img = document.createElement("img");
      img.draggable = false;
      frame.appendChild(img);

      const handle = document.createElement("div");
      handle.className = "tiptap-image__handle";
      handle.title = "Drag to resize";
      frame.appendChild(handle);

      const label = document.createElement("div");
      label.className = "tiptap-image__label";
      frame.appendChild(label);

      const remove = document.createElement("div");
      remove.className = "tiptap-image__remove";
      remove.title = "Delete image";
      remove.textContent = "×";
      frame.appendChild(remove);

      // Prevent the click from starting a drag / moving the selection.
      remove.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos === "function") {
          const pos = getPos();
          if (pos != null) {
            editor.view.dispatch(editor.view.state.tr.delete(pos, pos + node.nodeSize));
            editor.view.focus();
          }
        }
      });

      const caption = document.createElement("figcaption");
      caption.className = "tiptap-image__caption";
      figure.appendChild(caption);

      function applyAttrs(n: PMNode) {
        if (img.getAttribute("src") !== n.attrs.src) img.src = n.attrs.src ?? "";
        img.alt = n.attrs.alt ?? "";
        if (n.attrs.title) img.title = n.attrs.title;
        figure.style.width = normalizeWidth(n.attrs.width) ?? "100%";
        caption.classList.toggle("is-empty", n.content.size === 0);
      }
      applyAttrs(node);

      function basisWidth(): number {
        const parent = figure.parentElement;
        if (!parent) return figure.offsetWidth || 1;
        const cs = getComputedStyle(parent);
        const pad = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
        return Math.max(1, parent.clientWidth - pad);
      }

      function clampPct(pct: number): number {
        return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(pct)));
      }

      handle.addEventListener("mousedown", (event) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = frame.offsetWidth;
        const basis = basisWidth();
        figure.classList.add("is-resizing");

        function onMove(e: MouseEvent) {
          const next = startWidth + (e.clientX - startX);
          const pct = clampPct((next / basis) * 100);
          figure.style.width = `${pct}%`;
          label.textContent = `${pct}%`;
        }

        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          figure.classList.remove("is-resizing");
          const pct = clampPct((frame.offsetWidth / basis) * 100);
          if (typeof getPos === "function") {
            const pos = getPos();
            if (pos != null) {
              const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                width: `${pct}%`,
              });
              editor.view.dispatch(tr);
            }
          }
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      return {
        dom: figure,
        contentDOM: caption,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== node.type.name) return false;
          node = updatedNode;
          applyAttrs(node);
          return true;
        },
        ignoreMutation(mutation: any) {
          if (mutation.type === "selection") return false;
          return !caption.contains(mutation.target);
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// Image row container
// ---------------------------------------------------------------------------

export const ImageRow = Node.create({
  name: "imageRow",
  group: "block",
  content: "image+",
  draggable: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div.image-row" }];
  },

  renderHTML() {
    return ["div", { class: "image-row", style: IMAGE_ROW_STYLE }, 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`<div class="image-row" style="${IMAGE_ROW_STYLE}">\n`);
          node.forEach((child: PMNode) => {
            state.write((captionText(child) ? figureHtml(child, false) : imgTag(child)) + "\n");
          });
          state.write("</div>");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  // A row that drops to a single image becomes a plain image; empty rows vanish.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_trs, _oldState, newState) => {
          let tr: Transaction | null = null;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "imageRow" || node.childCount >= 2) return;
            if (!tr) tr = newState.tr;
            const from = tr.mapping.map(pos);
            const to = tr.mapping.map(pos + node.nodeSize);
            if (node.childCount === 1) {
              const child = node.child(0);
              const img = newState.schema.nodes.image.create(
                { ...child.attrs, width: "100%" },
                child.content,
                child.marks,
              );
              tr.replaceWith(from, to, img);
            } else {
              tr.delete(from, to);
            }
          });
          return tr && (tr as Transaction).docChanged ? tr : null;
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// Drag-into-row helpers (shared by file drops and internal node drags)
// ---------------------------------------------------------------------------

function buildRow(schema: any, images: PMNode[]): PMNode {
  const share = `${Math.max(MIN_PERCENT, Math.floor(MAX_PERCENT / images.length))}%`;
  const children = images.map((img) =>
    schema.nodes.image.create({ ...img.attrs, width: share }, img.content, img.marks),
  );
  return schema.nodes.imageRow.create(null, children);
}

function findImageTarget(
  view: EditorView,
  x: number,
  y: number,
): { pos: number; side: "before" | "after" } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const wrapper = el?.closest?.(".tiptap-image") as HTMLElement | null;
  if (!wrapper) return null;
  let foundPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (foundPos != null) return false;
    if (node.type.name === "image" && view.nodeDOM(pos) === wrapper) {
      foundPos = pos;
      return false;
    }
    return true;
  });
  if (foundPos == null) return null;
  const r = wrapper.getBoundingClientRect();
  const side = x < r.left + r.width / 2 ? "before" : "after";
  return { pos: foundPos, side };
}

function applyMerge(
  tr: Transaction,
  pos: number,
  newImg: PMNode,
  side: "before" | "after",
): boolean {
  const doc = tr.doc;
  const imgNode = doc.nodeAt(pos);
  if (!imgNode || imgNode.type.name !== "image") return false;
  const schema = doc.type.schema;
  const $img = doc.resolve(pos);
  if ($img.parent.type.name === "imageRow") {
    const row = $img.parent;
    const rowPos = $img.before();
    const idx = $img.index();
    const children: PMNode[] = [];
    row.forEach((c) => children.push(c));
    children.splice(side === "before" ? idx : idx + 1, 0, newImg);
    tr.replaceWith(rowPos, rowPos + row.nodeSize, buildRow(schema, children));
  } else {
    const ordered = side === "before" ? [newImg, imgNode] : [imgNode, newImg];
    tr.replaceWith(pos, pos + imgNode.nodeSize, buildRow(schema, ordered));
  }
  return true;
}

function collectImages(slice: Slice): PMNode[] {
  const imgs: PMNode[] = [];
  slice.content.forEach((node) => {
    if (node.type.name === "image") imgs.push(node);
    else if (node.type.name === "imageRow") node.forEach((c) => imgs.push(c));
  });
  return imgs;
}

// Insert a freshly-dropped image file. Dropped onto an existing image -> row;
// otherwise inserted at the drop point.
export function insertImageAtDrop(
  view: EditorView,
  attrs: Record<string, unknown>,
  x: number,
  y: number,
): void {
  const schema = view.state.schema;
  const newImg = schema.nodes.image.create(attrs);
  const target = findImageTarget(view, x, y);
  if (target) {
    const tr = view.state.tr;
    if (applyMerge(tr, target.pos, newImg, target.side)) {
      view.dispatch(tr);
      return;
    }
  }
  const hit = view.posAtCoords({ left: x, top: y });
  const at = hit ? hit.pos : view.state.selection.from;
  const pos = Math.min(at, view.state.doc.content.size);
  view.dispatch(view.state.tr.insert(pos, newImg));
}

// Internal drag of an existing image dropped onto another -> merge into a row.
export function handleImageRowDrop(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  moved: boolean,
): boolean {
  if (!moved) return false;
  const imgs = collectImages(slice);
  if (imgs.length !== 1) return false;
  const target = findImageTarget(view, event.clientX, event.clientY);
  if (!target) return false;
  const sel = view.state.selection;
  if (target.pos >= sel.from && target.pos < sel.to) return false;
  const src = imgs[0];
  const newImg = view.state.schema.nodes.image.create(src.attrs, src.content, src.marks);
  const tr = view.state.tr;
  tr.delete(sel.from, sel.to);
  const mapped = tr.mapping.map(target.pos, -1);
  if (!applyMerge(tr, mapped, newImg, target.side)) return false;
  event.preventDefault();
  view.dispatch(tr);
  return true;
}

export default ResizableImage;
