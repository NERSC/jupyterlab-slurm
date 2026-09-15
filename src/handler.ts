import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

import { devLog } from './utils/logger';

/**
 * Raised when the server responds with HTTP 2xx but the unified response
 * envelope carries `success: false`. This lets callers/`catch()` blocks
 * treat "the request went through but the operation failed" the same way
 * as an HTTP-level error, instead of relying on ad hoc `.success` checks
 * (or console logging) scattered across the codebase.
 */
export class SlurmApiError extends Error {
  readonly errorMessage: string | null;
  readonly exitCode: number | null;
  readonly responseMessage: string | null;
  readonly data: unknown;

  constructor(body: any) {
    super(
      body?.errorMessage || body?.responseMessage || 'Slurm API request failed'
    );
    this.name = 'SlurmApiError';
    this.errorMessage = body?.errorMessage ?? null;
    this.exitCode = typeof body?.exitCode === 'number' ? body.exitCode : null;
    this.responseMessage = body?.responseMessage ?? null;
    this.data = body?.data ?? {};
  }
}

/**
 * Call the API extension
 *
 * @param endPoint API REST end point for the extension
 * @param urlParams additional URL parameters included for the endpoint
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T>(
  endPoint = '',
  urlParams: URLSearchParams = new URLSearchParams(),
  init: RequestInit = {},
  throwOnFailure = false
): Promise<T> {
  // Make request to Jupyter API
  const settings = ServerConnection.makeSettings();
  let paramsUrl = endPoint;

  if (urlParams.toString().length > 0) {
    paramsUrl = endPoint + '?' + urlParams.toString();
  }

  const requestUrl = URLExt.join(
    settings.baseUrl,
    'jupyterlab_slurm',
    paramsUrl
  );

  let response: Response;
  try {
    devLog('requestAPI new request', requestUrl);
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    // Log only the endpoint and error, never the full request body/settings
    // (which may contain job data or other request details).
    console.error('Error with server response: ', requestUrl, error);
    throw error;
  }

  let data = null;
  if (!response.ok) {
    // Non-2xx: the body is still JSON (the unified envelope), but surface it
    // as an HTTP-level error so callers can rely on a single `catch()` to
    // handle malformed requests, authorization failures, unavailable
    // commands, and internal errors uniformly.
    const text = await response.text();
    console.error('Error code: ', response.status);
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    // `ServerConnection.ResponseError`'s second constructor argument is a
    // *string* message (it's passed straight to `Error`'s constructor,
    // which stringifies any non-string value to the useless
    // "[object Object]"). The unified envelope is an object, not a string,
    // so extract a real message from it (falling back to the envelope's
    // default) rather than passing the whole parsed object as `message`.
    const message =
      data && typeof data === 'object'
        ? (data.errorMessage ?? data.responseMessage ?? undefined)
        : typeof data === 'string' && data.length > 0
          ? data
          : undefined;
    throw new ServerConnection.ResponseError(response, message);
  } else {
    data = await response.json();
  }

  if (typeof data === 'string' && data.length > 0) {
    try {
      // Development-only: full response bodies may contain job data, so
      // this is never logged in a production build.
      devLog('response data', requestUrl, data);
      data = JSON.parse(data);
    } catch (error) {
      console.error(
        'requestAPI: Not a JSON response body.',
        endPoint,
        response.status
      );
    }
  }

  // HTTP 2xx but the unified envelope reports `success: false` (e.g. a
  // Slurm command that ran but failed). Surface this the same way as an
  // HTTP-level error unless the caller explicitly opts out (some callers
  // need the raw envelope to show partial-success details, e.g. per-job
  // hold/release results).
  if (
    throwOnFailure &&
    data &&
    typeof data === 'object' &&
    data.success === false
  ) {
    throw new SlurmApiError(data);
  }

  return data;
}
