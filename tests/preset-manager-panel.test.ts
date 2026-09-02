import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { initPresetManager, pmAktion, pmZustand } from "../src/gui/presetManager";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { baueSicherung, type SicherungsBlock } from "../src/core/geraetSicherung";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import { nameVon, istLeer, leererBlock } from "../src/core/presetManager";
import { VSB_GROESSE } from "../src/core/firmwareBau";

/**
 * Der Preset-Manager ueber den DOM-Stub: laden aus einer Sicherung, umbauen,
 * und dann fluechtig schreiben — nur die Unterschiede, danach die Zaehler.
 * Derselbe Stub wie in fx-preset-panel.test.ts.
 */

type Listener = () => void;

class StubElement {
  value = "";
  checked = false;
  textContent = "";
  innerHTML = "";
  files: unknown[] = [];
  dataset: Record<string, string> = {};
  href = "";
  download = "";
  readonly classList = {
    klassen: new Set<string>(),
    add: (k: string) => void this.classList.klassen.add(k),
    remove: (k: string) => void this.classList.klassen.delete(k),
    toggle: (k: string, an?: boolean) => {
      const soll = an ?? !this.classList.klassen.has(k);
      if (soll) this.classList.klassen.add(k);
      else this.classList.klassen.delete(k);
      return soll;
    },
    contains: (k: string) => this.classList.klassen.has(k),
  };
  private listeners = new Map<string, Listener[]>();
  addEventListener(typ: string, fn: Listener): void {
    const l = this.listeners.get(typ) ?? [];
    l.push(fn);
    this.listeners.set(typ, l);
  }
  feuere(typ: string): void {
    for (const fn of this.listeners.get(typ) ?? []) fn();
  }
  querySelectorAll(): StubElement[] {
    return [];
  }
  click(): void {
    this.feuere("click");
  }
}

const elemente = new Map<string, StubElement>();
const el = (id: string): StubElement => {
  let e = elemente.get(id);
  if (!e) {
    e = new StubElement();
    elemente.set(id, e);
  }
  return e;
};
const g = globalThis as unknown as { document?: unknown; URL: { createObjectURL?: unknown; revokeObjectURL?: unknown } };

async function klickUndWarte(id: string): Promise<void> {
  el(id).feuere("click");
  await new Promise((r) => setTimeout(r, 0));
}

function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}

const fakeDatei = (name: string, bytes: Uint8Array): File =>
  ({ name, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) }) as unknown as File;
const fakeTextDatei = (name: string, text: string): File => ({ name, text: async () => text }) as unknown as File;

const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;
const ifxAdresse = (slot: number): number => addressForSlot(ifxMap, slot);

/** Eine Sicherung wie vom Testgeraet: 49 IFX benannt, 32 MFX, Max-Index 48. */
function sicherungText(): string {
  const ifx = new Uint8Array(100 * FX_PRESET_SIZE);
  for (let i = 0; i < 100; i++) ifx.set(i < 49 ? presetBytes(`Werk ${i + 1}`) : leererBlock("ifx"), i * FX_PRESET_SIZE);
  const mfx = new Uint8Array(32 * FX_PRESET_SIZE);
  for (let i = 0; i < 32; i++) mfx.set(presetBytes(`Master ${i + 1}`, true), i * FX_PRESET_SIZE);
  const bloecke: SicherungsBlock[] = [
    { key: "ifxPreset", label: "IFX", adresse: ifxMap.base, laenge: ifx.length, bytes: ifx },
    { key: "mfxPreset", label: "MFX", adresse: mfxMap.base, laenge: mfx.length, bytes: mfx },
    { key: "maxIfxIndex", label: "Max", adresse: 0xc0048f80, laenge: 1, bytes: new Uint8Array([48]) },
  ];
  return baueSicherung(bloecke, { geraet: "E2S", firmware: "hacktribe" });
}

async function sicherungLaden(): Promise<void> {
  el("pmSicherungIn").files = [fakeTextDatei("geraet.tfbak", sicherungText())];
  el("pmSicherungIn").feuere("change");
  await new Promise((r) => setTimeout(r, 0));
}

let geschrieben: { addr: number; bytes: Uint8Array }[] = [];

/** Ein Geraet mit Max-Index 48; Lesungen liefern, was dieser Lauf schon geschrieben hat. */
function geraetLesung(addr: number, len: number): { ok: true; bytes: Uint8Array } {
  const z = IFX_ZAEHLER.find((x) => x.addr === addr);
  if (z && len === 1) return { ok: true, bytes: new Uint8Array([z.plusEins ? 49 : 48]) };
  const zuletzt = [...geschrieben].reverse().find((g) => g.addr === addr);
  if (zuletzt) return { ok: true, bytes: zuletzt.bytes };
  const slot = (addr - ifxAdresse(0)) / FX_PRESET_SIZE;
  if (Number.isInteger(slot) && slot >= 0 && slot < 100) return { ok: true, bytes: slot < 49 ? presetBytes(`Werk ${slot + 1}`) : leererBlock("ifx") };
  return { ok: true, bytes: presetBytes("GERAETPRESET") };
}

