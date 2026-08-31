import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";

/**
 * Das FX-Preset-Panel, ueber einen kleinen DOM-Stub getrieben. Es geht um den
 * Weg Datei → Geraet: die Pflicht-Lesung darf ein geladenes Preset nicht
 * ueberschreiben — aber nach dem Schreiben stehen Editor und Geraet wieder
 * gleich, und die naechste Lesung muss den Geraeteinhalt zeigen.
 */

type Listener = () => void;

class StubElement {
  value = "";
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

let geschrieben: { addr: number; bytes: Uint8Array }[] = [];

beforeEach(() => {
  elemente.clear();
  geschrieben = [];
  g.document = {
    getElementById: (id: string) => el(id),
    createElement: () => new StubElement(),
  };
  initFxPresetPanel({
    lesen: async () => ({ ok: true, bytes: presetBytes("GERAETPRESET") }),
    schreiben: async (addr, bytes) => {
      geschrieben.push({ addr, bytes });
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
});
