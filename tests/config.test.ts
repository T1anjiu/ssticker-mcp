import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuration safety", () => {
  it("refuses an unauthenticated remote bind", () => {
    expect(() => loadConfig({
      cwd: process.cwd(),
      ensureDirectories: false,
      env: {
        SSTICKER_HOST: "0.0.0.0",
        SSTICKER_AUTH_MODE: "none",
        SSTICKER_SIGNING_SECRET: "signing-secret-with-at-least-thirty-two-bytes",
        SSTICKER_SESSION_SECRET: "session-secret-with-at-least-thirty-two-bytes"
      }
    })).toThrow(/Refusing to bind remotely/);
  });

  it("requires complete OIDC configuration", () => {
    expect(() => loadConfig({
      cwd: process.cwd(),
      ensureDirectories: false,
      env: {
        SSTICKER_AUTH_MODE: "oidc",
        SSTICKER_OIDC_ISSUER: "https://issuer.example",
        SSTICKER_SIGNING_SECRET: "signing-secret-with-at-least-thirty-two-bytes",
        SSTICKER_SESSION_SECRET: "session-secret-with-at-least-thirty-two-bytes"
      }
    })).toThrow(/SSTICKER_OIDC_AUDIENCE/);
  });
});
