import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildPatternFile,
  createPattern,
  importE2Patterns,
  EDITOR_MAX_STEPS,
  type EditorPattern,
} from "../src/core/editorModel";
import { baueVariante, fillSchlaege, kettenNachEinschub, VARIANTEN, type VariantenArt } from "../src/core/patternVarianten";

/** Setzt Steps auf einem Part; `muster` ist eine Liste von Step-Indizes. */
function setze(p: EditorPattern, part: number, muster: number[], velocity = 100): void {
  for (const i of muster) {
    p.parts[part].steps[i].on = true;
    p.parts[part].steps[i].velocity = velocity;
  }
}

/** Indizes der aktiven Steps innerhalb der genutzten Länge. */
function aktive(p: EditorPattern, part: number): number[] {
  const raus: number[] = [];
  for (let i = 0; i < p.stepLength; i++) if (p.parts[part].steps[i].on) raus.push(i);
  return raus;
}

function basis(len: 16 | 32 | 64 = 16): EditorPattern {
  const p = createPattern("ORIGINAL");
  p.stepLength = len;
  return p;
}

describe("baueVariante — allgemein", () => {
  it("lässt das Original unangetastet", () => {
    const p = basis();
    setze(p, 0, [0, 4, 8, 12]);
    const vorher = aktive(p, 0);
    baueVariante(p, "rueckwaerts");
    expect(aktive(p, 0)).toEqual(vorher);
    expect(p.name).toBe("ORIGINAL");
  });

  it("gibt jeder Variante eine erkennbare, gerätetaugliche Bezeichnung", () => {
    const p = basis();
    for (const art of Object.keys(VARIANTEN) as VariantenArt[]) {
      const v = baueVariante(p, art);
      expect(v.name).not.toBe(p.name);
      // Das Namensfeld im Pattern hat 16 Byte; alles darüber schneidet der Export ab.
      expect(v.name.length).toBeLessThanOrEqual(16);
    }
  });

  it("liefert immer eine geräteechte Step-Länge", () => {
    for (const len of [16, 32] as const) {
      const p = basis(len);
      setze(p, 0, [0, 2, 4]);
      for (const art of Object.keys(VARIANTEN) as VariantenArt[]) {
        const v = baueVariante(p, art);
        expect([16, 32, 64]).toContain(v.stepLength);
        expect(v.parts[0].steps).toHaveLength(EDITOR_MAX_STEPS);
      }
    }
  });

  it("teilt den Original-Rohkörper nicht mit der Variante", () => {
    const p = basis();
    p.rawBody = new Uint8Array(0x4000);
    const v = baueVariante(p, "rueckwaerts");
    expect(v.rawBody).not.toBe(p.rawBody);
    expect(v.rawBody?.length).toBe(0x4000);
  });

  it("erbt die Kette NICHT — sonst entsteht ein Ast, den niemand spielt", () => {
    const p = basis();
    p.chainTo = 7;
    p.chainRepeat = 2;
    const v = baueVariante(p, "rueckwaerts");
    expect(v.chainTo).toBeUndefined();
    expect(v.chainRepeat).toBeUndefined();
  });
});

describe("rückwärts", () => {
  it("dreht die genutzte Länge um", () => {
    const p = basis();
    setze(p, 0, [0, 1, 15]);
    const v = baueVariante(p, "rueckwaerts");
    expect(aktive(v, 0)).toEqual([0, 14, 15]);
  });

  it("zweimal umgedreht ergibt wieder das Original", () => {
    const p = basis(32);
    setze(p, 0, [0, 3, 7, 20, 31]);
    setze(p, 4, [2, 5]);
    const zurueck = baueVariante(baueVariante(p, "rueckwaerts"), "rueckwaerts");
    expect(aktive(zurueck, 0)).toEqual(aktive(p, 0));
    expect(aktive(zurueck, 4)).toEqual(aktive(p, 4));
  });

  it("nimmt Anschlag, Ton und Länge mit", () => {
    const p = basis();
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[0].velocity = 111;
    p.parts[0].steps[0].note = 64;
    p.parts[0].steps[0].gate = 30;
    const v = baueVariante(p, "rueckwaerts");
    expect(v.parts[0].steps[15].velocity).toBe(111);
    expect(v.parts[0].steps[15].note).toBe(64);
    expect(v.parts[0].steps[15].gate).toBe(30);
  });
});

