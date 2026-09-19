/**
 * crossgrade — eine electribe-2-SYSTEM.VSB von einer Variante auf die andere
 * umkoepfen, damit die Firmware der einen Variante auf der Hardware der anderen
 * laeuft. Beide Geraete sind hardware-identisch; nur die Firmware unterscheidet
 * sich. Enthaelt neben dem Kopf-Umkoepfen den am Geraet bewiesenen
 * Boot-ID-Tor-Patch, ohne den die umgekoepfte Firmware nicht durchbootet.
 *
 * Am v2.02-Abbild disassembliert (Omnitribe
 * `docs/reverse/e2synth_auf_e2s_crossgrade_v202.md` und
 * `docs/reverse/crossgrade_idgate_befund_2026-09-09.md`):
 *
 * 1. DATEI-PRUEFUNG DES UPDATERS. Der SD-Updater prueft in drei Schritten —
 *    a. memcmp(Kopf, "KORG SYSTEM FILE", 16)
 *    b. family_check auf Byte 0x2E (Device-ID low). Der SYSTEM-Validator ruft
 *       ihn STRIKT: die LAUFENDE Firmware akzeptiert nur die eigene Variante
 *       (Synth-OS nur 0x23, Sampler-OS nur 0x24). Eine fremde Datei faellt als
 *       „Invalid File". Deshalb MUSS der Kopf auf die Variante der aktuell
 *       laufenden Firmware umgekoepft werden, nicht auf die Zielvariante.
 *    c. memcmp(Kopf[0x20:], "SYSTEM", 6).
 *    Getragene Kopf-Bytes: 0x2E (Device-ID low) und 0x12 (Magic-Suffix
 *    'E2'/'E2S'); 0x2D wird auf 0x01 gesetzt.
 *
 * 2. BOOT-ID-TOR. Beim Booten liest das OS die GERAETEINTERNE Plattform-
 *    Signatur aus den USER-Daten ("elec2USR"=0x123 / "ele2sUSR"=0x124) und
 *    vergleicht sie gegen einen fest verdrahteten Wert. Passt sie nicht, geht
 *    das OS in einen Update-/Recovery-Bootcode (0xA) — die „Update-Schleife".
 *    Der Kopf-Crossgrade allein reicht darum NICHT: das Tor sitzt im Payload.
 *    - Synth-Payload auf Sampler-Hardware: Vergleichskonstante 0x00000123 bei
 *      Datei-Offset 0x025F64 -> 0x00000124 (Synth akzeptiert Sampler-USER-Daten).
 *    - Sampler-Payload (Recovery, wenn USER evtl. auf Synth gestempelt wurde):
 *      `mov r3,#0xA` (Mismatch-Bootcode) bei Datei-Offset 0x028AE0 -> `mov r3,#0`
 *      (bootet normal, egal was im USER-Stempel steht).
 *
 * ✅ GERAETEBEFUND 2026-09-09 — der Crossgrade FUNKTIONIERT mit dem Boot-Tor-
 * Patch: Der reine Kopf-Crossgrade booted in die Update-Schleife (am Geraet
 * belegt, Inquiry-Byte 0x23 = Synth-OS laeuft), MIT dem Byte-Patch am ID-Tor
 * bootet die Synth-Firmware normal auf Sampler-Hardware. Die Klangerzeugung
 * (VPM, Analog-Modeling, geteilte PCM) laeuft. Offene Grenze: synth-eigene
 * PCM-Oszillatoren bleiben an die im Geraet vorhandene PCM.VSB gebunden
 * (Sampler-PCM), bis eine Synth-PCM.VSB vorliegt.
 *
 * Reine Byte-Operation. Es wird KEINE Korg-Firmware mitgeliefert; der Nutzer
 * laedt die Firmware selbst und faehrt sie hier durch.
 *
 * Rueckweg (belegt): die Firmware der aktuell laufenden Variante flashen. Laeuft
 * bereits die andere Variante (z. B. Synth nach dem Crossgrade), muss die
 * Rueckweg-Datei fuer deren Updater ebenfalls umgekoepft werden — genau dafuer
 * ist der Umpatcher da.
 */

