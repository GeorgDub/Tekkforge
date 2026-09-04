import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { liedZuSet, type StemErgebnis } from "../src/core/liedZuSet";

const TEKK = path.resolve("examples/e2s/tekk4.all");
const tekkDrums = fs.existsSync(TEKK) ? new Uint8Array(fs.readFileSync(TEKK)) : undefined;

/** Ein Lied bauen: Kick auf jeder Viertel, dazu ein Ton — reicht für die Analyse. */
function liedchen(sekunden = 40, bpm = 180, sr = 44100): Float32Array {
  const y = new Float32Array(Math.round(sekunden * sr));
  const beat = Math.round((60 / bpm) * sr);
  for (let i = 0; i < y.length; i++) y[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.25;
  for (let s = 0; s < y.length; s += beat) {
    for (let i = 0; i < 2000 && s + i < y.length; i++) {
      y[s + i] += Math.sin((2 * Math.PI * 55 * i) / sr) * 0.7 * (1 - i / 2000);
    }
  }
  return y;
}

/** Stem-Trennung vortäuschen: gibt zurück, was hineinkam. */
function stemsAttrappe(mitVox = true) {
  return (fenster: { id: string; pcm: Float32Array; nurVox: boolean }[]): StemErgebnis[] =>
    fenster.map((f) => ({
      id: f.id,
      melo: f.nurVox ? null : f.pcm,
      vox: mitVox ? f.pcm.slice(0, Math.min(f.pcm.length, 44100 * 2)) : null,
      drums: f.nurVox ? null : f.pcm,
    }));
}

describe("liedZuSet", () => {
  const pcm = liedchen();

  it("baut aus einem Lied eine Bank und eine Aufbau-Kette", () => {
    const set = liedZuSet(pcm, 44100, { name: "Testlied", kanaele: 1, tekkDrums });
    expect(set.projekt.samples.length).toBeGreaterThan(0);
    expect(set.patterns.length).toBeGreaterThan(1);
    expect(set.bank.byteLength).toBeGreaterThan(1000);
    expect(set.patterns.some((p) => p.name.endsWith("DROP"))).toBe(true);
  });

  it("wählt die Tempo-Oktave und legt das Tekk-Tempo fest", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, tekkDrums });
    expect(set.bpm).toBeCloseTo(set.gemessen * set.oktave, 0);
    expect(set.bpm).toBeGreaterThanOrEqual(140);
  });

  it("eine feste BPM-Angabe schlägt die Messung", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, bpm: 200, tekkDrums });
    expect(set.bpm).toBe(200);
    expect(set.patterns[0].bpm).toBe(200);
  });

  it("sagt es, wenn ohne Stems und ohne Drums gebaut wird", () => {
    // Genau die Falle, die im Stapellauf auffiel: aus dem Vollmix entstehen nur
    // Melodie-Fenster, und ohne tekk4 hat der Drop keine Kick.
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1 });
    expect(set.hinweise.join(" ")).toMatch(/kein Schlagzeug/i);
    expect(set.zaehler.drums).toBe(0);
    expect(set.zaehler.vox).toBe(0);
  });

  it("misst den Groove: gerades Lied bleibt gerade, spaete Offbeats geben Swing auf jedes Pattern", () => {
    const gerade = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, tekkDrums, bpm: 180 });
    expect(gerade.swing).toBe(0);
    expect(gerade.patterns.every((p) => !p.swing)).toBe(true);
    expect(gerade.hinweise.join(" ")).toMatch(/gerade/);
    // Lied mit Offbeat-Schlaegen, die ein Viertel Step spaet kommen
    const sr = 44100;
    const bpm = 180;
    const step = (60 / bpm / 4) * sr;
    const y = new Float32Array(Math.round(40 * sr));
    for (let i = 0; i < y.length; i++) y[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.2;
    for (let s = 0; s * step < y.length; s++) {
      if (s % 2 === 1 && s % 4 !== 3) continue; // Viertel und jeder zweite Offbeat
      const start = Math.round(s * step + (s % 2 === 1 ? step * 0.25 : 0));
      for (let i = 0; i < 1500 && start + i < y.length; i++) y[start + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * 0.8 * (1 - i / 1500);
    }
    const schwingt = liedZuSet(y, sr, { name: "S", kanaele: 1, tekkDrums, bpm, stems: stemsAttrappe(false) });
    expect(schwingt.swing).toBeGreaterThan(5);
    expect(schwingt.patterns.every((p) => p.swing === schwingt.swing)).toBe(true);
    expect(schwingt.groove?.laenge).toBe(16);
    // abschaltbar
    const aus = liedZuSet(y, sr, { name: "S", kanaele: 1, tekkDrums, bpm, groove: false });
    expect(aus.swing).toBe(0);
    expect(aus.groove).toBeUndefined();
  });

  it("mit tekk4 hat der Drop ein Schlagzeug", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, tekkDrums });
    const drop = set.patterns.find((p) => p.name.endsWith("DROP"))!;
    expect(drop.parts[0].muted).toBe(false);
    expect(drop.parts[0].steps.filter((s) => s.active).length).toBeGreaterThan(8);
  });

  it("mit Stem-Trennung entstehen eigene Drums und Vocals", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, stems: stemsAttrappe(true) });
    expect(set.zaehler.drums).toBeGreaterThan(0);
    expect(set.zaehler.vox).toBeGreaterThan(0);
    expect(set.projekt.samples.some((s) => s.rolle === "vox")).toBe(true);
    expect(set.projekt.samples.some((s) => s.rolle === "kick")).toBe(true);
  });

  it("ohne erkannte Vocals steht das im Hinweis", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, stems: stemsAttrappe(false) });
    expect(set.zaehler.vox).toBe(0);
    expect(set.hinweise.join(" ")).toMatch(/Vocals/i);
  });

  it("kann auch ein einzelnes Jam-Pattern statt der Kette", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", kanaele: 1, tekkDrums, aufbau: false });
    expect(set.patterns).toHaveLength(1);
  });

  it("die Sample-Namen bleiben im Geräte-Rahmen", () => {
    const set = liedZuSet(pcm, 44100, { name: "Ein sehr langer Liedname", kanaele: 1, stems: stemsAttrappe(true) });
    for (const s of set.projekt.samples) expect(s.name.length).toBeLessThanOrEqual(16);
  });
});

