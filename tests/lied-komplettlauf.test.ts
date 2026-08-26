/**
 * Kompletter Lauf: Lied rein, Tekk-Set raus.
 *
 * Nimmt jede WAV aus `examples/lieder/` (oder aus dem Ordner in LIED_DIR) und
 * fährt denselben Weg wie der Ein-Klick-Knopf im Generator: Tempo und
 * Abschnitte messen → Fenster und Vocal-Segmente schneiden → Bank planen →
 * Rezept → Aufbau-Kette → Audio ausrechnen. Danach wird geprüft, ob dabei
 * etwas herauskommt, das den Tekk-Regeln entspricht.
 *
 * Ohne Dateien überspringt sich die Datei selbst — sie liegt hier, damit ein
 * neues Lied nur noch hineingelegt werden muss.
 *
 * Nicht enthalten: die Stem-Trennung mit Demucs. Die läuft über Python und die
 * Electron-Brücke; hier wird der Vollmix-Weg gefahren und das Schlagzeug kommt
 * aus `examples/e2s/tekk4.all` — genau das, was die App anbietet, wenn Demucs
 * fehlt. Ohne die Drums hätte ein Lied gar keine Kick, denn aus dem Vollmix
 * entstehen nur Melodie- und Vocal-Fenster.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { analysiereLied } from "../src/core/liedAnalyse";
import { voxSegmentEintrag } from "../src/core/generatorSession";
import { rmsDb, peakVon, familie, type ScanEintrag } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { baueAufbau, alsAllPat, voxPaare } from "../src/core/patternGen";
import { editorProjectFromE2Files, type PoolSample } from "../src/core/editorModel";
import { rendere } from "../src/core/patternRender";

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
/** Längste Spieldauer, die noch mitläuft — darüber ist es ein DJ-Set, kein Lied. */
const MAX_MINUTEN = Number(process.env.LIED_MAX_MIN ?? 15);

/**
 * Spieldauer aus dem WAV-Kopf, OHNE die Datei zu laden.
 *
 * Ein 40-Minuten-Set sind als Float32 rund 400 MB im Speicher. Erst laden und
 * dann feststellen, dass es zu groß ist, bringt den Lauf um — also vorher in
 * den Kopf schauen.
 */
