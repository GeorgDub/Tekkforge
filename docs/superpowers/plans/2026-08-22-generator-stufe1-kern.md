# Generator Stufe 1 — Kernmodule + Regel-Planer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reine TypeScript-Module in `src/core/`, die aus dekodierten Samples eines Verzeichnisses ein Projekt (Sample-Bank `.all` + Projekt-Daten) und daraus per Regel-Planer Jam-Pattern / Mini-Set / Pro Melo als `E2PatternInput[]` bauen — ohne GUI, ohne KI, mit Tests und einer kleinen CLI zum Ausprobieren.

**Architecture:** Fünf Module mit klaren Grenzen: `tempoAnalyse` (reine Zahlen), `sampleScan` (Rollen/Familien/Dubletten auf dekodierten Puffern), `bankPlan` (Budget, Loops ganz, Varispeed, Bank-Slots, Projekt-JSON), `rezept` (Typen, Prüfung, Regel-Planer), `patternGen` (Rezept → Patterns). Dekodierung liefert der Aufrufer (Tests/CLI: `parseWav`; später Renderer: Web Audio). Bestehende Bausteine werden benutzt, nicht kopiert: `polyPhaseResample`, `peakNormalize`, `buildE2sBank`, `parseE2sBank`, `e2sPatternSampleLink`, `buildE2AllPatFile`/`buildE2PatternBody`.

**Tech Stack:** TypeScript (strict), Vitest, Node ≥ 20; Skripte per `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-22-generator-design.md`

## Global Constraints

- Samples im Projekt: mono, 44 100 Hz, Peak-normalisiert auf 0,95.
- Melodien bleiben ganz: ≤ 8 Takte ein Sample; länger → genau zwei Hälften A/B. Nie 4-Takt-Chunks.
- Nummerierung: eigene Samples ab 501; wenn tekk4-Drums dazukommen, liegen die auf ihren Originalnummern (501–535) und eigene ab 601. Anzeige = OSC + 1 (`e2sPatternSampleLink`).
- RAM-Budget: `E2S_DEVICE_PCM_WARN_BYTES` (24 MiB) → Standard-Budget 235 s mono.
- Parts ohne Steps werden gemutet; Tempo nie auf dem Vorgabewert (Rezept setzt BPM immer explizit).
- Pattern-Namen ≤ 16 ASCII-Zeichen, Sample-Namen ≤ 16.
- Alle Kommentare/Meldungen deutsch (Repo-Konvention), keine Umlaute in Code-Strings nötig.
- Tests: `pnpm test` muss grün bleiben (`npx vitest run <datei>` für einzelne).

---

## Dateiplan

| Datei | Verantwortung |
|---|---|
| `src/core/tempoAnalyse.ts` | Onset-Kurve, Takt-Autokorrelation, Takt-Passung, Tempo-Vorschlag |
| `src/core/sampleScan.ts` | Rollen-/Familien-Heuristik, Namen säubern, Dubletten, Scan-Einträge |
| `src/core/bankPlan.ts` | Budget/Volumes, Sample-Aufbereitung (Trim/Normalize/Fades/Varispeed/Hälften), Bank-Slots, `Projekt` |
| `src/core/rezept.ts` | Rezept-Typen, `pruefeRezept`, Regel-Planer `regelRezept` |
| `src/core/patternGen.ts` | Figuren-Bibliothek, `baueRezept` → `E2PatternInput[]` |
| `scripts/generator-cli.mjs` | Verzeichnis → Projekt (`.all` + `projekt.json`) → Patterns (`.e2spat`/`.e2sallpat`) |
| `tests/generator-tempo.test.ts`, `tests/generator-scan.test.ts`, `tests/generator-bank.test.ts`, `tests/generator-rezept.test.ts`, `tests/generator-pattern.test.ts` | je Modul |

Fixtures: die mono-44,1k-WAVs in `examples/e2s/korg3/` (42 Dateien, im Repo) und `examples/e2s/korg3/manifest.json` (Rollen-Erwartung aus der Python-Heuristik).

---

### Task 1: tempoAnalyse — Takt-Passung und Tempo-Vorschlag

**Files:**
- Create: `src/core/tempoAnalyse.ts`
- Test: `tests/generator-tempo.test.ts`

**Interfaces:**
- Produces:
  - `taktPassung(sekunden: number, bpm: number): { takte: number; abweichung: number }` — nächste ganze Taktzahl 1..16 und relative Abweichung (0 = exakt).
  - `onsetKurve(pcm: Float32Array, sampleRate: number, hop?: number): Float32Array` — halbwellen-gleichgerichtete Energie-Differenz je Hop (Standard 256 Samples).
  - `tempoSchaetzen(pcm: Float32Array, sampleRate: number, min?: number, max?: number): number` — BPM aus Takt-Autokorrelation (0,25er-Raster, Standard 80–200).
  - `tempoVorschlag(dauern: number[], kandidaten?: number[]): number` — BPM, bei dem die meisten Dauern taktgenau (≤ 3 %) sind; Kandidaten Standard 150–200 in 1er-Schritten, bei Gleichstand 180.

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-tempo.test.ts
import { describe, it, expect } from "vitest";
import { taktPassung, tempoSchaetzen, tempoVorschlag, onsetKurve } from "../src/core/tempoAnalyse";

function klickspur(bpm: number, sekunden: number, sr = 22050): Float32Array {
  const out = new Float32Array(Math.round(sekunden * sr));
  const beat = Math.round((60 / bpm) * sr);
  for (let i = 0; i < out.length; i += beat) {
    for (let k = 0; k < 200 && i + k < out.length; k++) out[i + k] = (1 - k / 200) * (i % (4 * beat) === 0 ? 1 : 0.5);
  }
  return out;
}

