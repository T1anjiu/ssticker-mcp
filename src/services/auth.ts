import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config.js";
import type { SStickerDatabase } from "../db/database.js";
import { addSecondsIso, hmacSha256, secureStringEqual, sha256 } from "../utils.js";

export interface AuthenticatedSubject {
  subject: string;
  scopes: Set<string>;
  payload?: JWTPayload;
}

export interface AdminSessionResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

declare global {
  namespace Express {
    interface Request {
      sstickerAuth?: AuthenticatedSubject;
      sstickerAdminSession?: { id: string; tokenId: string };
    }
  }
}

export class AuthService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(
    private readonly config: AppConfig,
    private readonly database: SStickerDatabase
  ) {
    this.jwks = config.oidc ? createRemoteJWKSet(new URL(config.oidc.jwksUrl)) : null;
  }

  async createAdminToken(name: string): Promise<{ id: string; token: string; prefix: string }> {
    const token = `sst_admin_${randomBytes(32).toString("base64url")}`;
    const prefix = token.slice(0, 16);
    const hash = await argon2.hash(token, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const id = this.database.createAdminToken(name, hash, prefix);
    return { id, token, prefix };
  }

  async createAdminSession(token: string): Promise<AdminSessionResult | null> {
    const candidates = this.database.listActiveAdminTokens().filter((candidate) => token.startsWith(candidate.prefix));
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.hash, token)) {
        const sessionToken = randomBytes(32).toString("base64url");
        const csrfToken = randomBytes(24).toString("base64url");
        const expiresAt = addSecondsIso(8 * 3600);
        this.database.createAdminSession(candidate.id, sha256(sessionToken), hmacSha256(this.config.sessionSecret, csrfToken), expiresAt);
        return { sessionToken, csrfToken, expiresAt };
      }
    }
    return null;
  }

  oidcMiddleware(requiredScopes: (request: Request) => string[]): (request: Request, response: Response, next: NextFunction) => Promise<void> {
    return async (request, response, next) => {
      if (this.config.authMode === "none") {
        request.sstickerAuth = { subject: "local", scopes: new Set(["ssticker.recommend", "ssticker.feedback", "ssticker.catalog.read", "ssticker.admin"]) };
        next();
        return;
      }
      const authorization = request.header("authorization");
      if (!authorization?.startsWith("Bearer ") || !this.jwks || !this.config.oidc) {
        this.unauthorized(response, "invalid_token", "A bearer access token is required");
        return;
      }
      try {
        const token = authorization.slice("Bearer ".length);
        const verified = await jwtVerify(token, this.jwks, {
          issuer: this.config.oidc.issuer,
          audience: this.config.oidc.audience
        });
        const scopes = extractScopes(verified.payload);
        const missing = requiredScopes(request).filter((scope) => !scopes.has(scope));
        if (missing.length > 0) {
          response.setHeader("WWW-Authenticate", this.challenge("insufficient_scope", `Missing scopes: ${missing.join(" ")}`, missing));
          response.status(403).json({ error: "insufficient_scope", required_scopes: missing });
          return;
        }
        request.sstickerAuth = { subject: verified.payload.sub ?? "oidc", scopes, payload: verified.payload };
        next();
      } catch {
        this.unauthorized(response, "invalid_token", "The access token could not be verified");
      }
    };
  }

  adminSessionMiddleware(options: { csrf: boolean }): (request: Request, response: Response, next: NextFunction) => void {
    return (request, response, next) => {
      const sessionToken = request.cookies?.ssticker_admin as string | undefined;
      if (!sessionToken) {
        response.status(401).json({ error: "admin_session_required" });
        return;
      }
      const sessionHash = sha256(sessionToken);
      const session = this.database.getAdminSession(sessionHash);
      if (!session) {
        response.clearCookie("ssticker_admin");
        response.clearCookie("ssticker_csrf");
        response.status(401).json({ error: "admin_session_expired" });
        return;
      }
      if (options.csrf) {
        const csrfHeader = request.header("x-csrf-token") ?? "";
        const csrfCookie = request.cookies?.ssticker_csrf as string | undefined;
        const csrfHash = hmacSha256(this.config.sessionSecret, csrfHeader);
        if (!csrfCookie || !csrfHeader || !secureStringEqual(csrfHeader, csrfCookie) || !secureStringEqual(csrfHash, session.csrf_hash)) {
          response.status(403).json({ error: "csrf_validation_failed" });
          return;
        }
      }
      request.sstickerAdminSession = { id: session.id, tokenId: session.token_id };
      next();
    };
  }

  revokeAdminSession(rawSessionToken: string | undefined): void {
    if (rawSessionToken) {
      this.database.revokeAdminSession(sha256(rawSessionToken));
    }
  }

  protectedResourceMetadata(): Record<string, unknown> {
    const resource = `${this.config.publicBaseUrl}/mcp`;
    return {
      resource,
      authorization_servers: this.config.oidc ? [this.config.oidc.issuer] : [],
      scopes_supported: ["ssticker.recommend", "ssticker.feedback", "ssticker.catalog.read", "ssticker.admin"],
      bearer_methods_supported: ["header"]
    };
  }

  private unauthorized(response: Response, error: string, description: string): void {
    response.setHeader("WWW-Authenticate", this.challenge(error, description));
    response.status(401).json({ error, error_description: description });
  }

  private challenge(error: string, description: string, scopes: string[] = []): string {
    const metadataUrl = `${this.config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;
    const scope = scopes.length > 0 ? `, scope="${scopes.join(" ")}"` : "";
    return `Bearer error="${error}", error_description="${description.replaceAll('"', "'")}", resource_metadata="${metadataUrl}"${scope}`;
  }
}

function extractScopes(payload: JWTPayload): Set<string> {
  const scope = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const scp = Array.isArray(payload.scp) ? payload.scp.filter((value): value is string => typeof value === "string") : [];
  return new Set([...scope, ...scp].filter(Boolean));
}
