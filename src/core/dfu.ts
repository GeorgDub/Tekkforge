/**
 * dfu — USB-DFU-1.1-Download zum Freetribe-Bootloader (USB e2fb:1802), transportunabhängig.
 *
 * Der Bootloader (vanasoft23/freetribe `bootloader-mess`, `usb/devices/tud_dfu.c`) bietet fünf
 * DFU-Alternate-Settings; für uns zählt **Alt 3 „DFU Debug Firmware"**: jeder Download-Block wird
 * fortlaufend nach DDR 0xC0000000 kopiert, beim Manifest klassifiziert der Bootloader das Image
 * (KORG SYSTEM.VSB mit 0x100-Kopf und 2 MiB Nutzlast, oder rohes 2-MiB-Image), schiebt die Nutzlast
 * an den Anfang und springt hinein — **flüchtig, ohne Flash**. Aus/Einschalten stellt alles zurück.
 * Alt 0 „Flash Bootloader" schreibt den Boot-Sektor (Ein-Schuss) und wird hier bewusst NICHT
 * angeboten; Alt 1/2/4 sind im Bootloader „not implemented".
 *
 * DFU-Ablauf (USB-DFU 1.1 §6.1): je Block `DFU_DNLOAD(wValue = Blocknummer, Daten)`, dann
 * `DFU_GETSTATUS` pollen, bis der Zustand `dfuDNLOAD-IDLE` ist (dazwischen `dfuDNBUSY` mit
 * bwPollTimeout); zum Schluss ein `DFU_DNLOAD` mit 0 Bytes → `dfuMANIFEST-SYNC` → `GETSTATUS` →
 * `dfuMANIFEST`; darin ruft TinyUSB den Manifest-Callback, und der Bootloader springt weg. Die
 * USB-Verbindung endet dann — das ist der Erfolgsfall, kein Fehler.
 *
 * Blockgröße: der Bootloader meldet 4096 B (BOOT_DFU_FS/HS_XFER_BUFSIZE), TinyUSB puffert 16 KiB.
 */

export const BOOTLOADER_USB = { vendorId: 0xe2fb, productId: 0x1802 } as const;

/** DFU-Klassen-Requests (bRequest). */
export const DFU_REQ = { detach: 0, dnload: 1, upload: 2, getStatus: 3, clrStatus: 4, getState: 5, abort: 6 } as const;

/** DFU-Zustände (bState). */
export const DFU_STATE = {
  appIdle: 0, appDetach: 1, dfuIdle: 2, dnloadSync: 3, dnBusy: 4, dnloadIdle: 5,
  manifestSync: 6, manifest: 7, manifestWaitReset: 8, uploadIdle: 9, error: 10,
} as const;

export const DFU_STATE_NAME: Record<number, string> = {
  0: "appIDLE", 1: "appDETACH", 2: "dfuIDLE", 3: "dfuDNLOAD-SYNC", 4: "dfuDNBUSY", 5: "dfuDNLOAD-IDLE",
  6: "dfuMANIFEST-SYNC", 7: "dfuMANIFEST", 8: "dfuMANIFEST-WAIT-RESET", 9: "dfuUPLOAD-IDLE", 10: "dfuERROR",
};

export const DFU_STATUS_NAME: Record<number, string> = {
  0: "OK", 1: "errTARGET", 2: "errFILE (Bootloader: Image nicht klassifizierbar)", 3: "errWRITE", 4: "errERASE",
  5: "errCHECK_ERASED", 6: "errPROG", 7: "errVERIFY", 8: "errADDRESS", 9: "errNOTDONE", 10: "errFIRMWARE",
  11: "errVENDOR", 12: "errUSBR", 13: "errPOR", 14: "errUNKNOWN", 15: "errSTALLEDPKT",
};

/** Alternate-Settings des Bootloaders (Reihenfolge der String-Deskriptoren 5..9). */
export const DFU_ALT = { flashBootloader: 0, flashFirmware: 1, debugBootloader: 2, debugFirmware: 3, reflash: 4 } as const;
export const DFU_ALT_NAME_DEBUG_FIRMWARE = "DFU Debug Firmware";

