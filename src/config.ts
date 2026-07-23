import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export type AuthMode = "none" | "oidc";
export type EmbeddingProviderName = "local" | "hash";

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  assetDir: string;
  originalDir: string;
  variantDir: string;
  uploadDir: string;
  modelCacheDir: string;
  publicBaseUrl: string;
  signingSecret: string;
  sessionSecret: string;
  allowedOrigins: string[];
  authMode: AuthMode;
  allowInsecureRemote: boolean;
  oidc?: {
    issuer: string;
    audience: string;
    jwksUrl: string;
  };
  embeddingProvider: EmbeddingProviderName;
  modelId: string;
  llm?: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  logLevel: string;
  projectRoot: string;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  ensureDirectories?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const dataDir = resolve(projectRoot, env.SSTICKER_DATA_DIR ?? "data");
  const host = env.SSTICKER_HOST ?? "127.0.0.1";
  const port = parseInteger(env.SSTICKER_PORT, 3377, 1, 65535, "SSTICKER_PORT");
  const authMode = parseEnum(env.SSTICKER_AUTH_MODE, ["none", "oidc"] as const, "none", "SSTICKER_AUTH_MODE");
  const allowInsecureRemote = env.SSTICKER_ALLOW_INSECURE_REMOTE === "true";
  const remoteBinding = !isLoopbackHost(host);

  if (remoteBinding && authMode === "none" && !allowInsecureRemote) {
    throw new Error("Refusing to bind remotely without OIDC. Set SSTICKER_AUTH_MODE=oidc or explicitly enable SSTICKER_ALLOW_INSECURE_REMOTE=true for development.");
  }

  const ensureDirectories = options.ensureDirectories ?? true;
  if (ensureDirectories) {
    for (const path of [dataDir, resolve(dataDir, "assets/originals"), resolve(dataDir, "assets/variants"), resolve(dataDir, "uploads"), resolve(dataDir, "models")]) {
      mkdirSync(path, { recursive: true });
    }
  }

  const secrets = ensureDirectories
    ? loadOrCreateSecrets(dataDir, env)
    : {
        signingSecret: env.SSTICKER_SIGNING_SECRET ?? "test-signing-secret-with-at-least-32-bytes",
        sessionSecret: env.SSTICKER_SESSION_SECRET ?? "test-session-secret-with-at-least-32-bytes"
      };

  const oidc = authMode === "oidc" ? readOidcConfig(env) : undefined;
  const llm = readLlmConfig(env);
  const publicBaseUrl = (env.SSTICKER_PUBLIC_BASE_URL ?? `http://${host}:${port}`).replace(/\/$/, "");

  return {
    host,
    port,
    dataDir,
    databasePath: resolve(dataDir, "ssticker.sqlite"),
    assetDir: resolve(dataDir, "assets"),
    originalDir: resolve(dataDir, "assets/originals"),
    variantDir: resolve(dataDir, "assets/variants"),
    uploadDir: resolve(dataDir, "uploads"),
    modelCacheDir: resolve(projectRoot, env.SSTICKER_MODEL_CACHE ?? resolve(dataDir, "models")),
    publicBaseUrl,
    signingSecret: secrets.signingSecret,
    sessionSecret: secrets.sessionSecret,
    allowedOrigins: splitCsv(env.SSTICKER_ALLOWED_ORIGINS ?? `${publicBaseUrl},http://localhost:${port}`),
    authMode,
    allowInsecureRemote,
    oidc,
    embeddingProvider: parseEnum(env.SSTICKER_EMBEDDING_PROVIDER, ["local", "hash"] as const, "local", "SSTICKER_EMBEDDING_PROVIDER"),
    modelId: env.SSTICKER_MODEL_ID ?? "intfloat/multilingual-e5-small",
    llm,
    logLevel: env.SSTICKER_LOG_LEVEL ?? "info",
    projectRoot
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function loadOrCreateSecrets(dataDir: string, env: NodeJS.ProcessEnv): { signingSecret: string; sessionSecret: string } {
  const explicitSigning = env.SSTICKER_SIGNING_SECRET;
  const explicitSession = env.SSTICKER_SESSION_SECRET;
  if (explicitSigning && explicitSession) {
    assertSecret(explicitSigning, "SSTICKER_SIGNING_SECRET");
    assertSecret(explicitSession, "SSTICKER_SESSION_SECRET");
    return { signingSecret: explicitSigning, sessionSecret: explicitSession };
  }

  const secretPath = resolve(dataDir, "secrets.json");
  if (existsSync(secretPath)) {
    const parsed = JSON.parse(readFileSync(secretPath, "utf8")) as { signingSecret?: string; sessionSecret?: string };
    if (!parsed.signingSecret || !parsed.sessionSecret) {
      throw new Error(`Invalid secrets file: ${secretPath}`);
    }
    assertSecret(parsed.signingSecret, "stored signing secret");
    assertSecret(parsed.sessionSecret, "stored session secret");
    return {
      signingSecret: explicitSigning ?? parsed.signingSecret,
      sessionSecret: explicitSession ?? parsed.sessionSecret
    };
  }

  const generated = {
    signingSecret: explicitSigning ?? randomBytes(48).toString("base64url"),
    sessionSecret: explicitSession ?? randomBytes(48).toString("base64url")
  };
  assertSecret(generated.signingSecret, "signing secret");
  assertSecret(generated.sessionSecret, "session secret");
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, `${JSON.stringify(generated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(secretPath, 0o600);
  } catch {
    // Windows does not implement POSIX modes; ACLs remain controlled by the current user.
  }
  return generated;
}

function readOidcConfig(env: NodeJS.ProcessEnv): AppConfig["oidc"] {
  const issuer = required(env.SSTICKER_OIDC_ISSUER, "SSTICKER_OIDC_ISSUER");
  const audience = required(env.SSTICKER_OIDC_AUDIENCE, "SSTICKER_OIDC_AUDIENCE");
  const jwksUrl = required(env.SSTICKER_OIDC_JWKS_URL, "SSTICKER_OIDC_JWKS_URL");
  return { issuer, audience, jwksUrl };
}

function readLlmConfig(env: NodeJS.ProcessEnv): AppConfig["llm"] {
  const baseUrl = env.SSTICKER_LLM_BASE_URL?.replace(/\/$/, "");
  const model = env.SSTICKER_LLM_MODEL;
  if (!baseUrl && !model) {
    return undefined;
  }
  if (!baseUrl || !model) {
    throw new Error("SSTICKER_LLM_BASE_URL and SSTICKER_LLM_MODEL must be configured together");
  }
  return { baseUrl, model, apiKey: env.SSTICKER_LLM_API_KEY ?? "" };
}

function assertSecret(value: string, name: string): void {
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function splitCsv(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseEnum<const T extends readonly string[]>(value: string | undefined, choices: T, fallback: T[number], name: string): T[number] {
  const selected = value ?? fallback;
  if (!choices.includes(selected as T[number])) {
    throw new Error(`${name} must be one of: ${choices.join(", ")}`);
  }
  return selected as T[number];
}
