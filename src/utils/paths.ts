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
