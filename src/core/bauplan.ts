/**
 * bauplan — ein Firmware-Umbau als Datei: Presets und Grooves mit Plaetzen,
 * Init-Pattern, Startbild und Init-Global, dazu der Hash der Basis, fuer die
 * er gedacht war.
 *
 * Wozu: Wer sich seine Bank zusammengebaut, ein Startbild gemalt und ein
 * Init-Pattern eingestellt hat, will das nicht bei jeder neuen Hacktribe-
 * Fassung von Hand wiederholen — und will es weitergeben koennen, ohne eine
 * 2-MB-Firmware zu verschicken. Ein Bauplan ist alles, was TekkForge in eine
 * Basis legt, in einer JSON-Datei (`.tfbau`), wie die Sammlung mit Base64.
 *
 * Anwenden heisst: `baueFirmware` fuer die Eintraege, dann Init-Pattern,
 * Startbild und Init-Global — dieselben Schritte wie in der Werkbank.
 */
import { bytesToBase64, base64ToBytes } from "./wavCodec";
import { leseSammlung, baueSammlung, type SammlungsEintrag } from "./sammlung";
import {
  baueFirmware,
  setzeInitPattern,
  setzeSplash,
  setzeInitGlobal,
  INIT_PATTERN_GROESSE,
  E2SPAT_GROESSE,
  SPLASH_GROESSE,
  INIT_GLOBAL_GROESSE,
  type FirmwareBauBericht,
} from "./firmwareBau";

export const BAUPLAN_VERSION = 1;

export interface Bauplan {
  version: number;
  titel: string;
  autor: string;
  wann: string;
  /** SHA-256 der Basis, auf der der Plan entstand — zur Warnung, nicht als Sperre. */
  basisSha256?: string;
  eintraege: SammlungsEintrag[];
  /** Der 0x3C00-Block („PTST" … „PTED") oder eine ganze .e2spat. */
  initPattern?: Uint8Array;
  splash?: Uint8Array;
  initGlobal?: Uint8Array;
}

export function baueBauplan(plan: Omit<Bauplan, "version" | "wann"> & { wann?: string }): string {
  // Die Eintraege gehen durch die Sammlung — gleiche Pruefungen, gleiches Format.
  const sammlung = JSON.parse(baueSammlung(plan.eintraege, { titel: plan.titel, autor: plan.autor, wann: plan.wann })) as Record<string, unknown>;
  return JSON.stringify(
    {
      version: BAUPLAN_VERSION,
      titel: plan.titel,
      autor: plan.autor,
      wann: plan.wann ?? new Date().toISOString(),
      ...(plan.basisSha256 ? { basisSha256: plan.basisSha256 } : {}),
      eintraege: sammlung.eintraege,
      ...(plan.initPattern ? { initPattern: bytesToBase64(plan.initPattern) } : {}),
      ...(plan.splash ? { splash: bytesToBase64(plan.splash) } : {}),
      ...(plan.initGlobal ? { initGlobal: bytesToBase64(plan.initGlobal) } : {}),
    },
    null,
    1,
  );
}

export function leseBauplan(text: string): Bauplan {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Error("Das ist kein lesbarer Bauplan (kein JSON).");
  }
  const x = (typeof roh === "object" && roh ? roh : {}) as Record<string, unknown>;
  if (x.version !== BAUPLAN_VERSION) throw new Error(`Unbekannte Bauplan-Version ${String(x.version)} — erwartet ${BAUPLAN_VERSION}.`);
  const eintraege = Array.isArray(x.eintraege) && x.eintraege.length
    ? leseSammlung(JSON.stringify({ version: 1, titel: x.titel, autor: x.autor, wann: x.wann, eintraege: x.eintraege })).eintraege
    : [];
  for (const e of eintraege) if (e.platz === undefined) throw new Error(`Eintrag „${e.name}“ hat keinen Platz — in einen Bauplan gehört nur, was einen hat.`);
  const block = (key: string, groessen: number[], magic?: [number, string]): Uint8Array | undefined => {
    if (x[key] === undefined) return undefined;
    if (typeof x[key] !== "string") throw new Error(`Feld „${key}“ ist keine Base64-Zeichenkette.`);
    const b = base64ToBytes(x[key] as string);
    if (!groessen.includes(b.length)) throw new Error(`Feld „${key}“: ${b.length} Bytes, erwartet ${groessen.join(" oder ")}.`);
    if (magic) {
      const [off, soll] = magic;
      if (String.fromCharCode(...b.subarray(off, off + soll.length)) !== soll) throw new Error(`Feld „${key}“: erwartete „${soll}“ an Offset ${off}.`);
    }
    return b;
  };
  const initPattern = block("initPattern", [INIT_PATTERN_GROESSE, E2SPAT_GROESSE]);
  if (initPattern) {
    const off = initPattern.length === E2SPAT_GROESSE ? 0x100 : 0;
    if (String.fromCharCode(...initPattern.subarray(off, off + 4)) !== "PTST") throw new Error("Init-Pattern im Bauplan beginnt nicht mit „PTST“.");
  }
  const plan: Bauplan = {
    version: BAUPLAN_VERSION,
    titel: String(x.titel ?? "Bauplan"),
    autor: String(x.autor ?? ""),
    wann: String(x.wann ?? ""),
    eintraege,
  };
  if (typeof x.basisSha256 === "string") plan.basisSha256 = x.basisSha256;
  if (initPattern) plan.initPattern = initPattern;
  const splash = block("splash", [SPLASH_GROESSE]);
  if (splash) plan.splash = splash;
  const initGlobal = block("initGlobal", [INIT_GLOBAL_GROESSE], [0, "GLST"]);
  if (initGlobal) plan.initGlobal = initGlobal;
  if (!eintraege.length && !initPattern && !splash && !initGlobal) throw new Error("Der Bauplan ist leer.");
  return plan;
}

export type BauplanErgebnis =
  | { ok: true; bytes: Uint8Array; bericht: FirmwareBauBericht | null; zeilen: string[] }
  | { ok: false; reason: string };

/** Den Plan auf eine Basis anwenden — dieselben Schritte wie die Werkbank, in derselben Reihenfolge. */
export function wendeBauplanAn(basis: Uint8Array, plan: Bauplan): BauplanErgebnis {
  let bytes = basis;
  let bericht: FirmwareBauBericht | null = null;
  const zeilen: string[] = [];
  if (plan.eintraege.length) {
    const r = baueFirmware(basis, plan.eintraege);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    bericht = r.bericht;
    const je = (art: string) => r.bericht.geschrieben.filter((g) => g.art === art).length;
    zeilen.push(`Presets: ${je("ifx")} IFX, ${je("mfx")} MFX, ${je("groove")} Grooves`);
    if (r.bericht.zaehler.length) zeilen.push(`IFX-Menü: bis ${r.bericht.ifxMaxVorher + 1} → bis ${r.bericht.ifxMaxNachher + 1}`);
    if (r.bericht.grooveZaehler.length) zeilen.push(`Groove-Menü: bis ${r.bericht.grooveMaxVorher + 1} → bis ${r.bericht.grooveMaxNachher + 1}`);
  }
  try {
    if (plan.initPattern) {
      bytes = setzeInitPattern(bytes, plan.initPattern);
      zeilen.push("Init-Pattern gesetzt");
    }
    if (plan.initGlobal) {
      bytes = setzeInitGlobal(bytes, plan.initGlobal);
      zeilen.push("Init-Global gesetzt");
    }
    if (plan.splash) {
      bytes = setzeSplash(bytes, plan.splash);
      zeilen.push("Startbild gesetzt");
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, bytes, bericht, zeilen };
}