describe("halbes Tempo", () => {
  it("zieht die Steps auseinander und verdoppelt die Länge", () => {
    const p = basis();
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "halb");
    expect(v.stepLength).toBe(32);
    expect(aktive(v, 0)).toEqual([0, 8, 16, 24]);
  });

  it("verlängert die Tonlänge mit, gedeckelt bei 96", () => {
    const p = basis();
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[0].gate = 24;
    p.parts[0].steps[4].on = true;
    p.parts[0].steps[4].gate = 90;
    const v = baueVariante(p, "halb");
    expect(v.parts[0].steps[0].gate).toBe(48);
    expect(v.parts[0].steps[8].gate).toBe(96);
  });

  it("verweigert 64 Steps, statt still abzuschneiden", () => {
    const p = basis(64);
    setze(p, 0, [0, 32, 63]);
    expect(() => baueVariante(p, "halb")).toThrow(/64/);
  });
});

describe("doppeltes Tempo", () => {
  it("staucht auf die halbe Länge und hängt die Wiederholung an", () => {
    const p = basis(16);
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "doppelt");
    expect(v.stepLength).toBe(16);
    expect(aktive(v, 0)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("halbiert die Tonlänge, aber nie unter 1", () => {
    const p = basis(16);
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[0].gate = 48;
    p.parts[0].steps[2].on = true;
    p.parts[0].steps[2].gate = 1;
    const v = baueVariante(p, "doppelt");
    expect(v.parts[0].steps[0].gate).toBe(24);
    expect(v.parts[0].steps[1].gate).toBe(1);
  });

  it("halbes und doppeltes Tempo heben sich auf", () => {
    const p = basis(16);
    setze(p, 0, [0, 4, 8, 12]);
    setze(p, 2, [4, 12]);
    const hin = baueVariante(p, "halb"); // 16 → 32
    const zurueck = baueVariante(hin, "doppelt"); // 32 → 32, gestaucht + wiederholt
    // Die erste Hälfte trägt wieder das Original.
    expect(aktive(zurueck, 0).filter((i) => i < 16)).toEqual(aktive(p, 0));
    expect(aktive(zurueck, 2).filter((i) => i < 16)).toEqual(aktive(p, 2));
  });

  it("Steps zwischen dem Raster gehen verloren — und das steht in der Meldung", () => {
    const p = basis(16);
    setze(p, 0, [0, 1, 4]); // die 1 liegt auf ungeradem Raster
    const v = baueVariante(p, "doppelt");
    expect(aktive(v, 0)).toEqual([0, 2, 8, 10]);
    expect(VARIANTEN.doppelt.hinweis).toMatch(/Raster|Zwischenschritt/i);
  });
});

describe("ausdünnen", () => {
  it("behält das Raster und wirft die Zwischenschritte weg", () => {
    const p = basis(16);
    setze(p, 4, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const v = baueVariante(p, "duenn");
    expect(aktive(v, 4)).toEqual([0, 4, 8, 12]);
  });

  it("behält die Eins und den Backbeat, wenn sie besetzt sind", () => {
    const p = basis(16);
    setze(p, 2, [0, 3, 4, 7, 8, 11, 12]);
    const v = baueVariante(p, "duenn");
    expect(aktive(v, 2)).toContain(0);
    expect(aktive(v, 2)).toContain(4);
    expect(aktive(v, 2)).toContain(12);
  });

  it("mutet Parts, die dabei leer werden", () => {
    const p = basis(16);
    setze(p, 5, [1, 3, 5, 7]); // ausschließlich Zwischenschritte
    setze(p, 0, [0, 8]);
    const v = baueVariante(p, "duenn");
    expect(aktive(v, 5)).toEqual([]);
    expect(v.parts[5].muted).toBe(true);
    // Der Part, der etwas behält, bleibt hörbar.
    expect(v.parts[0].muted).toBeFalsy();
  });

  it("mutet einen Part nicht, der schon vorher leer war und hörbar bleiben soll", () => {
    const p = basis(16);
    setze(p, 0, [0, 4]);
    const v = baueVariante(p, "duenn");
    // Part 9 war nie besetzt — hier wird nichts weggenommen, also auch nichts gemutet.
    expect(v.parts[9].muted).toBeFalsy();
  });
});

describe("menschlich", () => {
  it("verändert nur den Anschlag, nicht die Positionen", () => {
    const p = basis(16);
    setze(p, 0, [0, 4, 8, 12], 100);
    const v = baueVariante(p, "menschlich");
    expect(aktive(v, 0)).toEqual([0, 4, 8, 12]);
  });

  it("streut den Anschlag, bleibt aber im gültigen Bereich", () => {
    const p = basis(64);
    for (let i = 0; i < 64; i++) setze(p, 0, [i], 127);
    setze(p, 1, Array.from({ length: 64 }, (_, i) => i), 1);
    const v = baueVariante(p, "menschlich");
    for (let i = 0; i < 64; i++) {
      expect(v.parts[0].steps[i].velocity).toBeGreaterThanOrEqual(1);
      expect(v.parts[0].steps[i].velocity).toBeLessThanOrEqual(127);
      expect(v.parts[1].steps[i].velocity).toBeGreaterThanOrEqual(1);
      expect(v.parts[1].steps[i].velocity).toBeLessThanOrEqual(127);
    }
    const werte = new Set(Array.from({ length: 64 }, (_, i) => v.parts[0].steps[i].velocity));
    expect(werte.size).toBeGreaterThan(1); // es wurde wirklich gestreut
  });

  it("ist reproduzierbar — gleicher Startwert, gleiches Ergebnis", () => {
    const p = basis(16);
    setze(p, 0, [0, 1, 2, 3, 4, 5, 6, 7], 90);
    const a = baueVariante(p, "menschlich", { streuung: 20, startwert: 7 });
    const b = baueVariante(p, "menschlich", { streuung: 20, startwert: 7 });
    const c = baueVariante(p, "menschlich", { streuung: 20, startwert: 8 });
    const werte = (x: EditorPattern) => Array.from({ length: 8 }, (_, i) => x.parts[0].steps[i].velocity);
    expect(werte(a)).toEqual(werte(b));
    expect(werte(a)).not.toEqual(werte(c));
  });

  it("rührt abgeschaltete Steps nicht an", () => {
    const p = basis(16);
    p.parts[0].steps[3].velocity = 50; // aus, aber mit Wert
    const v = baueVariante(p, "menschlich", { streuung: 30 });
    expect(v.parts[0].steps[3].velocity).toBe(50);
  });
});

describe("Fill", () => {
  it("legt einen Wirbel auf das letzte Viertel", () => {
    const p = basis(16);
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "fill");
    // Snare (Part 3 im Layout: Kick, Kick 2, Snare, …) füllt 12..15
    expect(aktive(v, 2)).toEqual([12, 13, 14, 15]);
  });

  it("passt sich der Pattern-Länge an", () => {
    const p = basis(64);
    const v = baueVariante(p, "fill");
    expect(aktive(v, 2)).toEqual(Array.from({ length: 16 }, (_, i) => 48 + i));
  });

  it("steigert den Anschlag zum Ende hin", () => {
    const p = basis(16);
    const v = baueVariante(p, "fill");
    const vel = [12, 13, 14, 15].map((i) => v.parts[2].steps[i].velocity);
    expect(vel[0]).toBeLessThan(vel[3]);
    expect(vel[3]).toBeLessThanOrEqual(127);
    expect(vel[0]).toBeGreaterThanOrEqual(1);
  });

  it("lässt den Rest des Patterns stehen", () => {
    const p = basis(16);
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "fill");
    expect(aktive(v, 0)).toEqual([0, 4, 8, 12]);
  });

  it("hebt die Stummschaltung des Fill-Parts auf — sonst hört man ihn nicht", () => {
    const p = basis(16);
    p.parts[2].muted = true;
    const v = baueVariante(p, "fill");
    expect(v.parts[2].muted).toBeFalsy();
  });
});

describe("kettenNachEinschub", () => {
  it("zieht Verweise hinter der Einfügestelle mit", () => {
    const p = [basis(), basis(), basis(), basis()];
    p[0].chainTo = 3; // zeigt auf das dritte Pattern
    p[1].chainTo = 4;
    p[3].chainTo = 1; // zeigt davor — bleibt
    // Eingefügt wird an Listenindex 1, also als neue Nummer 2.
    kettenNachEinschub(p, 1);
    expect(p[0].chainTo).toBe(4);
    expect(p[1].chainTo).toBe(5);
    expect(p[3].chainTo).toBe(1);
  });

  it("lässt das Ende der Kette (0) in Ruhe", () => {
    const p = [basis(), basis()];
    p[0].chainTo = 0;
    kettenNachEinschub(p, 0);
    expect(p[0].chainTo).toBe(0);
  });

  it("rührt Patterns ohne Kette nicht an", () => {
    const p = [basis(), basis()];
    kettenNachEinschub(p, 0);
    expect(p[0].chainTo).toBeUndefined();
    expect(p[1].chainTo).toBeUndefined();
  });

  it("hängt beim Anfügen ans Ende nichts um", () => {
    const p = [basis(), basis()];
    p[0].chainTo = 2;
    kettenNachEinschub(p, 2); // ans Ende gehängt
    expect(p[0].chainTo).toBe(2);
  });
});

// ─── Der Weg bis in die Datei ────────────────────────────────────────────────
//
// Die Tests oben pruefen das Modell. Zwei Varianten aendern aber Felder, die
// auch im uebernommenen Rohkoerper eines importierten Patterns stehen: "halb"
// die Step-Laenge, "duenn" die Stummschaltung. Wenn dort der Rohkoerper
// gewinnt, sieht das Modell richtig aus und das Geraet spielt trotzdem etwas
// anderes — still. Also einmal wirklich exportieren und zurueckimportieren.

const BEISPIEL = path.resolve(process.cwd(), "examples", "e2s", "CHORDTEST.e2spat");

(fs.existsSync(BEISPIEL) ? describe : describe.skip)("Varianten überstehen den Export", () => {
  const geladen = () => importE2Patterns(new Uint8Array(fs.readFileSync(BEISPIEL))).patterns[0];

  it("das Beispiel bringt einen Rohkörper mit — sonst prüft der Test nichts", () => {
    const p = geladen();
    expect(p.rawBody).toBeDefined();
    expect(p.stepLength).toBe(16);
  });

  it("halbes Tempo: die verdoppelte Länge steht auch in der Datei", () => {
    const p = geladen();
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "halb");
    const zurueck = importE2Patterns(buildPatternFile(v)).patterns[0];
    expect(zurueck.stepLength).toBe(32);
    expect(aktive(zurueck, 0)).toEqual([0, 8, 16, 24]);
  });

  it("ausdünnen: die Stummschaltung steht auch in der Datei", () => {
    const p = geladen();
    for (let i = 0; i < 16; i++) p.parts[5].steps[i].on = false;
    setze(p, 5, [1, 3, 5, 7]); // nur Zwischenschritte → Part wird leer
    setze(p, 0, [0, 4, 8, 12]);
    const v = baueVariante(p, "duenn");
    const zurueck = importE2Patterns(buildPatternFile(v)).patterns[0];
    expect(aktive(zurueck, 5)).toEqual([]);
    expect(zurueck.parts[5].muted).toBe(true);
    expect(zurueck.parts[0].muted).toBeFalsy();
  });

  it("der Name der Variante passt ungekürzt ins Namensfeld", () => {
    const p = geladen();
    p.name = "AMPHEGOTT VOCAL 1"; // länger als das Feld
    const v = baueVariante(p, "rueckwaerts");
    const zurueck = importE2Patterns(buildPatternFile(v)).patterns[0];
    expect(zurueck.name.trim()).toBe(v.name);
  });

  it("Fill: der Wirbel steht auch in der Datei", () => {
    const p = geladen();
    const v = baueVariante(p, "fill");
    const zurueck = importE2Patterns(buildPatternFile(v)).patterns[0];
    expect(aktive(zurueck, 2)).toEqual([12, 13, 14, 15]);
  });
});

