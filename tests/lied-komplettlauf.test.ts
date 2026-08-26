/**
 * Kompletter Lauf: Lied rein, Tekk-Set raus.
 *
 * Nimmt jede Audiodatei aus `examples/lieder/` (oder aus dem Ordner in der
 * Umgebungsvariablen LIED_DIR) und fährt denselben Weg wie der Ein-Klick-Knopf
 * im Generator: Tempo und Abschnitte messen → Fenster und Vocal-Segmente
 * schneiden → Bank planen → Rezept → Aufbau-Kette → Audio ausrechnen. Danach
 * wird geprüft, ob dabei etwas herauskommt, das den Tekk-Regeln entspricht.
 *
 * Ohne Dateien überspringt sich die Datei selbst — sie liegt hier, damit ein
 * neues Lied nur noch hineingelegt werden muss.
 *
 * Nicht enthalten: die Stem-Trennung mit Demucs. Die läuft über Python und die
 * Electron-Brücke; hier wird der Vollmix-Weg gefahren, den die App genauso
 * anbietet, wenn Demucs fehlt. Alles danach ist identisch.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { analysiereLied } from "../src/core/liedAnalyse";
import { voxSegmentEintrag } from "../src/core/generatorSession";
import { rmsDb, peakVon, familie } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { baueAufbau, alsAllPat, voxPaare } from "../src/core/patternGen";
import { editorProjectFromE2Files, type PoolSample } from "../src/core/editorModel";
import { rendere } from "../src/core/patternRender";
import type { ScanEintrag } from "../src/core/sampleScan";

const LIED_DIR = process.env.LIED_DIR ?? path.resolve("examples/lieder");
const AUDIO = /\.(wav|mp3|m4a|flac|ogg)$/i;
const dateien = fs.existsSync(LIED_DIR) ? fs.readdirSync(LIED_DIR).filter((f) => AUDIO.test(f)) : [];

/** Nur WAV lässt sich hier ohne ffmpeg lesen — alles andere braucht die App. */
const wavs = dateien.filter((f) => /\.wav$/i.test(f));

/** tekk4-Drum-Bank: ohne sie hat ein Lied ohne Stem-Trennung kein Schlagzeug. */
const TEKK_DRUMS_PFAD = path.resolve("examples/e2s/tekk4.all");
const TEKK_DRUMS = fs.existsSync(TEKK_DRUMS_PFAD) ? new Uint8Array(fs.readFileSync(TEKK_DRUMS_PFAD)) : undefined;

/** Tekk-Tempobereich: darunter ist es Techno, darüber Uptempo/Speedcore. */
const TEKK_BPM_MIN = 140;
const TEKK_BPM_MAX = 260;

function eintragAus(lied: string, label: string, pcm: Float32Array, rolle: "melo" | "vox"): ScanEintrag {
  const stem = `${lied} ${label}`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle,
    familie: familie(stem),
    sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm),
    peak: peakVon(pcm),
    pcm,
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

