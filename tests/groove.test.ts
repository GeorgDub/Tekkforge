import { describe, it, expect } from "vitest";
import {
  decodeGroove,
  encodeGroove,
  initGrooveBytes,
  erkenneStepBasis,
  setzeSwing,
  GROOVE_SIZE,
  GROOVE_STEPS,
  GROOVE_STEP_BASIS,
  TRIGGER_MAX,
  GATE_MAX,
} from "../src/core/e2Groove";

describe("e2Groove", () => {
  it("initGrooveBytes: Rahmen, Laenge und Standard-Steps stimmen", () => {
    const b = initGrooveBytes();
    expect(b.length).toBe(GROOVE_SIZE);
    expect(String.fromCharCode(...b.slice(0, 4))).toBe("GVST");
    expect(String.fromCharCode(...b.slice(GROOVE_SIZE - 4))).toBe("GVED");
    expect(b[0x22]).toBe(0x40); // 64 Steps
    expect(b[0x23]).toBe(0xff);
    // Erster Step: kein Versatz, Velocity und Gate auf 0x60, Fuellbyte 0xFF
    expect(b[GROOVE_STEP_BASIS]).toBe(0x00);
    expect(b[GROOVE_STEP_BASIS + 1]).toBe(0x60);
    expect(b[GROOVE_STEP_BASIS + 2]).toBe(0x60);
    expect(b[GROOVE_STEP_BASIS + 3]).toBe(0xff);
    const g = decodeGroove(b);
    expect(g.name).toBe("Init Groove");
    expect(g.laenge).toBe(64);
    expect(g.steps).toHaveLength(GROOVE_STEPS);
  });

  it("Versatz ist vorzeichenbehaftet (Zweierkomplement) und wird begrenzt", () => {
    const g = decodeGroove(initGrooveBytes());
    g.steps[4].trigger = 48; // halber Step nach vorn
    g.steps[12].trigger = -48; // halber Step zurueck
    g.steps[20].trigger = 100; // ueber der Grenze
    const b = encodeGroove(g, initGrooveBytes());
    expect(b[GROOVE_STEP_BASIS + 4 * 4]).toBe(0x30);
    expect(b[GROOVE_STEP_BASIS + 12 * 4]).toBe(0xd0); // -48 als Zweierkomplement
    expect(b[GROOVE_STEP_BASIS + 20 * 4]).toBe(TRIGGER_MAX);
    const zurueck = decodeGroove(b);
    expect(zurueck.steps[4].trigger).toBe(48);
    expect(zurueck.steps[12].trigger).toBe(-48);
    expect(zurueck.steps[20].trigger).toBe(48);
  });

  it("Velocity 0..127, Gate 0..96 werden begrenzt", () => {
    const g = decodeGroove(initGrooveBytes());
    g.steps[0].velocity = 200;
    g.steps[1].gate = 200;
    g.steps[2].velocity = -5;
    const b = encodeGroove(g, initGrooveBytes());
    expect(b[GROOVE_STEP_BASIS + 1]).toBe(0x7f);
    expect(b[GROOVE_STEP_BASIS + 4 + 2]).toBe(GATE_MAX);
    expect(b[GROOVE_STEP_BASIS + 8 + 1]).toBe(0);
  });

  it("schreibt unveraendert zurueck — unbekannte Bytes bleiben erhalten", () => {
    const roh = initGrooveBytes();
    // unbekannte Bereiche mit erkennbarem Muster fuellen
    for (let i = 0x24; i < GROOVE_STEP_BASIS; i++) roh[i] = 0xab;
    for (let i = 0x130; i < GROOVE_SIZE - 4; i++) roh[i] = 0xcd;
    const zurueck = encodeGroove(decodeGroove(roh), roh);
    expect(Array.from(zurueck)).toEqual(Array.from(roh));
  });

  it("Name wird auf 15 Zeichen gekuerzt und ASCII-bereinigt", () => {
    const g = decodeGroove(initGrooveBytes());
    g.name = "Übermäßiger Groove-Name";
    const zurueck = decodeGroove(encodeGroove(g, initGrooveBytes()));
    expect(zurueck.name.length).toBeLessThanOrEqual(15);
    expect(/^[\x20-\x7e]*$/.test(zurueck.name)).toBe(true);
  });

  it("erkenneStepBasis findet das 0xFF-Muster der Step-Tabelle", () => {
    expect(erkenneStepBasis(initGrooveBytes())).toBe(GROOVE_STEP_BASIS);
    // Ohne Muster gibt es keine Fundstelle
    expect(erkenneStepBasis(new Uint8Array(GROOVE_SIZE))).toBeNull();
  });

  it("setzeSwing verschiebt jeden zweiten Step nach hinten", () => {
    const g = decodeGroove(initGrooveBytes());
    setzeSwing(g, 24);
    expect(g.steps[0].trigger).toBe(0);
    expect(g.steps[1].trigger).toBe(24);
    expect(g.steps[2].trigger).toBe(0);
    expect(g.steps[63].trigger).toBe(24);
    // Swing 0 setzt alles zurueck
    setzeSwing(g, 0);
    expect(g.steps.every((s) => s.trigger === 0)).toBe(true);
  });

  it("Laenge wird auf 1..64 begrenzt", () => {
    const g = decodeGroove(initGrooveBytes());
    g.laenge = 13;
    expect(decodeGroove(encodeGroove(g, initGrooveBytes())).laenge).toBe(13);
    g.laenge = 200;
    expect(decodeGroove(encodeGroove(g, initGrooveBytes())).laenge).toBe(64);
    g.laenge = 0;
    expect(decodeGroove(encodeGroove(g, initGrooveBytes())).laenge).toBe(1);
  });
});