describe("tempoAnalyse", () => {
  it("taktPassung: 5.333 s bei 180 BPM sind exakt 4 Takte", () => {
    const p = taktPassung(5.3333, 180);
    expect(p.takte).toBe(4);
    expect(p.abweichung).toBeLessThan(0.001);
  });
  it("taktPassung: 10.67 s bei 180 sind 8 Takte, 5.86 s sind 4 Takte mit ~10 % Abweichung", () => {
    expect(taktPassung(10.67, 180).takte).toBe(8);
    const p = taktPassung(5.86, 180);
    expect(p.takte).toBe(4);
    expect(p.abweichung).toBeGreaterThan(0.09);
    expect(p.abweichung).toBeLessThan(0.11);
  });
  it("onsetKurve hat einen Wert je Hop", () => {
    const y = klickspur(180, 2);
    expect(onsetKurve(y, 22050, 256).length).toBe(Math.floor(y.length / 256));
  });
  it("tempoSchaetzen findet 180 auf einer Klickspur (±1)", () => {
    expect(Math.abs(tempoSchaetzen(klickspur(180, 12), 22050) - 180)).toBeLessThanOrEqual(1);
  });
  it("tempoSchaetzen findet 95 oder 190 auf einer 95er-Spur", () => {
    const t = tempoSchaetzen(klickspur(95, 16), 22050);
    expect([95, 190].some((k) => Math.abs(t - k) <= 1)).toBe(true);
  });
  it("tempoVorschlag: lauter 5.333-s-Loops → 180", () => {
    expect(tempoVorschlag([5.333, 10.667, 5.333, 2.667])).toBe(180);
  });
  it("tempoVorschlag: 5.486-s-Loops → 175", () => {
    expect(tempoVorschlag([5.486, 5.486, 10.971])).toBe(175);
  });
  it("tempoVorschlag ohne Treffer → 180", () => {
    expect(tempoVorschlag([0.3, 0.2])).toBe(180);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-tempo.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/tempoAnalyse.ts
/**
 * tempoAnalyse — Takt-Passung, Onset-Kurve, Tempo-Schaetzung per
 * Takt-Autokorrelation und Tempo-Vorschlag fuer ein Verzeichnis.
 * Reine Zahlen, keine Dekodierung, kein DOM.
 */

/** Naechste ganze Taktzahl (1..16) fuer eine Dauer bei `bpm` und die relative Abweichung. */
export function taktPassung(sekunden: number, bpm: number): { takte: number; abweichung: number } {
  const taktSek = 240 / bpm;
  const roh = sekunden / taktSek;
  const takte = Math.min(16, Math.max(1, Math.round(roh)));
  return { takte, abweichung: Math.abs(roh - takte) / takte };
}

/** Halbwellen-gleichgerichtete Energie-Differenz je Hop (einfache Onset-Staerke). */
export function onsetKurve(pcm: Float32Array, sampleRate: number, hop = 256): Float32Array {
  const n = Math.floor(pcm.length / hop);
  const energie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) s += pcm[k] * pcm[k];
    energie[i] = Math.log1p(s / hop * 1000);
  }
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) out[i] = Math.max(0, energie[i] - energie[i - 1]);
  return out;
}

function autokorrelationBeiLag(x: Float32Array, lag: number): number {
  let s = 0;
  for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
  return s;
}

/** BPM aus der Takt-Autokorrelation der Onset-Kurve (0,25er-Raster, Takt = 4 Beats). */
export function tempoSchaetzen(pcm: Float32Array, sampleRate: number, min = 80, max = 200): number {
  const hop = 256;
  const on = onsetKurve(pcm, sampleRate, hop);
  const fps = sampleRate / hop;
  let best = 180, bestWert = -Infinity;
  for (let bpm = min; bpm <= max; bpm += 0.25) {
    const lag = Math.round((4 * 60 * fps) / bpm);
    if (lag <= 0 || lag >= on.length) continue;
    const w = autokorrelationBeiLag(on, lag);
    if (w > bestWert) { bestWert = w; best = bpm; }
  }
  return best;
}

/** BPM, bei dem die meisten Dauern taktgenau (<= 3 %) sind; Gleichstand → 180, kein Treffer → 180. */
export function tempoVorschlag(dauern: number[], kandidaten?: number[]): number {
  const kand = kandidaten ?? Array.from({ length: 51 }, (_, i) => 150 + i);
  let best = 180, bestZahl = 0;
  for (const bpm of kand) {
    const zahl = dauern.filter((d) => d >= 1 && taktPassung(d, bpm).abweichung <= 0.03).length;
    if (zahl > bestZahl || (zahl === bestZahl && zahl > 0 && bpm === 180)) { bestZahl = zahl; best = bpm; }
  }
  return bestZahl > 0 ? best : 180;
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-tempo.test.ts`
Expected: PASS (8 Tests). Falls die Klickspur-Schätzung daneben liegt: Hop auf 128 setzen und `lag`-Rundung prüfen — nicht die Toleranz im Test aufweichen.

- [ ] **Step 5: Commit**

```bash
git add src/core/tempoAnalyse.ts tests/generator-tempo.test.ts
git commit -m "feat(generator): tempoAnalyse — Takt-Passung, Autokorrelation, Tempo-Vorschlag"
```

---

### Task 2: sampleScan — Rollen, Familien, Namen, Dubletten

**Files:**
- Create: `src/core/sampleScan.ts`
- Test: `tests/generator-scan.test.ts`

**Interfaces:**
- Consumes: `taktPassung` aus Task 1 (nur für `bars`-Vorabschätzung nicht nötig — Scan kennt kein Tempo).
- Produces:
  - `type Rolle = "kick" | "snare" | "clap" | "hat" | "perc" | "ton" | "bass" | "fx" | "vox" | "melo" | "track"`
  - `interface ScanEingabe { name: string; pcm: Float32Array; sampleRate: number }` — mono!
  - `interface ScanEintrag { datei: string; stem: string; rolle: Rolle; familie: string; sekunden: number; rmsDb: number; peak: number; pcm: Float32Array; sampleRate: number; hinweis?: string }`
  - `rolleFuer(stem: string, sekunden: number, rmsDb: number): Rolle`
  - `familie(stem: string): string`
  - `sauberName(s: string, maxLen?: number): string`
  - `rmsDb(pcm: Float32Array): number`
  - `scanne(eingaben: ScanEingabe[], overrides?: Record<string, Rolle | "skip">): { eintraege: ScanEintrag[]; uebersprungen: { datei: string; grund: string }[] }`

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-scan.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { rolleFuer, familie, sauberName, scanne, type ScanEingabe } from "../src/core/sampleScan";

const KORG3 = path.resolve("examples/e2s/korg3");
const manifest = JSON.parse(fs.readFileSync(path.join(KORG3, "manifest.json"), "utf8")) as {
  samples: { file: string; role: string; family: string; seconds: number }[];
};

function lade(datei: string): ScanEingabe {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, datei))));
  return { name: datei, pcm: w.pcm, sampleRate: w.sampleRate };
}

describe("sampleScan", () => {
  it("rolleFuer: Namen-Heuristik", () => {
    expect(rolleFuer("RoBBaFFerT_KicK_30", 0.36, -6)).toBe("kick");
    expect(rolleFuer("HD_HaT", 0.18, -17)).toBe("hat");
    expect(rolleFuer("ZaHnI_To[N]-154", 0.17, -11)).toBe("ton");
    expect(rolleFuer("Klatsch", 0.7, -5)).toBe("clap");
    expect(rolleFuer("marviis 170 bass", 0.46, -6)).toBe("bass");
    expect(rolleFuer("GZUZ GHETTO KING", 13.3, -19)).toBe("vox");
    expect(rolleFuer("_jfxb_SweepDown_01", 12, -22)).toBe("fx");
    expect(rolleFuer("HyPer__MeLo", 10.6, -13)).toBe("melo");
    expect(rolleFuer("Tommi Schore - Track 1", 217, -9)).toBe("track");
  });
  it("rolleFuer: Fallback ueber Laenge/Pegel", () => {
    expect(rolleFuer("exo2", 0.3, -2.4)).toBe("kick");
    expect(rolleFuer("irgendwas", 0.3, -15)).toBe("perc");
    expect(rolleFuer("irgendwas", 1.5, -15)).toBe("ton");
    expect(rolleFuer("irgendwas", 6, -15)).toBe("melo");
  });
  it("familie: Nummern und Klammern weg, Unterstriche zu Leerzeichen", () => {
    expect(familie("Teetoo_VoGeL_KicK103!")).toBe("teetoo vogel kick");
    expect(familie("TetoKI (11)")).toBe("tetoki");
    expect(familie("1TetoKick")).toBe("tetokick");
    expect(familie("bd 1-01")).toBe("bd");
  });
  it("sauberName: ASCII, 16 Zeichen, Umlaute", () => {
    expect(sauberName("Für Sehn sucht1_AUDIO_2")).toBe("Fuer Sehn sucht1");
    expect(sauberName("RoBBaFFerT_KicK_30")).toBe("RoBBaFFerT KicK");
  });
  it("scanne: Rollen der korg3-Samples stimmen mit dem Manifest ueberein", () => {
    const eingaben = manifest.samples.map((m) => lade(m.file));
    const { eintraege } = scanne(eingaben);
    expect(eintraege.length).toBe(manifest.samples.length);
    for (const m of manifest.samples) {
      const e = eintraege.find((x) => x.datei === m.file)!;
      expect(e.rolle, m.file).toBe(m.role);
      expect(Math.abs(e.sekunden - m.seconds)).toBeLessThan(0.02);
    }
  });
  it("scanne: exakte Dublette und stille Datei fallen weg, overrides greifen", () => {
    const a = lade("Klatsch.wav");
    const still: ScanEingabe = { name: "still.wav", pcm: new Float32Array(4410).fill(0.001), sampleRate: 44100 };
    const { eintraege, uebersprungen } = scanne([a, { ...a, name: "Klatsch Kopie.wav" }, still], { "Klatsch.wav": "snare" });
    expect(eintraege.map((e) => e.datei)).toEqual(["Klatsch.wav"]);
    expect(eintraege[0].rolle).toBe("snare");
    expect(uebersprungen.map((u) => u.datei).sort()).toEqual(["Klatsch Kopie.wav", "still.wav"]);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-scan.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/sampleScan.ts
/**
 * sampleScan — Rollen (kick/snare/clap/hat/perc/ton/bass/fx/vox/melo/track),
 * Familien (Namensstamm ohne Nummern), saubere 16-Zeichen-Namen und
 * Dubletten-Erkennung auf bereits dekodierten Mono-Puffern.
 * Port der Heuristik aus scripts/prep-folder.py (Stand 2026-08-22).
 */

export type Rolle = "kick" | "snare" | "clap" | "hat" | "perc" | "ton" | "bass" | "fx" | "vox" | "melo" | "track";

export interface ScanEingabe {
  name: string;
  /** mono, [-1, 1] */
  pcm: Float32Array;
  sampleRate: number;
}

export interface ScanEintrag {
  datei: string;
  stem: string;
  rolle: Rolle;
  familie: string;
  sekunden: number;
  rmsDb: number;
  peak: number;
  pcm: Float32Array;
  sampleRate: number;
  hinweis?: string;
}

export const LANG_AB = 2.5;
export const TRACK_AB = 60;
const STILL_PEAK = 0.05;

const UML: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
const umlaute = (s: string) => s.replace(/[äöüÄÖÜß]/g, (c) => UML[c]);

const RE = {
  vox: /vocal|vokal|vox\b|audio|whatsapp|stimme|voice|communic|prophet|gzuz|abriss|gefuehl|nase|seen me|gibs tekk|katze/,
  fx: /\bfx\b|effekt|effect|sweep|alarm|riser|noise|quietsch|schall|aufgeschlizt|impact|crash|scratch/,
  melo: /melo|mello|synth|syme|pad\b|\d+(me|sp)\w*heiko|liebestrank|krossi|lackleder|mega ton|metropole|\bbgg\b|biese|hawk|bush|devillache|hyper|barett|hibliebe|honig|hpbe|intro|default|dhrc|sound|ancer|lead|chord|string|piano|arp/,
  kick: /kick|kicker|kiuck|\bbd\b|bassdrum|bumbug|\bki\d|tetoki|vink\d|bilanz|kank|tropf|turbo|toumoux|hard french|taeter drum|bern drum|hardki|emmaki|luzz\d? 16|druff|hub kick|homm|\bexo|dudibrumm|geil\b|boooffl|futeloser|baus\d|\bbreak\b|piup|aniki/,
  bass: /bass|bas\b|\bsub\b|808 bass/,
  snare: /snar|snair|snarre|snaare|\bsn\d|\bsd\b|rim/,
  clap: /clap|klatsch|handclap/,
  hat: /\bhat|hihat|hi-hat|\bhh\b|eatclose|eatopen|zlzzer|cymbal|ride|crash/,
  ton: /\bton\b|\bto\[n\]|ton[-_ ]?\d|_ton|teeton|tee ton|techno ton|tekke ton|tontekk|\bfuer\b|\btab\b|\bdn\b|foterlo|bussmj|moral|rtw|\bfote/,
  perc: /perc|shaker|tom\b|conga|bongo|tab\b|wood|click/,
};

export function rolleFuer(stem: string, sekunden: number, rmsDb: number): Rolle {
  const s = umlaute(stem).toLowerCase().replace(/_+/g, " ");
  if (sekunden >= TRACK_AB) return "track";
  if (/\d+\s*bpm/.test(s) && sekunden >= 12) return "track";
  if (RE.vox.test(s)) return "vox";
  if (RE.fx.test(s) && !RE.hat.test(s)) return "fx";
  if (RE.kick.test(s)) return "kick";
  if (RE.bass.test(s)) return "bass";
  if (RE.clap.test(s)) return "clap";
  if (RE.snare.test(s)) return "snare";
  if (RE.hat.test(s)) return "hat";
  if (RE.melo.test(s) && sekunden >= 1) return "melo";
  if (RE.ton.test(s)) return sekunden < LANG_AB ? "ton" : "melo";
  if (RE.perc.test(s)) return "perc";
  if (sekunden >= LANG_AB) return "melo";
  if (sekunden < 0.9 && rmsDb > -8.5) return "kick";
  if (sekunden < 0.6) return "perc";
  return "ton";
}

export function familie(stem: string): string {
  let s = umlaute(stem).toLowerCase();
  s = s.replace(/\(.*?\)/g, "");
  s = s.replace(/^\d+\s*/, "");
  s = s.replace(/[\s_\-!#.]*\d+[\s_\-!#.\d]*$/, "");
  s = s.replace(/[\s_\-!#.]+/g, " ").trim();
  return s || stem.toLowerCase();
}

export function sauberName(s: string, maxLen = 16): string {
  let t = umlaute(s).replace(/[^\x20-\x7e]/g, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  t = t.slice(0, maxLen).trim();
  return t;
}

export function rmsDb(pcm: Float32Array): number {
  if (!pcm.length) return -120;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return 20 * Math.log10(Math.sqrt(s / pcm.length) + 1e-9);
}

function peakVon(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > p) p = a; }
  return p;
}

/** Korrelation der ersten 0,2 s (bzw. alles bei Loops) — Fast-Dubletten. */
function korrelation(a: Float32Array, b: Float32Array, kurz: boolean, sr: number): number {
  const n = Math.min(a.length, b.length, kurz ? Math.round(0.2 * sr) : Infinity);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += a[i] * b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; }
  return sab / (Math.sqrt(saa * sbb) + 1e-9);
}

export function scanne(
  eingaben: ScanEingabe[],
  overrides: Record<string, Rolle | "skip"> = {},
): { eintraege: ScanEintrag[]; uebersprungen: { datei: string; grund: string }[] } {
  const eintraege: ScanEintrag[] = [];
  const uebersprungen: { datei: string; grund: string }[] = [];
  for (const e of eingaben) {
    const stem = e.name.replace(/\.[^.]+$/, "");
    const ov = overrides[e.name] ?? overrides[stem];
    if (ov === "skip") { uebersprungen.push({ datei: e.name, grund: "overrides: skip" }); continue; }
    const peak = peakVon(e.pcm);
    if (peak < STILL_PEAK || e.pcm.length < 64) { uebersprungen.push({ datei: e.name, grund: `still (Peak ${peak.toFixed(3)})` }); continue; }
    const sekunden = e.pcm.length / e.sampleRate;
    const db = rmsDb(e.pcm);
    const dup = eintraege.find((b) => Math.abs(b.sekunden - sekunden) <= 0.05 && sekunden <= 30 && b.sampleRate === e.sampleRate
      && korrelation(b.pcm, e.pcm, sekunden < LANG_AB, e.sampleRate) > 0.98);
    if (dup) { uebersprungen.push({ datei: e.name, grund: `Dublette von ${dup.datei}` }); continue; }
    eintraege.push({
      datei: e.name, stem, rolle: ov ?? rolleFuer(stem, sekunden, db), familie: familie(stem),
      sekunden, rmsDb: db, peak, pcm: e.pcm, sampleRate: e.sampleRate,
    });
  }
  return { eintraege, uebersprungen };
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-scan.test.ts`
Expected: PASS (6 Tests). Weicht eine Rolle vom Manifest ab, Regex gegen `scripts/prep-folder.py` abgleichen — das Manifest ist die Referenz.

- [ ] **Step 5: Commit**

```bash
git add src/core/sampleScan.ts tests/generator-scan.test.ts
git commit -m "feat(generator): sampleScan — Rollen, Familien, Namen, Dubletten (Port aus prep-folder.py)"
```

---

### Task 3: bankPlan — Aufbereitung, Budget, Bank-Slots, Projekt

**Files:**
- Create: `src/core/bankPlan.ts`
- Test: `tests/generator-bank.test.ts`

**Interfaces:**
- Consumes: `ScanEintrag`, `taktPassung`, `polyPhaseResample`, `peakNormalize` (audioProcessor), `buildE2sBank`, `parseE2sBank`, `displayNumberToOsc`, `displayNumberToSlotIndex`, `oscToDisplayNumber`, `sauberName`.
- Produces:
  - `interface ProjektSample { nr: number; name: string; rolle: Rolle; familie: string; kind: "oneshot" | "loop"; takte: number; sekunden: number; rmsDb: number; quelle: string; gruppe: string; chunk?: 0 | 1; chunks?: 2 }`
  - `interface Projekt { name: string; bpm: number; budgetSekunden: number; volume: number; volumes: number; tekkDrums: boolean; samples: ProjektSample[]; status: "gebaut" | "exportiert" | "geladen"; bankZeit: string }`
  - `interface PlanOptionen { name: string; bpm: number; budgetSekunden?: number; volume?: number; tekkDrumsBank?: Uint8Array; bankZeit?: string }`
  - `bereiteAuf(e: ScanEintrag, bpm: number): { teile: { name: string; pcm: Float32Array; kind: "oneshot" | "loop"; takte: number; chunk?: 0 | 1 }[] }`
  - `waehleVolumes(eintraege: ScanEintrag[], bpm: number, budgetSekunden: number): ScanEintrag[][]`
  - `planeBank(eintraege: ScanEintrag[], opts: PlanOptionen): { projekt: Projekt; bank: ArrayBuffer; warnungen: string[] }`

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-bank.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { bereiteAuf, waehleVolumes, planeBank } from "../src/core/bankPlan";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { oscToDisplayNumber } from "../src/core/e2sPatternSampleLink";

const KORG3 = path.resolve("examples/e2s/korg3");
const TEKK4 = path.resolve("examples/e2s/tekk4.all");
function eingaben(dateien: string[]) {
  return dateien.map((f) => { const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f)))); return { name: f, pcm: w.pcm, sampleRate: w.sampleRate }; });
}
const alle = fs.readdirSync(KORG3).filter((f) => f.endsWith(".wav"));

