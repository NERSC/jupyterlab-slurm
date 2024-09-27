namespace types {
  export type Request = {
    route: string;
    method: string;
    query?: string;
    body?: string | FormData | URLSearchParams;
    beforeResponse?: () => any[];
    afterResponse?: (response: Response, ...args: any[]) => Promise<any>;
  };
}

export async function makeRequest(request: types.Request) {
  const { route, method, query, body, beforeResponse, afterResponse } = request;
  if (request.route.indexOf('squeue') != -1) {
  }
}
