/**
 * crossgrade — eine electribe-2-SYSTEM.VSB von einer Variante auf die andere
 * umkoepfen, damit die offizielle Synth-Firmware auf Sampler-Hardware laeuft
 * (und umgekehrt). Beide Geraete sind hardware-identisch; nur die Firmware
 * unterscheidet sich.
 *
 * Am v2.02-Abbild disassembliert (Omnitribe
 * `docs/reverse/e2synth_auf_e2s_crossgrade_v202.md`): Der SD-Updater der
 * Electribe 2 prueft eine SYSTEM.VSB in drei Schritten —
 *   1. memcmp(Kopf, "KORG SYSTEM FILE", 16)   (ohne das E2/E2S-Suffix)
 *   2. family_check: Device-ID-Feld (Kopf[0x2D:0x2E] als 0x01xx). Der
 *      SYSTEM-Validator ruft ihn STRIKT: akzeptiert nur die eigene Variante
 *      (Sampler 0x0124). Eine Synth-Datei (0x0123) faellt als „Invalid File".
 *   3. memcmp(Kopf[0x20:], "SYSTEM", 6)        (Dateityp, variantenneutral)
 *
 * Der einzige geraetetragende Unterschied im 0x100-Byte-Kopf ist Byte 0x2E
 * (Device-ID low). Byte 0x12 (Magic-Suffix 'E2' vs 'E2S') wird vom
 * SYSTEM-Validator nicht geprueft, aber mitgesetzt, damit die Datei einer
 * echten Datei der Zielvariante byte-genau gleicht.
 *
 * Der Payload ab 0x100 (ARM-App + eingebettete Blackfin-Audio-Engine:
 * Oszillatoren, VPM, Filter) bleibt unangetastet und reist mit — die
 * Synth-Datei auf dem Sampler ergibt eine echte Synth-Klangerzeugung.
 * PCM-Instrumente liegen NICHT im SYSTEM.VSB, sondern geraeteseitig in
 * PCM.VSB — die bleibt die des Samplers (Caveat).
 *
 * Reine Byte-Operation. Es wird KEINE Korg-Firmware mitgeliefert; der Nutzer
 * laedt die offizielle SYSTEM.VSB bei Korg und faehrt sie hier durch.
 */

export const VSB_HEADER = 0x100;
export const VSB_PAYLOAD = 0x200000;
export const VSB_TOTAL = VSB_HEADER + VSB_PAYLOAD;

const MAGIC16 = "KORG SYSTEM FILE";
export const OFF_SUFFIX = 0x12;
export const OFF_ID_LOW = 0x2e;
export const OFF_ID_HIGH = 0x2d;
export const OFF_TAG = 0x20;

export type Variante = "synth" | "sampler";

export interface VariantenDef {
  suffix: number;
  idLow: number;
  deviceId: number;
  sdOrdner: string;
  label: string;
}

export const VARIANTEN: Record<Variante, VariantenDef> = {
  synth: { suffix: 0x00, idLow: 0x23, deviceId: 0x0123, sdOrdner: "KORG/electribe/System", label: "electribe 2 (Synth)" },
  sampler: { suffix: 0x53, idLow: 0x24, deviceId: 0x0124, sdOrdner: "KORG/electribe sampler/System", label: "electribe 2 sampler" },
};

/** Bekannte offizielle v2.02-Abbilder und das umgekoepfte Ergebnis (SHA-256). */
export const BEKANNTE_HASHES: Record<string, string> = {
  "41fc5f1c33209ef381d1c9fef21a72380bcd8d3431c9c1350a964f5c619ab8b8": "Synth v2.02 (offiziell)",
  "1d0f0689d5a12c8a8bde9f821f2a59adc5f6cd6012ddb201ebb192b72468a646": "Sampler v2.02 (offiziell)",
  "0d78b5b0ee0e8671329753696773fde3b762cd882a5ab1ee544e1c160b37bcd7": "Synth v2.02 → Sampler umgekoepft",
};

export interface VsbBefund {
  ok: boolean;
  grund: string;
  variante: Variante | "?";
  deviceId: number;
  magicOk: boolean;
  tagOk: boolean;
}