beforeEach(() => {
  elemente.clear();
  geschrieben = [];
  g.document = {
    getElementById: (id: string) => el(id),
    createElement: () => new StubElement(),
  };
  g.URL.createObjectURL = () => "blob:x";
  g.URL.revokeObjectURL = () => undefined;
  const hooks = {
    lesen: async (addr: number, len: number) => geraetLesung(addr, len),
    schreiben: async (addr: number, bytes: Uint8Array) => {
      geschrieben.push({ addr, bytes });
      return true;
    },
  };
  initFxPresetPanel(hooks);
  initPresetManager(hooks);
});

afterEach(() => {
  delete g.document;
});

describe("Preset-Manager: laden und umbauen", () => {
  it("laedt eine Sicherung: 49 IFX, 32 MFX, Zaehler 48", async () => {
    await sicherungLaden();
    const z = pmZustand()!;
    expect(nameVon(z.ifx[0])).toBe("Werk 1");
    expect(nameVon(z.ifx[48])).toBe("Werk 49");
    expect(istLeer(z.ifx[49])).toBe(true);
    expect(nameVon(z.mfx[31])).toBe("Master 32");
    expect(z.ifxMaxIndex).toBe(48);
    expect(el("pmInfo").textContent).toContain("unverändert");
  });

  it("verschieben, tauschen, umbenennen, loeschen wirken auf den Zustand, nicht auf die Basis", async () => {
    await sicherungLaden();
    await pmAktion("ab", "ifx", 1);
    expect(nameVon(pmZustand()!.ifx[1])).toBe("Werk 1");
    await pmAktion("tausch", "mfx", 1, 32);
    expect(nameVon(pmZustand()!.mfx[0])).toBe("Master 32");
    await pmAktion("name", "ifx", 5, "Mein Preset");
    expect(nameVon(pmZustand()!.ifx[4])).toBe("Mein Preset");
    await pmAktion("weg", "ifx", 49);
    expect(istLeer(pmZustand()!.ifx[48])).toBe(true);
    expect(el("pmInfo").textContent).toMatch(/geändert/);
    await klickUndWarte("pmVerwerfen");
    expect(nameVon(pmZustand()!.ifx[0])).toBe("Werk 1");
    expect(el("pmInfo").textContent).toContain("unverändert");
  });

  it("eine Datei landet auf dem ersten leeren Platz ihrer Art", async () => {
    await sicherungLaden();
    el("pmDateiIn").files = [fakeDatei("ring-lfo.e2fxp", presetBytes("Ring LFO"))];
    el("pmDateiIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    expect(nameVon(pmZustand()!.ifx[49])).toBe("Ring LFO");
    expect(el("pmStatus").textContent).toContain("Platz 50");
  });
});

describe("Preset-Manager: schreiben", () => {
  it("fluechtig: nur die Unterschiede, dann die 13 Zaehler bis zum hoechsten belegten Platz", async () => {
    await sicherungLaden();
    el("pmDateiIn").files = [fakeDatei("ring-lfo.e2fxp", presetBytes("Ring LFO"))];
    el("pmDateiIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    await pmAktion("name", "ifx", 3, "Umbenannt");
    await klickUndWarte("pmSchreiben");
    const presets = geschrieben.filter((w) => w.bytes.length === FX_PRESET_SIZE);
    const zaehler = geschrieben.filter((w) => w.bytes.length === 1);
    expect(presets.map((w) => w.addr)).toEqual([ifxAdresse(2), ifxAdresse(49)]);
    expect(decodeFxPreset(presets[0].bytes).name).toBe("Umbenannt");
    expect(zaehler).toHaveLength(13);
    for (const w of zaehler) {
      const z = IFX_ZAEHLER.find((x) => x.addr === w.addr)!;
      expect(w.bytes[0]).toBe(z.plusEins ? 50 : 49);
    }
    // Danach ist der geschriebene Stand die Basis
    expect(el("pmInfo").textContent).toContain("unverändert");
  });

  it("nichts geaendert → nichts geschrieben", async () => {
    await sicherungLaden();
    await klickUndWarte("pmSchreiben");
    expect(geschrieben).toHaveLength(0);
    expect(el("pmStatus").textContent).toMatch(/Nichts geändert/);
  });

  it("loeschen in der Mitte schreibt die aufgerueckten Plaetze und laesst die Zaehler in Ruhe", async () => {
    await sicherungLaden();
    await pmAktion("weg", "ifx", 1);
    await klickUndWarte("pmSchreiben");
    const presets = geschrieben.filter((w) => w.bytes.length === FX_PRESET_SIZE);
    expect(presets).toHaveLength(49);
    expect(presets[0].addr).toBe(ifxAdresse(0));
    expect(decodeFxPreset(presets[0].bytes).name).toBe("Werk 2");
    expect(istLeer(presets[48].bytes)).toBe(true);
    expect(geschrieben.filter((w) => w.bytes.length === 1)).toHaveLength(0);
  });

  it("Firmware patchen lehnt eine fremde Datei am Hash ab", async () => {
    await sicherungLaden();
    await pmAktion("name", "ifx", 1, "Neu");
    const fw = new Uint8Array(VSB_GROESSE);
    fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
    fw.set(new TextEncoder().encode("E2S"), 0x10);
    el("pmBasisIn").files = [fakeDatei("SYSTEM.VSB", fw)];
    el("pmBasisIn").feuere("change");
    await new Promise((r) => setTimeout(r, 50));
    expect(el("pmStatus").textContent).toMatch(/abgelehnt/);
    expect(geschrieben).toHaveLength(0);
  });
});
