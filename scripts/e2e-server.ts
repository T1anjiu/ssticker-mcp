import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { createRuntime } from "../src/runtime.js";
import { startHttpServer } from "../src/http/app.js";

const root = process.cwd();
const stateDirectory = resolve(root, ".tmp-e2e");
const dataDirectory = resolve(stateDirectory, "data");
const fixtureDirectory = resolve(stateDirectory, "fixtures");
await rm(stateDirectory, { recursive: true, force: true });
await mkdir(fixtureDirectory, { recursive: true });

const runtime = createRuntime({
  cwd: root,
  env: {
    ...process.env,
    SSTICKER_HOST: "127.0.0.1",
    SSTICKER_PORT: "3389",
    SSTICKER_DATA_DIR: dataDirectory,
    SSTICKER_PUBLIC_BASE_URL: "http://127.0.0.1:3389",
    SSTICKER_ALLOWED_ORIGINS: "http://127.0.0.1:3389",
    SSTICKER_AUTH_MODE: "none",
    SSTICKER_EMBEDDING_PROVIDER: "hash",
    SSTICKER_SIGNING_SECRET: "e2e-signing-secret-with-at-least-thirty-two-bytes",
    SSTICKER_SESSION_SECRET: "e2e-session-secret-with-at-least-thirty-two-bytes",
    SSTICKER_LOG_LEVEL: "silent"
  }
});

const fixturePath = resolve(fixtureDirectory, "review-me.png");
await sharp({ create: { width: 192, height: 192, channels: 4, background: { r: 142, g: 160, b: 63, alpha: 1 } } })
  .composite([{ input: Buffer.from("<svg width='192' height='192' xmlns='http://www.w3.org/2000/svg'><circle cx='72' cy='82' r='10' fill='#1f291c'/><circle cx='120' cy='82' r='10' fill='#1f291c'/><path d='M58 121 Q96 151 134 121' fill='none' stroke='#1f291c' stroke-width='9' stroke-linecap='round'/></svg>") }])
  .png()
  .toFile(fixturePath);
const imported = await runtime.catalog.importManifest({
  manifest_version: 1,
  items: [{
    external_id: "e2e-review-me",
    file: "review-me.png",
    title: "待审核笑脸",
    alt_text: { "zh-CN": "一个待审核的开心笑脸", en: "A happy face awaiting review" },
    scenes: [{ id: "joy", weight: 1 }],
    tags: ["开心", "smile"],
    tone: ["wholesome"],
    intensity: 0.55,
    audience: "any",
    safety: "safe",
    license: "CC0-1.0",
    source: "ssticker e2e fixture",
    attribution: "ssticker project",
    pack: "e2e"
  }]
}, fixtureDirectory);
if (imported.imported !== 1) {
  throw new Error(`Unable to create E2E fixture: ${JSON.stringify(imported)}`);
}

const admin = await runtime.auth.createAdminToken("e2e-admin");
await writeFile(resolve(stateDirectory, "credentials.json"), JSON.stringify({ token: admin.token }), "utf8");
const server = await startHttpServer(runtime);

const shutdown = () => {
  server.close(() => {
    runtime.close();
    process.exit(0);
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
