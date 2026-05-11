# typpy

A lightweight, native macOS editor for [Hugo](https://gohugo.io) blogs. WYSIWYG markdown, on-the-fly image compression, built-in git, and a one-click Hugo dev server with side-by-side preview.

typpy is theme- and section-agnostic — it works on any Hugo project with a `content/` directory.

<br />

## Features

- **WYSIWYG markdown editor** built on Tiptap. Tables, task lists, links, code blocks, headings — all rendered inline as you type. Embedded HTML (`<center>`, `<figure>`, raw `<img>`) is preserved verbatim on save.
- **Live front-matter form** with image thumbnails. Auto-detects YAML or TOML. Add/remove fields without touching syntax.
- **Drag-and-drop image import** with automatic compression. Camera-sized JPEGs get resized + re-encoded into your page bundle in one step; configurable max width / quality / format.
- **Git integration** (pull / commit / push) that shells out to your existing `git` — uses your SSH keys, GPG signing, credentials. Visual file-checklist commit dialog.
- **Hugo dev server** with a single click. Captures stdout/stderr into a resizable log panel so theme or module errors are visible. Side preview pane iframes the current post at the right URL.
- **Orphan-aware port handling** — if `:1313` is held by a runaway hugo from a previous session, typpy detects it (by process name, never blindly), terminates it, and starts cleanly on the same port.
- **Native `.app`** — ~4 MB binary, ~80 MB RAM idle, no Electron.

<br />

## Requirements

- macOS 12 or later (Apple Silicon)
- `hugo` on `PATH` — `brew install hugo`
- `git` on `PATH`
- `go` on `PATH` *only* if your Hugo site uses [Hugo Modules](https://gohugo.io/hugo-modules/) — `brew install go`

To build from source you also need:

- [Rust](https://rustup.rs) (stable, 1.85+)
- Node.js 20+ and npm

<br />

## Install (pre-built)

Download the latest `.dmg` from the [Releases](../../releases) page, drag `typpy.app` into `/Applications`, and open it.

The app is **not** signed or notarized. On first launch macOS will refuse to open it; right-click → Open, then confirm in the dialog. Alternatively: `xattr -d com.apple.quarantine /Applications/typpy.app`.

<br />

## Build from source

```bash
git clone https://github.com/typoverflow/typpy.git
cd typpy
npm install
npm run tauri build
```

Artifacts land in:

- `src-tauri/target/release/bundle/macos/typpy.app`
- `src-tauri/target/release/bundle/dmg/typpy_<version>_aarch64.dmg`

<br />

## Develop

```bash
npm run tauri dev
```

First start compiles Rust (~2 min); subsequent starts are fast (~5s).

Type-check without running:

```bash
npx tsc --noEmit                 # frontend
cd src-tauri && cargo check      # backend
```

Settings live at `~/Library/Application Support/io.gaocx.typpy/settings.json` — delete to reset to the welcome screen.

<br />

## Project layout

```
typpy/
├── src/                  React + TypeScript frontend
│   ├── api/tauri.ts      Typed wrappers around Rust commands
│   ├── components/       UI (Sidebar, Editor, TopBar, dialogs, etc.)
│   ├── store/app.ts      Zustand store
│   └── styles.css        Tailwind v4 + editor styles
├── src-tauri/            Rust backend
│   ├── src/
│   │   ├── lib.rs        Tauri commands + invoke_handler
│   │   ├── repo.rs       Hugo project detection + content tree
│   │   ├── frontmatter.rs YAML/TOML front-matter split/join
│   │   ├── imaging.rs    Image resize + re-encode
│   │   ├── gitops.rs     Shell-out to `git`
│   │   ├── hugo.rs       Hugo server lifecycle + orphan cleanup
│   │   └── settings.rs   Persisted user prefs
│   ├── capabilities/     Tauri permission scopes
│   └── tauri.conf.json   App metadata + window config
└── package.json
```

<br />

## How it talks to your blog

typpy treats the Hugo project as the source of truth:

- **Reads:** scans `content/` for sections (`post/`, `page/`, etc.) and page bundles (`section/slug/index.md` + co-located images). Front-matter is parsed (YAML or TOML) and shown as a structured form; the body is rendered in the WYSIWYG editor.
- **Writes:** on save, typpy serializes the form back into the original front-matter format and writes the file. Existing YAML field order is preserved as much as possible; unknown fields pass through untouched.
- **Images:** dropped/pasted images are compressed with the `image` crate, written into the bundle directory next to `index.md`, and referenced by a relative filename — exactly how Hugo expects.
- **Git:** never auto-commits. The commit dialog shows you exactly what will be staged.

This means you can keep editing the same posts in vim or VS Code — typpy doesn't write anything outside the file you're editing.

<br />

## Roadmap / known limitations

- Lossy WebP not supported yet (the `image` crate ships lossless WebP only). Use JPEG if you need small files.
- No code-block syntax highlighting in the editor (works fine when previewed via Hugo).
- `git pull` is `--ff-only`. Conflicts must be resolved in a terminal.
- macOS Apple Silicon only for now. Tauri itself is cross-platform; cross-compile PRs welcome.

<br />

## Contributing

Bug reports and feature requests are welcome via Issues. For pull requests:

1. Open an issue first if it's a non-trivial change, so we can agree on direction.
2. Keep PRs scoped — one feature/fix per PR.
3. Run `npx tsc --noEmit` and `cargo check` before pushing.

<br />

## License

[MIT](./LICENSE) © 2026 typoverflow
