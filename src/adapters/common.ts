import { sha256 } from "../utils.js";
import type { AssetVariant } from "../domain/types.js";

export async function downloadVerifiedAsset(asset: AssetVariant, maxBytes = 50 * 1024 * 1024): Promise<Buffer> {
  const url = new URL(asset.download_url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Adapter only accepts HTTP(S) asset URLs");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Asset download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes || asset.bytes > maxBytes) {
    throw new Error("Asset exceeds adapter download limit");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes || buffer.length !== asset.bytes) {
    throw new Error("Asset length does not match the delivery action");
  }
  if (sha256(buffer) !== asset.sha256) {
    throw new Error("Asset SHA-256 does not match the delivery action");
  }
  return buffer;
}

export async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}
