import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelCapabilityProfile, PolicyProfile } from "./domain/types.js";

export interface LoadedProfiles {
  channels: ChannelCapabilityProfile[];
  policies: PolicyProfile[];
}

export function loadProfiles(projectRoot = process.cwd()): LoadedProfiles {
  const profileDirectory = locateProfileDirectory(projectRoot);
  const channelData = JSON.parse(readFileSync(resolve(profileDirectory, "channel-profiles.json"), "utf8")) as { profiles: ChannelCapabilityProfile[] };
  const policyData = JSON.parse(readFileSync(resolve(profileDirectory, "policies.json"), "utf8")) as { profiles: PolicyProfile[] };
  if (!Array.isArray(channelData.profiles) || channelData.profiles.length === 0) {
    throw new Error("No channel capability profiles are configured");
  }
  if (!Array.isArray(policyData.profiles) || policyData.profiles.length === 0) {
    throw new Error("No policy profiles are configured");
  }
  return { channels: channelData.profiles, policies: policyData.profiles };
}

function locateProfileDirectory(projectRoot: string): string {
  const candidates = [
    resolve(projectRoot, "profiles"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../profiles"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../profiles")
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "channel-profiles.json")) && existsSync(resolve(candidate, "policies.json"))) {
      return candidate;
    }
  }
  throw new Error(`Unable to locate profile files. Checked: ${candidates.join(", ")}`);
}
