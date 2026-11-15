const CONSOLE_PATH = '/command-center';

const PAGE_HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    const page = await env.ASSETS.fetch(new Request(new URL(CONSOLE_PATH, url), request));
    const response = new Response(page.body, page);
    for (const [name, value] of Object.entries(PAGE_HEADERS)) response.headers.set(name, value);
    return response;
  },
};
