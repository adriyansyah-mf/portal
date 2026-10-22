import { createHash, timingSafeEqual } from 'node:crypto';

export class PortalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Mikrotik {
  constructor(config) {
    this.config = config;
  }

  async request(path, options = {}) {
    const { url, username, password } = this.config;
    if (!url || !username || !password) {
      throw new PortalError(503, 'Password changes are not available yet. Please contact your network administrator.');
    }
    let response;
    try {
      response = await fetch(`${url}/rest/ip/hotspot/user${path}`, {
        ...options,
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new PortalError(502, 'The network service is unavailable. Please try again later.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PortalError(502, 'The network service could not complete the request. Please contact your network administrator.');
    }
    try {
      return await response.json();
    } catch {
      throw new PortalError(502, 'The network service returned an unexpected response.');
    }
  }

  async changePassword(input) {
    const users = await this.request('/print', {
      method: 'POST',
      body: JSON.stringify({
        '.query': [`name=${input.username}`],
        '.proplist': ['.id', 'name', 'password', 'disabled'],
        'show-sensitive': '',
      }),
    });
    if (!Array.isArray(users) || users.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new PortalError(502, 'The network service returned an unexpected response.');
    }
    const user = users.find(item => item.name === input.username);
    const digest = value => createHash('sha256').update(value).digest();
    const stored = typeof user?.password === 'string' ? user.password : '';
    const matches = timingSafeEqual(digest(stored), digest(input.currentPassword));
    if (!user || !matches || !stored || user.disabled === 'true' || user.disabled === true) {
      throw new PortalError(401, 'Your username or current password is incorrect.');
    }
    if (typeof user['.id'] !== 'string' || !/^\*[a-f\d]+$/i.test(user['.id'])) {
      throw new PortalError(502, 'The network service returned an unexpected response.');
    }
    await this.request(`/${encodeURIComponent(user['.id'])}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: input.newPassword }),
    });
  }
}