/** Ergebnis am Geraet bestaetigt — Kurzhinweis fuer die Oberflaeche. */
export const CROSSGRADE_GERAETEBEFUND =
  "✅ Am Gerät bestätigt (2026-09-09): Mit dem Boot-ID-Tor-Patch bootet die umgeköpfte Firmware normal. Ohne den Patch hängt sie in der Update-Schleife. Klangerzeugung läuft; PCM-Sample-Oszillatoren bleiben an die im Gerät vorhandene PCM.VSB gebunden. Rückweg: Firmware der laufenden Variante flashen (bei bereits laufender Synth-Firmware ebenfalls hier umköpfen).";

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

/**
 * Boot-ID-Tor-Patch, gekennzeichnet nach der PAYLOAD-Variante (= der Firmware,
 * die nach dem Flashen laeuft, also der Quellvariante der Datei). `erwartet`
 * wird vor dem Patchen geprueft; passt es nicht (andere Firmware-Version), wird
 * der Patch NICHT angewendet und das gemeldet — der Kopf-Crossgrade bleibt gueltig.
 * Offsets am v2.02-Abbild belegt (Synth) bzw. an der Hacktribe-Fassung (Sampler).
 */
export interface GatePatch {
  offset: number;
  erwartet: number[];
  gepatcht: number[];
  zweck: string;
}

export const BOOT_GATE: Record<Variante, GatePatch> = {
  // Synth-Firmware: Vergleichswert 0x00000123 (ldr r3,=0x123 @0xC0025E44) -> 0x124.
  synth: {
    offset: 0x025f64,
    erwartet: [0x23, 0x01, 0x00, 0x00],
    gepatcht: [0x24, 0x01, 0x00, 0x00],
    zweck: "Synth-OS akzeptiert die Sampler-USER-Signatur (0x124) und bootet normal auf Sampler-Hardware.",
  },
  // Sampler-Firmware: Mismatch-Bootcode `mov r3,#0xA` @0xC00289E0 -> `mov r3,#0`.
  sampler: {
    offset: 0x028ae0,
    erwartet: [0x0a, 0x30, 0xa0, 0xe3],
    gepatcht: [0x00, 0x30, 0xa0, 0xe3],
    zweck: "Sampler-OS bootet unabhängig vom USER-Stempel (auch wenn er auf Synth 0x123 steht).",
  },
};

/**
 * „Einheitlicher Header" / Loose-Updater: patcht `family_check`, sodass der
 * SD-Updater der laufenden Firmware BEIDE Header (Synth 0x23 UND Sampler 0x24)
 * annimmt — dann muss der Kopf beim Firmware-Wechsel nie mehr umgeköpft werden.
 * Mechanik: der Sprung in den strikten Zweig (nur eigene Variante) wird zum NOP,
 * alle Aufrufer fallen in den Loose-Zweig, der `idLow ∈ {0x23,0x24}` akzeptiert.
 * Offset nach PAYLOAD-Variante (die laufende Firmware). Am v2.02-Abbild belegt.
 */
export const FAMILY_CHECK_LOOSE: Record<Variante, GatePatch> = {
  synth: {
    offset: 0x032910,
    erwartet: [0x08, 0x00, 0x00, 0x0a], // beq 0xC0032838 (in den strikten Zweig)
    gepatcht: [0x01, 0x10, 0xa0, 0xe1], // mov r1,r1 (NOP) -> immer Loose-Zweig
    zweck: "Synth-Updater akzeptiert Synth- UND Sampler-Header (kein Umköpfen nötig).",
  },
  sampler: {
    offset: 0x0368fc,
    erwartet: [0x08, 0x00, 0x00, 0x0a],
    gepatcht: [0x01, 0x10, 0xa0, 0xe1],
    zweck: "Sampler-Updater akzeptiert Synth- UND Sampler-Header (kein Umköpfen nötig).",
  },
};

