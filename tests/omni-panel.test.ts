import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initOmni,
  omniZustand,
  modulLaden,
  modulEntladen,
  paramsRendern,
  omniParamSenden,
  presetLaden,
  allesAus,
} from "../src/gui/omniPanel";
import { OtpCmd, OtpSub, buildFrame, buildOmniNrpn, OMNI_MODULES as MODS } from "../src/core/otp";

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
  sysexSenden: vi.fn(async (_f: Uint8Array) => {}),
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

/**
 * Nur das oeffnende Tag des Widgets zu einer `data-omni-pid` — nicht nur die
 * Substring-Anwesenheit des Attributs, sondern der tatsaechliche Element-Typ
 * (`<select` vs. `<input type="...">`), damit z.B. ein versehentlich auf
 * `<input type="text">` umgestelltes enum/range/toggle-Widget auffaellt.
 */
function widgetAusschnitt(karte: string, pid: number): string {
  const marker = `data-omni-pid="${pid}"`;
  const idx = karte.indexOf(marker);
  expect(idx).toBeGreaterThanOrEqual(0);
  const tagStart = karte.lastIndexOf("<", idx);
  const tagEnde = karte.indexOf(">", idx);
  return karte.slice(tagStart, tagEnde + 1);
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

  /**
   * Controller-Ruling (wie schon Task 5): kein jsdom, der Panel-Test-Stub kennt
   * nur `innerHTML` als String (kein DOM-Baum, kein `querySelector`, kein echtes
   * `dispatchEvent`). Der Brief-Testcode simuliert `dispatchEvent(new Event("change"))`
   * auf einem per `querySelector` gefundenen Element — das geht mit diesem Stub
   * nicht. Darum: Widgets werden per Substring im `viewOmni`-innerHTML geprueft
   * (wie in den bestehenden Tests oben), und die Sende-Aktion `omniParamSenden`
   * wird DIREKT aufgerufen statt ueber ein simuliertes `change`-Event.
   */
  it("rendert Parameter-Widgets, wenn ein Modul platziert ist", async () => {
    const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 1, 0]);
    const h = {
      sysexSenden: vi.fn(async () => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ack),
    };
    initOmni(h);
    await modulLaden(1); // Arp — gebuendelt, s. omniModuleBins
    const karte = kartenAusschnitt(1);
    const arp = MODS.find((m) => m.id === 1)!;
    expect(arp.params.length).toBeGreaterThan(0);
    for (const p of arp.params) {
      expect(karte).toContain(`data-omni-pid="${p.pid}"`);
    }
    // Nicht nur Attribut-Anwesenheit, sondern je ein Vertreter jeder `kind`-
    // Klasse mit dem korrekten Element-Typ (Review-Finding: ein Regressions-
    // Bug wie "alle Params als <input type=text>" faellt sonst nicht auf).
    expect(widgetAusschnitt(karte, 0)).toContain("<select"); // Modus — enum
    expect(widgetAusschnitt(karte, 2)).toContain('type="range"'); // Oktaven — range
    expect(widgetAusschnitt(karte, 4)).toContain('type="checkbox"'); // Latch — toggle
    expect(widgetAusschnitt(karte, 5)).toContain("<select"); // Ziel-Part — part (16 Parts)
  });

  it("paramsRendern laesst sich unabhaengig vom Laden-Status direkt aufrufen", () => {
    initOmni(hooksStub());
    paramsRendern(9); // Chord — auch ohne vorheriges modulLaden
    const karte = kartenAusschnitt(9);
    const chord = MODS.find((m) => m.id === 9)!;
    for (const p of chord.params) {
      expect(karte).toContain(`data-omni-pid="${p.pid}"`);
    }
  });

  it("modulEntladen leert den Params-Host wieder", async () => {
    const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 9, 0]);
    const h = {
      sysexSenden: vi.fn(async () => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ack),
    };
    initOmni(h);
    await modulLaden(9);
    expect(kartenAusschnitt(9)).toContain('data-omni-pid="0"');
    await modulEntladen(9);
    expect(kartenAusschnitt(9)).not.toContain("data-omni-pid=");
  });

  it("omniParamSenden sendet den passenden NRPN-Callback (Arp-Latch, part=2)", () => {
    const h = hooksStub();
    initOmni(h);
    const arp = MODS.find((m) => m.id === 1)!;
    omniParamSenden(arp, 2, 0x04, 1);
    expect(h.sysexSenden).toHaveBeenCalledTimes(1);
    const f = h.sysexSenden.mock.calls[0][0] as Uint8Array;
    expect(f[5]).toBe(OtpSub.MODULE_CALLBACK);
    // Payload beginnt [id=1, cb=1 (ON_NRPN), ...]
    expect([f[8], f[9]]).toEqual([1, 1]);
    expect(f).toEqual(buildOmniNrpn(arp, 2, 0x04, 1));
  });

  it("Enable-Toggle nutzt Chord pid 0x03 / Arp pid 0x06 (dieselbe NRPN wie ein Param)", () => {
    const h = hooksStub();
    initOmni(h);
    const chord = MODS.find((m) => m.id === 9)!;
    const arp = MODS.find((m) => m.id === 1)!;
    omniParamSenden(chord, 0, 0x03, 1);
    omniParamSenden(arp, 0, 0x06, 1);
    const [fChord, fArp] = h.sysexSenden.mock.calls.map((c) => c[0] as Uint8Array);
    expect(fChord).toEqual(buildOmniNrpn(chord, 0, 0x03, 1));
    expect(fArp).toEqual(buildOmniNrpn(arp, 0, 0x06, 1));
  });

  /**
   * Controller-Ruling (wie Task 5/6): kein jsdom, der Panel-Test-Stub kennt nur
   * `innerHTML` als String — ein Klick auf `#omniPreset`/`#omniAus` laesst sich
   * damit nicht simulieren. Darum werden die exportierten Aktions-Funktionen
   * `presetLaden`/`allesAus` DIREKT aufgerufen statt per Button-Klick. Die
   * Klick-Verdrahtung selbst existiert fuers echte Panel, bleibt hier aber
   * ungetestet (wie schon in Task 5/6).
   */
  it("Preset installiert die Periodik (IRQ 21) mit den Skript-Bytes", async () => {
    const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 0, 0]);
    const h = {
      sysexSenden: vi.fn(async (_f: Uint8Array) => {}),
      sysexAnfrage: vi.fn(async () => new Uint8Array()),
      warten: vi.fn(async () => ack),
    };
    initOmni(h);
    await presetLaden();
    const irqInstall = h.sysexSenden.mock.calls
      .map((c) => c[0] as Uint8Array)
      .find((f) => f[4] === OtpCmd.IRQ_HOOK && f[5] === OtpSub.IRQ_INSTALL);
    expect(irqInstall).toBeDefined();
    // Payload == [21, 0,0, 0,21, 1]
    expect(Array.from(irqInstall!.slice(8, 14))).toEqual([21, 0, 0, 0, 21, 1]);
  });

  it("Alles aus sendet Unplace 0x7F", async () => {
    const h = hooksStub();
    initOmni(h);
    await allesAus();
    const f = h.sysexSenden.mock.calls.map((c) => c[0] as Uint8Array).find((x) => x[5] === OtpSub.MODULE_UNPLACE);
    expect(f && f[8]).toBe(0x7f);
  });
});
