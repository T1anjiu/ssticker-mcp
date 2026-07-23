import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SStickerRuntime } from "../runtime.js";
import { createSStickerMcpServer } from "../mcp/server.js";
import { ManifestItemSchema } from "../domain/schemas.js";
import type { PolicyProfile, StickerRecord } from "../domain/types.js";
import { newId } from "../utils.js";

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);

export function createHttpApp(runtime: SStickerRuntime): Express {
  const app = createMcpExpressApp({ host: runtime.config.host });
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  const mcpLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const mcpSubjectLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => `${request.sstickerAuth?.subject ?? "anonymous"}:${ipKeyGenerator(request.ip ?? "127.0.0.1")}`
  });
  const adminLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });

  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/health/ready", (_request, response) => {
    try {
      response.json({ status: "ready", ...runtime.database.health() });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });
  app.get("/metrics", async (_request, response) => {
    updateOperationalMetrics(runtime);
    response.type(runtime.metrics.registry.contentType).send(await runtime.metrics.registry.metrics());
  });
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_request, response) => {
    response.json(runtime.auth.protectedResourceMetadata());
  });

  app.get("/assets/v1/:variantId", (request, response) => serveAsset(runtime, request, response));

  app.post(
    "/mcp",
    mcpLimiter,
    validateOrigin(runtime),
    validateProtocolVersion,
    runtime.auth.oidcMiddleware(requiredMcpScopes),
    mcpSubjectLimiter,
    async (request, response) => {
      const mcpServer = createSStickerMcpServer(runtime);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(request, response, request.body);
      } catch (error) {
        runtime.logger.error({ error: safeError(error) }, "MCP request failed");
        if (!response.headersSent) {
          response.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
        }
      } finally {
        await transport.close();
        await mcpServer.close();
      }
    }
  );
  app.get("/mcp", (_request, response) => methodNotAllowed(response));
  app.delete("/mcp", (_request, response) => methodNotAllowed(response));

  const admin = express.Router();
  admin.use(adminLimiter);
  mountAdminRoutes(admin, runtime);
  app.use("/api/v1/admin", admin);

  const adminDist = resolve(runtime.config.projectRoot, "apps/admin/dist");
  if (existsSync(adminDist)) {
    app.use("/admin", express.static(adminDist, { index: false, maxAge: "1h" }));
    app.get(["/admin", "/admin/*path"], (_request, response) => response.sendFile(resolve(adminDist, "index.html")));
  } else {
    app.get("/admin", (_request, response) => response.status(503).type("text/plain").send("Admin UI is not built. Run: pnpm --dir apps/admin build"));
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    runtime.logger.error({ error: safeError(error) }, "HTTP request failed");
    if (!response.headersSent) {
      response.status(500).json({ error: "internal_server_error" });
    }
  });
  return app;
}

export async function startHttpServer(runtime: SStickerRuntime): Promise<Server> {
  const app = createHttpApp(runtime);
  const server = createServer(app);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(runtime.config.port, runtime.config.host, () => resolvePromise());
  });
  runtime.jobs.start();
  runtime.logger.info({ host: runtime.config.host, port: runtime.config.port }, "ssticker HTTP server started");
  return server;
}

export async function startAssetOnlyServer(runtime: SStickerRuntime): Promise<Server> {
  const app = express();
  app.disable("x-powered-by");
  app.get("/assets/v1/:variantId", (request, response) => serveAsset(runtime, request, response));
  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  const server = createServer(app);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine stdio asset server address");
  }
  runtime.config.publicBaseUrl = `http://127.0.0.1:${address.port}`;
  return server;
}