describe("erkenneStepBasis: kürzere Vorlagen", () => {
  /**
   * Echte Geräte-Vorlage, am 2026-08-26 aus dem RAM gelesen ("Conga 1"):
   * 16 Steps ab 0x30, dahinter Nullen. Genau daran schlug die Schutzprüfung
   * fehl — sie verlangte 64 Marker und fand 16, obwohl das Längenbyte bei
   * 0x22 sauber 16 sagte. Jede korrekte Vorlage unter 64 Steps wurde damit
   * als verdächtig gemeldet.
   */
  function geraeteGroove(steps: number): Uint8Array {
    const b = new Uint8Array(GROOVE_SIZE);
    b.set([0x47, 0x56, 0x53, 0x54], 0); // "GVST"
    b[0x0c] = 0xff;
    for (const [i, c] of Array.from("Conga 1").entries()) b[0x10 + i] = c.charCodeAt(0);
    b[0x22] = steps;
    b[0x23] = 0xff;
    for (let i = 0; i < steps; i++) {
      const o = GROOVE_STEP_BASIS + i * 4;
      b[o] = 0x00;
      b[o + 1] = 0x15;
      b[o + 2] = 0x50;
      b[o + 3] = 0xff;
    }
    return b;
  }

  it("erkennt eine 16-Step-Vorlage vom Gerät", () => {
    expect(erkenneStepBasis(geraeteGroove(16))).toBe(GROOVE_STEP_BASIS);
  });

  it("erkennt auch 32 und volle 64 Steps", () => {
    expect(erkenneStepBasis(geraeteGroove(32))).toBe(GROOVE_STEP_BASIS);
    expect(erkenneStepBasis(geraeteGroove(64))).toBe(GROOVE_STEP_BASIS);
  });

  it("meldet weiterhin, wenn innerhalb der Länge ein Marker fehlt", () => {
    // Das ist der Fall, vor dem die Prüfung schützen soll: die Tabelle liegt
    // anders, als wir denken. Ein Loch mitten drin darf nicht durchgehen.
    const b = geraeteGroove(16);
    b[GROOVE_STEP_BASIS + 7 * 4 + 3] = 0x00;
    expect(erkenneStepBasis(b)).toBeNull();
  });

  it("eine Länge von 0 ist kein Freibrief", () => {
    const b = geraeteGroove(16);
    b[0x22] = 0;
    expect(erkenneStepBasis(b)).toBeNull();
  });
});
