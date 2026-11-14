import { CircleDot, X } from "lucide-react";
import { openPath } from "../lib/actions";
import { openChange } from "../lib/git";
import type { GitFile, GitStatus } from "../lib/gitApi";
import { groupFiles, KIND_LABEL, KIND_LETTER, rowKind, type Group } from "../lib/gitStatus";

const TITLES: [Group, string][] = [["conflict", "Merge Changes"], ["staged", "Staged Changes"], ["changes", "Changes"]];
const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

/** "Uncommitted changes on main" / "Uncommitted changes (not on a branch)". */
export function uncommittedHeading(branch: string | null): string {
  return branch ? `Uncommitted changes on ${branch}` : "Uncommitted changes (not on a branch)";
}

interface Props {
  repo: GitStatus;
  /** The current commit (full id), null before the first commit. */
  base: string | null;
  height: number;
  /** Source Control is showing: its button would do nothing visible. */
  gitShown: boolean;
  onBase: (sha: string) => void;
  onOpenSourceControl: () => void;
  onClose: () => void;
}

/**
 * The details pane of the graph's uncommitted-changes row (GRAPH-015): the changed files in the
 * groups Source Control shows, instead of a commit's message and people. A click opens what
 * Source Control opens for the file (`openChange`: the comparison with its staging controls, or
 * the file itself when it is new or in conflict); nothing here acts on the repository.
 */
export function GraphUncommitted({ repo, base, height, gitShown, onBase, onOpenSourceControl, onClose }: Props) {
  const groups = groupFiles(repo.files);
  return (
    <div className="graph-detail graph-uncommitted selectable" style={{ height }}>
      <div className="graph-detail-info">
        <div className="row">
          <CircleDot size={14} className="muted" />
          <span className="graph-uncommitted-title">{uncommittedHeading(repo.branch)}</span>
          <span className="grow" />
          {!gitShown && <button className="btn small" onClick={onOpenSourceControl}>Open Source Control</button>}
          <button className="icon-btn xs" title="Close details" onClick={onClose}><X size={14} /></button>
        </div>
        <dl className="graph-meta graph-uncommitted-meta">
          <dt title="The commit these changes sit on: the one you are on">Based on</dt>
          <dd>
            {base ? <button className="link-btn mono" title="Go to this commit" onClick={() => onBase(base)}>{base.slice(0, 7)}</button> : "nothing yet (no commits)"}
          </dd>
        </dl>
      </div>
      <div className="graph-detail-files">
        {TITLES.map(([group, title]) => groups[group].length > 0 && (
          <div key={group} role="list" aria-label={title}>
            <div className="graph-files-head">{title} ({groups[group].length})</div>
            {groups[group].map((f) => <ChangedFile key={f.path} f={f} group={group} root={repo.root} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangedFile({ f, group, root }: { f: GitFile; group: Group; root: string }) {
  const kind = rowKind(f, group);
  const rel = f.path.slice(root.length).replace(/^\\/, "");
  const slash = rel.lastIndexOf("\\");
  const staged = group === "staged";
  return (
    <div
      className="scm-row graph-file"
      role="listitem"
      tabIndex={0}
      title={`${f.path}\n${KIND_LABEL[kind]}${f.origPath ? ` (from ${nameOf(f.origPath)})` : ""}${staged ? ", staged" : ""}\n${group === "conflict" ? "Click to open the file and resolve the conflict" : "Click to see the change, double-click to open the file"}`}
      onClick={() => void openChange(f, staged)}
      onDoubleClick={() => void openPath(f.path)}
      onKeyDown={(e) => e.key === "Enter" && void openChange(f, staged)}
    >
      <span className={`scm-name git-${kind}`}>{nameOf(f.path)}</span>
      {slash > 0 && <span className="scm-dir">{rel.slice(0, slash)}</span>}
      <span className="grow" />
      <span className={`scm-letter git-${kind}`} aria-label={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
    </div>
  );
}
