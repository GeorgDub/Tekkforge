import { describe, it, expect } from "vitest";
import { meloNoten, linieAusNoten, stabAusLinie, bassLinieAusMelo, kickAnMelo, noteFuerStab, meloAlsSmf } from "../src/core/meloNoten";
import { smfBytes } from "../src/core/smfSchreiben";
import { parseSmf } from "../src/core/midiImport";
import type { E2StepInput } from "../src/core/electribePatternBuilder";

const SR = 44100;
const BPM = 120;
const step = (60 / BPM / 4) * SR;

/** Melodie: je Viertel eine Note mit Obertoenen und Huellkurve, Takt 1 A3 C4 E4 A3, Takt 2 G3 … */
function melodie(folge: (number | null)[], stepsJeNote = 4): Float32Array {
  const out = new Float32Array(Math.round(folge.length * stepsJeNote * step));
  folge.forEach((midi, k) => {
    if (midi === null) return;
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const von = Math.round(k * stepsJeNote * step);
    const n = Math.round(stepsJeNote * step);
    for (let i = 0; i < n && von + i < out.length; i++) {
      const t = i / SR;
      out[von + i] = Math.exp(-t * 1.5) * (0.6 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * 2 * hz * t));
    }
  });
  return out;
}

describe("meloNoten", () => {
  const folge = [57, 60, 64, 57, 55, 59, 62, 55, 57, 60, 64, 57, 55, 59, 62, 55];
  const { linie, noten } = meloNoten(melodie(folge), SR, BPM);

  it("erkennt die Melodie je Viertel: Note, Anschlag, Pause", () => {
    expect(noten.length).toBeGreaterThanOrEqual(12);
    for (let v = 0; v < 16; v++) {
      const s = v * 4;
      expect(linie.noten[s], `Viertel ${v}`).toBe(folge[v]);
      expect(linie.anschlag[s], `Anschlag ${v}`).toBe(true);
    }
    const mitPause = meloNoten(melodie([57, null, 64, null]), SR, BPM).linie;
    expect(mitPause.noten[4]).toBeNull();
    expect(mitPause.anschlag[8]).toBe(true);
  });

  it("linieAusNoten faltet Ticks aufs 16tel-Raster und haelt Noten ueber ihre Dauer", () => {
    const l = linieAusNoten([{ tick: 0, dauer: 480, note: 60, velocity: 100, kanal: 0 }, { tick: 480, dauer: 120, note: 62, velocity: 90, kanal: 0 }], 480);
    expect(l.noten.slice(0, 6)).toEqual([60, 60, 60, 60, 62, null]);
    expect(l.anschlag.slice(0, 5)).toEqual([true, false, false, false, true]);
    expect(l.velocity[4]).toBe(90);
  });

  it("stabAusLinie: Anschlag je Notenanfang, Tonklasse in 60…71, Gate nach Laenge", () => {
    const st = stabAusLinie(linie);
    expect(st[0]).toMatchObject({ active: true, notes: [noteFuerStab(57)], gate: 96 });
    expect(noteFuerStab(57)).toBe(69);
    expect(noteFuerStab(48)).toBe(60);
    expect(st[4].notes).toEqual([60]);
    expect(st.filter((s) => s.active).length).toBe(16);
    expect(st[1].active).toBe(false);
  });

  it("bassLinieAusMelo: tiefste Note je Viertel", () => {
    const b = bassLinieAusMelo(linie);
    expect(b.slice(0, 4)).toEqual([57, 60, 64, 57]);
    expect(bassLinieAusMelo(linieAusNoten([], 480))).toEqual(new Array(16).fill(null));
  });

  it("kickAnMelo: Viertel-Kicks auf Melodie-Anschlaegen 127, Zusatz-Kicks auf Anschlaegen entfallen", () => {
    const figur: E2StepInput[] = Array.from({ length: 64 }, (_, s) => (s % 4 === 0 || s === 63 || s === 6 ? { active: true, notes: [60], velocity: 112, gate: 40 } : { active: false }));
    const l = linieAusNoten([{ tick: 0, dauer: 240, note: 60, velocity: 100, kanal: 0 }, { tick: 6 * 120, dauer: 120, note: 62, velocity: 100, kanal: 0 }], 480);
    const k = kickAnMelo(figur, l);
    expect(k[0].velocity).toBe(127);
    expect(k[4].velocity).toBe(112);
    expect(k[6].active).toBe(false); // Melodie setzt dort neu an
    expect(k[63].active).toBe(true);
    expect(k.filter((s) => s.active).length).toBe(figur.filter((s) => s.active).length - 1);
  });

  it("meloAlsSmf → smfBytes → parseSmf: die Noten ueberleben die Datei", () => {
    const lied = meloAlsSmf(noten, BPM, "Melo");
    const bytes = smfBytes(lied);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("MThd");
    const zurueck = parseSmf(bytes);
    expect(zurueck.ticksProViertel).toBe(480);
    expect(Math.round(zurueck.bpm)).toBe(BPM);
    const n = zurueck.spuren.flatMap((s) => s.noten);
    expect(n.length).toBe(noten.length);
    expect(n.map((x) => x.note).slice(0, 4)).toEqual(noten.map((x) => x.note).slice(0, 4));
    expect(n[1].tick).toBe(noten[1].tick);
  });
});
