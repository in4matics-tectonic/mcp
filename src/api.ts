// Thin client for the KBC Momentum backend. The MCP server always acts *as the customer*:
// it only ever holds a `klant` token, and the klantId comes from that token, never from the AI.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`KBC API ${status} ${code}`);
  }
}

type Login = { username: string; password: string };

interface Me {
  sub: string;
  role: string;
  klantId?: string;
}

export class KbcApi {
  private token?: string;
  private klantId?: string;
  private login?: Login;

  /** Either log in with the customer's credentials (stdio) or reuse a token the MCP client passed (http). */
  constructor(
    private baseUrl: string,
    auth: { login: Login } | { token: string },
  ) {
    if ('token' in auth) this.token = auth.token;
    else this.login = auth.login;
  }

  private async request(method: string, path: string, body?: unknown, retry = true): Promise<any> {
    if (!this.token) await this.doLogin();
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    // Token expired (1h): log in again once, if we can
    if (res.status === 401 && retry && this.login) {
      this.token = undefined;
      return this.request(method, path, body, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data?.error ?? 'unknown_error');
    return data;
  }

  private async doLogin() {
    if (!this.login) throw new ApiError(401, 'unauthorized');
    const res = await fetch(this.baseUrl + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.login),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data?.error ?? 'login_failed');
    this.token = data.token;
  }

  /** Resolves the customer behind the token. Refuses anything that isn't a customer (adviseur/ingest tokens). */
  async klant(): Promise<string> {
    if (this.klantId) return this.klantId;
    const me: Me = await this.request('GET', '/v1/me');
    if (me.role !== 'klant' || !me.klantId) throw new ApiError(403, 'only_customer_tokens_allowed');
    return (this.klantId = me.klantId);
  }

  async share(body: { moment: string; fase: string; verwachte_maand?: string }) {
    return this.request('POST', `/v1/klanten/${enc(await this.klant())}/momenten/delen`, body);
  }

  async momenten() {
    return this.request('GET', `/v1/klanten/${enc(await this.klant())}/momenten`);
  }

  async moment(moment: string) {
    return this.request('GET', `/v1/klanten/${enc(await this.klant())}/momenten/${enc(moment)}`);
  }

  async revoke(moment: string) {
    return this.request('DELETE', `/v1/klanten/${enc(await this.klant())}/momenten/${enc(moment)}`);
  }
}

const enc = encodeURIComponent;
