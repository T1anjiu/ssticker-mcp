import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { Platform, VariantRecord } from "../domain/types.js";
import { newId, nowIso, sha256 } from "../utils.js";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_ANIMATION_FRAMES = 300;
const MAX_ANIMATION_DURATION_MS = 10_000;
const MAX_ANIMATION_VARIANT_BYTES = 10 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface InspectedMedia {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  extension: "png" | "jpg" | "webp" | "gif";
  width: number;
  height: number;
  pages: number;
  durationMs: number | null;
  sha256: string;
  perceptualHash: string;
}

export interface ProcessedMedia {
  originalStorageKey: string;
  variants: VariantRecord[];
}

export class MediaService {
  constructor(private readonly config: AppConfig) {}

  async inspect(filePath: string): Promise<InspectedMedia> {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error("Media source is not a regular file");
    }
    if (fileStats.size <= 0 || fileStats.size > MAX_SOURCE_BYTES) {
      throw new Error(`Media must be between 1 byte and ${MAX_SOURCE_BYTES} bytes`);
    }
    const buffer = await readFile(filePath);
    const detected = detectImageType(buffer);
    const image = sharp(buffer, { animated: detected.mimeType === "image/gif", limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    let pages = metadata.pages ?? 1;
    let durationMs = metadata.delay ? metadata.delay.reduce((total, delay) => total + delay, 0) : null;
    if (detected.mimeType === "image/gif") {
      const probed = await probeAnimation(filePath);
      pages = probed.frames;
      durationMs = probed.durationMs;
    }
    if (width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) {
      throw new Error("Media dimensions are invalid or exceed the decoded pixel limit");
    }
    if (pages > MAX_ANIMATION_FRAMES) {
      throw new Error(`Animation exceeds ${MAX_ANIMATION_FRAMES} frames`);
    }
    if ((durationMs ?? 0) > MAX_ANIMATION_DURATION_MS) {
      throw new Error(`Animation exceeds ${MAX_ANIMATION_DURATION_MS} ms`);
    }
    const perceptualHash = await calculatePerceptualHash(buffer);
    return {
      buffer,
      mimeType: detected.mimeType,
      extension: detected.extension,
      width,
      height,
      pages,
      durationMs,
      sha256: sha256(buffer),
      perceptualHash
    };
  }

  async process(filePath: string, stickerId: string, inspected?: InspectedMedia): Promise<ProcessedMedia> {
    const media = inspected ?? await this.inspect(filePath);
    await mkdir(this.config.originalDir, { recursive: true });
    await mkdir(this.config.variantDir, { recursive: true });
    const originalStorageKey = `${stickerId}.${media.extension}`;
    const originalPath = resolve(this.config.originalDir, originalStorageKey);
    await copyFile(filePath, originalPath);
    try {
      const variants = media.mimeType === "image/gif"
        ? await this.processAnimation(media, stickerId, filePath)
        : await this.processStatic(media, stickerId);
      return { originalStorageKey, variants };
    } catch (error) {
      await this.cleanup(stickerId);
      throw error;
    }
  }

  async cleanup(stickerId: string): Promise<void> {
    const entries = ["png", "jpg", "webp", "gif"].map((extension) => resolve(this.config.originalDir, `${stickerId}.${extension}`));
    for (const path of entries) {
      await rm(path, { force: true });
    }
    const variantNames = ["image.png", "sticker.webp", "animation.gif", "poster.png"];
    for (const name of variantNames) {
      await rm(resolve(this.config.variantDir, `${stickerId}-${name}`), { force: true });
    }
  }

  private async processStatic(media: InspectedMedia, stickerId: string): Promise<VariantRecord[]> {
    const png = await encodePngWithinLimit(media.buffer, 2 * 1024 * 1024);
    const pngKey = `${stickerId}-image.png`;
    await writeFile(resolve(this.config.variantDir, pngKey), png.buffer);
    const webp = await encodeWebpWithinLimit(media.buffer, 512 * 1024);
    const webpKey = `${stickerId}-sticker.webp`;
    await writeFile(resolve(this.config.variantDir, webpKey), webp.buffer);
    return [
      makeVariant(stickerId, "image-512", "image/png", "image", png.width, png.height, null, png.buffer, pngKey, ["wechat", "qq", "telegram", "generic"]),
      makeVariant(stickerId, "sticker-webp-512", "image/webp", "sticker", webp.width, webp.height, null, webp.buffer, webpKey, ["telegram", "generic"])
    ];
  }

  private async processAnimation(media: InspectedMedia, stickerId: string, sourcePath: string): Promise<VariantRecord[]> {
    const gifKey = `${stickerId}-animation.gif`;
    const gifPath = resolve(this.config.variantDir, gifKey);
    const gif = await transcodeAnimation(sourcePath, gifPath);
    const poster = await encodePngWithinLimit(gif.buffer, 2 * 1024 * 1024, true);
    const posterKey = `${stickerId}-poster.png`;
    await writeFile(resolve(this.config.variantDir, posterKey), poster.buffer);
    return [
      makeVariant(stickerId, "animation-sanitized", "image/gif", "animation", gif.width, gif.height, media.durationMs, gif.buffer, gifKey, ["telegram", "qq", "generic"]),
      makeVariant(stickerId, "animation-poster", "image/png", "image", poster.width, poster.height, null, poster.buffer, posterKey, ["wechat", "qq", "telegram", "generic"])
    ];
  }
}

interface ProbedAnimation {
  frames: number;
  durationMs: number;
}

async function probeAnimation(filePath: string): Promise<ProbedAnimation> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-count_frames",
      "-show_entries", "stream=nb_read_frames,duration:format=duration",
      "-of", "json",
      filePath
    ], { encoding: "utf8", timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const payload = JSON.parse(stdout) as {
      streams?: Array<{ nb_read_frames?: string; duration?: string }>;
      format?: { duration?: string };
    };
    const stream = payload.streams?.[0];
    const frames = Number.parseInt(stream?.nb_read_frames ?? "", 10);
    const durationSeconds = Number.parseFloat(stream?.duration ?? payload.format?.duration ?? "");
    if (!Number.isInteger(frames) || frames < 1 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("ffprobe returned incomplete animation metadata");
    }
    return { frames, durationMs: Math.round(durationSeconds * 1000) };
  } catch (error) {
    if (isExecutableMissing(error)) {
      throw new Error("GIF import requires ffprobe on PATH");
    }
    throw new Error(`GIF validation failed: ${errorMessage(error)}`);
  }
}

