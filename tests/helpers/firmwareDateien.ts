import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Die echten Korg-/Hacktribe-Abbilder liegen NIE im Repo. Tests, die sie
 * brauchen, holen sie aus TEKKFORGE_FIRMWARE_DIR oder aus dem Omnitribe-
 * Schwesterrepo (../omnitribe/vendor/firmware) — und ueberspringen sich sonst.
 */
export function firmwareOrdner(): string | null {
  const env = process.env.TEKKFORGE_FIRMWARE_DIR;
  const kandidaten = [env, resolve(process.cwd(), "../omnitribe/vendor/firmware"), resolve(process.cwd(), "vendor/firmware")].filter(Boolean) as string[];
  for (const k of kandidaten) if (existsSync(join(k, "stock_e2s_v202.vsb"))) return k;
  return null;
}

export function firmwareDatei(name: string): string | null {
  const o = firmwareOrdner();
  return o ? join(o, name) : null;
}
