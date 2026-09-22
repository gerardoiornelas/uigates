import * as fs from 'fs';
import * as path from 'path';

/**
 * One name: `uigates`. The command, the skill, the plugin, the state directory and the environment
 * variables all use it. `uig` was the earlier short name and is still understood, for one release:
 * the `uig` command alias, `UIG_*` variables, and an existing `.uig/` directory.
 *
 * The legacy directory is never migrated. A receipt's evidence reference embeds the project-relative
 * path (`sha256:<hash>:.uig/evidence/<id>.log`), so moving `.uig/` would break the hash check on
 * every record already written. A project that has `.uig/` keeps using it; a new project gets
 * `.uigates/`.
 */

export const STATE_DIR = '.uigates';
export const LEGACY_STATE_DIR = '.uig';
export const STATE_DIRS = [STATE_DIR, LEGACY_STATE_DIR] as const;

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * The state directory name for a project: `.uigates` if it exists, else `.uig` if it exists (an
 * older project), else `.uigates` (a new one). Decided by what is on disk, so every call agrees.
 */
export function stateDirName(root: string): string {
  if (isDir(path.join(root, STATE_DIR))) return STATE_DIR;
  if (isDir(path.join(root, LEGACY_STATE_DIR))) return LEGACY_STATE_DIR;
  return STATE_DIR;
}

export function stateDir(root: string): string {
  return path.join(root, stateDirName(root));
}

/** Both directories exist, so one of them is being ignored. Worth saying out loud. */
export function hasBothStateDirs(root: string): boolean {
  return isDir(path.join(root, STATE_DIR)) && isDir(path.join(root, LEGACY_STATE_DIR));
}

/**
 * A path that is UI-GATES state: `.uigates` or `.uig`, as a whole path segment, at any depth.
 * Both names are always protected, whichever one a project currently uses, so a proposal cannot
 * reach the records through the name the project is not using.
 */
export const STATE_PATH = /(^|\/)\.(uigates|uig)(\/|$)/;
/** Authority and audit records: nothing that acts under an intent may alter them. */
export const AUDIT_RECORD_PATH = /(^|\/)\.(uigates|uig)\/(intents|proposals|authorizations|receipts)(\/|$)/;
/** UI-GATES state at the project root, for filtering a change list. */
export const ROOT_STATE_PATH = /^\.(uigates|uig)(\/|$)/;

/** A setting: `UIGATES_<name>`, falling back to the legacy `UIG_<name>`. An empty value counts as unset. */
export function envSetting(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`UIGATES_${name}`] || env[`UIG_${name}`] || undefined;
}
