import { randomUUID } from 'node:crypto';

export interface AuthSession {
  account: string;
  roles: string[];
}

/**
 * Bridges the SASL-verified IRC identity to the HTTP API. When a browser
 * session authenticates over the gateway, we mint an opaque bearer token bound
 * to its account; the client presents it on API requests. Tokens live only in
 * memory (same process as the gateway + HTTP server) and are revoked on
 * disconnect.
 */
export class AuthRegistry {
  private byToken = new Map<string, AuthSession>();

  mint(account: string, roles: string[]): string {
    const token = randomUUID();
    this.byToken.set(token, { account, roles });
    return token;
  }

  /** Directly register a token (used only by the dev-token test hook). */
  put(token: string, session: AuthSession): void {
    this.byToken.set(token, session);
  }

  resolve(token: string | null | undefined): AuthSession | null {
    if (!token) return null;
    return this.byToken.get(token) ?? null;
  }

  /** Parse a `Bearer <token>` Authorization header. */
  resolveHeader(header: string | undefined): AuthSession | null {
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return this.resolve(match?.[1]);
  }

  revoke(token: string): void {
    this.byToken.delete(token);
  }
}
