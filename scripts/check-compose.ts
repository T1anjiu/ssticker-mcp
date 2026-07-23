import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const files = ["compose.yaml", "compose.prod.yaml"];
let ok = true;
for (const file of files) {
  const path = resolve(root, file);
  let parsed: unknown;
  try {
    const text = readFileSync(path, "utf8");
    parsed = parseYaml(text);
  } catch (error) {
    console.error(file + ": YAML parse error:", error instanceof Error ? error.message : error);
    ok = false;
    continue;
  }
  if (!parsed || typeof parsed !== "object") {
    console.error(file + ": not an object");
    ok = false;
    continue;
  }
  const services = (parsed as { services?: Record<string, unknown> }).services;
  if (!services || typeof services !== "object") {
    console.error(file + ": missing services");
    ok = false;
    continue;
  }
  const names = Object.keys(services);
  if (names.length !== 1 || names[0] !== "ssticker") {
    console.error(file + ": expected a single `ssticker` service, got " + JSON.stringify(names));
    ok = false;
    continue;
  }
  const svc = services.ssticker as Record<string, unknown>;
  const env = svc.environment as Record<string, string | number> | undefined;
  if (env) console.log(file + " authmode raw=", JSON.stringify(env.SSTICKER_AUTH_MODE), " allow_raw=", JSON.stringify(env.SSTICKER_ALLOW_INSECURE_REMOTE));
  const image = svc.image as string | undefined;
  const ports = svc.ports as string[] | undefined;
  const expose = svc.expose as string[] | undefined;
  const securityOpt = svc.security_opt as string[] | undefined;
  const capDrop = svc.cap_drop as string[] | undefined;
  console.log(file + ": ok (image=" + image + ", ports=" + JSON.stringify(ports) + ", expose=" + JSON.stringify(expose) + ", security_opt=" + JSON.stringify(securityOpt) + ", cap_drop=" + JSON.stringify(capDrop) + ")");
  if (file === "compose.prod.yaml") {
    if (ports) {
      console.error("compose.prod.yaml must not publish host ports (TLS terminates upstream)");
      ok = false;
    }
    if (!expose || !expose.includes("3377")) {
      console.error("compose.prod.yaml must expose 3377 internally");
      ok = false;
    }
    if (!env || env.SSTICKER_AUTH_MODE !== "${SSTICKER_AUTH_MODE:-oidc}") {
      console.error("compose.prod.yaml must default SSTICKER_AUTH_MODE to oidc, got " + JSON.stringify(env.SSTICKER_AUTH_MODE));
      ok = false;
    }
    if (env && env.SSTICKER_ALLOW_INSECURE_REMOTE !== "${SSTICKER_ALLOW_INSECURE_REMOTE:-false}") {
      console.error("compose.prod.yaml must default SSTICKER_ALLOW_INSECURE_REMOTE to false, got " + JSON.stringify(env.SSTICKER_ALLOW_INSECURE_REMOTE));
      ok = false;
    }
    for (const required of ["SSTICKER_OIDC_ISSUER", "SSTICKER_OIDC_AUDIENCE", "SSTICKER_OIDC_JWKS_URL", "SSTICKER_SIGNING_SECRET", "SSTICKER_SESSION_SECRET"]) {
      const value = env && env[required];
      if (typeof value !== "string" || !value.includes("${SSTICKER_") || !(value.includes(":-") || value.includes(":?"))) {
        console.error("compose.prod.yaml: " + required + " must use a ${VAR:-default} form, got " + JSON.stringify(value));
        ok = false;
      }
    }
  }
  if (file === "compose.yaml") {
    if (env && env.SSTICKER_AUTH_MODE !== "${SSTICKER_AUTH_MODE:-none}") {
      console.error("compose.yaml must default SSTICKER_AUTH_MODE to none, got " + JSON.stringify(env.SSTICKER_AUTH_MODE));
      ok = false;
    }
    if (!ports || !ports.some((entry) => entry.startsWith("127.0.0.1:"))) {
      console.error("compose.yaml must bind only to 127.0.0.1");
      ok = false;
    }
  }
}

if (!ok) process.exit(1);
console.log("All compose files OK.");
