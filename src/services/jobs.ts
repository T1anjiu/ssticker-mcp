import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { SStickerDatabase } from "../db/database.js";
import type { CatalogManifestItem } from "../domain/types.js";
import type { CatalogService } from "./catalog.js";

export interface CatalogImportJobPayload {
  item: CatalogManifestItem;
  base_directory: string;
}

export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private runsSinceCleanup = 0;

  constructor(
    private readonly database: SStickerDatabase,
    private readonly catalog: CatalogService,
    private readonly uploadDirectory: string,
    private readonly intervalMs = 1000
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.database.recoverInterruptedJobs();
    this.database.cleanupExpiredEvents();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<boolean> {
    if (this.running) {
      return false;
    }
    this.runsSinceCleanup += 1;
    if (this.runsSinceCleanup >= 60) {
      this.database.cleanupExpiredEvents();
      this.runsSinceCleanup = 0;
    }
    const job = this.database.claimNextJob();
    if (!job) {
      return false;
    }
    this.running = true;
    try {
      if (job.type === "catalog.import") {
        const payload = job.payload as unknown as CatalogImportJobPayload;
        const result = await this.catalog.importItem(payload.item, payload.base_directory, false);
        this.database.completeJob(job.id, result as unknown as Record<string, unknown>);
        await this.removeUploadedSource(payload);
      } else if (job.type === "index.rebuild") {
        const result = await this.catalog.rebuildIndex();
        this.database.completeJob(job.id, result as unknown as Record<string, unknown>);
      } else {
        throw new Error(`Unsupported job type: ${job.type}`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job error";
      const retry = job.attempts < 3;
      this.database.failJob(job.id, message, retry);
      if (!retry && job.type === "catalog.import") {
        await this.removeUploadedSource(job.payload as unknown as CatalogImportJobPayload);
      }
      return false;
    } finally {
      this.running = false;
    }
  }

  private async removeUploadedSource(payload: CatalogImportJobPayload): Promise<void> {
    if (resolve(payload.base_directory) !== resolve(this.uploadDirectory)) {
      return;
    }
    const root = resolve(this.uploadDirectory);
    const file = resolve(root, payload.item.file);
    const pathFromRoot = relative(root, file);
    if (!pathFromRoot || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
      return;
    }
    try {
      await rm(file, { force: true });
    } catch {
      // A completed import remains valid even if a best-effort cleanup fails.
    }
  }
}