describe("bankPlan", () => {
  it("bereiteAuf: One-Shot wird getrimmt, normalisiert, bleibt oneshot", () => {
    const { eintraege } = scanne(eingaben(["Klatsch.wav"]));
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("oneshot");
    let peak = 0; for (const v of t[0].pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.95, 2);
  });
  it("bereiteAuf: 8-Takt-Melo bleibt EIN Loop mit takte=8", () => {
    const { eintraege } = scanne(eingaben(["bgg A.wav", "bgg B.wav"]));
    // bgg A ist 4 Takte (5,33 s): bleibt ganz
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("loop");
    expect(t[0].takte).toBe(4);
    expect(t[0].pcm.length).toBe(Math.round((240 / 180) * 4 * 44100));
  });
  it("bereiteAuf: 10-Takt-Vocal wird in genau zwei Haelften geteilt", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(10 * (240 / 180) * sr));
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.5;
    const { eintraege } = scanne([{ name: "GZUZ lang.wav", pcm, sampleRate: sr }]);
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t.map((x) => x.name)).toEqual(["GZUZ lang A", "GZUZ lang B"]);
    expect(t.map((x) => x.takte)).toEqual([5, 5]);
    expect(t.map((x) => x.chunk)).toEqual([0, 1]);
  });
  it("bereiteAuf: 4.4 Takte werden per Varispeed auf 4 Takte gebracht", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(4.4 * (240 / 180) * sr)).map((_, i) => Math.sin(i / 30) * 0.5);
    const { eintraege } = scanne([{ name: "HpBe MeLo.wav", pcm, sampleRate: sr }]);
    const t = bereiteAuf(eintraege[0], 180).teile[0];
    expect(t.takte).toBe(4);
    expect(t.pcm.length).toBe(Math.round(4 * (240 / 180) * sr));
  });
  it("waehleVolumes: Budget teilt in Scheiben, taktgenaue Loops zuerst", () => {
    const { eintraege } = scanne(eingaben(alle));
    const vol = waehleVolumes(eintraege, 180, 30);
    expect(vol.length).toBeGreaterThan(1);
    const summe = (v: typeof eintraege) => v.reduce((s, e) => s + e.sekunden, 0);
    for (const v of vol) expect(summe(v)).toBeLessThanOrEqual(30 + 15); // ein Eintrag darf ueberlaufen
    expect(vol.flat().length).toBe(eintraege.length);
  });
  it("planeBank: korg3 ohne tekk-Drums → Nummern ab 501, Bank lesbar, Projekt stimmig", () => {
    const { eintraege } = scanne(eingaben(alle));
    const { projekt, bank, warnungen } = planeBank(eintraege, { name: "korg3", bpm: 180, bankZeit: "2026-08-22T12:00:00Z" });
    expect(warnungen).toEqual([]);
    expect(projekt.samples[0].nr).toBe(501);
    expect(projekt.tekkDrums).toBe(false);
    const gelesen = parseE2sBank(new Uint8Array(bank), "korg3.all");
    const nummern = gelesen.slots.filter(Boolean).map((s) => oscToDisplayNumber(s!.sampleNumber)).sort((a, b) => a - b);
    expect(nummern).toEqual(projekt.samples.map((s) => s.nr).sort((a, b) => a - b));
    for (const s of projekt.samples) expect(s.name.length).toBeLessThanOrEqual(16);
    expect(projekt.samples.filter((s) => s.rolle === "melo" && s.kind === "loop").every((s) => s.takte <= 8)).toBe(true);
  });
  it("planeBank: mit tekk4-Drums liegen die auf 501–535, eigene ab 601", () => {
    const { eintraege } = scanne(eingaben(["bgg A.wav", "Klatsch.wav"]));
    const { projekt } = planeBank(eintraege, { name: "t", bpm: 180, tekkDrumsBank: new Uint8Array(fs.readFileSync(TEKK4)) });
    expect(projekt.tekkDrums).toBe(true);
    const tekk = projekt.samples.filter((s) => s.gruppe === "tekk");
    expect(tekk.length).toBe(10);
    expect(tekk.every((s) => s.nr >= 501 && s.nr <= 535)).toBe(true);
    expect(projekt.samples.filter((s) => s.gruppe !== "tekk")[0].nr).toBe(601);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-bank.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/bankPlan.ts
/**
 * bankPlan — aus Scan-Eintraegen eine Sample-Bank planen: Budget/Volumes,
 * One-Shots trimmen/normalisieren, Loops per Varispeed auf ganze Takte und
 * GANZ lassen (<= 8 Takte), laengere in genau zwei Haelften; tekk4-Drums
 * optional auf ihren Originalnummern; Ergebnis = Projekt + .all-Bytes.
 */
import { type ScanEintrag, type Rolle, sauberName, rmsDb, LANG_AB } from "./sampleScan";
import { taktPassung } from "./tempoAnalyse";
import { polyPhaseResample, peakNormalize } from "./audioProcessor";
import { buildE2sBank, type E2sSlotInput } from "./e2sBankBuilder";
import { parseE2sBank } from "./e2sBankReader";
import { displayNumberToOsc, displayNumberToSlotIndex, oscToDisplayNumber } from "./e2sPatternSampleLink";

export const SR = 44100;
export const BUDGET_SEKUNDEN = 235;
const TAKT_TOLERANZ = 0.12;
const KAT: Record<Rolle, number> = { bass: 0, kick: 2, snare: 3, clap: 4, hat: 5, ton: 7, vox: 9, fx: 11, perc: 13, melo: 15, track: 15 };
/** Bewaehrte tekk4-Drums (Name-Praefixe) wie in make-folder-bank.mjs. */
export const TEKK_BASIS = ["HaimKind", "Jumpkick", "clydesna", "snarre-p", "closed 8", "707_hho", "ED Close", "ZaHnI_To", "Unison_Bass_C3", "Bassdrum-01fd"];
const TEKK_ROLLE: Record<string, Rolle> = { HaimKind: "kick", Jumpkick: "kick", "Bassdrum-01fd": "kick", clydesna: "snare", "snarre-p": "snare", "closed 8": "hat", "707_hho": "hat", "ED Close": "hat", ZaHnI_To: "ton", Unison_Bass_C3: "bass" };

export interface ProjektSample {
  nr: number; name: string; rolle: Rolle; familie: string; kind: "oneshot" | "loop"; takte: number;
  sekunden: number; rmsDb: number; quelle: string; gruppe: string; chunk?: 0 | 1; chunks?: 2;
}
export interface Projekt {
  name: string; bpm: number; budgetSekunden: number; volume: number; volumes: number; tekkDrums: boolean;
  samples: ProjektSample[]; status: "gebaut" | "exportiert" | "geladen"; bankZeit: string;
}
export interface PlanOptionen { name: string; bpm: number; budgetSekunden?: number; volume?: number; tekkDrumsBank?: Uint8Array; bankZeit?: string }
export interface Teil { name: string; pcm: Float32Array; kind: "oneshot" | "loop"; takte: number; chunk?: 0 | 1 }

function trimme(pcm: Float32Array, db = 50): Float32Array {
  const schwelle = Math.pow(10, -db / 20) * Math.max(...Array.from({ length: 1 }, () => 0), peak(pcm));
  let a = 0, b = pcm.length;
  while (a < b && Math.abs(pcm[a]) < schwelle) a++;
  while (b > a && Math.abs(pcm[b - 1]) < schwelle) b--;
  return b - a > 64 ? pcm.slice(a, b) : pcm;
}
function peak(pcm: Float32Array): number { let p = 0; for (let i = 0; i < pcm.length; i++) p = Math.max(p, Math.abs(pcm[i])); return p; }
function fades(pcm: Float32Array, einS: number, ausS: number): Float32Array {
  const out = pcm.slice();
  const fi = Math.round(einS * SR), fo = Math.round(ausS * SR);
  for (let i = 0; i < fi && i < out.length; i++) out[i] *= i / fi;
  for (let i = 0; i < fo && i < out.length; i++) out[out.length - 1 - i] *= i / fo;
  return out;
}
/** rate > 1 → kuerzer/hoeher (Varispeed). */
function varispeed(pcm: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.002) return pcm;
  return polyPhaseResample(pcm, Math.round(SR * rate), SR, 1);
}
function aufLaenge(pcm: Float32Array, frames: number): Float32Array {
  if (pcm.length === frames) return pcm;
  const out = new Float32Array(frames);
  out.set(pcm.subarray(0, Math.min(frames, pcm.length)));
  return out;
}

/** Ein Scan-Eintrag → ein oder zwei Teile (Haelften) fuer die Bank. */
export function bereiteAuf(e: ScanEintrag, bpm: number): { teile: Teil[] } {
  const taktSek = 240 / bpm;
  const basis = sauberName(e.stem);
  const istLoopRolle = e.rolle === "melo" || e.rolle === "vox" || e.rolle === "fx" || e.rolle === "bass" || e.rolle === "ton";
  if (e.sekunden < LANG_AB || !istLoopRolle) {
    return { teile: [{ name: basis, pcm: peakNormalize(fades(trimme(e.pcm), 0.002, 0.01), 0.95), kind: "oneshot", takte: 0 }] };
  }
  let y = e.rolle === "melo" ? e.pcm : trimme(e.pcm, 45);
  const { takte, abweichung } = taktPassung(y.length / SR, bpm);
  if (abweichung > TAKT_TOLERANZ && y.length / SR / taktSek <= 8) {
    return { teile: [{ name: basis, pcm: peakNormalize(fades(y, 0.002, 0.01), 0.95), kind: "oneshot", takte: 0 }] };
  }
  const ziel = takte * taktSek;
  y = aufLaenge(varispeed(y, (y.length / SR) / ziel), Math.round(ziel * SR));
  if (takte <= 8) return { teile: [{ name: basis, pcm: peakNormalize(fades(y, 0.002, 0.004), 0.95), kind: "loop", takte }] };
  const h = y.length >> 1;
  const kurz = sauberName(e.stem, 14);
  return { teile: [
    { name: `${kurz} A`, pcm: peakNormalize(fades(y.subarray(0, h), 0.002, 0.004), 0.95), kind: "loop", takte: Math.round(takte / 2), chunk: 0 },
    { name: `${kurz} B`, pcm: peakNormalize(fades(y.subarray(h), 0.002, 0.004), 0.95), kind: "loop", takte: Math.round(takte / 2), chunk: 1 },
  ] };
}

function punkte(e: ScanEintrag, bpm: number): number {
  const { takte, abweichung } = taktPassung(e.sekunden, bpm);
  let sc = -abweichung * 10 + Math.min(e.rmsDb, -8) / 10;
  if (e.sekunden >= 2.5 && e.sekunden <= 11) sc += 2;
  if (takte === 4 || takte === 8) sc += 1;
  if (/melo/i.test(e.stem)) sc += 1;
  return sc;
}

/** Rangliste (taktgenau, laut, "melo", je Familie erst das beste) in Budget-Scheiben. */
export function waehleVolumes(eintraege: ScanEintrag[], bpm: number, budgetSekunden: number): ScanEintrag[][] {
  const kand = eintraege.filter((e) => e.rolle !== "track").sort((a, b) => punkte(b, bpm) - punkte(a, bpm));
  const erste: ScanEintrag[] = [], zweite: ScanEintrag[] = [], gesehen = new Set<string>();
  for (const e of kand) { (gesehen.has(e.familie) ? zweite : erste).push(e); gesehen.add(e.familie); }
  const scheiben: ScanEintrag[][] = [];
  let akt: ScanEintrag[] = [], summe = 0;
  for (const e of [...erste, ...zweite]) {
    if (summe + e.sekunden > budgetSekunden && akt.length) { scheiben.push(akt); akt = []; summe = 0; }
    akt.push(e); summe += e.sekunden;
  }
  if (akt.length) scheiben.push(akt);
  return scheiben;
}

function eindeutig(name: string, vergeben: Set<string>): string {
  let n = name, i = 2;
  while (vergeben.has(n.toLowerCase())) { const s = String(i++); n = name.slice(0, 16 - s.length).trimEnd() + s; }
  vergeben.add(n.toLowerCase());
  return n;
}

export function planeBank(eintraege: ScanEintrag[], opts: PlanOptionen): { projekt: Projekt; bank: ArrayBuffer; warnungen: string[] } {
  const budget = opts.budgetSekunden ?? BUDGET_SEKUNDEN;
  const volumes = waehleVolumes(eintraege, opts.bpm, budget);
  const volume = opts.volume ?? 1;
  if (volume > volumes.length) throw new Error(`nur ${volumes.length} Volumes moeglich`);
  const auswahl = volumes[volume - 1] ?? [];
  const slots: E2sSlotInput[] = [];
  const samples: ProjektSample[] = [];
  const vergeben = new Set<string>();
  let tekk = false;
  if (opts.tekkDrumsBank) {
    const basis = parseE2sBank(opts.tekkDrumsBank, "tekk4.all");
    const genommen = new Set<string>();
    for (const s of basis.slots) {
      if (!s) continue;
      const praefix = TEKK_BASIS.find((b) => s.name.trim().toLowerCase().startsWith(b.toLowerCase()));
      if (!praefix || genommen.has(praefix)) continue;
      genommen.add(praefix);
      const nr = oscToDisplayNumber(s.sampleNumber);
      slots.push({ slotIndex: s.index, sampleNumber: s.sampleNumber, name: s.name, category: s.category, pcmData: s.pcmData, sampleRate: s.sampleRate, channels: s.channels as 1 | 2 });
      samples.push({ nr, name: s.name.trim(), rolle: TEKK_ROLLE[praefix], familie: "tekk", kind: "oneshot", takte: 0, sekunden: s.frames / s.sampleRate, rmsDb: rmsDb(s.pcmData), quelle: `tekk4.all #${nr}`, gruppe: "tekk" });
      vergeben.add(s.name.trim().toLowerCase());
    }
    tekk = genommen.size > 0;
  }
  let nr = tekk ? 601 : 501;
  const reihenfolge: Rolle[] = ["kick", "snare", "clap", "hat", "perc", "ton", "bass", "fx", "vox", "melo", "track"];
  for (const e of auswahl.slice().sort((a, b) => reihenfolge.indexOf(a.rolle) - reihenfolge.indexOf(b.rolle) || a.datei.localeCompare(b.datei))) {
    const { teile } = bereiteAuf(e, opts.bpm);
    for (const t of teile) {
      const name = eindeutig(t.name, vergeben);
      const kindLoop = t.kind === "loop";
      slots.push({ slotIndex: displayNumberToSlotIndex(nr), sampleNumber: displayNumberToOsc(nr), name, category: KAT[e.rolle], pcmData: t.pcm, sampleRate: SR, channels: 1, loopType: 1 });
      samples.push({ nr, name, rolle: e.rolle, familie: e.familie, kind: t.kind, takte: t.takte, sekunden: t.pcm.length / SR, rmsDb: rmsDb(t.pcm), quelle: e.datei,
        gruppe: kindLoop ? `${e.rolle}:${e.familie}` : e.rolle, ...(t.chunk !== undefined ? { chunk: t.chunk, chunks: 2 as const } : {}) });
      nr++;
    }
  }
  const bank = buildE2sBank(slots);
  const projekt: Projekt = { name: opts.name, bpm: opts.bpm, budgetSekunden: budget, volume, volumes: volumes.length, tekkDrums: tekk, samples, status: "gebaut", bankZeit: opts.bankZeit ?? new Date().toISOString() };
  return { projekt, bank: bank.buffer, warnungen: bank.warnings ?? [] };
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-bank.test.ts`
Expected: PASS (7 Tests). Falls `polyPhaseResample` bei krummen Raten langsam ist: Test-Laufzeit prüfen, aber nicht auf `resampleLinear` ausweichen (Klangqualität).

- [ ] **Step 5: Commit**

```bash
git add src/core/bankPlan.ts tests/generator-bank.test.ts
git commit -m "feat(generator): bankPlan — Loops ganz, Haelften, Volumes, Bank-Slots, Projekt"
```

---

### Task 4: rezept — Typen, Prüfung, Regel-Planer

**Files:**
- Create: `src/core/rezept.ts`
- Test: `tests/generator-rezept.test.ts`

**Interfaces:**
- Consumes: `Projekt`, `ProjektSample` (Task 3).
- Produces:
  - `type Modus = "jam" | "miniset" | "promelo"`
  - `type KickFigur = "vier" | "hart" | "roll" | "galopp"`, `type BassFigur = "off" | "roll" | "acht"`, `type StabFigur = "ruhig" | "stab" | "arp" | "frage"`
  - `type Lage = "melo" | "vers" | "bass" | "stab" | "shot" | "riser"`
  - `interface Thema { melo?: string; vers?: string; kickFamilie: string; snare: string; clap?: string; hats: [string, string]; percs?: [string, string]; bass?: string; stab?: string; shots?: [string, string]; riser?: string }`
  - `interface Abschnitt { name: string; wiederholungen: number; intensitaet: 1 | 2 | 3 | 4 | 5; kick: KickFigur; lagen: Lage[] }`
  - `interface Rezept { modus: Modus; bpm: number; begruendung: string; thema: Thema; abschnitte: Abschnitt[]; figuren: { bass: BassFigur; stab: StabFigur; hatsOffbeat: boolean } }`
  - `pruefeRezept(r: unknown, projekt: Projekt): { rezept: Rezept; korrekturen: string[] }` — wirft nie; ersetzt ungültige Felder feldweise durch Regel-Werte.
  - `regelRezept(projekt: Projekt, wunsch: { modus: Modus; bpm?: number; melo?: string; beschreibung?: string }): Rezept`
  - `regelRezeptProMelo(projekt: Projekt, bpm?: number): Rezept[]`

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-rezept.test.ts
import { describe, it, expect } from "vitest";
import type { Projekt, ProjektSample } from "../src/core/bankPlan";
import { regelRezept, regelRezeptProMelo, pruefeRezept } from "../src/core/rezept";

function s(nr: number, name: string, rolle: ProjektSample["rolle"], extra: Partial<ProjektSample> = {}): ProjektSample {
  return { nr, name, rolle, familie: name.toLowerCase().replace(/\d+$/, "").trim(), kind: "oneshot", takte: 0, sekunden: 0.3, rmsDb: -6, quelle: name, gruppe: rolle, ...extra };
}
const P: Projekt = {
  name: "t", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, status: "gebaut", bankZeit: "x",
  samples: [
    s(501, "Kick A1", "kick"), s(502, "Kick A2", "kick"), s(503, "Kick B1", "kick", { familie: "kick b" }),
    s(504, "Snare", "snare"), s(505, "Clap", "clap"), s(506, "Hat close", "hat", { sekunden: 0.1 }), s(507, "Hat open", "hat", { sekunden: 0.4 }),
    s(508, "Ton 1", "ton"), s(509, "Bass", "bass"), s(510, "Sweep", "fx", { sekunden: 2 }),
    s(511, "Melo Eins", "melo", { kind: "loop", takte: 4, sekunden: 5.33, gruppe: "melo:melo eins" }),
    s(512, "Melo Zwei", "melo", { kind: "loop", takte: 8, sekunden: 10.67, gruppe: "melo:melo zwei" }),
    s(513, "Vox Loop", "vox", { kind: "loop", takte: 4, sekunden: 5.33, gruppe: "vox:vox loop" }),
    s(514, "Vox Shot", "vox", { sekunden: 1 }),
  ],
};

describe("rezept", () => {
  it("regelRezept jam: ein Abschnitt, alle Lagen, Thema vollstaendig", () => {
    const r = regelRezept(P, { modus: "jam" });
    expect(r.modus).toBe("jam");
    expect(r.bpm).toBe(180);
    expect(r.abschnitte).toHaveLength(1);
    expect(r.abschnitte[0].lagen).toEqual(expect.arrayContaining(["melo", "bass", "stab", "shot", "vers"]));
    expect(r.thema.melo).toBe("Melo Eins");
    expect(r.thema.vers).toBe("Vox Loop");
    expect(r.thema.kickFamilie).toBe("kick a");
    expect(r.thema.hats).toEqual(["Hat close", "Hat open"]);
    expect(r.begruendung.length).toBeGreaterThan(10);
  });
  it("regelRezept miniset: 6 Abschnitte Intro→Drop→Break→Drop→Outro, Melo waehlbar", () => {
    const r = regelRezept(P, { modus: "miniset", melo: "Melo Zwei", bpm: 176 });
    expect(r.bpm).toBe(176);
    expect(r.thema.melo).toBe("Melo Zwei");
    expect(r.abschnitte.map((a) => a.name)).toEqual(["INTRO", "AUFBAU", "DROP 1", "BREAK", "DROP 2", "OUTRO"]);
    expect(r.abschnitte[2].intensitaet).toBe(5);
    expect(r.abschnitte[3].intensitaet).toBeLessThanOrEqual(2);
  });
  it("regelRezept: Beschreibung mit Schluesselwoertern beeinflusst Figuren", () => {
    const r = regelRezept(P, { modus: "jam", beschreibung: "hart und schnell, rollende bass, arp stab" });
    expect(r.abschnitte[0].kick).toBe("hart");
    expect(r.figuren.bass).toBe("roll");
    expect(r.figuren.stab).toBe("arp");
  });
  it("regelRezeptProMelo: ein Rezept je Melodie, Kick-Familien rotieren", () => {
    const rs = regelRezeptProMelo(P);
    expect(rs.map((r) => r.thema.melo)).toEqual(["Melo Eins", "Melo Zwei"]);
    expect(rs[0].thema.kickFamilie).not.toBe(rs[1].thema.kickFamilie);
  });
  it("pruefeRezept: unbekannte Namen und falsche Werte werden ersetzt und gemeldet", () => {
    const kaputt = { modus: "jam", bpm: 999, begruendung: "", thema: { melo: "gibts nicht", kickFamilie: "snare", snare: "Melo Eins", hats: ["Hat close"] }, abschnitte: [], figuren: { bass: "xyz" } };
    const { rezept, korrekturen } = pruefeRezept(kaputt, P);
    expect(rezept.bpm).toBe(180);
    expect(rezept.thema.melo).toBe("Melo Eins");
    expect(rezept.thema.kickFamilie).toBe("kick a");
    expect(rezept.thema.snare).toBe("Snare");
    expect(rezept.thema.hats).toHaveLength(2);
    expect(rezept.abschnitte.length).toBeGreaterThanOrEqual(1);
    expect(rezept.figuren.bass).toBe("off");
    expect(korrekturen.length).toBeGreaterThanOrEqual(5);
  });
  it("pruefeRezept: gueltiges Rezept bleibt unveraendert", () => {
    const r = regelRezept(P, { modus: "miniset" });
    const { rezept, korrekturen } = pruefeRezept(JSON.parse(JSON.stringify(r)), P);
    expect(korrekturen).toEqual([]);
    expect(rezept).toEqual(r);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-rezept.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/rezept.ts
/**
 * rezept — das Arrangement-Rezept zwischen Planer (Regeln oder KI) und
 * patternGen. Die KI liefert genau dieses JSON; pruefeRezept macht aus
 * jeder Antwort ein gueltiges Rezept (feldweise Ersatz + Korrekturliste).
 */
import type { Projekt, ProjektSample } from "./bankPlan";

export type Modus = "jam" | "miniset" | "promelo";
export type KickFigur = "vier" | "hart" | "roll" | "galopp";
export type BassFigur = "off" | "roll" | "acht";
export type StabFigur = "ruhig" | "stab" | "arp" | "frage";
export type Lage = "melo" | "vers" | "bass" | "stab" | "shot" | "riser";
export const KICK_FIGUREN: KickFigur[] = ["vier", "hart", "roll", "galopp"];
export const BASS_FIGUREN: BassFigur[] = ["off", "roll", "acht"];
export const STAB_FIGUREN: StabFigur[] = ["ruhig", "stab", "arp", "frage"];
export const LAGEN: Lage[] = ["melo", "vers", "bass", "stab", "shot", "riser"];

export interface Thema {
  melo?: string; vers?: string; kickFamilie: string; snare: string; clap?: string; hats: [string, string];
  percs?: [string, string]; bass?: string; stab?: string; shots?: [string, string]; riser?: string;
}
export interface Abschnitt { name: string; wiederholungen: number; intensitaet: 1 | 2 | 3 | 4 | 5; kick: KickFigur; lagen: Lage[] }
export interface Rezept {
  modus: Modus; bpm: number; begruendung: string; thema: Thema; abschnitte: Abschnitt[];
  figuren: { bass: BassFigur; stab: StabFigur; hatsOffbeat: boolean };
}

// ── Pools ──────────────────────────────────────────────────────────────────
export interface Pools {
  kicks: ProjektSample[]; familien: { name: string; kicks: ProjektSample[] }[]; snares: ProjektSample[]; claps: ProjektSample[];
  hatsClosed: ProjektSample[]; hatsOpen: ProjektSample[]; percs: ProjektSample[]; stabs: ProjektSample[]; basses: ProjektSample[];
  fxShots: ProjektSample[]; fxLoops: ProjektSample[]; voxShots: ProjektSample[]; meloLoops: ProjektSample[]; voxLoops: ProjektSample[];
}
const eigene = (l: ProjektSample[]) => (l.some((s) => s.gruppe !== "tekk") ? l.filter((s) => s.gruppe !== "tekk") : l);

export function pools(p: Projekt): Pools {
  const by = (r: ProjektSample["rolle"], kind?: "oneshot" | "loop") => p.samples.filter((s) => s.rolle === r && (!kind || s.kind === kind));
  const kicks = by("kick");
  const fam = new Map<string, ProjektSample[]>();
  for (const k of kicks) fam.set(k.familie, [...(fam.get(k.familie) ?? []), k]);
  const gross = [...fam.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).map(([name, l]) => ({ name, kicks: l }));
  const einzel = [...fam.entries()].filter(([, l]) => l.length < 2).flatMap(([, l]) => l);
  for (let i = 0; i < einzel.length; i += 3) gross.push({ name: einzel[i].familie, kicks: einzel.slice(i, i + 3) });
  for (const f of gross) f.kicks.sort((a, b) => b.rmsDb - a.rmsDb);
  const snares = eigene(by("snare")).length ? eigene(by("snare")) : by("perc");
  const hats = by("hat").slice().sort((a, b) => a.sekunden - b.sekunden);
  const hatsClosed = hats.filter((h) => h.sekunden < 0.3).length ? hats.filter((h) => h.sekunden < 0.3) : hats;
  const hatsOpen = hats.filter((h) => h.sekunden >= 0.18).length ? hats.filter((h) => h.sekunden >= 0.18).reverse() : hats;
  const tonsShort = by("ton").filter((t) => t.sekunden < 0.6), tonsLong = by("ton").filter((t) => t.sekunden >= 0.6);
  const meloLoops = by("melo", "loop"), voxLoops = by("vox", "loop");
  const meloKurz = meloLoops.filter((m) => m.takte < 4 && !m.chunks);
  return {
    kicks, familien: gross, snares, claps: by("clap").length ? by("clap") : snares.slice(1).concat(snares.slice(0, 1)),
    hatsClosed, hatsOpen, percs: by("perc").concat(tonsShort, hats.slice(2)),
    stabs: tonsLong.concat(by("melo", "oneshot"), tonsShort, meloKurz), basses: by("bass"),
    fxShots: by("fx", "oneshot"), fxLoops: by("fx", "loop"), voxShots: by("vox", "oneshot"),
    meloLoops: meloLoops.filter((m) => m.takte >= 4 || m.chunks), voxLoops,
  };
}
const rot = <T>(l: T[], i: number): T | undefined => (l.length ? l[((i % l.length) + l.length) % l.length] : undefined);
const nm = (s?: ProjektSample) => s?.name;

/** Melodien als Themen-Kandidaten: Haelften A/B zaehlen als EIN Eintrag (A). */
export function meloKandidaten(pl: Pools): ProjektSample[] {
  return pl.meloLoops.filter((m) => m.chunk === undefined || m.chunk === 0);
}

// ── Regel-Planer ────────────────────────────────────────────────────────────
const MINISET: Abschnitt[] = [
  { name: "INTRO", wiederholungen: 2, intensitaet: 1, kick: "vier", lagen: ["melo"] },
  { name: "AUFBAU", wiederholungen: 2, intensitaet: 3, kick: "roll", lagen: ["melo", "bass", "riser"] },
  { name: "DROP 1", wiederholungen: 4, intensitaet: 5, kick: "hart", lagen: ["melo", "bass", "stab", "shot"] },
  { name: "BREAK", wiederholungen: 2, intensitaet: 2, kick: "vier", lagen: ["vers", "stab"] },
  { name: "DROP 2", wiederholungen: 4, intensitaet: 5, kick: "galopp", lagen: ["melo", "vers", "bass", "stab", "shot"] },
  { name: "OUTRO", wiederholungen: 2, intensitaet: 2, kick: "vier", lagen: ["melo", "bass"] },
];

function themaFuer(pl: Pools, i: number, melo?: ProjektSample): Thema {
  const fam = rot(pl.familien, i)!;
  const vers = rot(pl.voxLoops.filter((v) => v.chunk === undefined || v.chunk === 0), i);
  return {
    melo: nm(melo), vers: nm(vers), kickFamilie: fam.name, snare: nm(rot(pl.snares, i))!, clap: nm(rot(pl.claps, i + 1)),
    hats: [nm(rot(pl.hatsClosed, i))!, nm(rot(pl.hatsOpen, i + 1))!],
    percs: pl.percs.length ? [nm(rot(pl.percs, 2 * i))!, nm(rot(pl.percs, 2 * i + 1))!] : undefined,
    bass: nm(rot(pl.basses, i)) ?? nm(pl.kicks.filter((k) => k.sekunden >= 0.6).concat(pl.kicks)[i % pl.kicks.length]),
    stab: nm(rot(pl.stabs, i)),
    shots: pl.voxShots.length || pl.fxShots.length ? [nm(rot(pl.voxShots.length ? pl.voxShots : pl.fxShots, 2 * i))!, nm(rot(pl.fxShots.length ? pl.fxShots : pl.voxShots, i))!] : undefined,
    riser: nm(rot(pl.fxLoops, i)),
  };
}

function figurenAus(beschreibung = ""): { kick: KickFigur; bass: BassFigur; stab: StabFigur; hatsOffbeat: boolean } {
  const b = beschreibung.toLowerCase();
  return {
    kick: /roll|wirbel/.test(b) ? "roll" : /galopp|gallop|offbeat kick/.test(b) ? "galopp" : /hart|hard|brett|druck/.test(b) ? "hart" : "vier",
    bass: /roll/.test(b) ? "roll" : /acht|8tel|achtel|schnell/.test(b) ? "acht" : "off",
    stab: /arp/.test(b) ? "arp" : /frage|call/.test(b) ? "frage" : /ruhig|soft|weich|chill/.test(b) ? "ruhig" : "stab",
    hatsOffbeat: !/keine hats|ohne hats/.test(b),
  };
}

export function regelRezept(projekt: Projekt, wunsch: { modus: Modus; bpm?: number; melo?: string; beschreibung?: string }): Rezept {
  const pl = pools(projekt);
  const kand = meloKandidaten(pl);
  const melo = (wunsch.melo ? kand.find((m) => m.name === wunsch.melo) : undefined) ?? kand[0];
  const idx = melo ? Math.max(0, kand.indexOf(melo)) : 0;
  const thema = themaFuer(pl, idx, melo);
  const fig = figurenAus(wunsch.beschreibung);
  const bpm = wunsch.bpm ?? projekt.bpm;
  const lagenAlle: Lage[] = (["melo", "vers", "bass", "stab", "shot"] as Lage[]).filter((l) => (l === "melo" ? !!thema.melo : l === "vers" ? !!thema.vers : l === "bass" ? !!thema.bass : l === "stab" ? !!thema.stab : !!thema.shots));
  const abschnitte: Abschnitt[] = wunsch.modus === "miniset"
    ? MINISET.map((a) => ({ ...a, kick: a.intensitaet >= 5 ? fig.kick : a.kick, lagen: a.lagen.filter((l) => lagenAlle.includes(l) || (l === "riser" && !!thema.riser)) }))
    : [{ name: "JAM", wiederholungen: 1, intensitaet: 5, kick: fig.kick, lagen: lagenAlle }];
  const begruendung = `${melo ? `Melodie "${melo.name}" (${melo.takte} Takte)` : "keine Melodie"} mit Kick-Familie "${thema.kickFamilie}"${thema.vers ? `, Vocal-Loop "${thema.vers}"` : ""}; Tempo ${bpm} BPM${wunsch.bpm ? " (gewaehlt)" : " (Vorschlag aus der Taktanalyse)"}; Kick ${fig.kick}, Bass ${fig.bass}, Stab ${fig.stab}.`;
  return { modus: wunsch.modus, bpm, begruendung, thema, abschnitte, figuren: { bass: fig.bass, stab: fig.stab, hatsOffbeat: fig.hatsOffbeat } };
}

export function regelRezeptProMelo(projekt: Projekt, bpm?: number): Rezept[] {
  const kand = meloKandidaten(pools(projekt));
  return kand.map((m) => ({ ...regelRezept(projekt, { modus: "promelo", bpm, melo: m.name }), modus: "promelo" as Modus }));
}

// ── Pruefung ────────────────────────────────────────────────────────────────
export function pruefeRezept(r: unknown, projekt: Projekt): { rezept: Rezept; korrekturen: string[] } {
  const korr: string[] = [];
  const x = (typeof r === "object" && r) ? (r as Record<string, unknown>) : {};
  const modus: Modus = (["jam", "miniset", "promelo"] as Modus[]).includes(x.modus as Modus) ? (x.modus as Modus) : (korr.push("modus → jam"), "jam");
  const basis = regelRezept(projekt, { modus, melo: typeof (x.thema as Thema)?.melo === "string" ? (x.thema as Thema).melo : undefined });
  const bpm = typeof x.bpm === "number" && x.bpm >= 60 && x.bpm <= 300 ? x.bpm : (korr.push(`bpm → ${basis.bpm}`), basis.bpm);
  const hat = (name: unknown, rollen: ProjektSample["rolle"][]) => typeof name === "string" && projekt.samples.some((s) => s.name === name && rollen.includes(s.rolle));
  const t = (typeof x.thema === "object" && x.thema ? x.thema : {}) as Partial<Thema>;
  const feld = <K extends keyof Thema>(k: K, rollen: ProjektSample["rolle"][], optional = false): Thema[K] => {
    const v = t[k];
    if (v === undefined && optional) return basis.thema[k];
    if (hat(v, rollen)) return v as Thema[K];
    korr.push(`thema.${k} "${String(v)}" → "${String(basis.thema[k])}"`);
    return basis.thema[k];
  };
  const paar = <K extends "hats" | "percs" | "shots">(k: K, rollen: ProjektSample["rolle"][]): Thema[K] => {
    const v = t[k];
    if (Array.isArray(v) && v.length === 2 && v.every((n) => hat(n, rollen))) return v as Thema[K];
    if (v !== undefined || k === "hats") korr.push(`thema.${k} → Regel`);
    return basis.thema[k];
  };
  const familien = pools(projekt).familien.map((f) => f.name);
  const kickFamilie = typeof t.kickFamilie === "string" && familien.includes(t.kickFamilie) ? t.kickFamilie : (korr.push(`thema.kickFamilie "${String(t.kickFamilie)}" → "${basis.thema.kickFamilie}"`), basis.thema.kickFamilie);
  const thema: Thema = {
    melo: feld("melo", ["melo"], true), vers: feld("vers", ["vox", "melo"], true), kickFamilie, snare: feld("snare", ["snare", "perc"]),
    clap: feld("clap", ["clap", "snare", "perc"], true), hats: paar("hats", ["hat", "perc"]), percs: paar("percs", ["perc", "ton", "hat"]),
    bass: feld("bass", ["bass", "kick"], true), stab: feld("stab", ["ton", "melo"], true), shots: paar("shots", ["vox", "fx", "ton"]), riser: feld("riser", ["fx"], true),
  };
  const abRoh = Array.isArray(x.abschnitte) ? (x.abschnitte as Partial<Abschnitt>[]) : [];
  const abschnitte: Abschnitt[] = abRoh.slice(0, 8).map((a, i) => ({
    name: typeof a.name === "string" ? a.name.slice(0, 8) : `TEIL ${i + 1}`,
    wiederholungen: typeof a.wiederholungen === "number" && a.wiederholungen >= 1 && a.wiederholungen <= 8 ? Math.round(a.wiederholungen) : 2,
    intensitaet: (typeof a.intensitaet === "number" && a.intensitaet >= 1 && a.intensitaet <= 5 ? Math.round(a.intensitaet) : 3) as 1 | 2 | 3 | 4 | 5,
    kick: KICK_FIGUREN.includes(a.kick as KickFigur) ? (a.kick as KickFigur) : "vier",
    lagen: Array.isArray(a.lagen) ? (a.lagen.filter((l) => LAGEN.includes(l as Lage)) as Lage[]) : ["melo"],
  }));
  if (!abschnitte.length) { korr.push("abschnitte leer → Regel"); abschnitte.push(...basis.abschnitte); }
  if (modus === "jam" && abschnitte.length > 1) { korr.push("jam hat nur einen Abschnitt"); abschnitte.splice(1); }
  const f = (typeof x.figuren === "object" && x.figuren ? x.figuren : {}) as Partial<Rezept["figuren"]>;
  const figuren = {
    bass: BASS_FIGUREN.includes(f.bass as BassFigur) ? (f.bass as BassFigur) : (korr.push("figuren.bass → off"), "off" as BassFigur),
    stab: STAB_FIGUREN.includes(f.stab as StabFigur) ? (f.stab as StabFigur) : (korr.push("figuren.stab → stab"), "stab" as StabFigur),
    hatsOffbeat: typeof f.hatsOffbeat === "boolean" ? f.hatsOffbeat : true,
  };
  const begruendung = typeof x.begruendung === "string" && x.begruendung.trim() ? x.begruendung.trim() : basis.begruendung;
  return { rezept: { modus, bpm, begruendung, thema, abschnitte, figuren }, korrekturen: korr };
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-rezept.test.ts`
Expected: PASS (6 Tests). Der Test „gültiges Rezept bleibt unverändert" verlangt, dass `pruefeRezept` optionale Felder (`clap`, `percs`, `bass`, `stab`, `shots`, `riser`, `vers`, `melo`) nicht anfasst, wenn sie gültig sind — bei Abweichung die `feld`/`paar`-Helfer prüfen, nicht den Test.

- [ ] **Step 5: Commit**

```bash
git add src/core/rezept.ts tests/generator-rezept.test.ts
git commit -m "feat(generator): rezept — Typen, Regel-Planer (jam/miniset/promelo), Pruefung"
```

---

### Task 5: patternGen — Rezept → Patterns

**Files:**
- Create: `src/core/patternGen.ts`
- Test: `tests/generator-pattern.test.ts`

**Interfaces:**
- Consumes: `Rezept`, `Abschnitt`, `Thema`, `pools` (Task 4); `Projekt` (Task 3); `E2PatternInput`, `E2PartInput`, `E2StepInput` aus `electribePatternBuilder`; `bankNumberToE2PatternRef`; `buildE2PatternBody`, `buildE2AllPatFile` aus `e2sExport`.
- Produces:
  - `baueRezept(rezept: Rezept, projekt: Projekt, opts?: { startSlot?: number; mfxType?: number }): { patterns: E2PatternInput[]; hinweise: string[] }` — Jam: 1 Pattern; Mini-Set: n Patterns gechaint (1-basiert relativ zu `startSlot`, Standard 1); Pro Melo: Aufrufer ruft je Rezept.
  - `baueProMelo(rezepte: Rezept[], projekt: Projekt): { patterns: E2PatternInput[]; hinweise: string[] }`
  - `alsAllPat(patterns: E2PatternInput[], startSlot?: number): ArrayBuffer` — 250 Slots, Rest leere Init-Patterns (Name "-", bpm 120, 16 Steps).
  - `alsPat(pattern: E2PatternInput): Uint8Array` — `buildE2PatternBody` (0x4000 Bytes) — ein `.e2spat` ist genau dieser Body? **Nein:** `.e2spat` hat laut `e2sExport.ts` einen Datei-Header; nimm die dort vorhandene Funktion `buildE2PatFile` wenn es sie gibt, sonst `buildE2AllPatFile([p])` und den ersten Slot ausschneiden. Beim Implementieren `grep -n "export function build" src/core/e2sExport.ts` ausführen und die existierende `.e2spat`-Funktion nutzen (Tests in `tests/e2s-export.test.ts` zeigen den Aufruf).

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-pattern.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept, regelRezeptProMelo } from "../src/core/rezept";
import { baueRezept, baueProMelo, alsAllPat } from "../src/core/patternGen";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";
import { e2PatternRefToBankNumber } from "../src/core/e2sPatternSampleLink";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs.readdirSync(KORG3).filter((f) => f.endsWith(".wav")).map((f) => { const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f)))); return { name: f, pcm: w.pcm, sampleRate: w.sampleRate }; });
const { projekt } = planeBank(scanne(eingaben).eintraege, { name: "korg3", bpm: 180, bankZeit: "x" });
const nummern = new Set(projekt.samples.map((s) => s.nr));

