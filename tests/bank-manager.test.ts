import { describe, it, expect } from "vitest";
import { createPattern, type EditorProject, type PoolSample } from "../src/core/editorModel";
import { packeNummernNeu, tauscheNummern, sortiereBank, luecken } from "../src/core/bankManager";

function projekt(nummern: number[]): EditorProject {
  const p = createPattern("TEST");
  // Part 0 zeigt auf das erste, Part 1 auf das zweite Sample
  p.parts[0].sampleNumber = nummern[0];
  p.parts[1].sampleNumber = nummern[1];
  const samples: PoolSample[] = nummern.map((n, i) => ({
    number: n,
    name: `S${i}`,
    sampleRate: 44100,
    pcm: new Float32Array(100).fill((i + 1) / 10),
  }));
  return { version: 1, patterns: [p], samples };
}

describe("bankManager", () => {
  it("packeNummernNeu schließt Lücken und zieht die Parts mit", () => {
    const pr = projekt([501, 507, 512]);
    const bericht = packeNummernNeu(pr);
    expect(pr.samples.map((s) => s.number)).toEqual([501, 502, 503]);
    // Die Parts zeigen weiterhin auf DASSELBE Sample, nicht auf dieselbe Nummer
    expect(pr.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(pr.patterns[0].parts[1].sampleNumber).toBe(502);
    expect(bericht.verschoben).toBe(2);
    expect(bericht.aenderungen).toEqual([
      { von: 507, nach: 502 },
      { von: 512, nach: 503 },
    ]);
  });

  it("packeNummernNeu lässt eine schon dichte Bank unberührt", () => {
    const pr = projekt([501, 502, 503]);
    const b = packeNummernNeu(pr);
    expect(b.verschoben).toBe(0);
    expect(pr.samples.map((s) => s.number)).toEqual([501, 502, 503]);
  });

  it("tauscheNummern vertauscht zwei Samples samt Part-Verweisen", () => {
    const pr = projekt([501, 502, 503]);
    expect(tauscheNummern(pr, 501, 503)).toBe(true);
    const namen = [...pr.samples].sort((a, b) => a.number - b.number).map((s) => s.name);
    expect(namen).toEqual(["S2", "S1", "S0"]);
    // Part 0 zeigte auf S0 — das liegt jetzt auf 503
    expect(pr.patterns[0].parts[0].sampleNumber).toBe(503);
    expect(pr.patterns[0].parts[1].sampleNumber).toBe(502);
  });

  it("tauscheNummern lehnt unbekannte Nummern ab, statt still nichts zu tun", () => {
    const pr = projekt([501, 502]);
    expect(tauscheNummern(pr, 501, 999)).toBe(false);
    expect(pr.samples.map((s) => s.number)).toEqual([501, 502]);
  });

  it("sortiereBank ordnet nach Name und vergibt fortlaufende Nummern", () => {
    const pr = projekt([505, 501, 509]);
    pr.samples[0].name = "Zebra";
    pr.samples[1].name = "Alpha";
    pr.samples[2].name = "Mitte";
    sortiereBank(pr, "name");
    const nach = [...pr.samples].sort((a, b) => a.number - b.number);
    expect(nach.map((s) => s.name)).toEqual(["Alpha", "Mitte", "Zebra"]);
    expect(nach.map((s) => s.number)).toEqual([501, 502, 503]);
    // Part 0 zeigte auf "Zebra" (vorher 505) — das ist jetzt 503
    expect(pr.patterns[0].parts[0].sampleNumber).toBe(503);
  });

  it("sortiereBank nach Länge stellt kurze Samples nach vorn", () => {
    const pr = projekt([501, 502, 503]);
    pr.samples[0].pcm = new Float32Array(300);
    pr.samples[1].pcm = new Float32Array(100);
    pr.samples[2].pcm = new Float32Array(200);
    sortiereBank(pr, "laenge");
    const nach = [...pr.samples].sort((a, b) => a.number - b.number);
    expect(nach.map((s) => s.pcm.length)).toEqual([100, 200, 300]);
  });

  it("luecken nennt freie Nummern zwischen den belegten", () => {
    expect(luecken(projekt([501, 504, 505]))).toEqual([502, 503]);
    expect(luecken(projekt([501, 502]))).toEqual([]);
  });
});