/** Bekannte offizielle v2.02-Abbilder und das umgekoepfte Ergebnis (SHA-256). */
export const BEKANNTE_HASHES: Record<string, string> = {
  "41fc5f1c33209ef381d1c9fef21a72380bcd8d3431c9c1350a964f5c619ab8b8": "Synth v2.02 (offiziell)",
  "1d0f0689d5a12c8a8bde9f821f2a59adc5f6cd6012ddb201ebb192b72468a646": "Sampler v2.02 (offiziell)",
  "0d78b5b0ee0e8671329753696773fde3b762cd882a5ab1ee544e1c160b37bcd7": "Synth v2.02 → Sampler umgekoepft (nur Kopf)",
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

/** Prueft, ob an `offset` genau die erwarteten Bytes stehen. */
function bytesPassen(data: Uint8Array, offset: number, erwartet: number[]): boolean {
  for (let i = 0; i < erwartet.length; i++) if (data[offset + i] !== erwartet[i]) return false;
  return true;
}

export interface GatePatchErgebnis {
  angewendet: boolean;
  offset: number;
  grund: string;
}

export interface CrossgradeErgebnis {
  bytes: Uint8Array;
  vonVariante: Variante;
  zuVariante: Variante;
  /** Alle geänderten Offsets (Kopf + ggf. Boot-Tor). */
  geaendert: number[];
  /** Nur die Kopf-Offsets — muss [0x12, 0x2E] sein. */
  kopfGeaendert: number[];
  sdPfad: string;
  /** Ergebnis des Boot-ID-Tor-Patches (nur bei bootGate). */
  gatePatch?: GatePatchErgebnis;
  /** Ergebnis des Loose-Updater-Patches (nur bei familyLoose). */
  familyPatch?: GatePatchErgebnis;
  /** Am Gerät bestätigter Befund (siehe {@link CROSSGRADE_GERAETEBEFUND}). */
  geraetebefund: string;
}

export interface CrossgradeOptionen {
  /**
   * Boot-ID-Tor mitpatchen (Standard: true). Ohne den Patch hängt die umgeköpfte
   * Firmware in der Update-Schleife. Der Patch wird nur angewendet, wenn die
   * erwarteten Bytes an der bekannten Stelle stehen; sonst bleibt es beim
   * reinen Kopf-Crossgrade (mit Hinweis).
   */
  bootGate?: boolean;
  /**
   * `family_check` auf Loose patchen (Standard: false), sodass der Updater der
   * FERTIGEN Firmware beide Header annimmt — dann muss beim nächsten
   * Firmware-Wechsel nicht mehr umgeköpft werden. Siehe {@link vereinheitliche}.
   */
  familyLoose?: boolean;
}

/** Wendet einen GatePatch (Boot-Tor / family_check) an, wenn die erwarteten Bytes passen. */
function wendeGatePatch(out: Uint8Array, g: GatePatch): GatePatchErgebnis {
  if (bytesPassen(out, g.offset, g.erwartet)) {
    for (let i = 0; i < g.gepatcht.length; i++) out[g.offset + i] = g.gepatcht[i];
    return { angewendet: true, offset: g.offset, grund: `bei 0x${g.offset.toString(16)} gepatcht — ${g.zweck}` };
  }
  return { angewendet: false, offset: g.offset, grund: `bei 0x${g.offset.toString(16)} NICHT gefunden (andere Firmware-Version?).` };
}

/**
 * „Einheitlicher Header": patcht Boot-ID-Tor + `family_check` (Loose), OHNE den
 * Kopf zu ändern. Ergebnis: die Firmware bootet auf der Hardware und ihr Updater
 * akzeptiert beide Header — der Nutzer muss beim Firmware-Wechsel nie umköpfen.
 * Am Gerät bestätigt 2026-09-10 (Synth mit Loose-Updater flasht Sampler direkt).
 */
export function vereinheitliche(
  data: Uint8Array,
  opts: { bootGate?: boolean } = {},
): { bytes: Uint8Array; variante: Variante; gatePatch: GatePatchErgebnis; familyPatch: GatePatchErgebnis; geaendert: number[] } {
  const bootGate = opts.bootGate ?? true;
  const befund = analysiere(data);
  if (!befund.ok || befund.variante === "?") throw new Error(`Eingabe abgelehnt: ${befund.grund}`);
  const v = befund.variante;
  const out = new Uint8Array(data);
  const gatePatch = bootGate
    ? wendeGatePatch(out, BOOT_GATE[v])
    : { angewendet: false, offset: BOOT_GATE[v].offset, grund: "Boot-Tor auf Wunsch übersprungen." };
  const familyPatch = wendeGatePatch(out, FAMILY_CHECK_LOOSE[v]);
  return { bytes: out, variante: v, gatePatch, familyPatch, geaendert: unterschiedsBytes(data, out) };
}

/**
 * Kopf auf die Zielvariante setzen (Byte 0x12, 0x2D, 0x2E) und — sofern
 * `bootGate` (Standard an) — das Boot-ID-Tor der PAYLOAD-Firmware patchen.
 *
 * WICHTIG zur Zielwahl: `ziel` ist die Variante, deren UPDATER die Datei
 * annehmen soll (also die aktuell laufende Firmware). Der Payload — und damit
 * die Firmware, die danach laeuft — bleibt der der Quelldatei. Fuer den
 * Synth-auf-Sampler-Weg laedt man eine Synth-Datei und waehlt `ziel="sampler"`
 * nur, wenn der laufende Updater ein Sampler ist; laeuft bereits Synth, waehlt
 * man `ziel="synth"` (Recovery einer Sampler-Datei fuer den Synth-Updater).
 *
 * Wirft mit klarer Begruendung, wenn die Eingabe keine gueltige SYSTEM.VSB ist
 * oder schon die Zielvariante hat.
 */
export function crossgrade(data: Uint8Array, ziel: Variante, opts: CrossgradeOptionen = {}): CrossgradeErgebnis {
  const bootGate = opts.bootGate ?? true;
  const befund = analysiere(data);
  if (!befund.ok || befund.variante === "?") throw new Error(`Eingabe abgelehnt: ${befund.grund}`);
  if (befund.variante === ziel) throw new Error(`Datei ist bereits „${VARIANTEN[ziel].label}“ — nichts umzukoepfen.`);
  const quelle = befund.variante;
  const v = VARIANTEN[ziel];
  const out = new Uint8Array(data);
  out[OFF_SUFFIX] = v.suffix;
  out[OFF_ID_LOW] = v.idLow;
  out[OFF_ID_HIGH] = 0x01;
  const kopfGeaendert = unterschiedsBytes(data, out);
  if (kopfGeaendert.length !== 2 || kopfGeaendert[0] !== OFF_SUFFIX || kopfGeaendert[1] !== OFF_ID_LOW) {
    throw new Error(`Unerwartete Kopf-Änderung an Offsets ${kopfGeaendert.map((x) => "0x" + x.toString(16))} — abgebrochen.`);
  }

  // Boot-ID-Tor der Payload-Firmware (= Quellvariante) patchen.
  const gatePatch = bootGate ? wendeGatePatch(out, BOOT_GATE[quelle]) : undefined;
  // Optional den Updater auf Loose patchen (kein künftiges Umköpfen nötig).
  const familyPatch = opts.familyLoose ? wendeGatePatch(out, FAMILY_CHECK_LOOSE[quelle]) : undefined;

  const res = analysiere(out);
  if (!res.ok || res.variante !== ziel) throw new Error(`Ergebnis nicht gültig als „${ziel}“: ${res.grund}`);
  return {
    bytes: out,
    vonVariante: quelle,
    zuVariante: ziel,
    geaendert: unterschiedsBytes(data, out),
    kopfGeaendert,
    sdPfad: `${v.sdOrdner}/SYSTEM.VSB`,
    gatePatch,
    familyPatch,
    geraetebefund: CROSSGRADE_GERAETEBEFUND,
  };
}
