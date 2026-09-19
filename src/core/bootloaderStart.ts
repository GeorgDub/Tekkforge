/**
 * bootloaderStart — einen Bootloader FLÜCHTIG im On-Chip-RAM des Geräts starten, über Hacktribes
 * SysEx-Loader (bangcorrupt/hacktribe `scripts/execute_freetribe.py`, nachgebaut):
 *
 *   1. 0x58  „Pivot“: die laufende Hacktribe-Firmware wird zum Freetribe-Loader
 *            (Nutzdaten: 8 Null-Bytes, 7-Bit-kodiert). AB HIER ist das Gerät kein Sequencer mehr,
 *            sondern ein Loader, der auf Häppchen wartet — nur ein Aus-/Einschalten holt die
 *            Firmware zurück. Es gibt kein „Abbrechen“ per SysEx.
 *   2. Magic: `64 01 23 45 67` schicken → der Loader antwortet mit dem Wort `76 54 32 10`.
 *            Kommt es NICHT, hat der Pivot nicht gegriffen — dann NICHTS weiter schicken.
 *   3. 0x54  Daten-Häppchen à 256 Bytes (letztes mit 0 auf 256 aufgefüllt), der Loader legt sie
 *            FORTLAUFEND ab (kein 0x53-Adress-Setzen wie beim RAM-Schreiben in hacktribeRam.ts!);
 *            Antwort mit 0x21 heißt „Häppchen angenommen“.
 *   4. 0x57  Execute an 0x80000000 (Adresse LE + 4 reservierte Bytes): der Loader springt in das
 *            geladene Programm. Danach ist die alte Firmware weg — bis Neustart oder bis der
 *            Bootloader selbst „Boot from flash“ ausführt. USB meldet sich als e2fb:1802 neu an.
 *
 * Das ist der EINZIGE Weg in TekkForge, der Code auf dem Gerät AUSFÜHRT. Er schreibt NICHT ins
 * Flash (kein 0x56). Alles hier ist nach einem Aus-/Einschalten weg. Der Aufrufer (GUI) muss das
 * bestätigen lassen und darf nur Images anbieten, die für 0x80000000 gebaut sind und in die
 * 128 KiB On-Chip-RAM passen (bootloader.bin = 131022 B).
 *
 * Vorbehalt (2026-09-17): Die genaue Rahmung der Loader-ANTWORTEN ist ohne Gerät/Original-Skript
 * nicht byte-genau belegt. Darum werden Antworten TOLERANT geprüft — die Magic-Antwort wird als
 * 4-Byte-Folge irgendwo im Frame gesucht, der Häppchen-ACK als 0x21 im Frame. Die AUSGEHENDEN
 * Frames sind dagegen voll über `buildFrame`/`syxEnc` (e2sysex.ts) belegt und getestet.
 */
import { buildFrame, syxEnc, parseAck, E2_PRODUCT_ID_SAMPLER, type E2SysexOptions } from "./e2sysex";

export const LOADER_CMD = { pivot: 0x58, data: 0x54, execute: 0x57, magic: 0x64 } as const;
/** Magic-Handshake: gesendet wird `64 01 23 45 67`. */
export const LOADER_MAGIC = [0x64, 0x01, 0x23, 0x45, 0x67] as const;
/** …erwartete Antwort-Wort, irgendwo im Antwort-Frame. */
export const LOADER_MAGIC_REPLY = [0x76, 0x54, 0x32, 0x10] as const;
export const LOADER_CHUNK = 256;
export const LOADER_ACK = 0x21;
export const OC_RAM_START = 0x80000000;
export const OC_RAM_SIZE = 0x20000; // 128 KiB On-Chip-RAM

export type LoaderOpts = E2SysexOptions;

function normOpts(opts: LoaderOpts = {}): E2SysexOptions {
  return { channel: opts.channel ?? 0, productId: opts.productId ?? E2_PRODUCT_ID_SAMPLER };
}

/** 1. Pivot-Frame (0x58 + acht 7-Bit-kodierte Null-Bytes). */
export function buildPivot(opts?: LoaderOpts): Uint8Array {
  return buildFrame(LOADER_CMD.pivot, syxEnc(new Uint8Array(8)), normOpts(opts));
}

