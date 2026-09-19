/**
 * dfuUsb — WebUSB-Transport zum Freetribe-Bootloader (e2fb:1802) für den flüchtigen DFU-Start.
 *
 * Läuft im Renderer über `navigator.usb`; der Hauptprozess (electron/main.cjs) lässt per
 * `select-usb-device` nur den Bootloader zu. Windows-Hinweis: WebUSB braucht den WinUSB-Treiber
 * auf dem DFU-Interface. Hängt an dem Interface kein oder ein anderer Treiber, schlägt `open()`/
 * `claimInterface()` fehl — dann einmalig mit Zadig „WinUSB" auf „DFU Debug Firmware" (Interface
 * der Klasse 0xFE) binden. Die MSC-/CDC-Interfaces des Bootloaders bleiben davon unberührt.
 *
 * Die WebUSB-Typen sind hier minimal nachgebildet, damit kein @types-Paket nötig ist.
 */
import { BOOTLOADER_USB, DFU_ALT, DFU_ALT_NAME_DEBUG_FIRMWARE, DFU_REQ, type DfuTransport } from "../core/dfu";

interface UsbAlternate { alternateSetting: number; interfaceClass: number; interfaceSubclass: number; interfaceName?: string }
interface UsbInterface { interfaceNumber: number; alternates: UsbAlternate[]; claimed?: boolean }
interface UsbConfiguration { configurationValue: number; interfaces: UsbInterface[] }
interface UsbInResult { data?: DataView; status: string }
export interface UsbGeraet {
  productName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(v: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  selectAlternateInterface(n: number, alt: number): Promise<void>;
  controlTransferOut(setup: Record<string, unknown>, data?: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
  controlTransferIn(setup: Record<string, unknown>, length: number): Promise<UsbInResult>;
}
interface UsbApi { requestDevice(o: { filters: { vendorId: number; productId?: number }[] }): Promise<UsbGeraet>; getDevices(): Promise<UsbGeraet[]> }

function usbApi(): UsbApi | null {
  const n = (globalThis as unknown as { navigator?: { usb?: UsbApi } }).navigator;
  return n?.usb ?? null;
}

export interface BootloaderUsb {
  geraet: UsbGeraet;
  interfaceNr: number;
  alt: number;
  altName: string;
}

/** Bootloader wählen (Systemdialog, vorgefiltert), öffnen, DFU-Interface belegen, Alt „Debug Firmware" setzen. */
export async function verbindeBootloaderUsb(): Promise<BootloaderUsb> {
  const usb = usbApi();
  if (!usb) throw new Error("WebUSB steht hier nicht zur Verfügung (Desktop-App nötig).");
  const geraet = await usb.requestDevice({ filters: [{ vendorId: BOOTLOADER_USB.vendorId, productId: BOOTLOADER_USB.productId }] });
  await geraet.open();
  if (!geraet.configuration) await geraet.selectConfiguration(geraet.configurations[0]?.configurationValue ?? 1);
  const cfg = geraet.configuration;
  if (!cfg) throw new Error("USB-Konfiguration nicht wählbar.");
  const dfuItf = cfg.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 0xfe && a.interfaceSubclass === 0x01));
  if (!dfuItf) throw new Error("Kein DFU-Interface (Klasse 0xFE/1) am Gerät — ist das der Freetribe-Bootloader?");
  const altEintrag = dfuItf.alternates.find((a) => (a.interfaceName ?? "").includes(DFU_ALT_NAME_DEBUG_FIRMWARE))
    ?? dfuItf.alternates.find((a) => a.alternateSetting === DFU_ALT.debugFirmware);
  if (!altEintrag) throw new Error("Alt-Setting „DFU Debug Firmware“ fehlt am DFU-Interface.");
  try {
    await geraet.claimInterface(dfuItf.interfaceNumber);
  } catch (e) {
    throw new Error(`DFU-Interface nicht belegbar (${e instanceof Error ? e.message : String(e)}). Unter Windows: WinUSB-Treiber per Zadig auf das DFU-Interface binden.`);
  }
  await geraet.selectAlternateInterface(dfuItf.interfaceNumber, altEintrag.alternateSetting);
  return { geraet, interfaceNr: dfuItf.interfaceNumber, alt: altEintrag.alternateSetting, altName: altEintrag.interfaceName ?? `Alt ${altEintrag.alternateSetting}` };
}

/** DfuTransport über WebUSB-Control-Transfers (Klasse, Empfänger Interface). */
export function dfuTransportUsb(v: BootloaderUsb): DfuTransport {
  const setup = (request: number, value: number) => ({ requestType: "class", recipient: "interface", request, value, index: v.interfaceNr });
  return {
    async dnload(blockNum, daten) {
      const r = await v.geraet.controlTransferOut(setup(DFU_REQ.dnload, blockNum), daten.length ? daten : undefined);
      if (r.status !== "ok") throw new Error(`DNLOAD Block ${blockNum}: ${r.status}`);
    },
    async getStatus() {
      const r = await v.geraet.controlTransferIn(setup(DFU_REQ.getStatus, 0), 6);
      if (r.status !== "ok" || !r.data) throw new Error(`GETSTATUS: ${r.status}`);
      return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    },
    warte: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export async function trenneBootloaderUsb(v: BootloaderUsb): Promise<void> {
  try { await v.geraet.releaseInterface(v.interfaceNr); } catch { /* Gerät ist oft schon weg */ }
  try { await v.geraet.close(); } catch { /* dito */ }
}