describe("fillSchlaege — die gemeinsame Definition", () => {
  it("belegt das letzte Viertel lückenlos", () => {
    expect(fillSchlaege(16).map((s) => s.index)).toEqual([12, 13, 14, 15]);
    expect(fillSchlaege(32).map((s) => s.index)).toEqual([24, 25, 26, 27, 28, 29, 30, 31]);
    expect(fillSchlaege(64).map((s) => s.index)).toEqual(Array.from({ length: 16 }, (_, i) => 48 + i));
  });

  it("steigert den Anschlag von der gedimmten Aufbau-Höhe bis ans Maximum", () => {
    const s = fillSchlaege(64);
    // Startet dort, wo der gedimmte Aufbau liegt — der Wirbel soll anschließen,
    // nicht danebenspringen.
    expect(s[0].velocity).toBe(90);
    expect(s[s.length - 1].velocity).toBe(127);
    for (let i = 1; i < s.length; i++) expect(s[i].velocity).toBeGreaterThanOrEqual(s[i - 1].velocity);
  });

  it("hält die Töne kurz, damit der Wirbel nicht verschmiert", () => {
    for (const s of fillSchlaege(16)) expect(s.gate).toBe(10);
  });

  it("kommt auch mit einem einzelnen Schlag zurecht", () => {
    const s = fillSchlaege(4);
    expect(s).toHaveLength(1);
    expect(s[0].velocity).toBe(127);
  });
});
