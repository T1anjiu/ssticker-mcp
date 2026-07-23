import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GetStickerAssetInputSchema,
  OutcomeResultSchema,
  RecommendStickerInputSchema,
  ReportStickerOutcomeInputSchema,
  SearchResultSchema,
  SearchStickersInputSchema,
  StickerDecisionSchema
} from "../domain/schemas.js";
import type { SStickerRuntime } from "../runtime.js";

export function createSStickerMcpServer(runtime: SStickerRuntime): McpServer {
  const server = new McpServer({
    name: "ssticker-mcp",
    title: "ssticker — context-aware sticker decisions",
    version: "0.1.0-alpha.0"
  }, {
    instructions: "Use recommend_sticker when a chat may benefit from a reaction sticker. Respect action=skip. The returned asset is a delivery directive for the channel adapter; this server never sends to the channel itself. Call report_sticker_outcome after the adapter attempts delivery."
  });

  server.registerTool("recommend_sticker", {
    title: "Recommend a sticker",
    description: "Classify recent chat context and return either a safe, channel-compatible sticker delivery action or an explicit skip decision.",
    inputSchema: RecommendStickerInputSchema,
    outputSchema: StickerDecisionSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    const startedAt = Date.now();
    try {
      const input = RecommendStickerInputSchema.parse(rawInput);
      const decision = await runtime.decisions.recommend(input);
      runtime.metrics.observeDecision(decision, input.channel.platform, startedAt);
      return structuredResult(decision, decision.asset ? {
        uri: decision.asset.resource_uri,
        name: decision.asset.title,
        description: decision.asset.alt_text[input.locale] ?? decision.asset.alt_text.en,
        mimeType: "application/json"
      } : undefined);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("search_stickers", {
    title: "Search stickers",
    description: "Search the reviewed catalog for safe, channel-compatible sticker candidates without applying automatic-send cooldowns.",
    inputSchema: SearchStickersInputSchema,
    outputSchema: SearchResultSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    try {
      const input = SearchStickersInputSchema.parse(rawInput);
      const results = await runtime.decisions.search(input);
      return structuredResult({ results });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("get_sticker_asset", {
    title: "Get a sticker asset",
    description: "Select a compatible processed variant for a reviewed sticker and return a fresh five-minute signed download URL.",
    inputSchema: GetStickerAssetInputSchema,
    outputSchema: { asset: StickerDecisionSchema.shape.asset.unwrap() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    try {
      const input = GetStickerAssetInputSchema.parse(rawInput);
      const asset = runtime.decisions.getAsset(input.sticker_id, input.channel);
      return structuredResult({ asset }, {
        uri: asset.resource_uri,
        name: asset.title,
        description: asset.alt_text[input.locale] ?? asset.alt_text.en,
        mimeType: "application/json"
      });
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool("report_sticker_outcome", {
    title: "Report sticker delivery outcome",
    description: "Idempotently report whether a channel adapter sent, skipped, rejected, or failed a sticker decision, with optional coarse feedback.",
    inputSchema: ReportStickerOutcomeInputSchema,
    outputSchema: OutcomeResultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (rawInput) => {
    try {
      const input = ReportStickerOutcomeInputSchema.parse(rawInput);
      const result = runtime.decisions.reportOutcome(input);
      if (!result.duplicate) {
        runtime.metrics.observeOutcome(input.outcome);
      }
      return structuredResult(result);
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerResource("ssticker-scenes", "ssticker://scenes", {
    title: "ssticker scene taxonomy",
    description: "The enabled bilingual scene definitions used by the classifier.",
    mimeType: "application/json"
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ scenes: runtime.database.listScenes() }) }]
  }));

  server.registerResource("ssticker-sticker", new ResourceTemplate("ssticker://stickers/{sticker_id}", { list: undefined }), {
    title: "ssticker catalog item",
    description: "Reviewed sticker metadata and processed variants.",
    mimeType: "application/json"
  }, async (uri, variables) => {
    const stickerId = String(variables.sticker_id ?? "");
    const sticker = runtime.database.getSticker(stickerId);
    if (!sticker || sticker.status !== "active") {
      throw new Error("Sticker resource not found");
    }
    const resource = {
      sticker,
      scenes: runtime.database.getStickerScenes(stickerId),
      tags: runtime.database.getStickerTags(stickerId),
      variants: runtime.database.getStickerVariants(stickerId).map(({ storage_key: _storageKey, ...variant }) => variant)
    };
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(resource) }] };
  });

  server.registerResource("ssticker-policy", new ResourceTemplate("ssticker://policies/{profile}", { list: undefined }), {
    title: "ssticker policy profile",
    description: "A public summary of recommendation thresholds and cooldowns.",
    mimeType: "application/json"
  }, async (uri, variables) => {
    const policy = runtime.database.getPolicyProfile(String(variables.profile ?? "default"));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(policy) }] };
  });

  return server;
}

function structuredResult(value: unknown, resource?: { uri: string; name: string; description?: string; mimeType: string }): CallToolResult {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [
      { type: "text", text: JSON.stringify(value) },
      ...(resource ? [{
        type: "resource_link" as const,
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        annotations: { audience: ["assistant" as const], priority: 0.8 }
      }] : [])
    ],
    structuredContent,
    isError: false
  };
}

function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown tool execution error";
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true
  };
}
