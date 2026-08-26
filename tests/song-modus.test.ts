import { describe, it, expect } from "vitest";
import { createPattern, type EditorPattern } from "../src/core/editorModel";
import { planeSong, type SongSchritt } from "../src/core/songModus";

const patterns = (n: number): EditorPattern[] =>
  Array.from({ length: n }, (_, i) => createPattern(String.fromCharCode(65 + i)));

const kette = (p: EditorPattern[]) => p.map((x) => `${x.name}:${x.chainTo ?? 0}x${x.chainRepeat ?? 1}`);

describe("songModus", () => {
  it("reiht Patterns aneinander: jedes zeigt aufs nächste, das letzte endet", () => {
    const schritte: SongSchritt[] = [
      { pattern: 0, wiederholungen: 2 },
      { pattern: 1, wiederholungen: 4 },
      { pattern: 2, wiederholungen: 1 },
    ];
    const r = planeSong(patterns(3), schritte);
    expect(kette(r.patterns)).toEqual(["A:2x2", "B:3x4", "C:0x1"]);
    expect(r.kopien).toBe(0);
  });

  it("gleiche Patterns direkt hintereinander werden zu Wiederholungen", () => {
    const r = planeSong(patterns(2), [
      { pattern: 0, wiederholungen: 2 },
      { pattern: 0, wiederholungen: 3 },
      { pattern: 1, wiederholungen: 1 },
    ]);
    // A läuft 5 Durchgänge und geht dann auf B — keine zwei A-Slots
    expect(kette(r.patterns).slice(0, 2)).toEqual(["A:2x5", "B:0x1"]);
    expect(r.kopien).toBe(0);
  });

  it("ein Pattern mit zwei verschiedenen Nachfolgern braucht eine Kopie", () => {
    // A B A C — das erste A geht auf B, das zweite auf C
    const r = planeSong(patterns(3), [
      { pattern: 0, wiederholungen: 1 },
      { pattern: 1, wiederholungen: 1 },
      { pattern: 0, wiederholungen: 1 },
      { pattern: 2, wiederholungen: 1 },
    ]);
    expect(r.kopien).toBe(1);
    expect(r.hinweise.join(" ")).toMatch(/Kopie/i);
    // Die Kette muss durchlaufen: erstes A -> B -> Kopie von A -> C -> Ende
    const slots = r.patterns;
    const ersteA = slots.findIndex((p) => p.name === "A");
    const b = slots.findIndex((p) => p.name === "B");
    expect(slots[ersteA].chainTo).toBe(b + 1);
    const zweiteA = slots[b].chainTo! - 1;
    expect(slots[zweiteA].name).toMatch(/^A/);
    expect(zweiteA).not.toBe(ersteA);
    const c = slots[zweiteA].chainTo! - 1;
    expect(slots[c].name).toBe("C");
    expect(slots[c].chainTo).toBe(0);
  });

  it("Patterns außerhalb des Songs bleiben erhalten und ohne Kette", () => {
    const r = planeSong(patterns(4), [{ pattern: 1, wiederholungen: 1 }]);
    expect(r.patterns).toHaveLength(4);
    expect(r.patterns[1].chainTo).toBe(0);
    // A, C, D wurden nicht angefasst
    expect(r.patterns[0].chainTo ?? 0).toBe(0);
    expect(r.patterns.map((p) => p.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("leerer Song lässt alles unverändert", () => {
    const p = patterns(2);
    const r = planeSong(p, []);
    expect(r.patterns.map((x) => x.name)).toEqual(["A", "B"]);
    expect(r.kopien).toBe(0);
    expect(r.hinweise.join(" ")).toMatch(/leer|kein/i);
  });

  it("Wiederholungen werden auf den erlaubten Bereich geklemmt", () => {
    const r = planeSong(patterns(1), [{ pattern: 0, wiederholungen: 999 }]);
    expect(r.patterns[0].chainRepeat).toBeLessThanOrEqual(64);
    expect(r.patterns[0].chainRepeat).toBeGreaterThanOrEqual(1);
  });

  it("meldet, wenn der Song mehr Slots braucht als die Bank hat", () => {
    const viele: SongSchritt[] = Array.from({ length: 300 }, (_, i) => ({
      pattern: i % 2,
      wiederholungen: 1,
    }));
    const r = planeSong(patterns(2), viele);
    expect(r.patterns.length).toBeLessThanOrEqual(250);
    expect(r.hinweise.join(" ")).toMatch(/250|gekürzt|passen/i);
  });

  it("unbekannte Pattern-Nummern werden übersprungen, nicht geraten", () => {
    const r = planeSong(patterns(2), [
      { pattern: 0, wiederholungen: 1 },
      { pattern: 99, wiederholungen: 1 },
      { pattern: 1, wiederholungen: 1 },
    ]);
    expect(r.hinweise.join(" ")).toMatch(/99/);
    expect(r.patterns[0].chainTo).toBe(2);
  });
});
