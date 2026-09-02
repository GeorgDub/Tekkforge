import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { initPresetManager, pmAktion, pmZustand, bibAufnehmen, pmBibAblegen } from "../src/gui/presetManager";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { baueSicherung, type SicherungsBlock } from "../src/core/geraetSicherung";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import { nameVon, istLeer, leererBlock } from "../src/core/presetManager";
import { VSB_GROESSE, GROOVE_ZAEHLER } from "../src/core/firmwareBau";
import { initGrooveBytes, decodeGroove, encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";

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
  const gv = new Uint8Array(96 * GROOVE_SIZE).fill(0xff);
  for (let i = 0; i < 62; i++) gv.set(grooveBytes(`G${i + 1}`), i * GROOVE_SIZE);
  const bloecke: SicherungsBlock[] = [
    { key: "ifxPreset", label: "IFX", adresse: ifxMap.base, laenge: ifx.length, bytes: ifx },
    { key: "mfxPreset", label: "MFX", adresse: mfxMap.base, laenge: mfx.length, bytes: mfx },
    { key: "maxIfxIndex", label: "Max", adresse: 0xc0048f80, laenge: 1, bytes: new Uint8Array([48]) },
    { key: "groove", label: "Groove", adresse: grooveMap.base, laenge: gv.length, bytes: gv },
    { key: "grooveMaxIndex", label: "GMax", adresse: 0xc007bb88, laenge: 1, bytes: new Uint8Array([62]) },
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
const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;
const grooveAdresse = (slot: number): number => addressForSlot(grooveMap, slot);
function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}
function geraetLesung(addr: number, len: number): { ok: true; bytes: Uint8Array } {
  const z = IFX_ZAEHLER.find((x) => x.addr === addr);
  if (z && len === 1) return { ok: true, bytes: new Uint8Array([z.plusEins ? 49 : 48]) };
  const gz = GROOVE_ZAEHLER.find((x) => x.addr === addr);
  if (gz && len === 1) return { ok: true, bytes: new Uint8Array([gz.plusEins ? 62 : 61]) };
  const gslot = (addr - grooveAdresse(0)) / GROOVE_SIZE;
  if (len === GROOVE_SIZE && Number.isInteger(gslot) && gslot >= 0 && gslot < 96) {
    const zuletztG = [...geschrieben].reverse().find((g) => g.addr === addr);
    if (zuletztG) return { ok: true, bytes: zuletztG.bytes };
    return { ok: true, bytes: gslot < 62 ? grooveBytes(`G${gslot + 1}`) : new Uint8Array(GROOVE_SIZE).fill(0xff) };
  }
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

describe("Preset-Manager: Bibliothek und Ablegen", () => {
  it("ohne geladenen Stand zeigen beide Listen alle Plaetze leer — und schreiben geht nicht", async () => {
    const z = pmZustand()!;
    expect(z.ifx).toHaveLength(96);
    expect(z.mfx).toHaveLength(32);
    expect(z.ifx.every((b) => istLeer(b))).toBe(true);
    expect(el("pmInfo").textContent).toMatch(/nichts geladen/);
    expect(el("pmIfxInfo").textContent).toContain("0 von 96");
    await klickUndWarte("pmSchreiben");
    expect(geschrieben).toHaveLength(0);
    expect(el("pmStatus").textContent).toMatch(/echten Stand/);
  });

  it("leerer Platz: der Bibliotheks-Eintrag kommt ohne Nachfrage hinein", async () => {
    await sicherungLaden();
    bibAufnehmen({ art: "ifx", name: "Ring LFO", bytes: presetBytes("Ring LFO"), woher: "Test" });
    await pmBibAblegen(0, "ifx", 50);
    expect(nameVon(pmZustand()!.ifx[49])).toBe("Ring LFO");
    expect(el("pmStatus").textContent).toContain("auf Platz 50");
  });

  it("belegter Platz: ersetzen, davor oder danach einfuegen", async () => {
    await sicherungLaden();
    bibAufnehmen({ art: "ifx", name: "Neu", bytes: presetBytes("Neu"), woher: "Test" });
    await pmBibAblegen(0, "ifx", 2, "ersetzen");
    expect(nameVon(pmZustand()!.ifx[1])).toBe("Neu");
    expect(nameVon(pmZustand()!.ifx[2])).toBe("Werk 3");
    await klickUndWarte("pmVerwerfen");
    await pmBibAblegen(0, "ifx", 2, "vor");
    expect(nameVon(pmZustand()!.ifx[1])).toBe("Neu");
    expect(nameVon(pmZustand()!.ifx[2])).toBe("Werk 2");
    expect(nameVon(pmZustand()!.ifx[49])).toBe("Werk 49");
    await klickUndWarte("pmVerwerfen");
    await pmBibAblegen(0, "ifx", 2, "nach");
    expect(nameVon(pmZustand()!.ifx[1])).toBe("Werk 2");
    expect(nameVon(pmZustand()!.ifx[2])).toBe("Neu");
    expect(nameVon(pmZustand()!.ifx[3])).toBe("Werk 3");
  });

  it("ein MFX-Eintrag gehoert nicht in die IFX-Liste; eine volle MFX-Bank nimmt kein Einfuegen an", async () => {
    await sicherungLaden();
    bibAufnehmen({ art: "mfx", name: "Wobble", bytes: presetBytes("Wobble", true), woher: "Test" });
    await pmBibAblegen(0, "ifx", 50);
    expect(istLeer(pmZustand()!.ifx[49])).toBe(true);
    expect(el("pmStatus").textContent).toMatch(/MFX-Liste/);
    await pmBibAblegen(0, "mfx", 5, "vor");
    expect(nameVon(pmZustand()!.mfx[4])).toBe("Master 5");
    expect(el("pmStatus").textContent).toMatch(/voll/);
    await pmBibAblegen(0, "mfx", 5, "ersetzen");
    expect(nameVon(pmZustand()!.mfx[4])).toBe("Wobble");
  });

  it("die Bibliothek laedt Sammlungen und Einzeldateien ueber den Datei-Weg", async () => {
    const { baueSammlung } = await import("../src/core/sammlung");
    el("pmBibIn").files = [
      fakeTextDatei("set.tfsam", baueSammlung([{ art: "mfx", name: "Trem Chop", bytes: presetBytes("Trem Chop", true) }], { titel: "Tekk" })),
      fakeDatei("phase-sync.e2fxp", presetBytes("Phase Sync")),
    ];
    el("pmBibIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    expect(el("pmBibInfo").textContent).toContain("2 Eintrag");
    await pmBibAblegen(1, "ifx", 1);
    expect(nameVon(pmZustand()!.ifx[0])).toBe("Phase Sync");
  });
});

describe("Preset-Manager: Groove-Vorlagen", () => {
  it("laedt die Groove-Bank aus der Sicherung: 62 belegt, Zaehler 61", async () => {
    await sicherungLaden();
    const z = pmZustand()!;
    expect(z.groove).toHaveLength(96);
    expect(nameVon(z.groove[0], "groove")).toBe("G1");
    expect(istLeer(z.groove[62], "groove")).toBe(true);
    expect(z.grooveMaxIndex).toBe(61);
    expect(el("pmGrooveInfo").textContent).toContain("62 von 96 belegt, Menü laut Zähler bis 62");
  });

  it("ein Groove aus der Bibliothek auf Platz 63, fluechtig geschrieben: Block plus die 4 Zaehler auf 62/63", async () => {
    await sicherungLaden();
    bibAufnehmen({ art: "groove", name: "Mein Swing", bytes: grooveBytes("Mein Swing"), woher: "Test" });
    await pmBibAblegen(0, "groove", 63);
    expect(nameVon(pmZustand()!.groove[62], "groove")).toBe("Mein Swing");
    await pmBibAblegen(0, "ifx", 50);
    expect(el("pmStatus").textContent).toMatch(/GROOVE-Liste/);
    await klickUndWarte("pmSchreiben");
    const bloecke = geschrieben.filter((w) => w.bytes.length === GROOVE_SIZE);
    expect(bloecke).toHaveLength(1);
    expect(bloecke[0].addr).toBe(grooveAdresse(62));
    expect(decodeGroove(bloecke[0].bytes).name).toBe("Mein Swing");
    const zaehler = geschrieben.filter((w) => w.bytes.length === 1);
    expect(zaehler.map((w) => w.addr)).toEqual(GROOVE_ZAEHLER.map((z) => z.addr));
    for (const w of zaehler) {
      const gz = GROOVE_ZAEHLER.find((x) => x.addr === w.addr)!;
      expect(w.bytes[0]).toBe(gz.plusEins ? 63 : 62);
    }
    expect(el("pmStatus").textContent).toMatch(/Groove-Menü erweitert: bis Platz 62 → bis Platz 63/);
  });

  it("umbenennen und loeschen wirken auch auf Grooves; ein leerer Platz laesst sich nicht umbenennen", async () => {
    await sicherungLaden();
    await pmAktion("name", "groove", 1, "Conga Neu");
    expect(nameVon(pmZustand()!.groove[0], "groove")).toBe("Conga Neu");
    await pmAktion("weg", "groove", 1);
    expect(nameVon(pmZustand()!.groove[0], "groove")).toBe("G2");
    expect(istLeer(pmZustand()!.groove[61], "groove")).toBe(true);
    await pmAktion("name", "groove", 90, "X");
    expect(el("pmStatus").textContent).toMatch(/leer/);
  });
});
