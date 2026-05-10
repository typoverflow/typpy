import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface RepoInfo {
  root: string;
  name: string;
  hugo_config_kind: string;
}

export interface ContentNode {
  name: string;
  path: string;
  kind: "section" | "bundle" | "single";
  children: ContentNode[];
  title: string | null;
  date: string | null;
  draft: boolean | null;
}

export interface PostDoc {
  path: string;
  bundle_dir: string | null;
  frontmatter_kind: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
}

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}
export interface GitStatus {
  is_repo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  remote_url: string | null;
}

export interface HugoVersion {
  version: string;
  extended: boolean;
  path: string;
}

export interface CompressResult {
  path: string;
  width: number;
  height: number;
  bytes_before: number;
  bytes_after: number;
  format: string;
}

export interface CompressOptions {
  max_width?: number;
  quality?: number;
  format?: "keep" | "jpeg" | "webp" | "png";
}

export interface Settings {
  recent_repos: string[];
  last_repo: string | null;
  image_defaults: {
    max_width: number | null;
    quality: number | null;
    format: string | null;
  };
  theme: "system" | "light" | "dark";
  hugo_port: number;
}

export const api = {
  settings: {
    get: () => invoke<Settings>("settings_get"),
    update: (patch: Partial<Settings>) => invoke<Settings>("settings_update", { patch }),
  },
  repo: {
    detect: (path: string) => invoke<RepoInfo>("repo_detect", { path }),
    open: (path: string) => invoke<RepoInfo>("repo_open", { path }),
    contentTree: (root: string) => invoke<ContentNode[]>("repo_content_tree", { root }),
  },
  post: {
    read: (path: string) => invoke<PostDoc>("post_read", { path }),
    write: (args: { path: string; kind: string; frontmatter: unknown; body: string }) =>
      invoke<void>("post_write", { args }),
    create: (args: { repoRoot: string; section: string; slug: string; frontmatter: unknown }) =>
      invoke<string>("post_create", {
        args: {
          repo_root: args.repoRoot,
          section: args.section,
          slug: args.slug,
          frontmatter: args.frontmatter,
        },
      }),
  },
  image: {
    import: (args: {
      src: string;
      bundleDir: string;
      desiredStem?: string;
      options?: CompressOptions;
    }) =>
      invoke<CompressResult>("image_import", {
        args: {
          src: args.src,
          bundle_dir: args.bundleDir,
          desired_stem: args.desiredStem,
          options: args.options,
        },
      }),
    compress: (args: { src: string; options?: CompressOptions; overwrite?: boolean }) =>
      invoke<CompressResult>("image_compress", {
        args: { src: args.src, options: args.options, overwrite: args.overwrite },
      }),
  },
  git: {
    status: (repoRoot: string) => invoke<GitStatus>("git_status", { repoRoot }),
    pull: (repoRoot: string) => invoke<string>("git_pull", { repoRoot }),
    push: (repoRoot: string) => invoke<string>("git_push", { repoRoot }),
    commit: (args: { repoRoot: string; files: string[]; message: string }) =>
      invoke<string>("git_commit", {
        args: { repo_root: args.repoRoot, files: args.files, message: args.message },
      }),
    discard: (args: { repoRoot: string; file: string }) =>
      invoke<void>("git_discard", {
        args: { repo_root: args.repoRoot, file: args.file },
      }),
  },
  hugo: {
    detect: () => invoke<HugoVersion>("hugo_detect"),
    start: (args: { repoRoot: string; port?: number }) =>
      invoke<number>("hugo_start", { repoRoot: args.repoRoot, port: args.port }),
    stop: () => invoke<void>("hugo_stop"),
    status: () => invoke<number | null>("hugo_status"),
  },
  fs: {
    exists: (path: string) => invoke<boolean>("fs_exists", { path }),
    readText: (path: string) => invoke<string>("fs_read_text", { path }),
    writeText: (path: string, contents: string) =>
      invoke<void>("fs_write_text", { path, contents }),
    writeBytes: (path: string, contents: Uint8Array | number[]) =>
      invoke<void>("fs_write_bytes", { path, contents: Array.from(contents as any) }),
    tempPath: (filename: string) => invoke<string>("fs_temp_path", { filename }),
    reveal: (path: string) => invoke<void>("fs_reveal", { path }),
  },
};

export { convertFileSrc };
