import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { baueSammlung, type SammlungsEintrag } from "../src/core/sammlung";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER, IFX_ANZAHL_ADDR } from "../src/core/ifxErweiterung";

const adresseVon = (key: "ifxPreset" | "mfxPreset", slot0: number): number =>
  addressForSlot(E2_RAM_MAP.find((e) => e.key === key)!, slot0);

/**
 * Das FX-Preset-Panel, ueber einen kleinen DOM-Stub getrieben. Es geht um den
 * Weg Datei → Geraet: die Pflicht-Lesung darf ein geladenes Preset nicht
 * ueberschreiben — aber nach dem Schreiben stehen Editor und Geraet wieder
 * gleich, und die naechste Lesung muss den Geraeteinhalt zeigen.
 */

type Listener = () => void;

class StubElement {
  value = "";
  checked = false;
  textContent = "";
  innerHTML = "";
  files: unknown[] = [];
  dataset: Record<string, string> = {};
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

const g = globalThis as unknown as { document?: unknown };

/** Klick-Handler feuern und die dahinter laufenden Promises abwarten. */
async function klickUndWarte(id: string): Promise<void> {
  el(id).feuere("click");
  await new Promise((r) => setTimeout(r, 0));
}

function presetBytes(name: string): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes());
  p.name = name;
  return encodeFxPreset(p);
}

function fakeDatei(name: string, bytes: Uint8Array): File {
  return {
    name,
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as File;
}

function fakeTextDatei(name: string, text: string): File {
  return { name, text: async () => text } as unknown as File;
}

/** Eine Sammlung ueber den Datei-Weg in das Panel laden. */
async function sammlungLaden(eintraege: SammlungsEintrag[]): Promise<void> {
  el("fxpSamIn").files = [fakeTextDatei("set.tfsam", baueSammlung(eintraege, { titel: "Test" }))];
  el("fxpSamIn").feuere("change");
  await new Promise((r) => setTimeout(r, 0));
}

let geschrieben: { addr: number; bytes: Uint8Array }[] = [];
type Lesung = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
/** Was das Geraet auf eine Lesung antwortet — je Test austauschbar. */
let leseStub: (addr: number, len: number) => Lesung = () => ({ ok: true, bytes: presetBytes("GERAETPRESET") });

beforeEach(() => {
  elemente.clear();
  geschrieben = [];
  leseStub = () => ({ ok: true, bytes: presetBytes("GERAETPRESET") });
  g.document = {
    getElementById: (id: string) => el(id),
    createElement: () => new StubElement(),
  };
  initFxPresetPanel({
    lesen: async (addr, len) => leseStub(addr, len),
    schreiben: async (addr, bytes) => {
      geschrieben.push({ addr, bytes });
      return true;
    },
  });
});

afterEach(() => {
  delete g.document;
});

describe("FX-Preset-Panel: Weg Datei → Geraet", () => {
  it("die Pflicht-Lesung laesst ein aus Datei geladenes Preset im Editor stehen", async () => {
    el("fxpFileIn").files = [fakeDatei("datei.e2fxp", presetBytes("DATEIPRESET"))];
    el("fxpFileIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    await klickUndWarte("fxpRead");
    expect(el("fxpEditor").innerHTML).toContain("DATEIPRESET");
    expect(el("fxpEditor").innerHTML).not.toContain("GERAETPRESET");
  });

  it("nach dem Schreiben zeigt die naechste Lesung wieder den Geraeteinhalt", async () => {
    el("fxpFileIn").files = [fakeDatei("datei.e2fxp", presetBytes("DATEIPRESET"))];
    el("fxpFileIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    await klickUndWarte("fxpRead");
    await klickUndWarte("fxpWrite");
    expect(geschrieben).toHaveLength(1);
    // Editor und Geraet sind jetzt identisch — wer einen anderen Platz liest,
    // will ihn auch sehen
    await klickUndWarte("fxpRead");
    expect(el("fxpEditor").innerHTML).toContain("GERAETPRESET");
  });

  it("das Platz-Feld zaehlt wie das Geraet ab 1 — Platz 41 schreibt auf Slot 40", async () => {
    el("fxpArt").value = "ifx";
    el("fxpSlot").value = "41";
    el("fxpFileIn").files = [fakeDatei("datei.e2fxp", presetBytes("DATEIPRESET"))];
    el("fxpFileIn").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    await klickUndWarte("fxpRead");
    await klickUndWarte("fxpWrite");
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0].addr).toBe(adresseVon("ifxPreset", 40));
  });
});

describe("FX-Preset-Panel: Sammlung verteilen", () => {
  const eintraege = (): SammlungsEintrag[] => [
    { art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 41 },
    { art: "ifx", name: "B", bytes: presetBytes("OHNE") },
    { art: "mfx", name: "C", bytes: presetBytes("ZWEI"), platz: 21 },
  ];

  it("schreibt Eintraege mit Platz der Reihe nach an ihre Adressen und ueberspringt die ohne", async () => {
    await sammlungLaden(eintraege());
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben.map((g) => g.addr)).toEqual([adresseVon("ifxPreset", 40), adresseVon("mfxPreset", 20)]);
    expect(decodeFxPreset(geschrieben[0].bytes).name).toBe("EINS");
    expect(decodeFxPreset(geschrieben[1].bytes, true).name).toBe("ZWEI");
    expect(el("fxpStatus").textContent).toContain("1 ohne Platz");
  });

  it("bei doppeltem Platz derselben Art wird gar nichts geschrieben", async () => {
    await sammlungLaden([
      { art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 41 },
      { art: "ifx", name: "B", bytes: presetBytes("ZWEI"), platz: 41 },
    ]);
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben).toHaveLength(0);
    expect(el("fxpStatus").textContent).toMatch(/doppelt/i);
  });

  it("das Zuruecknehmen schreibt die Vorher-Staende in umgekehrter Reihenfolge zurueck", async () => {
    await sammlungLaden(eintraege());
    await klickUndWarte("fxpSamSchreiben");
    await klickUndWarte("fxpSamZurueck");
    expect(geschrieben).toHaveLength(4);
    expect(geschrieben[2].addr).toBe(adresseVon("mfxPreset", 20));
    expect(geschrieben[3].addr).toBe(adresseVon("ifxPreset", 40));
    expect(decodeFxPreset(geschrieben[3].bytes).name).toBe("GERAETPRESET");
  });
});

