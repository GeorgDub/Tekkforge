/**
 * syxDatei — eine .syx-Datei (Folge von F0…F7-Frames) zerlegen, prüfen, beschreiben und
 * frameweise ans Gerät senden. Gedacht für Omnitribes Modul-Bündel (`omnitribe_modules.syx`,
 * OTP-Frames `F0 7D 01 02 05 01 …` = Sample-Block-Transfer, den der Hacktribe-erweiterte Loader
 * als Modul-Code-Laden versteht) — aber generisch für jede SysEx-Datei.
 *
 * Senden: je Frame senden, optional auf EINE Antwort warten (OTP quittiert Block-Transfers mit
 * `05 03`; für unbekannte Kommandos kommt laut Protokoll KEIN ACK, ein Timeout ist dort normal),
 * dazwischen eine Pause. Nichts davon schreibt ins Flash — der Loader legt Module im RAM ab.
 */

export interface SyxZerlegung {
  frames: Uint8Array[];
  /** Bytes außerhalb eines Frames oder Frames mit Datenbyte ≥ 0x80 (mit Position). */
  fehler: string[];
  bytesGesamt: number;
}

export function zerlegeSyx(bytes: Uint8Array): SyxZerlegung {
  const frames: Uint8Array[] = [];
  const fehler: string[] = [];
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0xf0) {
      if (start >= 0) fehler.push(`Frame ab Byte ${start} ohne F7, neues F0 bei ${i}`);
      start = i;
    } else if (b === 0xf7) {
      if (start < 0) fehler.push(`F7 ohne F0 bei Byte ${i}`);
      else { frames.push(bytes.subarray(start, i + 1)); start = -1; }
    } else if (start < 0) {
      fehler.push(`Byte 0x${b.toString(16).padStart(2, "0")} außerhalb eines Frames bei ${i}`);
    } else if (b >= 0x80) {
      fehler.push(`Datenbyte 0x${b.toString(16)} ≥ 0x80 in Frame ab ${start} (Position ${i})`);
    }
  }
  if (start >= 0) fehler.push(`Letzter Frame ab Byte ${start} ohne F7`);
  return { frames, fehler, bytesGesamt: bytes.length };
}

export interface SyxBeschreibung {
  anzahl: number;
  bytes: Uint8Array | number;
  otp: number;
  korg: number;
  andere: number;
  /** OTP-Kommandos „cmd/sub" → Anzahl. */
  otpKommandos: Record<string, number>;
  groessterFrame: number;
}

export function beschreibeSyx(frames: Uint8Array[]): SyxBeschreibung {
  let otp = 0, korg = 0, andere = 0, groesster = 0, bytes = 0;
  const otpKommandos: Record<string, number> = {};
  for (const f of frames) {
    bytes += f.length;
    groesster = Math.max(groesster, f.length);
    if (f[1] === 0x7d) {
      otp++;
      if (f.length >= 6) {
        const k = `${f[4].toString(16).padStart(2, "0")}/${f[5].toString(16).padStart(2, "0")}`;
        otpKommandos[k] = (otpKommandos[k] ?? 0) + 1;
      }
    } else if (f[1] === 0x42) korg++;
    else andere++;
  }
  return { anzahl: frames.length, bytes, otp, korg, andere, otpKommandos, groessterFrame: groesster };
}

export interface SyxSendeIO {
  sende(frame: Uint8Array): Promise<void>;
  sendeUndEmpfange(frame: Uint8Array, akzeptiere: (b: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array>;
  warte(ms: number): Promise<void>;
}

export interface SyxSendeOpts {
  /** Pause zwischen zwei Frames (Standard 20 ms). */
  pauseMs?: number;
  /** > 0: nach jedem Frame so lange auf eine Antwort warten; Timeout zählt als „keine Antwort", bricht nicht ab. */
  antwortTimeoutMs?: number;
  /** Antworten, die als Fehler gelten und den Versand stoppen (z. B. OTP-NACK). */
  istFehlerAntwort?: (b: Uint8Array) => boolean;
  fortschritt?: (gesendet: number, gesamt: number) => void;
  abbruch?: () => boolean;
}

export interface SyxSendeErgebnis {
  ok: boolean;
  gesendet: number;
  gesamt: number;
  antworten: number;
  ohneAntwort: number;
  nachricht: string;
  fehlerAntwort?: Uint8Array;
}

export async function sendeSyxFrames(frames: Uint8Array[], io: SyxSendeIO, opts: SyxSendeOpts = {}): Promise<SyxSendeErgebnis> {
  const pause = opts.pauseMs ?? 20;
  const warteAntwort = opts.antwortTimeoutMs ?? 0;
  let antworten = 0, ohneAntwort = 0;
  for (let i = 0; i < frames.length; i++) {
    if (opts.abbruch?.()) {
      return { ok: false, gesendet: i, gesamt: frames.length, antworten, ohneAntwort, nachricht: `Abgebrochen nach ${i}/${frames.length} Frames.` };
    }
    if (warteAntwort > 0) {
      try {
        const a = await io.sendeUndEmpfange(frames[i], () => true, warteAntwort);
        antworten++;
        if (opts.istFehlerAntwort?.(a)) {
          return { ok: false, gesendet: i + 1, gesamt: frames.length, antworten, ohneAntwort, fehlerAntwort: a,
            nachricht: `Gerät meldet einen Fehler auf Frame ${i + 1}/${frames.length} — Versand gestoppt.` };
        }
      } catch {
        ohneAntwort++;
      }
    } else {
      await io.sende(frames[i]);
    }
    opts.fortschritt?.(i + 1, frames.length);
    if (pause > 0 && i + 1 < frames.length) await io.warte(pause);
  }
  return { ok: true, gesendet: frames.length, gesamt: frames.length, antworten, ohneAntwort,
    nachricht: `${frames.length} Frames gesendet` + (warteAntwort > 0 ? `, ${antworten} quittiert, ${ohneAntwort} ohne Antwort.` : ".") };
}
