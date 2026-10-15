export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    if (route instanceof Error) throw route;
    if (route instanceof Uint8Array) return new Response(route, { status: 200 });
    if (route === 'hang') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason));
      });
    }
    if (route && typeof route === 'object' && 'status' in route && 'body' in route) {
      const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }
    return new Response(JSON.stringify(route), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}