export const DFU_XFER = 4096;
/** FIRMWARE_RESERVED_SIZE im Bootloader-Linker-Script: Obergrenze für Alt 3. */
export const DFU_FIRMWARE_MAX = 16 * 1024 * 1024;
const VSB_KOPF = 0x100;
const FIRMWARE_NUTZLAST = 0x200000;

export interface DfuStatus {
  status: number;
  pollTimeoutMs: number;
  state: number;
}

/** GETSTATUS-Antwort (6 Bytes): bStatus, bwPollTimeout (3 B LE), bState, iString. */
export function parseDfuStatus(b: Uint8Array | number[] | null | undefined): DfuStatus | null {
  if (!b || b.length < 6) return null;
  return { status: b[0], pollTimeoutMs: b[1] | (b[2] << 8) | (b[3] << 16), state: b[4] };
}

export type DfuImagePruefung =
  | { ok: true; art: "SYSTEM.VSB" | "roh"; nutzlast: number }
  | { ok: false; grund: string };

/**
 * Nimmt der Bootloader (boot_image_classify_memory) dieses Image für Alt 3 an?
 * KORG-VSB: genau 0x100 + 2 MiB; roh: genau 2 MiB. Alles andere lehnt er beim Manifest mit errFILE ab.
 */
export function pruefeDfuImage(bytes: Uint8Array): DfuImagePruefung {
  if (bytes.length === 0) return { ok: false, grund: "leere Datei" };
  if (bytes.length > DFU_FIRMWARE_MAX) return { ok: false, grund: `größer als die 16-MiB-DDR-Reserve (${bytes.length} B)` };
  const kopf = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  if (kopf === "KORG SYSTEM FILE") {
    const name = new TextDecoder("latin1").decode(bytes.subarray(0x20, 0x26)).replace(/\0.*$/, "");
    if (!name.startsWith("SYSTEM")) return { ok: false, grund: `KORG-Datei „${name}“ — per DFU startbar ist nur SYSTEM (Firmware)` };
    if (bytes.length !== VSB_KOPF + FIRMWARE_NUTZLAST) {
      return { ok: false, grund: `SYSTEM.VSB muss ${VSB_KOPF + FIRMWARE_NUTZLAST} B lang sein, ist ${bytes.length} B` };
    }
    return { ok: true, art: "SYSTEM.VSB", nutzlast: FIRMWARE_NUTZLAST };
  }
  if (bytes[0] === 0x54 && bytes[1] === 0x49 && bytes[2] === 0x50 && bytes[3] === 0x41) {
    return { ok: false, grund: "Boot-Sektor (AIS „TIPA“) — das ist kein Firmware-Image; für den Bootloader selbst den SysEx-Start nehmen" };
  }
  if (bytes.length === FIRMWARE_NUTZLAST) return { ok: true, art: "roh", nutzlast: FIRMWARE_NUTZLAST };
  return { ok: false, grund: `weder SYSTEM.VSB (${VSB_KOPF + FIRMWARE_NUTZLAST} B) noch rohes 2-MiB-Image (${bytes.length} B)` };
}

/** Image in DFU-Blöcke (Standard 4096 B); der letzte ist kürzer, NICHT aufgefüllt. */
export function inDfuBloecke(image: Uint8Array, xfer = DFU_XFER): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let off = 0; off < image.length; off += xfer) out.push(image.subarray(off, Math.min(off + xfer, image.length)));
  return out;
}

/** USB-Transport; die GUI reicht WebUSB herein, Tests einen Fake. */
export interface DfuTransport {
  /** DFU_DNLOAD mit Blocknummer; `daten` leer = Abschluss (Manifest). */
  dnload(blockNum: number, daten: Uint8Array): Promise<void>;
  /** DFU_GETSTATUS → 6 Bytes. Darf werfen, wenn das Gerät verschwindet (nach dem Sprung erwartet). */
  getStatus(): Promise<Uint8Array>;
  warte(ms: number): Promise<void>;
}

export interface DfuErgebnis {
  ok: boolean;
  bloecke: number;
  bloeckeGesamt: number;
  nachricht: string;
}

