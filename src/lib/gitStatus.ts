/** Pure helpers over `git status` entries (gitApi.ts): what a file's change is, and how the Source Control panel groups them. */
import type { GitFile } from "./gitApi";

export type GitKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export const KIND_LETTER: Record<GitKind, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };
export const KIND_LABEL: Record<GitKind, string> = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", untracked: "Untracked", conflict: "Conflict" };
/** Which change a folder shows when it holds several kinds. */
export const KIND_RANK: Record<GitKind, number> = { conflict: 5, modified: 3, renamed: 2, added: 2, deleted: 1, untracked: 1 };

/** The change of a file as a whole (staged and not). */
export function kindOf(f: GitFile): GitKind {
  if (f.conflicted) return "conflict";
  if (f.untracked) return "untracked";
  if (f.index === "D" || f.worktree === "D") return "deleted";
  if (f.index === "R" || f.index === "C") return "renamed";
  if (f.index === "A" && (f.worktree === "." || f.worktree === "M")) return "added";
  return "modified";
}

export type Group = "conflict" | "staged" | "changes";

const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

/** Split a repository's files into Merge Changes / Staged Changes / Changes (a file can be in both of the last two). */
export function groupFiles(files: GitFile[]): Record<Group, GitFile[]> {
  const out: Record<Group, GitFile[]> = { conflict: [], staged: [], changes: [] };
  for (const f of files) {
    if (f.conflicted) out.conflict.push(f);
    else {
      if (!f.untracked && f.index !== ".") out.staged.push(f);
      if (f.untracked || f.worktree !== ".") out.changes.push(f);
    }
  }
  const byName = (a: GitFile, b: GitFile) => nameOf(a.path).localeCompare(nameOf(b.path)) || a.path.localeCompare(b.path);
  for (const g of Object.values(out)) g.sort(byName);
  return out;
}

/** What a row shows: the staged side's change in Staged Changes, the work tree's in Changes. */
export function rowKind(f: GitFile, group: Group): GitKind {
  if (group === "conflict") return "conflict";
  if (group === "staged") return f.index === "A" ? "added" : f.index === "D" ? "deleted" : f.index === "R" || f.index === "C" ? "renamed" : "modified";
  if (f.untracked) return "untracked";
  return f.worktree === "D" ? "deleted" : "modified";
}

/** The web page of a GitHub / GitLab / Bitbucket style remote URL (https or scp-like ssh), or null. */
export function remoteWebUrl(url: string): string | null {
  const u = url.trim();
  let m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(u);
  if (!m) m = /^(?:ssh:\/\/)?[^@/]+@([^:/]+)[:/](.+?)(?:\.git)?\/?$/i.exec(u);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

/** A remote URL with any password or token taken out, for showing. */
export function displayUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^@/]+@/i, "$1");
}

/** A GitHub repository name from a folder name (GitHub allows letters, digits, '-', '_' and '.'). */
export function repoNameFor(folder: string): string {
  const base = folder.replace(/[\\/]+$/, "");
  const name = base.slice(Math.max(base.lastIndexOf("\\"), base.lastIndexOf("/")) + 1);
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "repository";
}

/** git's answer when the remote repository isn't there (deleted, renamed, or not visible to this account). */
export function isMissingRepo(error: string | null | undefined): boolean {
  return !!error && /repository .*not found|not found.*repository|does not appear to be a git repository|does not exist/i.test(error);
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "ok": nothing to do anywhere; "local": only uncommitted work; "todo": push or pull; "warn": diverged. */
export type SyncKind = "ok" | "local" | "todo" | "warn";

/**
 * The Source Control status line for a branch that has an upstream: uncommitted work and the
 * commits to push / pull are told apart, so "matches the remote" is never read as "all saved".
 */
export function syncLine(changes: number, ahead: number, behind: number, upstream: string): { kind: SyncKind; text: string } {
  const local = changes ? count(changes, "uncommitted change") : "";
  if (ahead && behind) {
    return { kind: "warn", text: `${local ? local + ". " : ""}Diverged from ${upstream}: ${count(ahead, "commit")} to push, ${behind} to pull. Pull first, then push.` };
  }
  if (behind) return { kind: "todo", text: `${local ? local + ", " : ""}${count(behind, "commit")} to pull from ${upstream}.` };
  if (ahead) return { kind: "todo", text: `${local ? local + ", " : ""}${count(ahead, "commit")} to push to ${upstream}.` };
  if (changes) return { kind: "local", text: `${local}. Your commits match ${upstream}.` };
  return { kind: "ok", text: `Everything is committed and matches ${upstream}.` };
}

/** The Commit button: what it will take. */
export function commitLabel(staged: number, total: number, amend: boolean): string {
  if (amend) return "Amend Last Commit";
  if (staged) return `Commit ${staged} Staged`;
  return total ? `Commit All (${count(total, "file")})` : "Commit All";
}

/** Kind (colour / letter) of a file in a commit, from git's status letter there. */
export function commitFileKind(status: string): GitKind {
  return status === "A" ? "added" : status === "D" ? "deleted" : status === "R" || status === "C" ? "renamed" : "modified";
}
