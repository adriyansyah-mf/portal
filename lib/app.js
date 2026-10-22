import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { PortalError } from './mikrotik.js';
import { AttemptLimiter, readInput } from './validation.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

export function createApp({ mikrotik, origin, serverFactory = createServer, trustProxy = false }) {
  const limiter = new AttemptLimiter();
  const pending = new Set();
  return serverFactory(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method === 'GET' && assets.has(request.url)) {
        const [file, contentType] = assets.get(request.url);
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(content);
        return;
      }
      if (request.url !== '/api/change-password') return reply(404, { message: 'Page not found.' });
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return reply(405, { message: 'Method not allowed.' });
      }
      if (request.headers.origin !== origin) throw new PortalError(403, 'Please open the portal and try again.');
      const forwardedAddress = typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for'].split(',')[0].trim()
        : '';
      const clientAddress = trustProxy && isIP(forwardedAddress) ? forwardedAddress : request.socket.remoteAddress;
      limiter.consume(`ip:${clientAddress}`);
      const input = await readInput(request);
      limiter.consume(`user:${input.username}`);
      if (pending.has(input.username)) throw new PortalError(409, 'A password change is already in progress. Please wait.');
      pending.add(input.username);
      try { await mikrotik.changePassword(input); }
      finally { pending.delete(input.username); }
      reply(200, { message: 'Your password has been updated. Use your new password the next time you sign in to Wi-Fi.' });
    } catch (error) {
      if (error instanceof PortalError) {
        if (error.status === 429) response.setHeader('Retry-After', '900');
        reply(error.status, { message: error.message });
      } else {
        reply(500, { message: 'Something went wrong. Please try again later.' });
      }
    }
  });
}