/** 2. Magic-Test-Frame (`64 01 23 45 67`, roh — NICHT 7-Bit-kodiert). */
export function buildMagicTest(opts?: LoaderOpts): Uint8Array {
  return buildFrame(LOADER_MAGIC[0], LOADER_MAGIC.slice(1) as unknown as number[], normOpts(opts));
}

/** True, wenn das Magic-Antwort-Wort `76 54 32 10` irgendwo im Frame steht. */
export function istMagicAntwort(bytes: Uint8Array | number[] | null | undefined): boolean {
  if (!bytes || bytes.length < LOADER_MAGIC_REPLY.length) return false;
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const m = LOADER_MAGIC_REPLY;
  for (let i = 0; i + m.length <= b.length; i++) {
    let hit = true;
    for (let j = 0; j < m.length; j++) {
      if (b[i + j] !== m[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * True, wenn der Frame den Häppchen-ACK 0x21 trägt. Zuerst an der msgId-Position (Index 6) über
 * parseAck — so quittiert ein KORG-E2-Frame eindeutig, statt dass irgendein 0x21-Datenbyte irgendwo
 * im Frame fälschlich als ACK gilt. Nur wenn parseAck den Frame nicht als E2-Rahmen erkennt, wird
 * ersatzweise nach 0x21 gesucht (der Loader nutzt evtl. eine andere Rahmung als KORG).
 */
export function istHaeppchenAck(bytes: Uint8Array | number[] | null | undefined): boolean {
  if (!bytes || bytes.length === 0) return false;
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const ack = parseAck(b);
  if (ack !== null) return ack === LOADER_ACK;
  for (let i = 0; i < b.length; i++) if (b[i] === LOADER_ACK) return true;
  return false;
}

/**
 * Image in 256-Byte-Häppchen zerlegen; das LETZTE wird mit 0 auf volle 256 aufgefüllt.
 * (131022 ist kein Vielfaches von 256 → das letzte Häppchen trägt echte Daten + Nullen.)
 */
export function inHaeppchen(image: Uint8Array, chunk = LOADER_CHUNK): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let off = 0; off < image.length; off += chunk) {
    const teil = new Uint8Array(chunk); // schon mit 0 gefüllt
    teil.set(image.subarray(off, Math.min(off + chunk, image.length)), 0);
    out.push(teil);
  }
  return out;
}

/** 3. Daten-Frame für ein 256-Byte-Häppchen (fortlaufend, ohne Adress-Setzen). */
export function buildDataChunk(chunk256: Uint8Array, opts?: LoaderOpts): Uint8Array {
  return buildFrame(LOADER_CMD.data, syxEnc(chunk256), normOpts(opts));
}

/** 4. Execute-Frame: Sprung an `addr` (Standard 0x80000000). Body = addr LE (4) + 4 reservierte 0. */
export function buildExecute(addr: number = OC_RAM_START, opts?: LoaderOpts): Uint8Array {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setUint32(0, addr >>> 0, true); // little-endian
  return buildFrame(LOADER_CMD.execute, syxEnc(body), normOpts(opts));
}

/** Ein-/Ausgabe-Kanal zum Gerät; die GUI reicht hier den echten MIDI-Transport herein. */
export interface LoaderIO {
  /**
   * Frame senden und auf die erste Antwort warten, die `akzeptiere` erfüllt (Timeout in ms).
   * WICHTIG: Der Transport muss Frames, die `akzeptiere` NICHT erfüllen, überspringen (weiterhören),
   * nicht mit ihnen auflösen — sonst quittiert ein Streu-Frame (z. B. Firmware-Ausgabe aus dem
   * Pivot-Fenster) fälschlich den Schritt. Wirft/rejectet bei Timeout.
   */
  sendeUndEmpfange(frame: Uint8Array, akzeptiere: (b: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array>;
  /** Frame senden, ohne auf Antwort zu warten (Pivot, Execute — danach verschwindet das Gerät). */
  sende(frame: Uint8Array): Promise<void>;
  /** Warten (ms). */
  warte(ms: number): Promise<void>;
}

export type LoaderSchritt = "pivot" | "magic" | "daten" | "execute" | "fertig";

export interface LoaderErgebnis {
  ok: boolean;
  schritt: LoaderSchritt;
  nachricht: string;
  haeppchenGesendet: number;
  haeppchenGesamt: number;
}

export interface StarteOpts extends LoaderOpts {
  /** ms Wartezeit nach dem Pivot, bevor der Magic-Test geht (Standard 1000, wie im Referenz-Skript). */
  pivotWarteMs?: number;
  /** Antwort-Timeout je Schritt (Standard 2000). */
  antwortTimeoutMs?: number;
  /** Fortschritt-Callback (gesendete, gesamte Häppchen). */
  fortschritt?: (gesendet: number, gesamt: number) => void;
}

/**
 * Bootloader (oder ein anderes 0x80000000-Image) FLÜCHTIG starten.
 *
 * Bricht SAUBER ab, wenn der Pivot nicht bestätigt wird (dann floss KEIN Byte in eine Firmware,
 * die nie umgeschaltet hat) oder ein Häppchen nicht quittiert wird. Nach erfolgreichem Execute ist
 * die alte Firmware weg; nur ein Aus-/Einschalten (oder „Boot from flash“ im Loader) kehrt zurück.
 *
 * WICHTIG: Diese Funktion NICHT unbeaufsichtigt am Gerät ausführen — sie kapert das Gerät.
 */
export async function starteBootloaderFluechtig(
  image: Uint8Array,
  io: LoaderIO,
  opts: StarteOpts = {},
): Promise<LoaderErgebnis> {
  const haeppchen = inHaeppchen(image);
  const gesamt = haeppchen.length;
  const fail = (schritt: LoaderSchritt, nachricht: string, gesendet = 0): LoaderErgebnis => ({
    ok: false, schritt, nachricht, haeppchenGesendet: gesendet, haeppchenGesamt: gesamt,
  });

  if (image.length === 0) return fail("pivot", "Leeres Image — nichts zu laden.");
  if (image.length > OC_RAM_SIZE) {
    return fail("pivot", `Image ${image.length} B passt nicht in ${OC_RAM_SIZE} B On-Chip-RAM.`);
  }

  const timeout = opts.antwortTimeoutMs ?? 2000;

  // 1. Pivot: laufende Firmware → Loader. Danach ist das Gerät gekapert.
  await io.sende(buildPivot(opts));
  await io.warte(opts.pivotWarteMs ?? 1000);

  // 2. Magic-Handshake. Der Transport wartet gezielt auf das Magic-Wort und überspringt Streu-Frames
  //    (z. B. Firmware-Ausgabe, die noch aus dem Pivot-Fenster in der Eingangs-Warteschlange liegt).
  //    Ohne Bestätigung wird NICHTS weiter geschickt.
  try {
    await io.sendeUndEmpfange(buildMagicTest(opts), istMagicAntwort, timeout);
  } catch {
    return fail("magic", "Keine Magic-Antwort `76 54 32 10` — Gerät ist NICHT im Loader (Pivot hat "
      + "vermutlich nicht gegriffen). Es wurde KEIN Häppchen gesendet. "
      + "Gerät aus- und wieder einschalten stellt die Firmware her.");
  }

  // 3. Häppchen fortlaufend laden; je Häppchen gezielt auf den 0x21-ACK warten.
  for (let i = 0; i < gesamt; i++) {
    try {
      await io.sendeUndEmpfange(buildDataChunk(haeppchen[i], opts), istHaeppchenAck, timeout);
    } catch {
      return fail("daten", `Häppchen ${i + 1}/${gesamt} nicht mit 0x21 quittiert (Timeout/Fehler). `
        + "Übertragung abgebrochen; Gerät hängt im Loader, bis es aus- und wieder eingeschaltet wird.", i);
    }
    opts.fortschritt?.(i + 1, gesamt);
  }

  // 4. Execute — Sprung ins Image. Keine verlässliche Antwort (Gerät springt weg).
  await io.sende(buildExecute(OC_RAM_START, opts));

  return {
    ok: true, schritt: "fertig", haeppchenGesendet: gesamt, haeppchenGesamt: gesamt,
    nachricht: `Bootloader gestartet: ${gesamt} Häppchen geladen, Sprung an 0x${OC_RAM_START.toString(16)}. `
      + "Die alte Firmware ist bis zum Aus-/Einschalten weg. USB meldet sich als e2fb:1802 neu an.",
  };
}
