/**
 * hacktribeFlash — Hacktribes Flash-LESE-Kommando (SysEx 0x55), sonst nichts.
 *
 * `hacktribeRam.ts` schließt Flash und Execute bewusst aus, weil ein Flash-WRITE (0x56) den
 * Power-Cycle überlebt. Lesen ist harmlos — und nützlich: der erste 128-KiB-Block (AIS +
 * Werks-SBL), der Gerätestempel in der User-Region und die Versionsrecords liegen nur im
 * Flash, nicht im RAM. Deshalb hier ein eigenes, kleines Modul mit genau einem Kommando und
 * ohne jeden Schreibpfad.
 *
 * Protokoll (hacktribe `e2sysex.py` `read_flash`, Omnitribe `electribe2_native_sysex.md` §5):
 *   TX: F0 42 3g 00 01 24 55 <syxEnc(addr_le32 ‖ len_le32)> F7
 *   RX: F0 42 3g 00 01 24 54 55 00 <syxEnc(data)> F7     (Kommando-Echo an Index 7, Daten ab 9 —
 *       so wie bei 0x52/0x54 am Gerät aufgezeichnet; die Annahme für 0x55 wurde am 2026-09-16
 *       am Gerät geprüft, siehe README „Erprobungsstand“)
 */
import { buildFrame, syxDec, syxEnc, isKorgSysex, type E2SysexOptions } from "./e2sysex";
import { encodeAddrLen } from "./hacktribeRam";

export const FLASH_CMD_READ = 0x55;
/** 16 MiB serieller Flash (AM1802 SPI1). */
export const FLASH_GROESSE = 0x1000000;
export const FLASH_READ_CHUNK = 0x100;

export type FlashRangeCheck = { ok: true } | { ok: false; reason: string };

export function validateFlashRange(addr: number, len: number): FlashRangeCheck {
  if (!Number.isInteger(addr) || addr < 0) return { ok: false, reason: "Flash-Adresse muss eine nichtnegative ganze Zahl sein" };
  if (!Number.isInteger(len) || len <= 0) return { ok: false, reason: "Länge muss positiv sein" };
  if (addr + len > FLASH_GROESSE) return { ok: false, reason: `Bereich 0x${addr.toString(16)}+${len} liegt über dem 16-MiB-Flash` };
  return { ok: true };
}

export function buildFlashReadRequest(addr: number, len: number, opts?: E2SysexOptions): Uint8Array {
  return buildFrame(FLASH_CMD_READ, syxEnc(encodeAddrLen(addr, len)), opts);
}

/** Antwort auf 0x55: Echo des Kommandos an Index 7, Nutzdaten ab Index 9. Sonst null. */
export function parseFlashResponse(frame: Uint8Array | number[]): Uint8Array | null {
  const b = frame instanceof Uint8Array ? frame : Uint8Array.from(frame);
  if (!isKorgSysex(b) || b.length < 10) return null;
  if (b[7] !== FLASH_CMD_READ) return null;
  const end = b[b.length - 1] === 0xf7 ? b.length - 1 : b.length;
  return syxDec(b.subarray(9, end));
}

export function splitFlashRead(addr: number, len: number, chunkSize = FLASH_READ_CHUNK): { addr: number; len: number }[] {
  const size = chunkSize > 0 ? chunkSize : FLASH_READ_CHUNK;
  const out: { addr: number; len: number }[] = [];
  for (let off = 0; off < len; off += size) out.push({ addr: addr + off, len: Math.min(size, len - off) });
  return out;
}
