import { describe, it, expect } from "vitest";
import { waehleVolumes, planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { bauePaare } from "../src/core/patternGen";
import type { ScanEintrag } from "../src/core/sampleScan";

const SR = 44100;
const BPM = 204;
const takt = (240 / BPM) * SR;
const kick = (seed: number): Float32Array => new Float32Array(15000).map((_, i) => 0.9 * Math.sin((2 * Math.PI * (55 + seed) * i) / SR) * Math.exp(-i / 3000));
const loop = (hz: number, takte: number): Float32Array => new Float32Array(Math.round(takte * takt)).map((_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR));
const eintrag = (name: string, rolle: ScanEintrag["rolle"], pcm: Float32Array, lied?: string): ScanEintrag =>
  ({ datei: `${name}.wav`, stem: name, rolle, familie: name.toLowerCase().replace(/\s*\d+$/, ""), sekunden: pcm.length / SR, rmsDb: -10, peak: 0.9, pcm, sampleRate: SR, ...(lied ? { lied } : {}) }) as ScanEintrag;

/** Ordner (Drums) plus Lied (viele Vocal-Segmente und Melodie-Fenster) — mehr Sekunden als das Budget. */
function ordnerPlusLied(): ScanEintrag[] {
  const drums = [
    eintrag("HommO KicK 1", "kick", kick(0)),
    eintrag("HommO KicK 2", "kick", kick(3)),
    eintrag("LuZz KicK 1", "kick", kick(6)),
    eintrag("snarre-p", "snare", kick(300)),
    eintrag("closed 8", "hat", kick(2000).subarray(0, 6000)),
    eintrag("707_hho", "hat", kick(1800).subarray(0, 9000)),
    eintrag("clydesna", "clap", kick(500)),
    eintrag("Unison_Bass_C3", "bass", loop(65, 1).subarray(0, 50000)),
  ];
  // die eigene Bibliothek bringt viele Melodie-Schleifen mit — die stehen in der Rangliste ueber jedem One-Shot
  for (let i = 1; i <= 20; i++) drums.push(eintrag(`Bibliothek MeLo ${i}`, "melo", loop(200 + i * 11, 4)));
  const lied: ScanEintrag[] = [];
  for (let i = 1; i <= 14; i++) lied.push(eintrag(`Geraet V${String(i).padStart(2, "0")}`, "vox", loop(220 + i * 7, 8), "Geraet"));
  for (const f of ["DROP", "BREAK", "VAR"]) lied.push(eintrag(`Geraet ${f}`, "melo", loop(330, 8), "Geraet"));
  return [...drums, ...lied];
}

describe("Budget: Schlagzeug bleibt in der ersten Scheibe", () => {
  const alle = ordnerPlusLied();
  const sekunden = alle.reduce((s, e) => s + e.sekunden, 0);

  it("die Eintraege sprengen das Budget — trotzdem liegen alle One-Shots in Scheibe 1", () => {
    const budget = 90;
    expect(sekunden).toBeGreaterThan(budget);
    const vol = waehleVolumes(alle, BPM, budget);
    expect(vol.length).toBeGreaterThan(1);
    const erste = new Set(vol[0].map((e) => e.stem));
    for (const n of ["HommO KicK 1", "HommO KicK 2", "LuZz KicK 1", "snarre-p", "closed 8", "707_hho", "clydesna", "Unison_Bass_C3"]) expect(erste.has(n), n).toBe(true);
    // und die Melodie ist auch da
    expect(vol[0].some((e) => e.rolle === "melo")).toBe(true);
    expect(vol.flat().length).toBe(alle.length);
  });

  it("die Patterns daraus haben Kick, Snare, Hats und Bass wach — nicht nur drei Parts", () => {
    const { projekt } = planeBank(alle, { name: "t", bpm: BPM, bankZeit: "x", budgetSekunden: 90, rateNachRolloff: false });
    expect(projekt.samples.some((s) => s.rolle === "kick")).toBe(true);
    const rezept = regelRezept(projekt, { modus: "jam", bpm: BPM });
    const { patterns } = bauePaare(rezept, projekt, { variation: false });
    const a = patterns[0];
    const wach = a.parts.map((p, i) => (!p.muted && p.steps.some((s) => s.active) ? i + 1 : 0)).filter(Boolean);
    expect(wach).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 9, 13]));
    expect(wach.length).toBeGreaterThanOrEqual(8);
  });
});
