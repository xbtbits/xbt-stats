// www.xbtstats.com: a separate tiny Worker that sends every request to the bare domain.
// The target is fixed, so a request can never be redirected anywhere else.
const TARGET = 'https://xbtstats.com';

export default {
  async fetch(request) {
    const { pathname, search } = new URL(request.url);
    return new Response(null, {
      status: 301,
      headers: { location: `${TARGET}${pathname}${search}`, 'cache-control': 'public, max-age=86400' },
    });
  },
};
