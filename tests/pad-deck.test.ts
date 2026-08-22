/**
 * tests/pad-deck.test.ts — Pad-Deck-Modell: Raster, Serialisierung,
 * Pattern-Kopie mit Änderungen, Morph- und Takt-Mathematik, Beispiel-Deck.
 */

import { describe, it, expect } from "vitest";
import { createPattern } from "../src/core/editorModel";
import {
  beispielDeck,
  beschreibeAktion,
  deckGroesseAendern,
  deserialisiereDeck,
  morphDauerMs,
  morphWerte,
  msBisNaechsterTakt,
  neuesDeck,
  neuesPad,
  padIndex,
  serialisiereDeck,
  standardTaste,
  wendeAenderungenAn,
} from "../src/core/padDeck";

describe("padDeck — Raster", () => {
  it("neues Deck: 4×4, 4 Seiten, leere Pads, Achsen auf 1–8 geklemmt", () => {
    const d = neuesDeck(4, 4);
    expect(d.seiten).toHaveLength(4);
    expect(d.seiten[0].pads).toHaveLength(16);
    expect(d.seiten[0].pads.every((p) => p === null)).toBe(true);
    expect(neuesDeck(12, 0).cols).toBe(8);
    expect(neuesDeck(12, 0).rows).toBe(1);
  });

  it("Größe ändern behält Pads an ihrer Spalte/Zeile", () => {
    const d = neuesDeck(3, 3);
    d.seiten[0].pads[padIndex(d, 2, 1)] = neuesPad("X");
    const g = deckGroesseAendern(d, 4, 4);
    expect(g.seiten[0].pads[padIndex(g, 2, 1)]?.label).toBe("X");
    const k = deckGroesseAendern(g, 2, 2);
    expect(k.seiten[0].pads.every((p) => p === null)).toBe(true); // Spalte 2 passt nicht mehr
  });

  it("Standard-Tasten sind eindeutig", () => {
    const t = Array.from({ length: 36 }, (_, i) => standardTaste(i));
    expect(new Set(t).size).toBe(36);
    expect(standardTaste(99)).toBeUndefined();
  });
});

describe("padDeck — Serialisierung", () => {
  it("Roundtrip behält Pads, Aktionen, Tasten, MIDI-Trigger", () => {
    const d = neuesDeck(2, 2);
    d.seiten[1].name = "Zwei";
    d.seiten[0].pads[0] = {
      ...neuesPad("Sprung", "#123456"),
      quantisierung: "takt",
      taste: "q",
      midi: { art: "note", kanal: 9, nummer: 36 },
      aktionen: [
        { art: "pattern", idx: 49 },
        { art: "patternKopie", idx: 3, aenderungen: [{ part: "alle", key: "cutoff", wert: 40 }], bpm: 180 },
        { art: "cc", part: "global", key: "mfxX", wert: 100 },
        { art: "mutes", parts: [0, 1], muted: true },
        { art: "transport", was: "play" },
        { art: "morph", ziele: [{ part: 0, key: "cutoff", nach: 127 }], dauer: 4, einheit: "takte" },
      ],
    };
    const zurueck = deserialisiereDeck(serialisiereDeck(d));
    expect(zurueck).toEqual(d);
  });

  it("wirft Müll weg und lehnt Nicht-Decks ab", () => {
    expect(() => deserialisiereDeck("{nope")).toThrow(/JSON/);
    expect(() => deserialisiereDeck({ foo: 1 })).toThrow(/Raster/);
    const d = deserialisiereDeck({ cols: 2, rows: 1, seiten: [{ pads: [{ label: "ok", aktionen: [{ art: "pattern", idx: 999 }, { art: "transport", was: "stop" }, { art: "unsinn" }] }, "kaputt"] }] });
    expect(d.seiten[0].pads[0]?.aktionen).toEqual([{ art: "transport", was: "stop" }]);
    expect(d.seiten[0].pads[1]).toBeNull();
  });
});

describe("padDeck — Pattern-Kopie", () => {
  it("ändert Parameter, Volume, Mute und BPM nur in der Kopie", () => {
    const p = createPattern("Orig");
    p.bpm = 165;
    const k = wendeAenderungenAn(
      p,
      [
        { part: "alle", key: "cutoff", wert: 40 },
        { part: 2, key: "volume", wert: 200 },
        { part: 0, key: "muted", wert: 1 },
      ],
      175,
    );
    expect(k.bpm).toBe(175);
    expect(k.parts.every((x) => x.params?.cutoff === 40)).toBe(true);
    expect(k.parts[2].volume).toBe(127);
    expect(k.parts[0].muted).toBe(true);
    expect(p.bpm).toBe(165);
    expect(!!p.parts[0].muted).toBe(false);
    expect(p.parts[0].params?.cutoff).toBeUndefined();
  });
});

describe("padDeck — Morph und Takt", () => {
  it("morphWerte endet exakt am Ziel und hat n Schritte", () => {
    expect(morphWerte(0, 100, 4)).toEqual([25, 50, 75, 100]);
    expect(morphWerte(127, 7, 3)).toEqual([87, 47, 7]);
    expect(morphWerte(5, 5, 0)).toEqual([5]);
  });

  it("Morph-Dauer: 4 Takte bei 175 BPM ≈ 5486 ms, Sekunden direkt", () => {
    expect(morphDauerMs(4, "takte", 175)).toBeCloseTo(5485.7, 0);
    expect(morphDauerMs(2.5, "sekunden", 175)).toBe(2500);
  });

  it("msBisNaechsterTakt: auf der Takteins 0, sonst Rest bis zur nächsten", () => {
    const takt = (4 * 60000) / 175;
    expect(msBisNaechsterTakt(0, 175)).toBe(0);
    expect(msBisNaechsterTakt(takt * 2, 175)).toBeLessThan(1);
    expect(msBisNaechsterTakt(100, 175)).toBeCloseTo(takt - 100, 6);
  });
});

describe("padDeck — Beispiel und Beschreibung", () => {
  it("Beispiel-Deck springt an Blockanfänge und hat alle vier Seiten gefüllt", () => {
    const d = beispielDeck(250, 30);
    expect(d.seiten[0].pads.filter(Boolean)).toHaveLength(9); // 0,30,…,240
    expect(d.seiten[0].pads[1]?.aktionen[0]).toEqual({ art: "pattern", idx: 30 });
    expect(d.seiten[1].pads.filter(Boolean).length).toBeGreaterThan(4);
    expect(d.seiten[2].pads[0]?.aktionen[0]).toEqual({ art: "transport", was: "play" });
    expect(d.seiten[3].pads[0]?.aktionen[0].art).toBe("morph");
    expect(() => deserialisiereDeck(serialisiereDeck(d))).not.toThrow();
  });

  it("beschreibeAktion nennt Patternnamen, wenn bekannt", () => {
    expect(beschreibeAktion({ art: "pattern", idx: 4 }, (i) => (i === 4 ? "Dr T1 DROP 1" : undefined))).toBe("→ Pattern 5 „Dr T1 DROP 1\"");
    expect(beschreibeAktion({ art: "mutes", parts: [0, 2], muted: true })).toBe("Parts 1,3 stumm");
  });
});