describe("patternGen", () => {
  it("jam: ein Pattern, 64 Steps, alle Refs in der Bank, Parts ohne Steps gemutet", () => {
    const { patterns } = baueRezept(regelRezept(projekt, { modus: "jam" }), projekt);
    expect(patterns).toHaveLength(1);
    const p = patterns[0];
    expect(p.stepLength).toBe(64);
    expect(p.bpm).toBe(180);
    expect(p.parts).toHaveLength(16);
    for (const part of p.parts) {
      const aktiv = part.steps.some((s) => s.active);
      expect(part.muted).toBe(!aktiv);
      if (aktiv) expect(nummern.has(e2PatternRefToBankNumber(part.sampleId!))).toBe(true);
    }
    expect(p.parts.filter((x) => !x.muted).length).toBeGreaterThanOrEqual(8);
  });
  it("jam: 8-Takt-Melo triggert nur Part 13, Part 14 schweigt; 4-Takt-Melo triggert 13 und 14", () => {
    const acht = baueRezept(regelRezept(projekt, { modus: "jam", melo: "bgg A" }), projekt).patterns[0];
    // bgg A/B sind im Repo bereits 4-Takt-Dateien → beide Parts triggern
    expect(acht.parts[12].steps.filter((s) => s.active)).toHaveLength(1);
    expect(acht.parts[13].steps.filter((s) => s.active)).toHaveLength(1);
    const lang = projekt.samples.find((s) => s.rolle === "melo" && s.takte === 8);
    if (lang) {
      const p = baueRezept(regelRezept(projekt, { modus: "jam", melo: lang.name }), projekt).patterns[0];
      expect(p.parts[12].steps.filter((s) => s.active)).toHaveLength(1);
      expect(p.parts[13].muted).toBe(true);
      expect(p.alternate13_14).toBe(true);
    }
  });
  it("miniset: Kette ueber 6 Patterns, letztes ohne Ziel, Intensitaet steuert Mutes", () => {
    const { patterns } = baueRezept(regelRezept(projekt, { modus: "miniset" }), projekt, { startSlot: 10 });
    expect(patterns).toHaveLength(6);
    expect(patterns.map((p) => p.chainTo)).toEqual([11, 12, 13, 14, 15, 0]);
    expect(patterns[0].chainRepeat).toBe(2);
    const wach = (p: typeof patterns[0]) => p.parts.filter((x) => !x.muted).length;
    expect(wach(patterns[2])).toBeGreaterThan(wach(patterns[0]));
    expect(patterns.map((p) => p.name)).toEqual(["K3 bare INTRO", "K3 bare AUFBAU", "K3 bare DROP 1", "K3 bare BREAK", "K3 bare DROP 2", "K3 bare OUTRO"].map((n) => n.replace("K3 bare", "bare")));
  });
  it("promelo: ein Pattern je Melodie, alsAllPat liefert 250 Slots und ist rueckparsbar", () => {
    const { patterns } = baueProMelo(regelRezeptProMelo(projekt), projekt);
    expect(patterns.length).toBe(projekt.samples.filter((s) => s.rolle === "melo" && s.kind === "loop" && (s.chunk === undefined || s.chunk === 0)).length);
    const buf = alsAllPat(patterns);
    const bank = parseElectribeAllPatBank(buf);
    expect(bank.patterns).toHaveLength(250);
    expect(bank.patterns[0].bpm).toBe(180);
    expect(bank.patterns[patterns.length].name.trim()).toBe("-");
  });
  it("golden: gleiches Rezept → gleiche Bytes", () => {
    const r = regelRezept(projekt, { modus: "miniset" });
    const a = alsAllPat(baueRezept(r, projekt).patterns), b = alsAllPat(baueRezept(r, projekt).patterns);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-pattern.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/patternGen.ts
/**
 * patternGen — Rezept → E2PatternInput[] (Figuren-Bibliothek aus
 * scripts/make-folder-set.mjs, ohne 250er-Ketten).
 *  Parts: 1 Kick A, 2 Kick B, 3 Snare, 4 Clap, 5 Hat closed, 6 Hat open, 7 Perc, 8 Perc 2,
 *         9 Bass, 10 Stab (Poly), 11 Shot A, 12 Shot B/Riser, 13/14 Melo, 15/16 Vers.
 *  Loops > 4 Takte: nur Part 13/15 triggert, 14/16 schweigt (Alternate laesst 8 Takte laufen).
 *  Parts ohne Steps sind gemutet.
 */
import type { E2PatternInput, E2PartInput, E2StepInput } from "./electribePatternBuilder";
import { buildE2AllPatFile } from "./e2sExport";
import { bankNumberToE2PatternRef } from "./e2sPatternSampleLink";
import type { Projekt, ProjektSample } from "./bankPlan";
import { type Rezept, type Abschnitt, type Thema, type KickFigur, pools } from "./rezept";

const N = 64;
const MONO1 = 0, POLY2 = 3;
const takt = (s: number) => Math.floor(s / 16), imTakt = (s: number) => s % 16;
const leer = (): E2StepInput[] => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes: number[], velocity: number, gate: number): E2StepInput => ({ active: true, notes, velocity, gate });
const baue = (fn: (s: number) => E2StepInput | null): E2StepInput[] => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
const loopHit = (takte: number, vel = 127) => { const alle = takte === 1 ? 16 : takte === 2 ? 32 : 64; return baue((s) => (s % alle === 0 ? hit([60], vel, 96) : null)); };

const KICK: Record<KickFigur, () => E2StepInput[]> = {
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null)),
  roll: () => baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
  galopp: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : s % 8 === 6 ? hit([60], 100, 14) : null)),
};
const STAB = {
  ruhig: () => baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([60], 92, 40) : null)),
  stab: () => baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([takt(s) === 3 && imTakt(s) === 12 ? 67 : 60], 96, 14) : null)),
  arp: () => baue((s) => (s % 4 === 2 ? hit([[60, 67, 72, 67][takt(s)]], 88, 12) : null)),
  frage: () => baue((s) => (imTakt(s) === 0 ? hit([takt(s) % 2 ? 55 : 60], 94, 40) : imTakt(s) === 10 ? hit([60], 84, 14) : null)),
  phrase: () => baue((s) => (s === 0 || s === 32 ? hit([60], 100, 96) : null)),
};
const BASS = {
  off: () => baue((s) => (s % 4 === 2 ? hit([takt(s) === 3 && imTakt(s) >= 8 ? 67 : 60], 110, 12) : null)),
  roll: () => baue((s) => (takt(s) < 3 ? (s % 4 === 2 ? hit([60], 110, 12) : null) : s % 2 === 1 ? hit([60], 104, 8) : null)),
  acht: () => baue((s) => (s % 2 === 1 ? hit([imTakt(s) === 15 ? 55 : 60], 104, 8) : null)),
};
const SHOT_A = () => baue((s) => (s === 0 || s === 32 ? hit([60], 118, 96) : null));
const SHOT_B = () => baue((s) => (s === 24 || s === 56 ? hit([60], 112, 96) : null));
//            K1   K2   SN   CL   HH  HH2   PC  PC2  BASS STAB SHA  SHB  MELA MELB VRA  VRB
const VOLUME = [127, 104, 110, 96, 88, 82, 84, 80, 118, 100, 112, 108, 112, 112, 114, 114];

