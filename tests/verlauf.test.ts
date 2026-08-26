import { describe, it, expect } from "vitest";
import { Verlauf } from "../src/core/verlauf";
import { klonProjektFuerVerlauf, createPattern, type EditorProject } from "../src/core/editorModel";

describe("Verlauf", () => {
  it("nimmt Schritte zurück und wieder vor", () => {
    const v = new Verlauf<string>();
    v.merke("A"); // Stand vor der Änderung nach B
    v.merke("B");
    expect(v.kannZurueck).toBe(true);
    expect(v.zurueck("C")).toBe("B");
    expect(v.zurueck("B")).toBe("A");
    expect(v.kannZurueck).toBe(false);
    expect(v.zurueck("A")).toBeNull();
    // und wieder vor
    expect(v.vor("A")).toBe("B");
    expect(v.vor("B")).toBe("C");
    expect(v.kannVor).toBe(false);
  });

  it("eine neue Änderung verwirft den Vorwärts-Weg", () => {
    const v = new Verlauf<string>();
    v.merke("A");
    v.merke("B");
    v.zurueck("C");
    expect(v.kannVor).toBe(true);
    v.merke("X"); // ab hier ist der alte Vorwärts-Pfad hinfällig
    expect(v.kannVor).toBe(false);
  });

  it("hält nur die letzten Schritte, damit der Speicher nicht wächst", () => {
    const v = new Verlauf<number>(3);
    for (let i = 0; i < 10; i++) v.merke(i);
    expect(v.tiefe).toBe(3);
    // die ältesten sind weg: zurück führt zu 9, 8, 7
    expect(v.zurueck(99)).toBe(9);
    expect(v.zurueck(9)).toBe(8);
    expect(v.zurueck(8)).toBe(7);
    expect(v.zurueck(7)).toBeNull();
  });

  it("leeren setzt beide Richtungen zurück", () => {
    const v = new Verlauf<string>();
    v.merke("A");
    v.zurueck("B");
    v.leeren();
    expect(v.kannZurueck).toBe(false);
    expect(v.kannVor).toBe(false);
    expect(v.tiefe).toBe(0);
  });

  it("Schnappschuss teilt die Klangdaten, kopiert aber die Patterns", () => {
    const p = createPattern("A");
    p.parts[0].steps[0].on = true;
    const projekt: EditorProject = {
      version: 1,
      patterns: [p],
      samples: [{ number: 501, name: "S", sampleRate: 44100, pcm: new Float32Array([1, 2, 3]) }],
    };
    const kopie = klonProjektFuerVerlauf(projekt);
    // Patterns sind echte Kopien — Änderungen wirken nicht zurück
    kopie.patterns[0].parts[0].steps[0].on = false;
    kopie.patterns[0].name = "B";
    expect(projekt.patterns[0].parts[0].steps[0].on).toBe(true);
    expect(projekt.patterns[0].name).toBe("A");
    // Die Klangdaten werden NICHT kopiert (sonst kostete jeder Schritt Megabytes)
    expect(kopie.samples[0].pcm).toBe(projekt.samples[0].pcm);
    // Der Sample-Eintrag selbst ist aber eigenständig
    kopie.samples[0].name = "X";
    expect(projekt.samples[0].name).toBe("S");
  });

  it("frischer Verlauf gibt nichts her", () => {
    const v = new Verlauf<string>();
    expect(v.kannZurueck).toBe(false);
    expect(v.zurueck("A")).toBeNull();
    expect(v.vor("A")).toBeNull();
  });
});