describe("liedZuSet: das Tempo der Samples und der Patterns muss dasselbe sein", () => {
  /**
   * Der Fehler, den der Nutzer am Gerät hörte (2026-08-26): "weder eine
   * richtige Melo noch Vocal drin". Die Fenster wurden auf 180 BPM gedehnt,
   * das Pattern lief aber mit 209,5 — also 16 % zu schnell und entsprechend
   * verstimmt. Vom Lied blieb nichts wiedererkennbar übrig.
   *
   * Die App macht es richtig: erst in einem Vorlauf das Tekk-Tempo bestimmen,
   * dann MIT diesem Ziel analysieren. Der Kern muss dasselbe tun.
   */
  it("die Fenster sind auf dasselbe Tempo gedehnt, mit dem die Patterns laufen", () => {
    const set = liedZuSet(liedchen(40, 105), 44100, { name: "T", kanaele: 1, tekkDrums });
    // Das Lied wurde mit 105 gemessen und auf 210 verdoppelt — die Samples
    // müssen für 210 gedehnt sein, nicht für 180.
    expect(set.bpm).toBeCloseTo(set.gemessen * set.oktave, 0);
    expect(set.patterns[0].bpm).toBe(set.bpm);
    expect(set.zielBpm, "die Analyse lief auf ein anderes Ziel als das Pattern").toBeCloseTo(set.bpm, 1);
  });

  it("auch bei fest vorgegebenem Tempo", () => {
    const set = liedZuSet(liedchen(40, 105), 44100, { name: "T", kanaele: 1, bpm: 200, tekkDrums });
    expect(set.zielBpm).toBeCloseTo(200, 1);
    expect(set.patterns[0].bpm).toBe(200);
  });

  it("ein Loop-Sample passt zur Taktlänge des Patterns", () => {
    // Vier Takte bei 210 BPM sind 4,57 s. Stimmt das Dehnziel nicht, weicht
    // die Länge sichtbar ab und der Loop läuft im Pattern aus dem Takt.
    const set = liedZuSet(liedchen(40, 105), 44100, { name: "T", kanaele: 1, tekkDrums });
    const takte = (s: { sekunden: number }) => (s.sekunden * set.bpm) / (60 * 4);
    for (const s of set.projekt.samples.filter((x) => x.kind === "loop")) {
      const t = takte(s);
      expect(Math.abs(t - Math.round(t)), `${s.name}: ${t.toFixed(2)} Takte`).toBeLessThan(0.08);
    }
  });
});

describe("liedZuSet: die Melodie darf nicht von den Vocals verdrängt werden", () => {
  /** Stem-Attrappe mit sehr vielen Vocal-Segmenten — wie ein vocal-lastiges Lied. */
  function vieleVox(fenster: { id: string; pcm: Float32Array; nurVox: boolean }[]): StemErgebnis[] {
    return fenster.map((f) => ({
      id: f.id,
      melo: f.nurVox ? null : f.pcm,
      vox: f.pcm,
      drums: f.nurVox ? null : f.pcm,
    }));
  }

  it("in der Bank steht mindestens eine Melodie", () => {
    // Der Fehler am Gerät (2026-08-26): das Amphegott-Set enthielt 44 Samples
    // — Drums und 53 Vocal-Schnipsel, aber KEINE einzige Melodie. Die drei
    // Fenster waren vom Budget in ein zweites Volume gedrängt worden, und
    // geschrieben wird nur das erste. Ohne Melodie ist kein Lied wiedererkennbar.
    const set = liedZuSet(liedchen(150, 105), 44100, { name: "Vokallastig", kanaele: 1, tekkDrums, stems: vieleVox });
    const melos = set.projekt.samples.filter((s) => s.rolle === "melo");
    expect(melos.length, `nur ${set.projekt.samples.map((s) => s.rolle).join(",")}`).toBeGreaterThan(0);
  });

  it("und die Vocals sind trotzdem noch dabei", () => {
    const set = liedZuSet(liedchen(150, 105), 44100, { name: "Vokallastig", kanaele: 1, tekkDrums, stems: vieleVox });
    expect(set.projekt.samples.some((s) => s.rolle === "vox")).toBe(true);
  });

  it("das Drop-Pattern hat eine Melodie auf den Melo-Parts", () => {
    const set = liedZuSet(liedchen(150, 105), 44100, { name: "Vokallastig", kanaele: 1, tekkDrums, stems: vieleVox });
    const drop = set.patterns.find((p) => p.name.endsWith("DROP"))!;
    expect(drop.parts[12].muted, "Part 13 (Melo) stumm — keine Melodie im Set").toBe(false);
  });
});