function parts(rezept: Rezept, projekt: Projekt, a: Abschnitt, pos: number, zweiteHaelfte: boolean): E2PartInput[] {
  const pl = pools(projekt);
  const byName = (n?: string) => (n ? projekt.samples.find((s) => s.name === n) : undefined);
  const t: Thema = rezept.thema;
  const fam = pl.familien.find((f) => f.name === t.kickFamilie) ?? pl.familien[0];
  const kicks = fam.kicks.length >= 2 ? fam.kicks : fam.kicks.concat(pl.kicks.filter((k) => !fam.kicks.includes(k)).slice(0, 2));
  const kick2 = kicks[1 + (pos % Math.max(kicks.length - 1, 1))] ?? kicks[0];
  const haelfte = (s?: ProjektSample) => {
    if (!s || !s.chunks) return s;
    const b = projekt.samples.find((x) => x.gruppe === s.gruppe && x.chunk === 1);
    return zweiteHaelfte && b ? b : s;
  };
  const melo = haelfte(byName(t.melo)), vers = haelfte(byName(t.vers));
  const stab = byName(t.stab), bass = byName(t.bass);
  const shotA = byName(t.shots?.[0]), riser = byName(t.riser), shotB = a.lagen.includes("riser") && riser ? riser : byName(t.shots?.[1]);
  const i = a.intensitaet;
  const hatsOff = rezept.figuren.hatsOffbeat;
  const lang = (s?: ProjektSample) => !!s && s.kind === "loop" && s.takte > 4;

  const steps: E2StepInput[][] = Array.from({ length: 16 }, leer);
  const wach = new Array<boolean>(16).fill(false);
  steps[0] = KICK[a.kick](); wach[0] = true;
  steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 22) : takt(s) === 3 && imTakt(s) === 14 ? hit([60], 100, 14) : null)); wach[1] = i >= 4;
  steps[2] = baue((s) => (a.kick === "roll" && takt(s) === 3 ? hit([60], 100, 10) : imTakt(s) === 4 || imTakt(s) === 12 ? hit([60], 106, 28) : null)); wach[2] = i >= 3 || a.kick === "roll";
  steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 96, 22) : takt(s) === 1 && imTakt(s) === 14 ? hit([60], 84, 12) : null)); wach[3] = i >= 4;
  steps[4] = baue((s) => (s % 4 === (hatsOff ? 2 : 0) ? hit([60], 82, 12) : null)); wach[4] = i >= 1;
  steps[5] = baue((s) => (s % 2 === 1 ? hit([60], takt(s) === 3 ? 78 : 70, 8) : null)); wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null)); wach[6] = i >= 4;
  steps[7] = baue((s) => (imTakt(s) === 14 && takt(s) % 2 === 1 ? hit([60], 84, 40) : imTakt(s) === 7 && takt(s) === 3 ? hit([60], 80, 10) : null)); wach[7] = i >= 5;
  steps[8] = BASS[rezept.figuren.bass](); wach[8] = a.lagen.includes("bass") && !!bass;
  const stabFig = stab && (stab.kind === "loop" || stab.sekunden >= 2) ? "phrase" : rezept.figuren.stab;
  steps[9] = STAB[stabFig](); wach[9] = a.lagen.includes("stab") && !!stab;
  steps[10] = shotA?.kind === "loop" ? loopHit(shotA.takte, 118) : SHOT_A(); wach[10] = a.lagen.includes("shot") && !!shotA;
  steps[11] = shotB?.kind === "loop" ? loopHit(shotB.takte, 110) : SHOT_B(); wach[11] = (a.lagen.includes("riser") && shotB === riser && !!riser) || (a.lagen.includes("shot") && !!shotB && shotB !== riser);
  steps[12] = melo ? loopHit(melo.takte) : leer(); steps[13] = melo && !lang(melo) ? loopHit(melo.takte) : leer();
  wach[12] = a.lagen.includes("melo") && !!melo; wach[13] = wach[12] && !lang(melo);
  steps[14] = vers ? loopHit(vers.takte) : leer(); steps[15] = vers && !lang(vers) ? loopHit(vers.takte) : leer();
  wach[14] = a.lagen.includes("vers") && !!vers; wach[15] = wach[14] && !lang(vers);

  const pc = pl.percs.length ? pl.percs[(2 * pos) % pl.percs.length] : undefined, pc2 = pl.percs.length ? pl.percs[(2 * pos + 1) % pl.percs.length] : undefined;
  const sample: (ProjektSample | undefined)[] = [kicks[0], kick2, byName(t.snare), byName(t.clap), byName(t.hats[0]), byName(t.hats[1]),
    byName(t.percs?.[0]) ?? pc, byName(t.percs?.[1]) ?? pc2, bass, stab, shotA, shotB, melo, melo, vers, vers];
  return steps.map((st, idx) => {
    const smp = sample[idx];
    const params: Record<string, number> = { voiceAssign: idx === 9 ? POLY2 : MONO1 };
    if (idx <= 1) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (smp?.kind === "loop" || (idx >= 10 && (smp?.sekunden ?? 0) >= 1)) params.ampEgOn = 0;
    if (idx === 8 && smp?.rolle === "kick") params.oscPitch = -12;
    if (idx === 5) params.egDecay = 60;
    const an = wach[idx] && !!smp;
    return { sampleId: smp ? bankNumberToE2PatternRef(smp.nr) : 0, steps: an ? st : leer(), volume: VOLUME[idx], params, muted: !an };
  });
}