function mountAdminRoutes(router: express.Router, runtime: SStickerRuntime): void {
  router.post("/session", async (request, response) => {
    const token = typeof request.body?.token === "string" ? request.body.token : "";
    const session = await runtime.auth.createAdminSession(token);
    if (!session) {
      response.status(401).json({ error: "invalid_admin_token" });
      return;
    }
    const secure = runtime.config.publicBaseUrl.startsWith("https://");
    response.cookie("ssticker_admin", session.sessionToken, { httpOnly: true, secure, sameSite: "strict", path: "/", expires: new Date(session.expiresAt) });
    response.cookie("ssticker_csrf", session.csrfToken, { httpOnly: false, secure, sameSite: "strict", path: "/", expires: new Date(session.expiresAt) });
    response.json({ authenticated: true, expires_at: session.expiresAt, csrf_token: session.csrfToken });
  });

  router.get("/session", runtime.auth.adminSessionMiddleware({ csrf: false }), (_request, response) => response.json({ authenticated: true }));
  router.delete("/session", runtime.auth.adminSessionMiddleware({ csrf: true }), (request, response) => {
    runtime.auth.revokeAdminSession(request.cookies?.ssticker_admin as string | undefined);
    response.clearCookie("ssticker_admin");
    response.clearCookie("ssticker_csrf");
    response.status(204).end();
  });

  router.use(runtime.auth.adminSessionMiddleware({ csrf: false }));
  router.get("/overview", (_request, response) => response.json(runtime.database.dashboardStats()));
  router.get("/stickers", (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status as StickerRecord["status"] : undefined;
    const query = typeof request.query.query === "string" ? request.query.query : undefined;
    const limit = numberQuery(request.query.limit, 50, 1, 200);
    const offset = numberQuery(request.query.offset, 0, 0, 1_000_000);
    const page = runtime.database.listStickers({ query, status, limit, offset });
    response.json({
      ...page,
      items: page.items.map((sticker) => {
        const thumbnail = runtime.database.getStickerVariants(sticker.id).find((variant) => variant.delivery_kind === "image");
        return { ...sticker, thumbnail_url: thumbnail ? runtime.assets.sign(thumbnail.id).downloadUrl : null };
      })
    });
  });
  router.get("/stickers/:id", (request, response) => {
    const sticker = runtime.database.getSticker(requestParam(request, "id"));
    if (!sticker) {
      response.status(404).json({ error: "sticker_not_found" });
      return;
    }
    response.json({
      sticker,
      scenes: runtime.database.getStickerScenes(sticker.id),
      tags: runtime.database.getStickerTags(sticker.id),
      variants: runtime.database.getStickerVariants(sticker.id).map((variant) => ({
        ...variant,
        download_url: runtime.assets.sign(variant.id).downloadUrl
      }))
    });
  });

  const csrf = runtime.auth.adminSessionMiddleware({ csrf: true });
  router.post("/stickers/bulk-status", csrf, (request, response) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0) : [];
    const status = request.body?.status;
    if (ids.length < 1 || ids.length > 100 || !["active", "disabled"].includes(status)) {
      response.status(400).json({ error: "ids must contain 1-100 sticker IDs and status must be active or disabled" });
      return;
    }
    const results = runtime.catalog.setStickerStatuses(ids, status as "active" | "disabled", `admin:${request.sstickerAdminSession?.tokenId ?? "unknown"}`);
    response.json({ results });
  });
  router.patch("/stickers/:id", csrf, async (request, response) => {
    const stickerId = requestParam(request, "id");
    const body = request.body as Record<string, unknown>;
    const changes: Partial<StickerRecord> = {};
    for (const key of ["title", "alt_text", "status", "safety", "license", "source", "attribution", "pack", "audience", "intensity", "tones"] as const) {
      if (body[key] !== undefined) {
        Object.assign(changes, { [key]: body[key] });
      }
    }
    const scenes = Array.isArray(body.scenes) ? body.scenes as Array<{ id: string; weight: number }> : undefined;
    const tags = Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === "string") : undefined;
    const updated = runtime.database.updateSticker(stickerId, changes, { scenes, tags }, `admin:${request.sstickerAdminSession?.tokenId ?? "unknown"}`);
    await runtime.catalog.reindexSticker(stickerId);
    response.json(updated);
  });
  router.post("/stickers/:id/review", csrf, async (request, response) => {
    const approved = request.body?.approved === true;
    const stickerId = requestParam(request, "id");
    const reviewed = runtime.catalog.reviewSticker(stickerId, approved, `admin:${request.sstickerAdminSession?.tokenId ?? "unknown"}`);
    await runtime.catalog.reindexSticker(stickerId);
    response.json(reviewed);
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_request, _file, callback) => {
        try {
          await mkdir(runtime.config.uploadDir, { recursive: true });
          callback(null, runtime.config.uploadDir);
        } catch (error) {
          callback(error as Error, runtime.config.uploadDir);
        }
      },
      filename: (_request, file, callback) => callback(null, `${newId()}-${file.originalname.replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024, files: 50 },
    fileFilter: (_request, file, callback) => callback(null, ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimetype))
  });
  router.post("/uploads", csrf, upload.array("files", 50), (request, response) => {
    const files = Array.isArray(request.files) ? request.files : [];
    const defaults = parseUploadDefaults(request.body?.metadata);
    const jobs = files.map((file) => {
      const title = file.originalname.replace(/\.[^.]+$/, "");
      const item = ManifestItemSchema.parse({
        external_id: `${slugForUpload(title)}-${newId().slice(0, 8)}`,
        file: file.filename,
        title,
        alt_text: { "zh-CN": title, en: title },
        scenes: defaults.scenes ?? [],
        tags: defaults.tags ?? [],
        tone: defaults.tone ?? [],
        intensity: defaults.intensity ?? 0.5,
        audience: defaults.audience ?? "any",
        safety: "safe",
        license: defaults.license ?? "",
        source: defaults.source ?? "",
        attribution: defaults.attribution ?? "",
        pack: defaults.pack ?? "default"
      });
      return runtime.database.createJob("catalog.import", { item, base_directory: runtime.config.uploadDir });
    });
    response.status(202).json({ jobs });
  });

  router.get("/jobs", (_request, response) => response.json({ jobs: runtime.database.listJobs() }));
  router.post("/index/rebuild", csrf, (_request, response) => response.status(202).json(runtime.database.createJob("index.rebuild", {})));
  router.get("/scenes", (_request, response) => response.json({ scenes: runtime.database.listScenes() }));
  router.get("/policies/:id", (request, response) => response.json(runtime.database.getPolicyProfile(requestParam(request, "id"))));
  router.patch("/policies/:id", csrf, (request, response) => {
    const current = runtime.database.getPolicyProfile(requestParam(request, "id"));
    const profile = { ...current, ...request.body, id: current.id, version: current.version + 1 } as PolicyProfile;
    validatePolicy(profile);
    runtime.database.updatePolicyProfile(profile, `admin:${request.sstickerAdminSession?.tokenId ?? "unknown"}`);
    response.json(profile);
  });
  router.get("/decisions", (request, response) => response.json({ decisions: runtime.database.listDecisions(numberQuery(request.query.limit, 100, 1, 500)) }));
  router.get("/system", (_request, response) => response.json({
    health: runtime.database.health(),
    config: {
      host: runtime.config.host,
      port: runtime.config.port,
      data_dir: runtime.config.dataDir,
      auth_mode: runtime.config.authMode,
      embedding_provider: runtime.config.embeddingProvider,
      model_id: runtime.config.modelId,
      llm_configured: Boolean(runtime.config.llm)
    },
    profiles: runtime.database.listChannelProfiles()
  }));
}

function serveAsset(runtime: SStickerRuntime, request: Request, response: Response): void {
  const variantId = requestParam(request, "variantId");
  const expires = typeof request.query.expires === "string" ? request.query.expires : undefined;
  const signature = typeof request.query.signature === "string" ? request.query.signature : undefined;
  if (!runtime.assets.verify(variantId, expires, signature)) {
    response.status(403).json({ error: "invalid_or_expired_asset_signature" });
    return;
  }
  const variant = runtime.database.getVariant(variantId);
  if (!variant) {
    response.status(404).json({ error: "asset_not_found" });
    return;
  }
  try {
    const path = runtime.assets.resolveVariantPath(variant);
    response.setHeader("Content-Type", variant.mime_type);
    response.setHeader("Content-Length", String(variant.bytes));
    response.setHeader("Cache-Control", "private, max-age=60");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.sendFile(path);
  } catch {
    response.status(404).json({ error: "asset_file_missing" });
  }
}

function validateOrigin(runtime: SStickerRuntime): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const origin = request.header("origin");
    if (origin && !runtime.config.allowedOrigins.includes(origin)) {
      response.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin is not allowed" }, id: null });
      return;
    }
    next();
  };
}

function validateProtocolVersion(request: Request, response: Response, next: NextFunction): void {
  const version = request.header("mcp-protocol-version");
  if (version && !SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
    response.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Unsupported MCP protocol version" }, id: null });
    return;
  }
  next();
}

function requiredMcpScopes(request: Request): string[] {
  if (request.body?.method === "resources/read" || request.body?.method === "resources/list" || request.body?.method === "resources/templates/list") {
    return ["ssticker.catalog.read"];
  }
  if (request.body?.method !== "tools/call") {
    return [];
  }
  const name = request.body?.params?.name;
  if (name === "report_sticker_outcome") {
    return ["ssticker.feedback"];
  }
  if (name === "search_stickers" || name === "get_sticker_asset") {
    return ["ssticker.catalog.read"];
  }
  return ["ssticker.recommend"];
}

function methodNotAllowed(response: Response): void {
  response.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
}

function numberQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function requestParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

function parseUploadDefaults(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function slugForUpload(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "sticker";
}

function validatePolicy(profile: PolicyProfile): void {
  for (const field of ["auto_threshold", "explicit_threshold", "scene_threshold", "margin_threshold"] as const) {
    if (!Number.isFinite(profile[field]) || profile[field] < 0 || profile[field] > 1) {
      throw new Error(`${field} must be between 0 and 1`);
    }
  }
  for (const field of ["direct_cooldown_seconds", "direct_turn_gap", "group_cooldown_seconds", "group_message_gap", "recent_duplicate_window", "event_ttl_hours"] as const) {
    if (!Number.isInteger(profile[field]) || profile[field] < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
  }
}

function updateOperationalMetrics(runtime: SStickerRuntime): void {
  const stats = runtime.database.dashboardStats();
  runtime.metrics.catalogGauge.set({ status: "total" }, stats.total_stickers);
  runtime.metrics.catalogGauge.set({ status: "active" }, stats.active_stickers);
  runtime.metrics.catalogGauge.set({ status: "pending" }, stats.pending_review);
  runtime.metrics.catalogGauge.set({ status: "active_variants" }, stats.active_variants);
  runtime.metrics.adoptionGauge.set({ window: "24h" }, stats.send_decisions_24h > 0 ? stats.sent_24h / stats.send_decisions_24h : 0);
  const jobs = runtime.database.listJobs(500);
  for (const status of ["queued", "running", "completed", "failed"] as const) {
    runtime.metrics.jobGauge.set({ status }, jobs.filter((job) => job.status === status).length);
  }
}

function safeError(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: "Unknown error" };
}
