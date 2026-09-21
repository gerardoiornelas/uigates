/**
 * Resources whose change should always need a principal, whatever impact the proposer declares.
 *
 * These are the places where a small edit changes what runs, what ships, or who can act: CI,
 * dependencies, deployment and infrastructure, secrets, and agent settings. One list serves both
 * the engine (which gates a proposal by its declared resource) and `uig audit` (which checks the
 * files that actually changed), so the two cannot disagree about what counts.
 *
 * Judged on the normalized project-relative path. A directory that would contain such files is
 * matched through a trailing slash, so `.github/workflows` is gated as `.github/workflows/x.yml` is.
 * A resource of `.` or `/` names no particular file and is not matched here; `uig audit` is what
 * catches a wide resource that covers a gate-class change.
 */
export const GATE_CLASS: { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)\.gitlab-ci\.yml$/, why: 'CI configuration' },
  { pattern: /(^|\/)\.github\/workflows\//, why: 'CI configuration' },
  { pattern: /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml)$/, why: 'container build' },
  { pattern: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.ya?ml|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock)$/, why: 'dependencies' },
  { pattern: /(^|\/)(template\.ya?ml|samconfig\.toml|serverless\.ya?ml|netlify\.toml)$/, why: 'deployment or infrastructure' },
  { pattern: /\.tf$/, why: 'infrastructure' },
  { pattern: /\.env$|(^|\/)\.env\./, why: 'environment secrets' },
  { pattern: /(^|\/)settings(\.local)?\.json$/, why: 'settings' },
  { pattern: /(^|\/)\.claude\/settings/, why: 'agent permissions' },
];

/** Why a resource is gate-class, or null when it is not. */
export function gateClassOf(resource: string): string | null {
  const path = resource.replace(/\\/g, '/');
  return GATE_CLASS.find(g => g.pattern.test(path) || g.pattern.test(`${path.replace(/\/$/, '')}/`))?.why ?? null;
}
