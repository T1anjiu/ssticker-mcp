import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { StickerDecision } from "../domain/types.js";

export class MetricsService {
  readonly registry = new Registry();
  readonly recommendationCounter: Counter<"action" | "reason" | "channel">;
  readonly recommendationDuration: Histogram<"channel">;
  readonly stageDuration: Histogram<"stage">;
  readonly modelFailureCounter: Counter<"component">;
  readonly outcomeCounter: Counter<"outcome">;
  readonly catalogGauge: Gauge<"status">;
  readonly jobGauge: Gauge<"status">;
  readonly adoptionGauge: Gauge<"window">;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "ssticker_" });
    this.recommendationCounter = new Counter({
      name: "ssticker_recommendations_total",
      help: "Sticker recommendation decisions by action, primary reason, and channel.",
      labelNames: ["action", "reason", "channel"],
      registers: [this.registry]
    });
    this.recommendationDuration = new Histogram({
      name: "ssticker_recommendation_duration_seconds",
      help: "End-to-end recommendation latency.",
      labelNames: ["channel"],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry]
    });
    this.stageDuration = new Histogram({
      name: "ssticker_pipeline_stage_duration_seconds",
      help: "Recommendation pipeline latency by stage.",
      labelNames: ["stage"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5],
      registers: [this.registry]
    });
    this.modelFailureCounter = new Counter({
      name: "ssticker_model_degraded_total",
      help: "Recommendations that used a degraded or failed model path.",
      labelNames: ["component"],
      registers: [this.registry]
    });
    this.outcomeCounter = new Counter({
      name: "ssticker_delivery_outcomes_total",
      help: "Reported channel delivery outcomes.",
      labelNames: ["outcome"],
      registers: [this.registry]
    });
    this.catalogGauge = new Gauge({
      name: "ssticker_catalog_stickers",
      help: "Catalog sticker count by status.",
      labelNames: ["status"],
      registers: [this.registry]
    });
    this.jobGauge = new Gauge({
      name: "ssticker_jobs",
      help: "Background jobs by status.",
      labelNames: ["status"],
      registers: [this.registry]
    });
    this.adoptionGauge = new Gauge({
      name: "ssticker_adoption_ratio",
      help: "Ratio of successful sent outcomes to send decisions.",
      labelNames: ["window"],
      registers: [this.registry]
    });
  }

  observeDecision(decision: StickerDecision, channel: string, startedAt: number): void {
    this.recommendationCounter.inc({ action: decision.action, reason: decision.reason_codes[0] ?? "unknown", channel });
    this.recommendationDuration.observe({ channel }, (Date.now() - startedAt) / 1000);
  }

  observeStage(stage: "recognition" | "llm" | "retrieval" | "policy", startedAt: number): void {
    this.stageDuration.observe({ stage }, (Date.now() - startedAt) / 1000);
  }

  observeModelFailure(component: "llm" | "embedding"): void {
    this.modelFailureCounter.inc({ component });
  }

  observeOutcome(outcome: string): void {
    this.outcomeCounter.inc({ outcome });
  }
}
