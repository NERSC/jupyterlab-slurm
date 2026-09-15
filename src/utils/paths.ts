/**
 * Join a POSIX workdir and a (possibly relative) path, and normalize .. and . segments.
 */
export function joinAndNormalizePosix(workdir: string, p: string): string {
  // If p is absolute (starts with '/') or home shortcut '~', or Windows drive, return as-is
  if (!p) {
    return p;
  }
  if (p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:\\/.test(p)) {
    return p;
  }
  // Ensure workdir is defined and absolute-like; fallback to p if not
  let base = workdir && workdir.length ? workdir : '';
  if (!base) {
    return p;
  }
  // Remove trailing slash from base (except root)
  if (base.length > 1 && base.endsWith('/')) {
    base = base.replace(/\/+$/, '');
  }
  // Build combined path and normalize segments
  const raw = `${base}/${p}`;
  const parts = raw.split('/');
  const stack: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(seg);
  }
  return '/' + stack.join('/');
}

/**
 * Resolve a path for UI actions, taking into account the working directory.
 */
export function resolveForActions(
  pathValue?: string,
  workdir?: string
): string | undefined {
  if (!pathValue) {
    return undefined;
  }
  try {
    return joinAndNormalizePosix(workdir ?? '', pathValue);
  } catch {
    return pathValue;
  }
}

/**
 * Check if a string looks like a file system path.
 */
export function isPathLike(s: string | null | undefined): boolean {
  if (!s) {
    return false;
  }
  return (
    /^(~|\/.+|[A-Za-z]:\\)/.test(s) || /.+\.[A-Za-z0-9]{1,6}(\s|$)/.test(s)
  );
}

/**
 * Convert an absolute filesystem path into a path relative to the Jupyter
 * server's Contents root (`ServerApp.root_dir`), which is what
 * `docmanager:open`/`filebrowser:go-to-path` actually expect -- they do NOT
 * accept raw absolute OS paths. Returns `undefined` if `absolutePath` falls
 * outside `rootDir` (or either is missing/unresolvable), meaning the path
 * genuinely cannot be opened through JupyterLab's file APIs from this
 * server; callers should disable the corresponding action in that case
 * rather than invoking a command that will silently no-op.
 */
export function toRootRelativePath(
  absolutePath: string | undefined,
  rootDir: string | undefined | null
): string | undefined {
  if (!absolutePath || !rootDir) {
    return undefined;
  }
  const normalize = (p: string) => p.replace(/\/+$/, '') || '/';
  const root = normalize(rootDir);
  const target = normalize(absolutePath);
  // `root === '/'` is a degenerate special case: EVERY absolute path is
  // "under" the filesystem root, but the general-case check below
  // (`target.startsWith(`${root}/`)`) computes a `${root}/` prefix of `//`
  // in this case, which no real absolute path (starting with a single `/`)
  // can ever match -- so every path would incorrectly be reported as
  // outside root_dir, permanently disabling every Open/Edit action.
  if (root === '/') {
    return target === '/' ? '' : target.slice(1);
  }
  if (target === root) {
    return '';
  }
  if (target.startsWith(`${root}/`)) {
    return target.slice(root.length + 1);
  }
  return undefined;
}