describe("FX-Preset-Panel: Plaetze durchnummerieren", () => {
  const ohnePlatz = (): SammlungsEintrag[] => [
    { art: "ifx", name: "A", bytes: presetBytes("EINS") },
    { art: "ifx", name: "B", bytes: presetBytes("ZWEI") },
    { art: "ifx", name: "C", bytes: presetBytes("DREI") },
  ];

  it("▲ ab dem Startplatz: 50, 51, 52 — und das Verteilen schreibt genau dorthin", async () => {
    await sammlungLaden(ohnePlatz());
    el("fxpSamStart").value = "50";
    await klickUndWarte("fxpSamNumAuf");
    expect(el("fxpStatus").textContent).toContain("3 Plätze aufsteigend");
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben.map((g) => g.addr)).toEqual([49, 50, 51].map((s) => adresseVon("ifxPreset", s)));
  });

  it("▼ ohne Startplatz zaehlt vom Platz des ersten Eintrags herunter", async () => {
    const e = ohnePlatz();
    e[0].platz = 20;
    await sammlungLaden(e);
    await klickUndWarte("fxpSamNumAb");
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben.map((g) => g.addr)).toEqual([19, 18, 17].map((s) => adresseVon("ifxPreset", s)));
  });
});

describe("FX-Preset-Panel: IFX-Menue erweitern", () => {
  const ifxAdresse = (slot: number): number => adresseVon("ifxPreset", slot);

  /**
   * Ein Geraet mit Max-Index 48 (wie das Testgeraet): Zaehler stimmig,
   * Plaetze bis Slot 48 belegt, dahinter Nullen — es sei denn, dieser Lauf
   * hat schon dorthin geschrieben (dann liefert die Lesung das Geschriebene).
   */
  const geraetMitMax = (max: number) => (addr: number, len: number): Lesung => {
    const z = IFX_ZAEHLER.find((x) => x.addr === addr);
    if (z && len === 1) return { ok: true, bytes: new Uint8Array([z.plusEins ? max + 1 : max]) };
    const zuletzt = [...geschrieben].reverse().find((g) => g.addr === addr);
    if (zuletzt) return { ok: true, bytes: zuletzt.bytes };
    const slot = (addr - ifxAdresse(0)) / 0x20c;
    if (Number.isInteger(slot) && slot > max) return { ok: true, bytes: new Uint8Array(FX_PRESET_SIZE) };
    return { ok: true, bytes: presetBytes("GERAETPRESET") };
  };

  it("mit Haken: nach dem Verteilen auf 50 und 51 werden die 13 Zaehler auf 50/51 gesetzt", async () => {
    leseStub = geraetMitMax(48);
    await sammlungLaden([
      { art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 50 },
      { art: "ifx", name: "B", bytes: presetBytes("ZWEI"), platz: 51 },
    ]);
    el("fxpSamErweitern").checked = true;
    await klickUndWarte("fxpSamSchreiben");
    const zaehler = geschrieben.slice(2);
    expect(geschrieben.slice(0, 2).map((g) => g.addr)).toEqual([ifxAdresse(49), ifxAdresse(50)]);
    expect(zaehler).toHaveLength(13);
    expect(zaehler.map((g) => g.addr)).toEqual(IFX_ZAEHLER.map((z) => z.addr));
    for (const g of zaehler) {
      const z = IFX_ZAEHLER.find((x) => x.addr === g.addr)!;
      expect(Array.from(g.bytes)).toEqual([z.plusEins ? 51 : 50]);
    }
    expect(geschrieben.find((g) => g.addr === IFX_ANZAHL_ADDR)!.bytes[0]).toBe(51);
    expect(el("fxpStatus").textContent).toContain("bis Platz 49 → bis Platz 51");
  });

  it("eine Luecke im neuen Bereich stoppt die Erweiterung — die Presets bleiben, die Zaehler nicht angefasst", async () => {
    leseStub = geraetMitMax(48);
    await sammlungLaden([{ art: "ifx", name: "B", bytes: presetBytes("ZWEI"), platz: 51 }]);
    el("fxpSamErweitern").checked = true;
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben).toHaveLength(1);
    expect(el("fxpStatus").textContent).toMatch(/Platz 50 leer/);
  });

  it("ohne Haken bleibt alles wie bisher", async () => {
    leseStub = geraetMitMax(48);
    await sammlungLaden([{ art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 50 }]);
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben).toHaveLength(1);
  });

  it("das Zuruecknehmen stellt zuerst die alten Zaehler (48/49) und dann die Plaetze wieder her", async () => {
    leseStub = geraetMitMax(48);
    await sammlungLaden([{ art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 50 }]);
    el("fxpSamErweitern").checked = true;
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben).toHaveLength(14);
    await klickUndWarte("fxpSamZurueck");
    expect(geschrieben).toHaveLength(28);
    const zurueck = geschrieben.slice(14);
    expect(zurueck.slice(0, 13).map((g) => g.addr)).toEqual([...IFX_ZAEHLER].reverse().map((z) => z.addr));
    for (const g of zurueck.slice(0, 13)) {
      const z = IFX_ZAEHLER.find((x) => x.addr === g.addr)!;
      expect(Array.from(g.bytes)).toEqual([z.plusEins ? 49 : 48]);
    }
    expect(zurueck[13].addr).toBe(ifxAdresse(49));
    expect(Array.from(zurueck[13].bytes)).toEqual(Array.from(new Uint8Array(FX_PRESET_SIZE)));
  });

  it("ein widerspruechlicher Zaehlersatz wird gemeldet und nicht angefasst", async () => {
    const basis = geraetMitMax(48);
    leseStub = (addr, len) => (addr === 0xc004a1f8 && len === 1 ? { ok: true, bytes: new Uint8Array([49]) } : basis(addr, len));
    await sammlungLaden([{ art: "ifx", name: "A", bytes: presetBytes("EINS"), platz: 50 }]);
    el("fxpSamErweitern").checked = true;
    await klickUndWarte("fxpSamSchreiben");
    expect(geschrieben).toHaveLength(1);
    expect(el("fxpStatus").textContent).toMatch(/widersprechen/);
  });
});
