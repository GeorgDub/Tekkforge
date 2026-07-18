/**
 * Synthstudio – KORG-Bank-File-Type-Detection (v3.3.0)
 *
 * Schmaler Wrapper um isEsxBuffer / isE2sBuffer für eine einheitliche
 * Drop-/Picker-Entry-Pipeline. Keine Parser-Aufrufe — nur Magic-Bytes.
 */

import { isEsxBuffer } from "./esxParser";
import { isE2sBuffer } from "./e2sBankReader";

export type KorgBankType = "esx" | "e2s" | "unknown";

export function detectKorgBankType(input: ArrayBuffer | Uint8Array): KorgBankType {
  try {
    if (isEsxBuffer(input)) return "esx";
    if (isE2sBuffer(input)) return "e2s";
  } catch {
    /* defensive */
  }
  return "unknown";
}

/** Heuristic from filename only (does not read bytes). */
export function detectKorgBankTypeFromName(name: string): KorgBankType {
  if (typeof name !== "string") return "unknown";
  const lower = name.toLowerCase();
  if (lower.endsWith(".esx") || lower.endsWith(".ess")) return "esx";
  if (lower.endsWith(".all")) return "e2s";
  return "unknown";
}
