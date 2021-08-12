import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

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
  init: RequestInit = {}
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
    //console.log('requestAPI new request', requestUrl, init, settings);
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    console.error(
      'Error with server response: ',
      requestUrl,
      init,
      settings,
      error
    );
  }

  let data = null;
  if (!response.ok) {
    data = await response.text();
    console.error('Error code: ', response.status);
    throw new ServerConnection.ResponseError(response, data);
  } else {
    data = await response.json();
  }

  if (data.length > 0) {
    try {
      console.log('response data', requestUrl, urlParams, init, data);
      data = JSON.parse(data);
    } catch (error) {
      console.error(
        'requestAPI: Not a JSON response body.',
        endPoint,
        urlParams,
        init,
        response
      );
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}
