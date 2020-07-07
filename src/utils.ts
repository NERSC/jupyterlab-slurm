import {
  ServerConnection,
} from '@jupyterlab/services';

import {
  URLExt,
  PageConfig,
} from '@jupyterlab/coreutils';

namespace types {
  export type Request = {
    route: string,
    method: string,
    query?: string,
    body?: string | FormData | URLSearchParams,
    beforeResponse?: () => any[],
    afterResponse?: (response: Response, ...args: any[]) => Promise<any>,
  };
}

export async function makeRequest(request: types.Request) {
  const { route, method, query, body, beforeResponse, afterResponse } = request;
  const settings = ServerConnection.makeSettings();
  // Prepend command with the base URL to yield the final endpoint
  const endpoint = URLExt.join(settings.baseUrl, query ? `${route}${query}` : route);
  const requestInit: RequestInit = {
    method,
    headers: {
      // Add Jupyter authorization (XRSF) token to request header
      'Authorization': 'token ' + PageConfig.getToken(),
      // Prevent it from enconding as plain-text UTF-8
      'Content-Type': 'application/x-www-form-urlencoded'
    },
  }
  if (body) {
    if (typeof (body) == "string") {
      requestInit.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body instanceof URLSearchParams) {
      requestInit.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    requestInit.body = body;
  }
  try {
    const args = beforeResponse ? beforeResponse() : undefined;
    const response = await ServerConnection.makeRequest(endpoint, requestInit, settings);
    if (afterResponse) {
      if (args)
        return afterResponse(response, ...args);
      else
        return afterResponse(response);
    }
  }
  catch (error) {
    console.log(error);
  }
}
