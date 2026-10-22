import { createApp } from './lib/app.js';
import { Mikrotik } from './lib/mikrotik.js';
import { createServer as createSecureServer } from 'node:https';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const origin = new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${port}`).origin;
const tlsCertFile = process.env.TLS_CERT_FILE;
const tlsKeyFile = process.env.TLS_KEY_FILE;
if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together.');
const tlsOptions = tlsCertFile
  ? { cert: await readFile(tlsCertFile), key: await readFile(tlsKeyFile) }
  : undefined;
const serverFactory = tlsOptions
  ? listener => createSecureServer(tlsOptions, listener)
  : undefined;
const url = process.env.MIKROTIK_URL?.replace(/\/$/, '');
if (url) {
  const router = new URL(url);
  if (router.protocol !== 'https:' || router.username || router.password || router.search || router.hash || router.pathname !== '/') {
    throw new Error('MIKROTIK_URL must be an HTTPS origin, for example https://192.168.88.1.');
  }
}
const app = createApp({
  origin,
  serverFactory,
  trustProxy: process.env.TRUST_PROXY === 'true',
  mikrotik: new Mikrotik({ url, username: process.env.MIKROTIK_USERNAME, password: process.env.MIKROTIK_PASSWORD }),
});
app.listen(port, process.env.HOST || '127.0.0.1');