function dauerMinuten(datei: string): number {
  let fd: number | null = null;
  try {
    fd = fs.openSync(datei, "r");
    const kopf = Buffer.alloc(64);
    fs.readSync(fd, kopf, 0, 64, 0);
    const byteRate = kopf.readUInt32LE(28);
    return byteRate > 0 ? (fs.statSync(datei).size - 44) / byteRate / 60 : 0;
  } catch {
    return 0;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const kandidaten = wavs
  .map((f) => ({ datei: f, minuten: dauerMinuten(path.join(LIED_DIR, f)) }))
  .sort((a, b) => a.datei.localeCompare(b.datei));
const zuLang = kandidaten.filter((k) => k.minuten > MAX_MINUTEN);
const laufende = kandidaten.filter((k) => k.minuten <= MAX_MINUTEN);

function eintragAus(lied: string, label: string, pcm: Float32Array): ScanEintrag {
  const stem = `${lied} ${label}`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle: "melo",
    familie: familie(stem),
    sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm),
    peak: peakVon(pcm),
    pcm,
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

function baueSatz(datei: string) {
  const roh = parseWav(new Uint8Array(fs.readFileSync(path.join(LIED_DIR, datei))));
  const name = datei.replace(AUDIO, "");
  const analyse = analysiereLied(roh.pcm, roh.sampleRate, { zielBpm: 180 });
  const eintraege: ScanEintrag[] = [
    ...analyse.fenster.map((f) => eintragAus(name, f.label, f.pcm)),
    ...(analyse.segmente ?? []).map((s, i) => voxSegmentEintrag(name, i + 1, s.pcm)),
  ];
  // Das Tekk-Tempo ist das gemessene MAL der gewählten Oktave: ein Lied mit
  // 80 gemessenen BPM wird als 160er Tekk gefahren, nicht als 80er.
  const tekkBpm = Math.round(analyse.bpm * analyse.k * 10) / 10;
  const { projekt, bank, warnungen } = planeBank(eintraege, {
    name: name.slice(0, 12),
    bpm: tekkBpm,
    bankZeit: "test",
    tekkDrumsBank: TEKK_DRUMS,
  });
  const rezept = regelRezept(projekt, { modus: "jam", bpm: tekkBpm });
  const { patterns, hinweise } = baueAufbau(rezept, projekt);
  const ep = editorProjectFromE2Files(new Uint8Array(alsAllPat(patterns)), new Uint8Array(bank));
  return {
    analyse: { bpm: analyse.bpm, k: analyse.k, fenster: analyse.fenster.length },
    tekkBpm,
    projekt,
    rezept,
    patterns,
    hinweise,
    warnungen,
    ep,
    dropIdx: patterns.findIndex((p) => p.name.endsWith("DROP")),
  };
}

/**
 * Ein-Platz-Zwischenspeicher: es liegt immer nur EIN Lied im Speicher.
 * Die Prüfungen eines Lieds laufen nacheinander, also trifft der Speicher;
 * das nächste Lied verdrängt das vorige und gibt dessen Daten frei.
 */
let gemerkt: { datei: string; wert: ReturnType<typeof baueSatz> } | null = null;
function satz(datei: string): ReturnType<typeof baueSatz> {
  if (gemerkt?.datei !== datei) {
    gemerkt = null;
    gemerkt = { datei, wert: baueSatz(datei) };
  }
  return gemerkt.wert;
}

function pegel(s: ReturnType<typeof baueSatz>, i: number): number {
  const r = rendere(s.ep.patterns[i], s.ep.samples as PoolSample[], { ausklang: 0 });
  let summe = 0;
  for (const v of r.pcm) summe += v * v;
  return Math.sqrt(summe / r.pcm.length);
}

(laufende.length ? describe : describe.skip)("Kompletter Lauf aus echten Liedern", () => {
  for (const { datei, minuten } of laufende) {
    describe(`${datei} (${minuten.toFixed(1)} min)`, () => {
      it("das Tempo landet im Tekk-Bereich", () => {
        const s = satz(datei);
        expect(s.tekkBpm, `gemessen ${s.analyse.bpm.toFixed(1)} ×${s.analyse.k}`).toBeGreaterThanOrEqual(TEKK_BPM_MIN);
        expect(s.tekkBpm).toBeLessThanOrEqual(TEKK_BPM_MAX);
      });

      it("es entstehen Fenster und eine Bank, die ins Sample-RAM passt", () => {
        const s = satz(datei);
        expect(s.analyse.fenster).toBeGreaterThan(0);
        expect(s.projekt.samples.length).toBeGreaterThan(0);
        const mb = s.projekt.samples.reduce((a, x) => a + x.sekunden * 44100 * 2, 0) / (1024 * 1024);
        // Über 24 MB muss planeBank auf mehrere Volumes aufteilen und das sagen.
        if (mb > 24) expect(s.warnungen.join(" ") + s.hinweise.join(" ")).toMatch(/Volume|RAM|zu viel/i);
        else expect(mb).toBeLessThanOrEqual(24);
      });

      it("die Aufbau-Kette wächst bis zum Drop und schließt sauber", () => {
        const s = satz(datei);
        expect(s.dropIdx).toBeGreaterThan(0);
        const hoerbar = (p: (typeof s.patterns)[0]) => p.parts.filter((x) => !x.muted).length;
        for (let i = 1; i <= s.dropIdx; i++)
          expect(hoerbar(s.patterns[i])).toBeGreaterThanOrEqual(hoerbar(s.patterns[i - 1]));
        expect(hoerbar(s.patterns[s.dropIdx])).toBeGreaterThan(hoerbar(s.patterns[0]));
        s.patterns.slice(0, -1).forEach((p, i) => expect(p.chainTo).toBe(i + 2));
        expect(s.patterns[s.patterns.length - 1].chainTo).toBe(0);
      });

      it("die Kick läuft und wiederholt sich nicht vier Takte lang", () => {
        const s = satz(datei);
        const drop = s.patterns[s.dropIdx];
        expect(drop.parts[0].muted, "Drop ohne Kick — fehlen die tekk4-Drums?").toBe(false);
        expect(drop.parts[0].steps.filter((x) => x.active).length).toBeGreaterThanOrEqual(12);
        const zeilen = [0, 1, 2, 3].map((t) =>
          Array.from({ length: 16 }, (_, i) => (drop.parts[0].steps[t * 16 + i]?.active ? "x" : ".")).join(""),
        );
        expect(new Set(zeilen).size).toBeGreaterThanOrEqual(2);
      });

      it("das Pattern lässt Luft — es liegt nicht auf jedem Sechzehntel etwas", () => {
        const s = satz(datei);
        const drop = s.patterns[s.dropIdx];
        let leer = 0;
        for (let i = 0; i < 64; i++) if (!drop.parts.slice(0, 9).some((p) => p.steps[i]?.active)) leer++;
        expect(leer).toBeGreaterThanOrEqual(8);
      });

      it("die Vocalspur des Lieds wird über die Kette verteilt", () => {
        const s = satz(datei);
        const paare = voxPaare(s.projekt, s.rezept.thema.melo ?? s.rezept.thema.vers);
        if (!paare.length) return; // instrumentales Lied — nichts zu verteilen
        const getragen = new Set(
          s.patterns.map((p) => p.parts[14].sampleId).filter((id): id is number => typeof id === "number" && id > 0),
        );
        expect(getragen.size).toBeGreaterThanOrEqual(Math.min(paare.length, s.patterns.length));
      });

      it("gerendert baut es auf und übersteuert nicht", () => {
        const s = satz(datei);
        expect(pegel(s, s.dropIdx)).toBeGreaterThan(pegel(s, 0));
        for (const i of [0, s.dropIdx]) {
          const r = rendere(s.ep.patterns[i], s.ep.samples as PoolSample[], { ausklang: 0 });
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
    if (!dateien.length) {
      console.log(`Keine Lieder in ${LIED_DIR} — Dateien dorthin legen (WAV wird direkt gelesen).`);
    } else {
      const andere = dateien.filter((f) => !/\.wav$/i.test(f));
      console.log(`${laufende.length} Lied(er) im Lauf.`);
      if (zuLang.length)
        console.log(
          `Übersprungen, länger als ${MAX_MINUTEN} min (DJ-Sets): ${zuLang.map((k) => `${k.datei} (${k.minuten.toFixed(0)} min)`).join(", ")}`,
        );
      if (andere.length) console.log(`Übersprungen, kein WAV: ${andere.join(", ")}`);
    }
    expect(true).toBe(true);
  });
});