async function transcodeAnimation(sourcePath: string, outputPath: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  const attempts = [
    { size: 1280, fps: 24 },
    { size: 960, fps: 18 },
    { size: 720, fps: 12 }
  ];
  for (const attempt of attempts) {
    await rm(outputPath, { force: true });
    try {
      await execFileAsync("ffmpeg", [
        "-v", "error",
        "-y",
        "-i", sourcePath,
        "-map_metadata", "-1",
        "-vf", `scale='min(${attempt.size},iw)':'min(${attempt.size},ih)':force_original_aspect_ratio=decrease:flags=lanczos,fps=${attempt.fps}`,
        "-gifflags", "+transdiff",
        "-loop", "0",
        outputPath
      ], { encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      if (isExecutableMissing(error)) {
        throw new Error("GIF import requires ffmpeg on PATH");
      }
      throw new Error(`GIF transcoding failed: ${errorMessage(error)}`);
    }
    const outputStats = await stat(outputPath);
    if (outputStats.size > MAX_ANIMATION_VARIANT_BYTES && attempt !== attempts[attempts.length - 1]) {
      continue;
    }
    if (outputStats.size > MAX_ANIMATION_VARIANT_BYTES) {
      throw new Error(`Sanitized GIF exceeds ${MAX_ANIMATION_VARIANT_BYTES} bytes`);
    }
    const buffer = await readFile(outputPath);
    const metadata = await sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    if (width < 1 || height < 1) {
      throw new Error("Sanitized GIF has invalid dimensions");
    }
    return { buffer, width, height };
  }
  throw new Error("Unable to produce a compatible GIF variant");
}

function isExecutableMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown media tool error";
}

function detectImageType(buffer: Buffer): { mimeType: InspectedMedia["mimeType"]; extension: InspectedMedia["extension"] } {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  throw new Error("Unsupported image type");
}

async function calculatePerceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer, { animated: false, page: 0, limitInputPixels: MAX_INPUT_PIXELS })
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mean = data.reduce((total, value) => total + value, 0) / data.length;
  let bits = "";
  for (const value of data) {
    bits += value >= mean ? "1" : "0";
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

async function encodePngWithinLimit(buffer: Buffer, maxBytes: number, firstPage = false): Promise<{ buffer: Buffer; width: number; height: number }> {
  for (const size of [512, 384, 256]) {
    const output = await sharp(buffer, { animated: false, page: firstPage ? 0 : undefined, limitInputPixels: MAX_INPUT_PIXELS })
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length <= maxBytes || size === 256) {
      return { buffer: output.data, width: output.info.width, height: output.info.height };
    }
  }
  throw new Error("Unable to encode PNG variant");
}

async function encodeWebpWithinLimit(buffer: Buffer, maxBytes: number): Promise<{ buffer: Buffer; width: number; height: number }> {
  const attempts = [
    { size: 512, quality: 84 },
    { size: 448, quality: 74 },
    { size: 384, quality: 64 },
    { size: 320, quality: 56 }
  ];
  for (const attempt of attempts) {
    const output = await sharp(buffer, { animated: false, limitInputPixels: MAX_INPUT_PIXELS })
      .resize(attempt.size, attempt.size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: attempt.quality, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length <= maxBytes || attempt === attempts[attempts.length - 1]) {
      return { buffer: output.data, width: output.info.width, height: output.info.height };
    }
  }
  throw new Error("Unable to encode WebP variant");
}

function makeVariant(
  stickerId: string,
  name: string,
  mimeType: string,
  deliveryKind: VariantRecord["delivery_kind"],
  width: number,
  height: number,
  durationMs: number | null,
  buffer: Buffer,
  storageKey: string,
  platforms: Platform[]
): VariantRecord {
  return {
    id: newId(),
    sticker_id: stickerId,
    name,
    mime_type: mimeType,
    delivery_kind: deliveryKind,
    width,
    height,
    duration_ms: durationMs,
    bytes: buffer.length,
    sha256: sha256(buffer),
    storage_key: storageKey,
    platforms,
    created_at: nowIso()
  };
}
