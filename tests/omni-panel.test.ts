import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initOmni, omniZustand } from "../src/gui/omniPanel";

/**
 * Omni-Panel ueber denselben DOM-Stub wie die anderen Panel-Tests
 * (fx-preset-panel.test.ts, preset-manager-panel.test.ts, firmware-werkbank.test.ts):
 * kein jsdom im Projekt, darum ein minimaler `document`-Ersatz. `innerHTML`
 * ist hier nur ein gespeicherter String — die Karten werden per Substring
 * geprueft statt per echter DOM-Traversierung.
 */

class StubElement {
  innerHTML = "";
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

const hooksStub = () => ({
  sysexSenden: vi.fn(async () => {}),
  sysexAnfrage: vi.fn(async () => new Uint8Array()),
  warten: vi.fn(async () => null),
});

/** Die Karte eines Moduls als Teilstring aus dem gerenderten `viewOmni`-HTML. */
function kartenAusschnitt(modulId: number): string {
  const html = el("viewOmni").innerHTML;
  const start = html.indexOf(`data-omni-modul="${modulId}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const ende = html.indexOf('data-omni-modul="', start + 1);
  return html.slice(start, ende === -1 ? html.length : ende);
}

beforeEach(() => {
  elemente.clear();
  g.document = {
    getElementById: (id: string) => el(id),
  };
});

afterEach(() => {
  delete g.document;
});

describe("Omni-Panel", () => {
  it("baut fuer jedes Modul eine Karte mit Laden/Entladen", () => {
    initOmni(hooksStub());
    const html = el("viewOmni").innerHTML;
    const treffer = html.match(/data-omni-modul="/g) ?? [];
    expect(treffer.length).toBe(6); // Chord, Arp + 4 ungetestete
    expect(html).toContain('data-omni-modul="9"');
    const karte9 = kartenAusschnitt(9);
    expect(karte9).toContain("data-omni-laden=");
    expect(karte9).toContain("data-omni-entladen=");
  });
  it("markiert ungetestete Module sichtbar", () => {
    initOmni(hooksStub());
    expect(kartenAusschnitt(19)).toContain("ungetestet");
  });
  it("omniZustand listet die Module (anfangs nicht platziert)", () => {
    initOmni(hooksStub());
    expect(omniZustand().module.every((m) => !m.platziert)).toBe(true);
  });
});