const liesAscii = (b: Uint8Array, off: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i] ?? 0);
  return s;
};

/** Kopf einer SYSTEM.VSB analysieren — variantensicher, ohne zu werfen. */
export function analysiere(data: Uint8Array): VsbBefund {
  if (data.length !== VSB_TOTAL) {
    return { ok: false, grund: `Falsche Größe: ${data.length} statt ${VSB_TOTAL} Bytes`, variante: "?", deviceId: -1, magicOk: false, tagOk: false };
  }
  const magicOk = liesAscii(data, 0, 16) === MAGIC16;
  const tagOk = liesAscii(data, OFF_TAG, 6) === "SYSTEM";
  const deviceId = (data[OFF_ID_HIGH] << 8) | data[OFF_ID_LOW];
  let variante: Variante | "?" = "?";
  (Object.keys(VARIANTEN) as Variante[]).forEach((v) => {
    if (data[OFF_ID_LOW] === VARIANTEN[v].idLow && data[OFF_SUFFIX] === VARIANTEN[v].suffix) variante = v;
  });
  if (!magicOk) return { ok: false, grund: "Kopf ohne „KORG SYSTEM FILE“ — keine electribe-SYSTEM.VSB", variante, deviceId, magicOk, tagOk };
  if (!tagOk) return { ok: false, grund: "Dateityp-Tag bei 0x20 ist nicht „SYSTEM“ — evtl. PCM.VSB/BOOT.VSB", variante, deviceId, magicOk, tagOk };
  if (deviceId !== 0x0123 && deviceId !== 0x0124) {
    return { ok: false, grund: `Device-ID 0x${deviceId.toString(16).padStart(4, "0")} ist weder Synth (0x0123) noch Sampler (0x0124)`, variante, deviceId, magicOk, tagOk };
  }
  return { ok: true, grund: "gültige electribe-2-SYSTEM.VSB", variante, deviceId, magicOk, tagOk };
}

/** Offsets, an denen sich zwei gleich lange Puffer unterscheiden. */
export function unterschiedsBytes(a: Uint8Array, b: Uint8Array): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i);
  for (let i = n; i < Math.max(a.length, b.length); i++) out.push(i);
  return out;
}

export interface CrossgradeErgebnis {
  bytes: Uint8Array;
  vonVariante: Variante;
  zuVariante: Variante;
  /** Geänderte Offsets — muss genau [0x12, 0x2E] sein. */
  geaendert: number[];
  sdPfad: string;
}

/**
 * Kopf auf die Zielvariante setzen (nur Byte 0x12 und 0x2E). Payload bleibt.
 * Wirft mit klarer Begründung, wenn die Eingabe keine gültige SYSTEM.VSB ist
 * oder schon die Zielvariante hat.
 */
export function crossgrade(data: Uint8Array, ziel: Variante): CrossgradeErgebnis {
  const befund = analysiere(data);
  if (!befund.ok || befund.variante === "?") throw new Error(`Eingabe abgelehnt: ${befund.grund}`);
  if (befund.variante === ziel) throw new Error(`Datei ist bereits „${VARIANTEN[ziel].label}“ — nichts umzukoepfen.`);
  const v = VARIANTEN[ziel];
  const out = new Uint8Array(data);
  out[OFF_SUFFIX] = v.suffix;
  out[OFF_ID_LOW] = v.idLow;
  out[OFF_ID_HIGH] = 0x01;
  const geaendert = unterschiedsBytes(data, out);
  if (geaendert.length !== 2 || geaendert[0] !== OFF_SUFFIX || geaendert[1] !== OFF_ID_LOW) {
    throw new Error(`Unerwartete Änderung an Offsets ${geaendert.map((x) => "0x" + x.toString(16))} — abgebrochen.`);
  }
  const res = analysiere(out);
  if (!res.ok || res.variante !== ziel) throw new Error(`Ergebnis nicht gültig als „${ziel}“: ${res.grund}`);
  return { bytes: out, vonVariante: befund.variante, zuVariante: ziel, geaendert, sdPfad: `${v.sdOrdner}/SYSTEM.VSB` };
}
