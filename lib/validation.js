import { createHash } from 'node:crypto';
import { PortalError } from './mikrotik.js';

export async function readInput(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new PortalError(415, 'Please submit the form as JSON.');
  }
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) throw new PortalError(413, 'The submitted form is too large.');
  }
  let input;
  try { input = JSON.parse(body); }
  catch { throw new PortalError(400, 'The submitted form is invalid.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PortalError(400, 'Please complete every field.');
  }
  const { username, currentPassword, newPassword, confirmPassword } = input;
  if (![username, currentPassword, newPassword, confirmPassword].every(value => typeof value === 'string' && value.length > 0)) {
    throw new PortalError(400, 'Please complete every field.');
  }
  if (username.length > 128 || currentPassword.length > 256 || /[\x00-\x1f\x7f]/.test(username)) {
    throw new PortalError(400, 'Your username or current password is invalid.');
  }
  if (newPassword.length < 8 || newPassword.length > 64 || /[^\x20-\x7e]/.test(newPassword)) {
    throw new PortalError(400, 'Use 8–64 characters: English letters, numbers, spaces, or symbols.');
  }
  if (newPassword !== confirmPassword) throw new PortalError(400, 'Your new passwords do not match.');
  if (newPassword === currentPassword) throw new PortalError(400, 'Choose a password different from your current password.');
  return { username, currentPassword, newPassword };
}

export class AttemptLimiter {
  entries = new Map();

  consume(key) {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(id);
    }
    const id = createHash('sha256').update(key).digest('hex');
    const entry = this.entries.get(id) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (entry.count >= 10 || (!this.entries.has(id) && this.entries.size >= 10000)) {
      throw new PortalError(429, 'Too many attempts. Please try again in 15 minutes.');
    }
    entry.count++;
    this.entries.set(id, entry);
  }
}
