import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

export function newId(): string {
  return uuidv7();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSecondsIso(seconds: number, from = Date.now()): string {
  return new Date(from + seconds * 1000).toISOString();
}

export function sha256(input: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function roundScore(value: number): number {
  return Math.round(clamp(value) * 10000) / 10000;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function normalizeVector(values: Float32Array): Float32Array {
  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }
  if (norm === 0) {
    return values;
  }
  const divisor = Math.sqrt(norm);
  return Float32Array.from(values, (value) => value / divisor);
}

export function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToFloat32(value: Buffer | Uint8Array): Float32Array {
  const bytes = Uint8Array.from(value);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const latin = normalized.match(/[a-z0-9_]+/g) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const hanTokens = hanRuns.flatMap((run) => {
    if (run.length <= 2) {
      return [run];
    }
    const tokens: string[] = [run];
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
    return tokens;
  });
  return [...latin, ...hanTokens];
}

export function escapeFtsQuery(value: string): string {
  return tokenize(value).slice(0, 32).map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

export function hammingDistanceHex64(left: string, right: string): number {
  if (!/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) {
    return Number.POSITIVE_INFINITY;
  }
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}
