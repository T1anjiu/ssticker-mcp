import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createRuntime } from "../src/runtime.js";
import type { AssetVariant } from "../src/domain/types.js";
import { generateDemoCatalog, generateEvaluationCorpus, type EvaluationCase } from "./fixtures.js";

const root = process.cwd();
const stateDirectory = resolve(root, ".tmp-eval");
await rm(stateDirectory, { recursive: true, force: true });
const demo = await generateDemoCatalog(root);
const corpus = await generateEvaluationCorpus(root);
const runtime = createRuntime({
  cwd: root,
  env: {
    ...process.env,
    SSTICKER_DATA_DIR: stateDirectory,
    SSTICKER_EMBEDDING_PROVIDER: "hash",
    SSTICKER_SIGNING_SECRET: "evaluation-signing-secret-with-at-least-thirty-two-bytes",
    SSTICKER_SESSION_SECRET: "evaluation-session-secret-with-at-least-thirty-two-bytes",
    SSTICKER_PUBLIC_BASE_URL: "http://127.0.0.1:3377",
    SSTICKER_AUTH_MODE: "none",
    SSTICKER_LOG_LEVEL: "silent"
  }
});

try {
  const imported = await runtime.catalog.importPath(demo.manifestPath);
  if (imported.failed > 0 || imported.imported !== demo.assets) {
    throw new Error(`Demo catalog import failed: ${JSON.stringify(imported)}`);
  }
  for (const item of imported.items) {
    if (item.sticker_id) runtime.catalog.reviewSticker(item.sticker_id, true, "evaluation");
  }
  await runtime.catalog.rebuildIndex();

  const cases = (await readFile(corpus.corpusPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EvaluationCase);
  let automaticSent = 0;
  let automaticCorrect = 0;
  let explicitFound = 0;
  let seriousWrongSend = 0;
  let ordinaryWrongSend = 0;
  let compatibleSends = 0;
  let totalSends = 0;
  const automaticMisses: Array<{ id: string; expected_scene?: string; scene: string; confidence: number; top_score: number | null; reasons: string[] }> = [];
  const seriousFailures: Array<{ id: string; text: string; scene: string; reasons: string[] }> = [];
  const ordinaryFailures: Array<{ id: string; text: string; scene: string; confidence: number; reasons: string[] }> = [];

  for (const item of cases) {
    const channel = { platform: "generic" as const, profile: "generic", conversation_type: item.conversation_type };
    if (item.kind === "explicit_search") {
      const query = item.messages.map((message) => message.text).join("\n");
      const results = await runtime.decisions.search({ query, channel, locale: item.locale, limit: 5 });
      if (results.some((result) => result.scene_ids.includes(item.expected_scene ?? ""))) explicitFound += 1;
      continue;
    }
    const decision = await runtime.decisions.recommend({
      request_id: `eval-${item.id}`,
      session_id: `session-${item.id}`,
      mode: item.kind === "serious_skip" && item.messages[0]?.text.match(/表情包|meme/i) ? "explicit" : "auto",
      channel,
      locale: item.locale,
      messages: item.messages,
      context: { bot_mentioned: true, turn_index: 100 }
    });
    if (decision.action === "send" && decision.asset) {
      totalSends += 1;
      if (assetIsCompatible(decision.asset)) compatibleSends += 1;
    }
    if (item.kind === "auto_send" && decision.action === "send") {
      automaticSent += 1;
      if (decision.scene.id === item.expected_scene) automaticCorrect += 1;
    } else if (item.kind === "auto_send" && automaticMisses.length < 12) {
      const query = item.messages.map((message) => message.text).join("\n");
      const candidates = await runtime.decisions.search({ query, channel, locale: item.locale, limit: 1 });
      automaticMisses.push({ id: item.id, expected_scene: item.expected_scene, scene: decision.scene.id, confidence: decision.scene.confidence, top_score: candidates[0]?.score ?? null, reasons: decision.reason_codes });
    }
    if (item.kind === "serious_skip" && decision.action === "send") {
      seriousWrongSend += 1;
      if (seriousFailures.length < 12) seriousFailures.push({ id: item.id, text: item.messages.map((message) => message.text).join(" "), scene: decision.scene.id, reasons: decision.reason_codes });
    }
    if (item.kind === "ordinary_skip" && decision.action === "send") {
      ordinaryWrongSend += 1;
      if (ordinaryFailures.length < 12) ordinaryFailures.push({ id: item.id, text: item.messages.map((message) => message.text).join(" "), scene: decision.scene.id, confidence: decision.scene.confidence, reasons: decision.reason_codes });
    }
  }

  const automaticPrecisionAt1 = automaticSent > 0 ? automaticCorrect / automaticSent : 0;
  const explicitTotal = cases.filter((item) => item.kind === "explicit_search").length;
  const explicitRecallAt5 = explicitTotal > 0 ? explicitFound / explicitTotal : 0;
  const compatibilityCoverage = totalSends > 0 ? compatibleSends / totalSends : 1;
  const report = {
    corpus_cases: cases.length,
    serious_cases: cases.filter((item) => item.kind === "serious_skip").length,
    automatic_sent: automaticSent,
    automatic_precision_at_1: round(automaticPrecisionAt1),
    explicit_recall_at_5: round(explicitRecallAt5),
    serious_wrong_sends: seriousWrongSend,
    ordinary_wrong_sends: ordinaryWrongSend,
    compatible_send_coverage: round(compatibilityCoverage),
    diagnostic_samples: { automatic_misses: automaticMisses, serious_failures: seriousFailures, ordinary_failures: ordinaryFailures },
    gates: {
      serious_zero_wrong_sends: seriousWrongSend === 0,
      ordinary_zero_wrong_sends: ordinaryWrongSend === 0,
      automatic_precision_at_1_gte_088: automaticPrecisionAt1 >= 0.88,
      explicit_recall_at_5_gte_090: explicitRecallAt5 >= 0.9,
      compatible_send_coverage_100_percent: compatibilityCoverage === 1
    }
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (Object.values(report.gates).some((passed) => !passed)) process.exitCode = 2;
} finally {
  runtime.close();
  await rm(stateDirectory, { recursive: true, force: true });
}

function assetIsCompatible(asset: AssetVariant): boolean {
  const profile = runtime.database.getChannelProfile("generic");
  return profile.accepted.some((rule) =>
    rule.mime_type === asset.mime_type &&
    rule.delivery_kind === asset.delivery_kind &&
    asset.bytes <= rule.max_bytes &&
    asset.width <= rule.max_width &&
    asset.height <= rule.max_height &&
    (rule.max_duration_ms === null || (asset.duration_ms ?? 0) <= rule.max_duration_ms)
  );
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
