#!/usr/bin/env node
import { cp, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sharp from "sharp";
import { loadConfig } from "./config.js";
import { createRuntime, type SStickerRuntime } from "./runtime.js";
import { createSStickerMcpServer } from "./mcp/server.js";
import { startAssetOnlyServer, startHttpServer } from "./http/app.js";
import { pullEmbeddingModel } from "./services/embedding.js";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("ssticker")
    .description("Self-hosted MCP sticker recommendation service")
    .version("0.1.0-alpha.0");

  program.command("init")
    .description("Initialize the data directory, SQLite schema, profiles, and persistent secrets")
    .action(async () => withRuntime(async (runtime) => {
      printJson({
        initialized: true,
        data_dir: runtime.config.dataDir,
        database: runtime.config.databasePath,
        health: runtime.database.health()
      });
    }));

  const models = program.command("models").description("Manage local embedding models");
  models.command("pull")
    .description("Download and cache the configured multilingual embedding model")
    .action(async () => {
      const config = loadConfig();
      await pullEmbeddingModel(config);
      printJson({ pulled: true, model: config.modelId, cache: config.modelCacheDir });
    });

  const catalog = program.command("catalog").description("Import, validate, review, export, and index stickers");
  catalog.command("import")
    .argument("<path>", "Directory, YAML, JSON, or JSONL manifest")
    .option("--dry-run", "Validate without writing catalog data")
    .action(async (path: string, options: { dryRun?: boolean }) => withRuntime(async (runtime) => {
      const result = await runtime.catalog.importPath(path, options.dryRun === true);
      printJson(result);
      if (result.failed > 0) {
        process.exitCode = 2;
      }
    }));
  catalog.command("validate")
    .description("Validate metadata, safety, scenes, and processed variants")
    .action(async () => withRuntime(async (runtime) => {
      const issues = runtime.catalog.validateCatalog();
      printJson({ valid: !issues.some((issue) => issue.severity === "error"), issues });
      if (issues.some((issue) => issue.severity === "error")) {
        process.exitCode = 2;
      }
    }));
  catalog.command("review")
    .argument("<sticker-id>")
    .option("--deny", "Block instead of activating the sticker")
    .action(async (stickerId: string, options: { deny?: boolean }) => withRuntime(async (runtime) => {
      printJson(runtime.catalog.reviewSticker(stickerId, options.deny !== true, "cli"));
    }));
  catalog.command("export")
    .argument("<path>", "Output YAML manifest path")
    .action(async (path: string) => withRuntime(async (runtime) => {
      await runtime.catalog.exportManifest(path);
      printJson({ exported: true, path: resolve(path) });
    }));

  const index = program.command("index").description("Manage the search index");
  index.command("rebuild")
    .action(async () => withRuntime(async (runtime) => printJson(await runtime.catalog.rebuildIndex())));

  program.command("serve")
    .description("Start the HTTP MCP server, admin UI/API, assets, health, and metrics")
    .action(async () => {
      const runtime = createRuntime();
      const server = await startHttpServer(runtime);
      await waitForShutdown(async () => {
        await closeServer(server);
        runtime.close();
      });
    });

  const mcp = program.command("mcp").description("Run an MCP transport");
  mcp.option("--stdio", "Run over stdin/stdout")
    .action(async (options: { stdio?: boolean }) => {
      if (!options.stdio) {
        throw new Error("Only --stdio is supported by this command; use `ssticker serve` for Streamable HTTP");
      }
      const runtime = createRuntime();
      const assetServer = await startAssetOnlyServer(runtime);
      const server = createSStickerMcpServer(runtime);
      const transport = new StdioServerTransport();
      await server.connect(transport);
      runtime.logger.info({ asset_base_url: runtime.config.publicBaseUrl }, "ssticker stdio server started");
      const shutdown = async () => {
        await server.close();
        await closeServer(assetServer);
        runtime.close();
      };
      process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
      process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
    });

  const admin = program.command("admin").description("Manage local admin access tokens");
  const token = admin.command("token").description("Create or revoke admin tokens");
  token.command("create")
    .argument("[name]", "Human-readable token name", "local-admin")
    .action(async (name: string) => withRuntime(async (runtime) => {
      const created = await runtime.auth.createAdminToken(name);
      printJson({ id: created.id, name, prefix: created.prefix, token: created.token, warning: "This token is shown once. Store it securely." });
    }));
  token.command("revoke")
    .argument("<token-id>")
    .action(async (tokenId: string) => withRuntime(async (runtime) => {
      printJson({ id: tokenId, revoked: runtime.database.revokeAdminToken(tokenId) });
    }));

  const backup = program.command("backup").description("Create and restore data directory backups");
  backup.command("create")
    .argument("[destination]")
    .action(async (destination?: string) => withRuntime(async (runtime) => {
      runtime.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
      const target = resolve(destination ?? resolve(runtime.config.projectRoot, "backups", `ssticker-${timestampForPath()}`));
      await mkdir(target, { recursive: true });
      await cp(runtime.config.dataDir, target, { recursive: true, force: false, errorOnExist: true });
      await writeFile(resolve(target, "backup.json"), `${JSON.stringify({ version: 1, created_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
      printJson({ created: true, destination: target });
    }));
  backup.command("restore")
    .argument("<source>")
    .action(async (source: string) => {
      const config = loadConfig({ ensureDirectories: false });
      const absoluteSource = resolve(source);
      if (!existsSync(resolve(absoluteSource, "backup.json")) || !(await stat(absoluteSource)).isDirectory()) {
        throw new Error("Backup source is missing backup.json or is not a directory");
      }
      const safetyCopy = `${config.dataDir}.before-restore-${timestampForPath()}`;
      if (existsSync(config.dataDir)) {
        await rename(config.dataDir, safetyCopy);
      }
      try {
        await cp(absoluteSource, config.dataDir, { recursive: true, force: false, errorOnExist: true });
      } catch (error) {
        if (existsSync(safetyCopy) && !existsSync(config.dataDir)) {
          await rename(safetyCopy, config.dataDir);
        }
        throw error;
      }
      printJson({ restored: true, source: absoluteSource, previous_data: existsSync(safetyCopy) ? safetyCopy : null });
    });

  program.command("doctor")
    .description("Check SQLite, vector extension, Sharp, ffmpeg, profiles, and model cache")
    .action(async () => withRuntime(async (runtime) => {
      const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
      const report = {
        database: runtime.database.health(),
        sharp: { available: true, versions: sharp.versions },
        ffmpeg: { available: ffmpeg.status === 0, version: ffmpeg.status === 0 ? ffmpeg.stdout.split(/\r?\n/)[0] : null },
        model: { configured: runtime.config.modelId, cache_exists: existsSync(runtime.config.modelCacheDir), provider: runtime.config.embeddingProvider },
        channel_profiles: runtime.database.listChannelProfiles().map((profile) => ({ id: profile.id, version: profile.version, verified_at: profile.verified_at }))
      };
      printJson(report);
    }));

  await program.parseAsync(argv);
}

async function withRuntime<T>(callback: (runtime: SStickerRuntime) => Promise<T>): Promise<T> {
  const runtime = createRuntime();
  try {
    return await callback(runtime);
  } finally {
    runtime.close();
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    let closing = false;
    const handler = () => {
      if (closing) {
        return;
      }
      closing = true;
      void shutdown().finally(resolvePromise);
    };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  });
}

async function closeServer(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

if (process.argv[1] && basename(process.argv[1]).match(/^cli(?:\.js|\.ts)?$/)) {
  runCli().catch(async (error) => {
    const message = error instanceof Error ? error.message : "Unknown CLI error";
    process.stderr.write(`${message}\n`);
    if (error instanceof Error && error.stack && process.env.SSTICKER_LOG_LEVEL === "debug") {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
  });
}
