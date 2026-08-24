import { describe, expect, it } from "vitest";
import { parseSmf, rasterisiere, baueMidiPatterns } from "../src/core/midiImport";

// ─── SMF-Fixture von Hand: Format 1, 480 Ticks/Viertel ──────────────────────

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}

function track(events: number[]): number[] {
  const body = [...events, 0x00, 0xff, 0x2f, 0x00];
  return [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body];
}

function smf(tracks: number[][], format = 1, tpq = 480): Uint8Array {
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, (tpq >> 8) & 0xff, tpq & 0xff,
    ...tracks.flat(),
  ]);
}

// Tempo 150 BPM = 400000 µs/Viertel, Spurname "LEAD", zwei Noten:
// C4 (60) bei Tick 0, Dauer 480; E4 (64) bei Tick 240, Dauer 240 (Akkord-Overlap).
const FIXTURE = smf([
  track([0x00, 0xff, 0x51, 0x03, 0x06, 0x1a, 0x80]),
  track([
    0x00, 0xff, 0x03, 0x04, 0x4c, 0x45, 0x41, 0x44, // Name "LEAD"
    0x00, 0x90, 60, 100, // C4 an
    ...vlq(240), 0x90, 64, 90, // E4 an (Running-Status waere auch ok)
    ...vlq(240), 0x80, 60, 0, // C4 aus (Tick 480)
    0x00, 0x80, 64, 0, // E4 aus
  ]),
]);

describe("parseSmf", () => {
  it("liest Header, Tempo, Spurnamen und Noten mit Dauer", () => {
    const lied = parseSmf(FIXTURE);
    expect(lied.format).toBe(1);
    expect(lied.ticksProViertel).toBe(480);
    expect(lied.bpm).toBeCloseTo(150, 1);
    const spur = lied.spuren.find((s) => s.noten.length > 0)!;
    expect(spur.name).toBe("LEAD");
    expect(spur.noten).toEqual([
      { tick: 0, dauer: 480, note: 60, velocity: 100, kanal: 0 },
      { tick: 240, dauer: 240, note: 64, velocity: 90, kanal: 0 },
    ]);
  });

  it("versteht Running-Status und Note-On mit Velocity 0 als Note-Off", () => {
    const lied = parseSmf(
      smf([track([0x00, 0x90, 60, 100, ...vlq(120), 62, 80, ...vlq(120), 60, 0, ...vlq(120), 62, 0])]),
    );
    const spur = lied.spuren.find((s) => s.noten.length > 0)!;
    expect(spur.noten.map((n) => [n.note, n.tick, n.dauer])).toEqual([
      [60, 0, 240],
      [62, 120, 240],
    ]);
  });

  it("wirft bei kaputten Dateien mit Position", () => {
    expect(() => parseSmf(Uint8Array.from([1, 2, 3]))).toThrow(/MThd/);
    const kaputt = smf([track([0x00, 0x90, 60])]); // Note-On ohne Velocity
    expect(() => parseSmf(kaputt)).toThrow(/Byte/);
  });

  it("teilt Format 0 mit mehreren Kanaelen in Pseudo-Spuren", () => {
    const lied = parseSmf(
      smf([track([0x00, 0x90, 60, 100, ...vlq(120), 0x80, 60, 0, 0x00, 0x99, 36, 110, ...vlq(60), 0x89, 36, 0])], 0),
    );
    const mitNoten = lied.spuren.filter((s) => s.noten.length > 0);
    expect(mitNoten.length).toBe(2);
    expect(mitNoten.map((s) => s.kanal).sort()).toEqual([0, 9]);
  });
});

describe("rasterisiere", () => {
  it("quantisiert Ticks auf 16tel-Steps", () => {
    const raster = rasterisiere(
      [
        { tick: 0, dauer: 480, note: 60, velocity: 100, kanal: 0 },
        { tick: 130, dauer: 120, note: 64, velocity: 90, kanal: 0 }, // nahe Step 1
      ],
      480,
    );
    expect(raster[0].step).toBe(0);
    expect(raster[1].step).toBe(1);
    expect(raster[0].gate).toBeGreaterThan(raster[1].gate);
  });
});

describe("baueMidiPatterns", () => {
  it("legt Noten auf den gewaehlten Part, Akkorde in die Notenplaetze", () => {
    const lied = parseSmf(FIXTURE);
    const spurIndex = lied.spuren.findIndex((s) => s.noten.length > 0);
    const { patterns } = baueMidiPatterns(lied, [{ spurIndex, part: 10 }], {
      bpm: 150, stepLength: 16, namensBasis: "LIED",
    });
    expect(patterns.length).toBe(1);
    const part = patterns[0].parts[10];
    expect(part.steps[0].on).toBe(true);
    expect(part.steps[0].note).toBe(60);
    // E4 bei Tick 240 (Achtel) -> 16tel-Step 2
    expect(part.steps[2].on).toBe(true);
    expect(part.steps[2].note).toBe(64);
    expect(patterns[0].bpm).toBe(150);
    expect(patterns[0].name).toBe("LIED 1");
  });

  it("schneidet lange Spuren in 4-Takt-Fenster (mehrere Patterns)", () => {
    // 20 Viertel = 80 Steps -> bei 64er-Laenge 2 Patterns
    const noten = Array.from({ length: 20 }, (_, i) => ({ tick: i * 480, dauer: 240, note: 60, velocity: 100, kanal: 0 }));
    const lied = { format: 1, ticksProViertel: 480, bpm: 120, spuren: [{ name: "X", kanal: 0, programm: null, noten }] };
    const { patterns } = baueMidiPatterns(lied, [{ spurIndex: 0, part: 0 }], { bpm: 120, stepLength: 64, namensBasis: "X" });
    expect(patterns.length).toBe(2);
    expect(patterns[0].parts[0].steps.filter((s) => s.on).length).toBe(16);
    expect(patterns[1].parts[0].steps.filter((s) => s.on).length).toBe(4);
  });

  it("meldet Hinweis und deckelt bei mehr als 16 Fenstern", () => {
    const noten = Array.from({ length: 300 }, (_, i) => ({ tick: i * 480, dauer: 240, note: 60, velocity: 100, kanal: 0 }));
    const lied = { format: 1, ticksProViertel: 480, bpm: 120, spuren: [{ name: "X", kanal: 0, programm: null, noten }] };
    const { patterns, hinweise } = baueMidiPatterns(lied, [{ spurIndex: 0, part: 0 }], { bpm: 120, stepLength: 64, namensBasis: "X" });
    expect(patterns.length).toBe(16);
    expect(hinweise.join(" ")).toMatch(/gek(ue|ü)rzt/);
  });
});