export interface DfuOpts {
  xfer?: number;
  /** Höchstzahl GETSTATUS-Runden je Block, bevor abgebrochen wird (Standard 200). */
  maxPoll?: number;
  fortschritt?: (bloecke: number, gesamt: number) => void;
}

function statusFehler(st: DfuStatus | null, wo: string): string | null {
  if (!st) return `${wo}: GETSTATUS-Antwort unlesbar`;
  if (st.state === DFU_STATE.error || st.status !== 0) {
    return `${wo}: DFU-Fehler ${DFU_STATUS_NAME[st.status] ?? st.status} im Zustand ${DFU_STATE_NAME[st.state] ?? st.state}`;
  }
  return null;
}

/**
 * Firmware über DFU Alt 3 hochladen und starten. Der Aufrufer hat Alt 3 bereits gewählt.
 * Nach dem Abschluss-Block springt der Bootloader in die Firmware; ein dabei abreißender USB-Zugriff
 * gilt als Erfolg. Ein DFU-Fehlerstatus (z. B. errFILE = Image nicht erkannt) bricht ab.
 */
export async function dfuFirmwareStarten(image: Uint8Array, t: DfuTransport, opts: DfuOpts = {}): Promise<DfuErgebnis> {
  const pruef = pruefeDfuImage(image);
  const bloecke = inDfuBloecke(image, opts.xfer ?? DFU_XFER);
  const gesamt = bloecke.length;
  if (!pruef.ok) return { ok: false, bloecke: 0, bloeckeGesamt: gesamt, nachricht: `Image abgelehnt: ${pruef.grund}` };
  const maxPoll = opts.maxPoll ?? 200;

  for (let i = 0; i < gesamt; i++) {
    await t.dnload(i, bloecke[i]);
    let fertig = false;
    for (let p = 0; p < maxPoll && !fertig; p++) {
      const st = parseDfuStatus(await t.getStatus());
      const f = statusFehler(st, `Block ${i + 1}/${gesamt}`);
      if (f) return { ok: false, bloecke: i, bloeckeGesamt: gesamt, nachricht: f };
      if (st!.state === DFU_STATE.dnloadIdle) fertig = true;
      else if (st!.state === DFU_STATE.dnBusy || st!.state === DFU_STATE.dnloadSync) await t.warte(Math.max(1, st!.pollTimeoutMs));
      else return { ok: false, bloecke: i, bloeckeGesamt: gesamt, nachricht: `Block ${i + 1}: unerwarteter Zustand ${DFU_STATE_NAME[st!.state] ?? st!.state}` };
    }
    if (!fertig) return { ok: false, bloecke: i, bloeckeGesamt: gesamt, nachricht: `Block ${i + 1}: Gerät wird nicht fertig (dfuDNBUSY bleibt)` };
    opts.fortschritt?.(i + 1, gesamt);
  }

  // Abschluss: leerer Download → Manifest. Darin springt der Bootloader weg.
  try {
    await t.dnload(gesamt, new Uint8Array(0));
    for (let p = 0; p < maxPoll; p++) {
      const st = parseDfuStatus(await t.getStatus());
      const f = statusFehler(st, "Manifest");
      if (f) return { ok: false, bloecke: gesamt, bloeckeGesamt: gesamt, nachricht: f };
      if (st!.state === DFU_STATE.manifestSync || st!.state === DFU_STATE.manifest) { await t.warte(Math.max(1, st!.pollTimeoutMs)); continue; }
      break; // dfuIDLE / MANIFEST-WAIT-RESET: Gerät hat übernommen
    }
  } catch (e) {
    return { ok: true, bloecke: gesamt, bloeckeGesamt: gesamt, nachricht: `Firmware übergeben (${gesamt} Blöcke); die USB-Verbindung endete beim Sprung wie erwartet (${e instanceof Error ? e.message : String(e)}).` };
  }
  return { ok: true, bloecke: gesamt, bloeckeGesamt: gesamt, nachricht: `Firmware übergeben (${gesamt} Blöcke, ${pruef.art}). Das Gerät startet sie jetzt flüchtig; Aus/Ein stellt den Flash-Stand wieder her.` };
}
