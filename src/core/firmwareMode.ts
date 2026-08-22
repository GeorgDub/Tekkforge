/**
 * firmwareMode.ts — Stock-KORG-Firmware vs. Hacktribe: welche Funktionen
 * TekkForge am angeschlossenen Gerät überhaupt anbieten darf.
 *
 * Alles, was über SysEx-Dumps (0x10/0x40/0x11), Global (0x0E), Program
 * Change und CC läuft, kann die Stock-Firmware. Hacktribe kommt nur für drei
 * Dinge ins Spiel:
 *
 *   nrpnFx     — IFX-Parameter live per NRPN setzen (hacktribeNrpn.ts)
 *   nrpnPanel  — Bedienfeld per NRPN (Part-Mute im Panel-Live-Modus)
 *   ramAccess  — RAM lesen/schreiben, CMD 0x52/0x54 (hacktribeRam.ts),
 *                dazu „FX-Puffer lesen" im Part-Popup
 *
 * Ein Stock-Gerät ignoriert NRPN stumm und antwortet auf 0x52 nie. Genau das
 * nutzt die Erkennung: eine harmlose 4-Byte-Leseanfrage — Antwort = Hacktribe,
 * Timeout = Stock. Default ist Stock, weil das die sichere Annahme ist: im
 * Zweifel wird nichts angeboten, was am Gerät ins Leere läuft.
 *
 * Reine Logik ohne DOM/MIDI, damit die Tabelle und die Entscheidung testbar
 * sind; die GUI fragt nur `featureAvailable` und `featureHint`.
 */

export type FirmwareMode = "stock" | "hacktribe";

export type Feature = "nrpnFx" | "nrpnPanel" | "ramAccess";

export const FIRMWARE_MODES: readonly FirmwareMode[] = ["stock", "hacktribe"];

export const FIRMWARE_LABEL: Record<FirmwareMode, string> = {
  stock: "Stock (KORG-Firmware)",
  hacktribe: "Hacktribe",
};

interface FeatureDef {
  label: string;
  /** true = nur mit Hacktribe. */
  hacktribeOnly: boolean;
  /** Was unter Stock stattdessen passiert (für den Hinweistext). */
  stockFallback: string;
}

export const FEATURES: Record<Feature, FeatureDef> = {
  nrpnFx: {
    label: "IFX-Parameter live senden (NRPN)",
    hacktribeOnly: true,
    stockFallback: `Parameter im Pattern setzen und per „Pattern → Gerät (Live)" übertragen.`,
  },
  nrpnPanel: {
    label: "Part-Mute sofort per NRPN",
    hacktribeOnly: true,
    stockFallback: "Mute wird per Edit-Buffer-Übertragung gesetzt (greift nach ~1 s).",
  },
  ramAccess: {
    label: "Geräte-RAM lesen/schreiben",
    hacktribeOnly: true,
    stockFallback: "Nicht verfügbar — die Stock-Firmware kennt die RAM-Befehle nicht.",
  },
};

export function featureAvailable(mode: FirmwareMode, feature: Feature): boolean {
  return !FEATURES[feature].hacktribeOnly || mode === "hacktribe";
}

/** Hinweistext, wenn eine Funktion im aktuellen Modus nicht angeboten wird. */
export function featureHint(mode: FirmwareMode, feature: Feature): string {
  const def = FEATURES[feature];
  if (featureAvailable(mode, feature)) return "";
  return `${def.label}: nur mit Hacktribe-Firmware. ${def.stockFallback}`;
}

/** localStorage-Schlüssel für die gemerkte Auswahl. */
export const FIRMWARE_STORAGE_KEY = "tekkforge.firmware";

/** Wandelt einen gespeicherten/unbekannten Wert in einen Modus; Default Stock. */
export function parseFirmwareMode(value: unknown): FirmwareMode {
  return value === "hacktribe" ? "hacktribe" : "stock";
}

/**
 * Erkennungs-Probe: harmlose RAM-Leseanfrage im DDR2-Bereich (Default-Adresse
 * des RAM-Panels, 4 Bytes). Stock antwortet nicht → Timeout → Stock.
 */
export const FIRMWARE_PROBE = {
  addr: 0xc00a80f0,
  len: 4,
  timeoutMs: 1500,
} as const;

export type ProbeOutcome = "reply" | "timeout" | "error";

/** Entscheidung aus dem Probe-Ergebnis. Nur eine echte Datenantwort zählt als Hacktribe. */
export function firmwareFromProbe(outcome: ProbeOutcome): FirmwareMode {
  return outcome === "reply" ? "hacktribe" : "stock";
}

/** Statuszeile nach der Erkennung. */
export function probeStatusText(outcome: ProbeOutcome, mode: FirmwareMode): string {
  switch (outcome) {
    case "reply":
      return `Firmware erkannt: ${FIRMWARE_LABEL[mode]} — RAM-Leseanfrage beantwortet.`;
    case "timeout":
      return `Firmware erkannt: ${FIRMWARE_LABEL[mode]} — keine Antwort auf die RAM-Probe (Stock kennt den Befehl nicht). Falls der Port von einem zweiten Programm belegt ist, sieht das genauso aus.`;
    default:
      return `Erkennung nicht möglich — bleibe bei ${FIRMWARE_LABEL[mode]}.`;
  }
}
