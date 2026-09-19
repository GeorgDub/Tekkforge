import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initOmni, omniZustand, modulLaden, modulEntladen } from "../src/gui/omniPanel";
import { OtpCmd, OtpSub, buildFrame } from "../src/core/otp";

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

  /**
   * Controller-Ruling (Task 5): kein jsdom im Projekt, der Panel-Test-Stub ist
   * nur ein `innerHTML`-String ohne DOM-Baum — darum ruft der Test die
   * Aktions-Funktionen direkt auf statt einen Klick auf `[data-omni-laden]`
   * zu simulieren. Geprueft wird, was ueber `sysexSenden` ging und was
   * `omniZustand()` danach fuehrt.
   */
  it("Laden sendet Chunks + Commit und wartet je ACK", async () => {
    // ACK-Antwort simulieren: CMD 0x05 SUB 0x03, [status0, id, block]
    const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 9, 0]);
    const h = {
      sysexSenden: vi.fn(async (_f: Uint8Array) => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ack),
    };
    initOmni(h);
    await modulLaden(9);
    const gesendet = h.sysexSenden.mock.calls.map((c) => c[0]);
    expect(gesendet.length).toBeGreaterThan(1); // mindestens ein Chunk + Commit
    // mindestens ein Commit-Frame (SUB 0x04) ging raus
    expect(gesendet.some((f) => f[5] === OtpSub.MODULE_COMMIT)).toBe(true);
    // je gesendetem Frame wurde auf ein ACK gewartet
    expect(h.warten.mock.calls.length).toBe(gesendet.length);
    expect(omniZustand().module.find((m) => m.id === 9)!.platziert).toBe(true);
  });

  it("Entladen sendet Unplace und raeumt platziert", async () => {
    const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 9, 0]);
    const h = {
      sysexSenden: vi.fn(async (_f: Uint8Array) => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ack),
    };
    initOmni(h);
    await modulLaden(9); // erst platzieren, damit das Entladen etwas raeumt
    await modulEntladen(9);
    expect(h.sysexSenden.mock.calls.some((c) => c[0][5] === OtpSub.MODULE_UNPLACE)).toBe(true);
    expect(omniZustand().module.find((m) => m.id === 9)!.platziert).toBe(false);
  });

  it("Laden ohne gebuendeltes Modul sendet nichts und meldet den Status", async () => {
    const h = hooksStub();
    initOmni(h);
    await modulLaden(999); // keine .bin fuer id 999 in omniModuleBins gebuendelt
    expect(h.sysexSenden).not.toHaveBeenCalled();
    expect(omniZustand().module.every((m) => !m.platziert)).toBe(true);
  });

  it("Commit-Fehler laesst das Modul unplatziert", async () => {
    // Status 0x0a = "passt nicht in den Slot" (OTP_MODULE_STATUS) — auf jeden
    // Frame geantwortet; nur beim COMMIT-Frame selbst greift der Abbruch.
    const ackFehler = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x0a, 9, 0]);
    const h = {
      sysexSenden: vi.fn(async () => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ackFehler),
    };
    initOmni(h);
    await modulLaden(9);
    expect(omniZustand().module.find((m) => m.id === 9)!.platziert).toBe(false);
  });
});