function tagAus(rezept: Rezept): string {
  const n = (rezept.thema.melo ?? "T").replace(/^[^A-Za-z0-9#]+/, "");
  return n.split(/\s+/)[0].slice(0, 4) || "T";
}

export function baueRezept(rezept: Rezept, projekt: Projekt, opts: { startSlot?: number; mfxType?: number } = {}): { patterns: E2PatternInput[]; hinweise: string[] } {
  const start = opts.startSlot ?? 1;
  const hinweise: string[] = [];
  const tag = tagAus(rezept);
  const n = rezept.abschnitte.length;
  const patterns = rezept.abschnitte.map((a, i) => ({
    name: (rezept.modus === "jam" || rezept.modus === "promelo" ? `${tag} JAM` : `${tag} ${a.name}`).slice(0, 16),
    bpm: rezept.bpm,
    mfxType: opts.mfxType ?? 11,
    stepLength: 64 as const,
    parts: parts(rezept, projekt, a, i, i >= Math.ceil(n / 2) && n > 1),
    alternate13_14: true,
    alternate15_16: true,
    chainTo: rezept.modus === "miniset" && i < n - 1 ? start + i + 1 : 0,
    chainRepeat: rezept.modus === "miniset" ? a.wiederholungen : 1,
  }));
  if (!rezept.thema.melo) hinweise.push("keine Melodie im Projekt — Pattern nur Drums/Bass/Shots");
  return { patterns, hinweise };
}

export function baueProMelo(rezepte: Rezept[], projekt: Projekt): { patterns: E2PatternInput[]; hinweise: string[] } {
  const out: E2PatternInput[] = [], hinweise: string[] = [];
  rezepte.forEach((r, i) => {
    const { patterns, hinweise: h } = baueRezept(r, projekt, { startSlot: i + 1 });
    out.push(...patterns); hinweise.push(...h);
  });
  return { patterns: out, hinweise };
}

const LEER: E2PatternInput = { name: "-", bpm: 120, stepLength: 16, parts: [] };

/** 250-Slot-Bank: Patterns ab `startSlot` (1-basiert), Rest leere Init-Patterns. */
export function alsAllPat(patterns: E2PatternInput[], startSlot = 1): ArrayBuffer {
  const alle: E2PatternInput[] = Array.from({ length: 250 }, () => LEER);
  patterns.forEach((p, i) => { if (startSlot - 1 + i < 250) alle[startSlot - 1 + i] = p; });
  return buildE2AllPatFile(alle);
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-pattern.test.ts`
Expected: PASS (5 Tests). Wenn `buildE2AllPatFile` leere Parts nicht akzeptiert: `LEER.parts` mit 16 `{ steps: [], muted: true }` füllen. `alsPat` (Einzel-`.e2spat`) erst in Task 6 über die vorhandene Export-Funktion anbinden.

- [ ] **Step 5: Commit**

```bash
git add src/core/patternGen.ts tests/generator-pattern.test.ts
git commit -m "feat(generator): patternGen — Rezept zu Jam/Mini-Set/Pro-Melo-Patterns"
```

---

### Task 6: CLI `scripts/generator-cli.mjs` — Ende-zu-Ende auf einem Verzeichnis

**Files:**
- Create: `scripts/generator-cli.mjs`
- Modify: `README.md` (Abschnitt „Sample-Ordner → Bank + Pattern-Set": drei Zeilen zum neuen CLI)

**Interfaces:**
- Consumes: `parseWav`, `scanne`, `planeBank`, `regelRezept`, `regelRezeptProMelo`, `baueRezept`, `baueProMelo`, `alsAllPat`, `tempoVorschlag`; für `.e2spat` die vorhandene Export-Funktion aus `e2sExport.ts` (Name per `grep -n "export function build" src/core/e2sExport.ts` ermitteln — in `tests/e2s-export.test.ts` steht der Aufruf).
- Produces: `<verzeichnis>/TekkForge/<name>.all`, `projekt.json`, `<NAME>-jam.e2spat` | `<NAME>-miniset.e2sallpat` | `<NAME>-promelo.e2sallpat`.

- [ ] **Step 1: Skript schreiben**

```js
/**
 * generator-cli.mjs — Verzeichnis → Projekt (.all + projekt.json) → Patterns.
 * Nur WAV (mono/stereo beliebig; Stereo wird gemittelt, Rate auf 44,1 k gebracht).
 *
 * Aufruf: npx tsx scripts/generator-cli.mjs <verzeichnis> [--modus jam|miniset|promelo]
 *           [--bpm 180] [--melo "Name"] [--beschreibung "…"] [--volume 1] [--tekk-drums]
 *           [--name xyz] [--slot 1]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec.ts";
import { polyPhaseResample, downmixToMono } from "../src/core/audioProcessor.ts";
import { scanne } from "../src/core/sampleScan.ts";
import { planeBank } from "../src/core/bankPlan.ts";
import { tempoVorschlag } from "../src/core/tempoAnalyse.ts";
import { regelRezept, regelRezeptProMelo } from "../src/core/rezept.ts";
import { baueRezept, baueProMelo, alsAllPat } from "../src/core/patternGen.ts";
import { buildE2PatFile } from "../src/core/e2sExport.ts"; // Namen ggf. anpassen (siehe Interfaces)

const ARG = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const DIR = process.argv[2];
if (!DIR) throw new Error("Verzeichnis fehlt");
const MODUS = ARG("--modus", "jam");
const NAME = ARG("--name", path.basename(DIR).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "projekt");
const OUT = path.join(DIR, "TekkForge");
fs.mkdirSync(OUT, { recursive: true });

const eingaben = [];
for (const f of fs.readdirSync(DIR).filter((f) => /\.wav$/i.test(f)).sort()) {
  try {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(DIR, f))));
    let pcm = w.channels === 2 ? downmixToMono(w.pcm).pcm : w.pcm;
    if (w.sampleRate !== 44100) pcm = polyPhaseResample(pcm, w.sampleRate, 44100, 1);
    eingaben.push({ name: f, pcm, sampleRate: 44100 });
  } catch (e) { console.log(`  unlesbar: ${f} (${e.message})`); }
}
const { eintraege, uebersprungen } = scanne(eingaben);
for (const u of uebersprungen) console.log(`  weg: ${u.datei} — ${u.grund}`);
const vorschlag = tempoVorschlag(eintraege.map((e) => e.sekunden));
const bpm = Number(ARG("--bpm", vorschlag));
console.log(`${eintraege.length} Samples · Tempo-Vorschlag ${vorschlag} BPM · genommen ${bpm}`);

const tekk = process.argv.includes("--tekk-drums") ? new Uint8Array(fs.readFileSync("examples/e2s/tekk4.all")) : undefined;
const { projekt, bank, warnungen } = planeBank(eintraege, { name: NAME, bpm, volume: Number(ARG("--volume", 1)), tekkDrumsBank: tekk });
for (const w of warnungen) console.log("  ! " + w);
fs.writeFileSync(path.join(OUT, `${NAME}.all`), Buffer.from(bank));
fs.writeFileSync(path.join(OUT, "projekt.json"), JSON.stringify(projekt, null, 1));
console.log(`${OUT}/${NAME}.all — ${projekt.samples.length} Samples (Volume ${projekt.volume}/${projekt.volumes})`);

const slot = Number(ARG("--slot", 1));
if (MODUS === "promelo") {
  const { patterns, hinweise } = baueProMelo(regelRezeptProMelo(projekt, bpm), projekt);
  hinweise.forEach((h) => console.log("  " + h));
  fs.writeFileSync(path.join(OUT, `${NAME.toUpperCase()}-promelo.e2sallpat`), Buffer.from(alsAllPat(patterns)));
  console.log(`${patterns.length} Jam-Patterns (eines je Melodie) → ${NAME.toUpperCase()}-promelo.e2sallpat`);
} else {
  const rezept = regelRezept(projekt, { modus: MODUS, bpm, melo: ARG("--melo", undefined), beschreibung: ARG("--beschreibung", "") });
  console.log("Warum so? " + rezept.begruendung);
  const { patterns, hinweise } = baueRezept(rezept, projekt, { startSlot: slot });
  hinweise.forEach((h) => console.log("  " + h));
  if (MODUS === "jam") {
    fs.writeFileSync(path.join(OUT, `${NAME.toUpperCase()}-jam.e2spat`), Buffer.from(buildE2PatFile(patterns[0])));
    console.log(`Jam-Pattern "${patterns[0].name}" → ${NAME.toUpperCase()}-jam.e2spat`);
  } else {
    fs.writeFileSync(path.join(OUT, `${NAME.toUpperCase()}-miniset.e2sallpat`), Buffer.from(alsAllPat(patterns, slot)));
    console.log(`Mini-Set ${patterns.length} Patterns ab Slot ${slot} → ${NAME.toUpperCase()}-miniset.e2sallpat`);
  }
}
```

- [ ] **Step 2: Ende-zu-Ende auf korg3 laufen lassen**

Run (aus dem Repo-Wurzelverzeichnis):
```bash
npx tsx scripts/generator-cli.mjs examples/e2s/korg3 --modus jam --name korg3g
npx tsx scripts/generator-cli.mjs examples/e2s/korg3 --modus miniset --name korg3g --beschreibung "hart, rollende bass"
npx tsx scripts/generator-cli.mjs examples/e2s/korg3 --modus promelo --name korg3g
python G:/IdeaProjects/Omnitribe/tools/formats/e2s_geometry_check.py examples/e2s/korg3/TekkForge/korg3g.all
```
Expected: drei Ausgabedateien in `examples/e2s/korg3/TekkForge/`, Tempo-Vorschlag 180, `Versatz: OK`. Danach `examples/e2s/korg3/TekkForge/` wieder löschen (kein Commit der Ausgaben).

- [ ] **Step 3: README ergänzen**

Unter „Sample-Ordner → Bank + Pattern-Set" nach dem Code-Block einfügen:

```markdown
Der neue Weg ohne Python (Kern des kommenden Generator-Tabs, nur WAV):

```bash
npx tsx scripts/generator-cli.mjs "<ordner>" --modus jam|miniset|promelo [--bpm 180] [--melo "Name"] [--beschreibung "hart, arp"] [--tekk-drums]
```

Schreibt `<ordner>/TekkForge/<name>.all` + `projekt.json` und das Pattern als
`.e2spat` (Jam) bzw. `.e2sallpat` (Mini-Set 6 Patterns gechaint, Pro Melo ein
Jam-Pattern je Melodie). Melodien bleiben ganz; Module: `src/core/{tempoAnalyse,
sampleScan,bankPlan,rezept,patternGen}.ts`.
```

- [ ] **Step 4: Gesamte Testsuite + Typprüfung**

Run: `pnpm check && pnpm test`
Expected: `tsc` ohne Fehler, alle Tests grün (bisherige 389 + neue).

- [ ] **Step 5: Commit**

```bash
git add scripts/generator-cli.mjs README.md
git commit -m "feat(generator): CLI Verzeichnis → Projekt → Jam/Mini-Set/Pro-Melo (Stufe 1 komplett)"
```

---

## Self-Review

- **Spec-Abdeckung Stufe 1:** `sampleScan` (Task 2), `tempoAnalyse` (Task 1), `bankPlan` inkl. Volumes/Hälften/tekk-Drums/Projekt-Status (Task 3), `rezept` mit Schema-Prüfung und Regel-Planer (Task 4), `patternGen` mit Jam-/Mini-Set-/Pro-Melo-Logik, Mute-Regel, Alternate-Regel (Task 5), Ende-zu-Ende + Geometrie (Task 6). `kiPlaner`, `liedAnalyse`, GUI, Gerät sind Stufen 2–5 (eigene Pläne).
- **Typen:** `ProjektSample.gruppe` wird in `rezept.pools` (`"tekk"`) und `patternGen.haelfte` (Gruppe der Hälften) gleich benutzt; `takte` heißt überall `takte` (nicht `bars`); `chunk: 0 | 1`, `chunks: 2`.
- **Offene Stelle bewusst benannt:** `.e2spat`-Exportfunktion in Task 6 per grep ermitteln (Name im Repo unbekannt beim Planen) — kein Platzhalter, sondern eine konkrete Anweisung.
