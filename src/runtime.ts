import pino, { type Logger } from "pino";
import { loadConfig, type AppConfig, type LoadConfigOptions } from "./config.js";
import { SStickerDatabase } from "./db/database.js";
import { loadProfiles } from "./profiles.js";
import { AuthService } from "./services/auth.js";
import { CatalogService } from "./services/catalog.js";
import { DecisionService } from "./services/decision.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./services/embedding.js";
import { JobWorker } from "./services/jobs.js";
import { MediaService } from "./services/media.js";
import { MetricsService } from "./services/metrics.js";
import { LocalAssetStore } from "./services/storage.js";

export interface SStickerRuntime {
  config: AppConfig;
  database: SStickerDatabase;
  embedding: EmbeddingProvider;
  media: MediaService;
  catalog: CatalogService;
  assets: LocalAssetStore;
  decisions: DecisionService;
  jobs: JobWorker;
  auth: AuthService;
  metrics: MetricsService;
  logger: Logger;
  close(): void;
}

export function createRuntime(options: LoadConfigOptions = {}): SStickerRuntime {
  const config = loadConfig(options);
  const logger = pino({
    level: config.logLevel,
    base: { service: "ssticker-mcp", version: "0.1.0-alpha.0" },
    redact: {
      paths: ["messages", "session_id", "req.headers.authorization", "download_url", "apiKey", "token"],
      censor: "[redacted]"
    }
  }, pino.destination(2));
  const profiles = loadProfiles(config.projectRoot);
  const database = new SStickerDatabase(config.databasePath);
  database.initialize(profiles.channels, profiles.policies);
  const embedding = createEmbeddingProvider(config);
  const media = new MediaService(config);
  const catalog = new CatalogService(database, media, embedding);
  const assets = new LocalAssetStore(config);
  const metrics = new MetricsService();
  const decisions = new DecisionService(config, database, embedding, assets, metrics);
  const jobs = new JobWorker(database, catalog);
  const auth = new AuthService(config, database);
  return {
    config,
    database,
    embedding,
    media,
    catalog,
    assets,
    decisions,
    jobs,
    auth,
    metrics,
    logger,
    close() {
      jobs.stop();
      database.close();
    }
  };
}
