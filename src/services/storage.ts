import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { AppConfig } from "../config.js";
import type { VariantRecord } from "../domain/types.js";
import { addSecondsIso, hmacSha256, secureStringEqual } from "../utils.js";

export interface SignedAsset {
  downloadUrl: string;
  expiresAt: string;
}

export class LocalAssetStore {
  constructor(private readonly config: AppConfig) {}

  sign(variantId: string, ttlSeconds = 300, now = Date.now()): SignedAsset {
    const expires = Math.floor(now / 1000) + ttlSeconds;
    const signature = hmacSha256(this.config.signingSecret, this.signaturePayload(variantId, expires));
    return {
      downloadUrl: `${this.config.publicBaseUrl}/assets/v1/${encodeURIComponent(variantId)}?expires=${expires}&signature=${encodeURIComponent(signature)}`,
      expiresAt: addSecondsIso(ttlSeconds, now)
    };
  }

  verify(variantId: string, expiresValue: string | undefined, signature: string | undefined, now = Date.now()): boolean {
    if (!expiresValue || !signature || !/^\d+$/.test(expiresValue)) {
      return false;
    }
    const expires = Number(expiresValue);
    if (!Number.isSafeInteger(expires) || expires < Math.floor(now / 1000)) {
      return false;
    }
    const expected = hmacSha256(this.config.signingSecret, this.signaturePayload(variantId, expires));
    return secureStringEqual(expected, signature);
  }

  resolveVariantPath(variant: VariantRecord): string {
    const base = resolve(this.config.variantDir);
    const target = resolve(base, variant.storage_key);
    if (target !== base && !target.startsWith(`${base}${sep}`)) {
      throw new Error("Variant storage key resolves outside the asset directory");
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`Variant file is missing: ${variant.id}`);
    }
    return target;
  }

  private signaturePayload(variantId: string, expires: number): string {
    return `default\n${variantId}\n${expires}`;
  }
}