(wavs.length ? describe : describe.skip)("Kompletter Lauf aus echten Liedern", () => {
  for (const datei of wavs) {
    describe(datei, () => {
      const roh = parseWav(new Uint8Array(fs.readFileSync(path.join(LIED_DIR, datei))));
      const name = datei.replace(AUDIO, "");
      const analyse = analysiereLied(roh.pcm, roh.sampleRate, { zielBpm: 180 });

      const eintraege: ScanEintrag[] = [
        ...analyse.fenster.map((f) => eintragAus(name, f.label, f.pcm, "melo")),
        ...(analyse.segmente ?? []).map((s, i) => voxSegmentEintrag(name, i + 1, s.pcm)),
      ];
      // Das Tekk-Tempo ist das gemessene MAL der gewaehlten Oktave: ein Lied mit
      // 80 gemessenen BPM wird als 160er Tekk gefahren, nicht als 80er.
      const tekkBpm = Math.round(analyse.bpm * analyse.k * 10) / 10;
      // Ohne Stem-Trennung bringt ein Lied nur Melodie und Vocals mit — keine
      // einzige Kick. Die App bietet dafuer die tekk4-Drums an und empfiehlt sie,
      // sobald Drums fehlen; ohne sie haette der Drop kein Schlagzeug.
      const { projekt, bank, warnungen } = planeBank(eintraege, {
        name: name.slice(0, 12),
        bpm: tekkBpm,
        bankZeit: "test",
        tekkDrumsBank: TEKK_DRUMS,
      });
      const rezept = regelRezept(projekt, { modus: "jam", bpm: tekkBpm });
      const { patterns, hinweise } = baueAufbau(rezept, projekt);
      const ep = editorProjectFromE2Files(new Uint8Array(alsAllPat(patterns)), new Uint8Array(bank));
      const dropIdx = patterns.findIndex((p) => p.name.endsWith("DROP"));

      it("das Tempo landet im Tekk-Bereich", () => {
        // Die Analyse waehlt die Oktave — ein Lied mit gemessenen 80 BPM soll
        // als 160er Tekk herauskommen, nicht als 80er.
        expect(tekkBpm, `gemessen ${analyse.bpm} ×${analyse.k}`).toBeGreaterThanOrEqual(TEKK_BPM_MIN);
        expect(tekkBpm).toBeLessThanOrEqual(TEKK_BPM_MAX);
      });

      it("es entstehen Fenster und eine Bank, die ins Sample-RAM passt", () => {
        expect(analyse.fenster.length).toBeGreaterThan(0);
        expect(projekt.samples.length).toBeGreaterThan(0);
        const mb = projekt.samples.reduce((a, s) => a + s.sekunden * 44100 * 2, 0) / (1024 * 1024);
        // Über 24 MB muss planeBank auf mehrere Volumes aufteilen und das sagen.
        if (mb > 24) expect(warnungen.join(" ") + hinweise.join(" ")).toMatch(/Volume|RAM|zu viel/i);
        else expect(mb).toBeLessThanOrEqual(24);
      });

      it("die Aufbau-Kette wächst bis zum Drop und hört dort auf oder geht weiter", () => {
        expect(dropIdx).toBeGreaterThan(0);
        const hoerbar = (p: (typeof patterns)[0]) => p.parts.filter((x) => !x.muted).length;
        for (let i = 1; i <= dropIdx; i++) expect(hoerbar(patterns[i])).toBeGreaterThanOrEqual(hoerbar(patterns[i - 1]));
        expect(hoerbar(patterns[dropIdx])).toBeGreaterThan(hoerbar(patterns[0]));
        // Kette schließt: jedes Pattern zeigt aufs nächste, das letzte auf 0.
        patterns.slice(0, -1).forEach((p, i) => expect(p.chainTo).toBe(i + 2));
        expect(patterns[patterns.length - 1].chainTo).toBe(0);
      });

      it("die Kick läuft durch und wiederholt sich nicht vier Takte lang", () => {
        const drop = patterns[dropIdx];
        expect(drop.parts[0].muted).toBe(false);
        expect(drop.parts[0].steps.filter((s) => s.active).length).toBeGreaterThanOrEqual(12);
        const zeilen = [0, 1, 2, 3].map((t) =>
          Array.from({ length: 16 }, (_, i) => (drop.parts[0].steps[t * 16 + i]?.active ? "x" : ".")).join(""),
        );
        expect(new Set(zeilen).size).toBeGreaterThanOrEqual(2);
      });

      it("das Pattern lässt Luft — es liegt nicht auf jedem Sechzehntel etwas", () => {
        const drop = patterns[dropIdx];
        let leer = 0;
        for (let s = 0; s < 64; s++) if (!drop.parts.slice(0, 9).some((p) => p.steps[s]?.active)) leer++;
        expect(leer).toBeGreaterThanOrEqual(8);
      });

      it("die Vocalspur des Lieds wird über die Kette verteilt", () => {
        const paare = voxPaare(projekt, rezept.thema.melo ?? rezept.thema.vers);
        if (!paare.length) return; // instrumentales Lied — nichts zu verteilen
        const getragen = new Set(
          patterns.map((p) => p.parts[14].sampleId).filter((id): id is number => typeof id === "number" && id > 0),
        );
        // Jedes Vocal-Paar muss irgendwo in der Kette hörbar sein, sonst hat man
        // das Lied nicht komplett gehört (ausdrückliche Vorgabe).
        expect(getragen.size).toBeGreaterThanOrEqual(Math.min(paare.length, patterns.length));
      });

      it("gerendert ist der Drop lauter als die erste Aufbau-Stufe", () => {
        const pegel = (i: number) => {
          const r = rendere(ep.patterns[i], ep.samples as PoolSample[], { ausklang: 0 });
          let summe = 0;
          for (const v of r.pcm) summe += v * v;
          return Math.sqrt(summe / r.pcm.length);
        };
        expect(pegel(dropIdx)).toBeGreaterThan(pegel(0));
      });

      it("nichts im Set übersteuert", () => {
        for (const i of [0, dropIdx]) {
          const r = rendere(ep.patterns[i], ep.samples as PoolSample[], { ausklang: 0 });
          let spitze = 0;
          for (const v of r.pcm) spitze = Math.max(spitze, Math.abs(v));
          expect(spitze).toBeLessThanOrEqual(1);
        }
      });
    });
  }
});

describe("Lied-Ordner", () => {
  it("sagt, was er gefunden hat", () => {
    // Kein Fehlschlag ohne Dateien — dieser Test ist der Wegweiser.
    if (!dateien.length) {
      console.log(`Keine Lieder in ${LIED_DIR} — Dateien dorthin legen (WAV wird direkt gelesen).`);
    } else {
      const andere = dateien.filter((f) => !/\.wav$/i.test(f));
      console.log(`${wavs.length} WAV(s) im Lauf${andere.length ? `, übersprungen (kein WAV): ${andere.join(", ")}` : ""}`);
    }
    expect(true).toBe(true);
  });
});