describe("liedZuSet: fremde Abtastraten", () => {
  /**
   * Am Gerät gehört (2026-08-26): das Lied war im Set nicht wiederzuerkennen.
   * Die Quelldateien laufen mit 48 kHz (Amphegott) und 96 kHz (Sturmmaske),
   * dieser Kern schrieb aber überall fest 44100 in die Einträge. Damit stimmte
   * die angegebene Dauer nicht mehr mit den Daten überein — Tonhöhe und Tempo
   * liefen auseinander, und vom Lied blieb nichts übrig.
   */
  for (const rate of [48000, 96000]) {
    it(`${rate} Hz ergibt taktgenaue Loops`, () => {
      const set = liedZuSet(liedchen(60, 105, rate), rate, { name: "Fremd", kanaele: 1, tekkDrums });
      expect(set.projekt.samples.length).toBeGreaterThan(0);
      for (const s of set.projekt.samples.filter((x) => x.kind === "loop")) {
        const takte = (s.sekunden * set.bpm) / 240;
        expect(Math.abs(takte - Math.round(takte)), `${s.name}: ${takte.toFixed(2)} Takte`).toBeLessThan(0.08);
      }
    });

    it(`${rate} Hz: die Samples sind auf 44,1 kHz gebracht`, () => {
      const set = liedZuSet(liedchen(60, 105, rate), rate, { name: "Fremd", kanaele: 1, tekkDrums });
      for (const s of set.projekt.samples) expect(s.sampleRate ?? 44100).toBe(44100);
    });
  }

  it("44,1 kHz bleibt unverändert", () => {
    const set = liedZuSet(liedchen(60, 105, 44100), 44100, { name: "Normal", kanaele: 1, tekkDrums });
    for (const s of set.projekt.samples.filter((x) => x.kind === "loop")) {
      const takte = (s.sekunden * set.bpm) / 240;
      expect(Math.abs(takte - Math.round(takte))).toBeLessThan(0.08);
    }
  });
});

describe("liedZuSet: Stereo-Quellen", () => {
  /** Verschränktes Stereo — genau das, was parseWav liefert. */
  function stereo(mono: Float32Array): Float32Array {
    const out = new Float32Array(mono.length * 2);
    for (let i = 0; i < mono.length; i++) {
      out[i * 2] = mono[i];
      out[i * 2 + 1] = mono[i];
    }
    return out;
  }

  it("Stereo klingt nicht halb so langsam wie Mono", () => {
    // Der Fehler am Gerät (2026-08-26): "die vocals sind zu langsam, das klingt
    // furchtbar". parseWav gibt VERSCHRÄNKTES Stereo zurück; als Mono
    // weitergereicht ist das Feld doppelt so lang, also spielt alles halb so
    // schnell — und die abwechselnden Kanäle klingen obendrein zerhackt.
    const mono = liedchen(60, 105);
    const a = liedZuSet(mono, 44100, { name: "M", kanaele: 1, tekkDrums });
    const b = liedZuSet(stereo(mono), 44100, { name: "S", kanaele: 2, tekkDrums });
    expect(b.bpm).toBeCloseTo(a.bpm, 0);
    const laenge = (s: typeof a) => s.projekt.samples.filter((x) => x.kind === "loop")[0]?.sekunden ?? 0;
    expect(laenge(b)).toBeCloseTo(laenge(a), 1);
  });

  it("Stereo ergibt taktgenaue Loops", () => {
    const set = liedZuSet(stereo(liedchen(60, 105)), 44100, { name: "S", kanaele: 2, tekkDrums });
    for (const s of set.projekt.samples.filter((x) => x.kind === "loop")) {
      const takte = (s.sekunden * set.bpm) / 240;
      expect(Math.abs(takte - Math.round(takte)), `${s.name}: ${takte.toFixed(2)} Takte`).toBeLessThan(0.08);
    }
  });

  it("Stereo mit 48 kHz — beides zusammen", () => {
    const set = liedZuSet(stereo(liedchen(60, 105, 48000)), 48000, { name: "S48", kanaele: 2, tekkDrums });
    for (const s of set.projekt.samples.filter((x) => x.kind === "loop")) {
      const takte = (s.sekunden * set.bpm) / 240;
      expect(Math.abs(takte - Math.round(takte)), `${s.name}: ${takte.toFixed(2)} Takte`).toBeLessThan(0.08);
    }
  });
});
