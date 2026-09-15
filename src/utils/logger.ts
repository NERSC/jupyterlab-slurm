/**
 * Development-only logging helper.
 *
 * Production JupyterLab builds are made with `NODE_ENV=production` (the
 * default for `jlpm build:prod` / the packaged labextension), so gating
 * verbose/diagnostic logging behind this check ensures normal user-facing
 * deployments never emit job data, request URLs/params, or other request
 * details to the browser console. `console.error`/`console.warn` calls that
 * report a genuine failure (without dumping full payloads) are intentionally
 * left ungated, since operators/users legitimately need to see that
 * something went wrong.
 */
export function isDevMode(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Logs verbose/diagnostic information (e.g. full request/response bodies)
 * only in non-production builds. Never call this with data that should
 * never reach a browser console in any build (secrets, credentials).
 */
export function devLog(...args: unknown[]): void {
  if (isDevMode()) {
    // eslint-disable-next-line no-console
    console.debug(...args);
  }
}
