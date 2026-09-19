/** tests/dfu.test.ts — DFU-1.1-Download zum Freetribe-Bootloader (Alt 3): Blöcke, Status, Ablauf, Abbruch. */
import { describe, it, expect } from "vitest";
import { parseDfuStatus, pruefeDfuImage, inDfuBloecke, dfuFirmwareStarten, DFU_STATE, DFU_XFER, type DfuTransport } from "../src/core/dfu";

const vsb = (name = "SYSTEM", laenge = 0x100 + 0x200000): Uint8Array => {
  const b = new Uint8Array(laenge);
  b.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  b.set(new TextEncoder().encode(name), 0x20);
  return b;
};

describe("parseDfuStatus", () => {
  it("liest Status, 24-Bit-PollTimeout (LE) und Zustand", () => {
    const st = parseDfuStatus(Uint8Array.from([0x00, 0x10, 0x02, 0x00, 0x04, 0x00]));
    expect(st).toEqual({ status: 0, pollTimeoutMs: 0x0210, state: 4 });
    expect(parseDfuStatus(Uint8Array.from([0, 0, 0]))).toBeNull();
  });
});

describe("pruefeDfuImage", () => {
  it("nimmt SYSTEM.VSB (0x100 + 2 MiB) und rohe 2 MiB an", () => {
    expect(pruefeDfuImage(vsb())).toEqual({ ok: true, art: "SYSTEM.VSB", nutzlast: 0x200000 });
    expect(pruefeDfuImage(new Uint8Array(0x200000))).toEqual({ ok: true, art: "roh", nutzlast: 0x200000 });
  });
  it("lehnt PCM.VSB, Boot-Sektor, falsche Längen und Leeres ab", () => {
    expect(pruefeDfuImage(vsb("PCM", 0x100 + 0x800000)).ok).toBe(false);
    expect(pruefeDfuImage(vsb("SYSTEM", 0x100 + 0x200000 - 1)).ok).toBe(false);
    expect(pruefeDfuImage(Uint8Array.from([0x54, 0x49, 0x50, 0x41, 0, 0, 0, 0])).ok).toBe(false); // TIPA
    expect(pruefeDfuImage(new Uint8Array(0)).ok).toBe(false);
    expect(pruefeDfuImage(new Uint8Array(1234)).ok).toBe(false);
  });
});

describe("inDfuBloecke", () => {
  it("zerlegt in 4096er Blöcke, letzter kürzer und nicht aufgefüllt", () => {
    const b = inDfuBloecke(new Uint8Array(DFU_XFER * 2 + 100));
    expect(b.length).toBe(3);
    expect(b[0].length).toBe(DFU_XFER);
    expect(b[2].length).toBe(100);
    // 2 MiB + 0x100 → 513 Blöcke (512 volle + 256 B)
    expect(inDfuBloecke(vsb()).length).toBe(513);
  });
});

/** Fake-Transport: DNBUSY einmal, dann DNLOAD-IDLE; Manifest → MANIFEST einmal, dann (optional) Verbindung weg. */
function fakeTransport(opts: { fehlerBeiBlock?: number; manifestWirft?: boolean; busyRunden?: number } = {}) {
  const dnloads: { block: number; len: number }[] = [];
  const warteZeiten: number[] = [];
  let letzterBlock = -1;
  let letzteLen = 0;
  let busy = 0;
  let manifestRunden = 0;
  const t: DfuTransport = {
    async dnload(block, daten) { dnloads.push({ block, len: daten.length }); letzterBlock = block; letzteLen = daten.length; busy = opts.busyRunden ?? 1; },
    async getStatus() {
      if (letzteLen === 0 && letzterBlock >= 0) {
        // Abschluss-Download
        manifestRunden++;
        if (manifestRunden === 1) return Uint8Array.from([0, 5, 0, 0, DFU_STATE.manifest, 0]);
        if (opts.manifestWirft) throw new Error("device disconnected");
        return Uint8Array.from([0, 0, 0, 0, DFU_STATE.dfuIdle, 0]);
      }
      if (opts.fehlerBeiBlock !== undefined && letzterBlock === opts.fehlerBeiBlock) {
        return Uint8Array.from([2, 0, 0, 0, DFU_STATE.error, 0]); // errFILE
      }
      if (busy > 0) { busy--; return Uint8Array.from([0, 3, 0, 0, DFU_STATE.dnBusy, 0]); }
      return Uint8Array.from([0, 0, 0, 0, DFU_STATE.dnloadIdle, 0]);
    },
    async warte(ms) { warteZeiten.push(ms); },
  };
  return { t, dnloads, warteZeiten };
}

describe("dfuFirmwareStarten", () => {
  it("lädt alle Blöcke fortlaufend nummeriert, schließt mit leerem Download ab und wartet die PollTimeouts", async () => {
    const image = new Uint8Array(0x200000); // rohes Image → 512 Blöcke
    const { t, dnloads, warteZeiten } = fakeTransport();
    const r = await dfuFirmwareStarten(image, t);
    expect(r.ok).toBe(true);
    expect(r.bloecke).toBe(512);
    expect(dnloads.length).toBe(513);
    expect(dnloads[0]).toEqual({ block: 0, len: DFU_XFER });
    expect(dnloads[511]).toEqual({ block: 511, len: DFU_XFER });
    expect(dnloads[512]).toEqual({ block: 512, len: 0 });
    expect(warteZeiten.filter((w) => w === 3).length).toBe(512); // je Block ein DNBUSY mit 3 ms
    expect(warteZeiten).toContain(5); // Manifest-PollTimeout
  });

  it("gilt als Erfolg, wenn die USB-Verbindung beim Manifest abreißt (Gerät ist gesprungen)", async () => {
    const { t } = fakeTransport({ manifestWirft: true });
    const r = await dfuFirmwareStarten(new Uint8Array(0x200000), t);
    expect(r.ok).toBe(true);
    expect(r.nachricht).toMatch(/USB-Verbindung endete/);
  });

  it("bricht bei einem DFU-Fehlerstatus ab und nennt Block und Fehler", async () => {
    const { t, dnloads } = fakeTransport({ fehlerBeiBlock: 2 });
    const r = await dfuFirmwareStarten(new Uint8Array(0x200000), t);
    expect(r.ok).toBe(false);
    expect(r.bloecke).toBe(2);
    expect(r.nachricht).toMatch(/Block 3\/512.*errFILE/);
    expect(dnloads.length).toBe(3); // kein weiterer Block, kein Abschluss
  });

  it("weist ein ungültiges Image ab, ohne etwas zu senden", async () => {
    const { t, dnloads } = fakeTransport();
    const r = await dfuFirmwareStarten(new Uint8Array(1000), t);
    expect(r.ok).toBe(false);
    expect(dnloads.length).toBe(0);
  });

  it("gibt auf, wenn das Gerät nie aus dfuDNBUSY herauskommt", async () => {
    const { t } = fakeTransport({ busyRunden: 10_000 });
    const r = await dfuFirmwareStarten(new Uint8Array(0x200000), t, { maxPoll: 5 });
    expect(r.ok).toBe(false);
    expect(r.nachricht).toMatch(/nicht fertig/);
  });
});
