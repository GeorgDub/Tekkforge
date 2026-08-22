# Generator Stufe 2 — Tab „Generator" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünfter Tab in der TekkForge-GUI: Sample-Verzeichnis wählen → Scan (Rollen, Tempo-Vorschlag, RAM) → Bank bauen → Jam / Mini-Set / Pro Melo generieren → „→ Datei", „→ Editor", Vorhören der Melodien, „Warum so?".

**Architecture:** Die Entscheidungslogik liegt in einem reinen Modul `src/core/generatorSession.ts` (Zusammenfassung, tekk-Drums-Empfehlung, Dateinamen, eine `erzeuge()`-Funktion, die Rezept → Patterns → Bytes bündelt) und ist getestet. `src/gui/generator.ts` ist dünne DOM-Schicht nach dem Muster von `paddeck.ts` (rendert seine Section aus TS) und nutzt die Stufe-1-Module. Dekodierung im Renderer: WAV über `parseWav`, alles andere über `OfflineAudioContext.decodeAudioData` (Chromium kann mp3/m4a) — beides auf mono 44,1 k. Ausgabe per `download()` wie Converter/Editor; die Editor-Übergabe über `editorProjectFromE2Files` + `loadProject` + Tab-Wechsel. Kein Dateisystem-Zugriff im Renderer (kommt mit Stufe 3 über IPC).

**Tech Stack:** TypeScript, Vite, Electron-Renderer (auch als Browser-Single-File), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-generator-design.md` (Abschnitt „Bedienung", „Projekt", „Fehler")

## Global Constraints

- GUI-Code in `src/gui/`, Logik in `src/core/` (kein DOM dort). Tests nur für `src/core/`.
- Deutsch in Oberfläche, Kommentaren und Commit-Texten.
- Melodien bleiben ganz; Mutes für Parts ohne Steps (kommt aus Stufe 1).
- Bestehende Tabs unverändert; `main.ts` bekommt nur den fünften Tab und den Editor-Handoff.
- Abweichung zur Spec, bewusst: Das Beschreibungsfeld bleibt ohne API-Key **aktiv** (Schlüsselwörter wirken schon im Regel-Planer); ein Hinweis sagt, dass die KI-Übersetzung erst mit Key (Stufe 4) kommt.
- `pnpm check && pnpm test` grün; App-Start mit `pnpm desktop` (Screenshot über die Skill `run-tekkforge`).

---

## Dateiplan

| Datei | Verantwortung |
|---|---|
| `src/core/generatorSession.ts` | `zusammenfassung()`, `tekkDrumsEmpfohlen()`, `dateiArt()`, `erzeuge()` (Modus → Rezept(e) → Patterns → Bytes + Dateiname), `projektJson()` |
| `tests/generator-session.test.ts` | Tests dazu |
| `src/gui/audioDecode.ts` | `dekodiere(file): Promise<ScanEingabe>` — WAV per `parseWav`, sonst `OfflineAudioContext` |
| `src/gui/generator.ts` | Tab: Rendern, Zustand, Knöpfe, Vorhören, Download, Editor-Übergabe |
| `index.html` | Tab-Knopf `tabGenerator`, `<section id="viewGenerator" class="hidden"></section>`, CSS |
| `src/gui/main.ts` | Tab registrieren, `initGenerator(onEditor)` |
| `README.md` | zwei Sätze unter „Schnellstart" |

---

### Task 1: generatorSession — reine Logik mit Tests

**Files:**
- Create: `src/core/generatorSession.ts`
- Test: `tests/generator-session.test.ts`

**Interfaces:**
- Consumes: `ScanEintrag` (sampleScan), `Projekt`, `planeBank` (bankPlan), `regelRezept`, `regelRezeptProMelo`, `Rezept`, `Modus` (rezept), `baueRezept`, `baueProMelo`, `alsAllPat`, `alsPat` (patternGen), `tempoVorschlag`.
- Produces:
  - `interface Zusammenfassung { anzahl: number; rollen: Record<string, number>; sekunden: number; megabyte: number; tempoVorschlag: number; volumesNoetig: number; tekkEmpfohlen: boolean }`
  - `zusammenfassung(eintraege: ScanEintrag[], budgetSekunden?: number): Zusammenfassung`
  - `tekkDrumsEmpfohlen(eintraege: ScanEintrag[]): boolean` — true, wenn keine Kick **oder** keine Hat **oder** keine Snare/Clap.
  - `dateiArt(name: string): "wav" | "audio" | "skip"` — wav/wave → wav; mp3/m4a/aac/ogg/flac/aif/aiff → audio; sonst skip.
  - `interface Erzeugt { modus: Modus; rezepte: Rezept[]; patterns: E2PatternInput[]; bytes: Uint8Array; dateiname: string; hinweise: string[]; warumSo: string }`
  - `erzeuge(projekt: Projekt, wunsch: { modus: Modus; bpm: number; melo?: string; beschreibung?: string; startSlot?: number }): Erzeugt`
  - `projektJson(projekt: Projekt): string` — `JSON.stringify(projekt, null, 1)`.

- [ ] **Step 1: Failing test schreiben**

```ts
// tests/generator-session.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { zusammenfassung, tekkDrumsEmpfohlen, dateiArt, erzeuge } from "../src/core/generatorSession";
import { parseElectribeAllPatBank, parseElectribePattern } from "../src/core/electribeImport";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs.readdirSync(KORG3).filter((f) => f.endsWith(".wav")).map((f) => {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
  return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
});
const { eintraege } = scanne(eingaben);
const { projekt } = planeBank(eintraege, { name: "korg3", bpm: 180, bankZeit: "x" });

describe("generatorSession", () => {
  it("zusammenfassung: Rollen, Sekunden, MB, Tempo 180, ein Volume, keine tekk-Drums noetig", () => {
    const z = zusammenfassung(eintraege);
    expect(z.anzahl).toBe(eintraege.length);
    expect(z.rollen.kick).toBe(16);
    expect(z.tempoVorschlag).toBe(180);
    expect(z.sekunden).toBeGreaterThan(80);
    expect(z.megabyte).toBeCloseTo((z.sekunden * 2 * 44100) / 1048576, 1);
    expect(z.volumesNoetig).toBe(1);
    expect(z.tekkEmpfohlen).toBe(false);
  });
  it("tekkDrumsEmpfohlen: ohne Kick oder ohne Hat oder ohne Snare/Clap → true", () => {
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "kick"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "hat"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "snare" && e.rolle !== "clap"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege)).toBe(false);
  });
  it("dateiArt", () => {
    expect(dateiArt("Kick.WAV")).toBe("wav");
    expect(dateiArt("x.mp3")).toBe("audio");
    expect(dateiArt("x.m4a")).toBe("audio");
    expect(dateiArt("x.flp")).toBe("skip");
    expect(dateiArt("manifest.json")).toBe("skip");
  });
  it("erzeuge jam → .e2spat mit einem Pattern und Begruendung", () => {
    const e = erzeuge(projekt, { modus: "jam", bpm: 180 });
    expect(e.patterns).toHaveLength(1);
    expect(e.dateiname).toBe("KORG3-jam.e2spat");
    expect(e.bytes.byteLength).toBe(16640);
    expect(parseElectribePattern(e.bytes).bpm).toBe(180);
    expect(e.warumSo).toContain("BaReTT");
  });
  it("erzeuge miniset → .e2sallpat ab Slot 10 mit Kette", () => {
    const e = erzeuge(projekt, { modus: "miniset", bpm: 176, startSlot: 10, beschreibung: "hart" });
    expect(e.patterns).toHaveLength(6);
    expect(e.dateiname).toBe("KORG3-miniset.e2sallpat");
    const bank = parseElectribeAllPatBank(e.bytes);
    expect(bank.patterns[9].bpm).toBe(176);
    expect(bank.patterns[9].name.trim()).toBe("BaRe INTRO");
    expect(bank.patterns[0].name.trim()).toBe("-");
  });
  it("erzeuge promelo → ein Rezept je Melodie", () => {
    const e = erzeuge(projekt, { modus: "promelo", bpm: 180 });
    expect(e.rezepte.length).toBe(e.patterns.length);
    expect(e.patterns.length).toBeGreaterThanOrEqual(6);
    expect(e.dateiname).toBe("KORG3-promelo.e2sallpat");
    expect(e.warumSo).toContain("Melodien");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/generator-session.test.ts`
Expected: FAIL (Modul nicht gefunden)

- [ ] **Step 3: Implementierung**

```ts
// src/core/generatorSession.ts
/**
 * generatorSession — die Entscheidungen des Generator-Tabs ohne DOM:
 * Zusammenfassung eines Scans, tekk-Drums-Empfehlung, Dateiarten und
 * erzeuge() = Modus → Rezept(e) → Patterns → Bytes + Dateiname.
 */
import type { ScanEintrag } from "./sampleScan";
import { tempoVorschlag } from "./tempoAnalyse";
import { type Projekt, BUDGET_SEKUNDEN, waehleVolumes } from "./bankPlan";
import { type Rezept, type Modus, regelRezept, regelRezeptProMelo } from "./rezept";
import { baueRezept, baueProMelo, alsAllPat, alsPat } from "./patternGen";
import type { E2PatternInput } from "./electribePatternBuilder";

export interface Zusammenfassung {
  anzahl: number;
  rollen: Record<string, number>;
  sekunden: number;
  megabyte: number;
  tempoVorschlag: number;
  volumesNoetig: number;
  tekkEmpfohlen: boolean;
}

export function tekkDrumsEmpfohlen(eintraege: ScanEintrag[]): boolean {
  const hat = (r: ScanEintrag["rolle"]) => eintraege.some((e) => e.rolle === r);
  return !hat("kick") || !hat("hat") || !(hat("snare") || hat("clap"));
}

export function zusammenfassung(eintraege: ScanEintrag[], budgetSekunden = BUDGET_SEKUNDEN): Zusammenfassung {
  const rollen: Record<string, number> = {};
  for (const e of eintraege) rollen[e.rolle] = (rollen[e.rolle] ?? 0) + 1;
  const sekunden = eintraege.reduce((s, e) => s + e.sekunden, 0);
  const bpm = tempoVorschlag(eintraege.map((e) => e.sekunden));
  return {
    anzahl: eintraege.length,
    rollen,
    sekunden,
    megabyte: (sekunden * 2 * 44100) / 1048576,
    tempoVorschlag: bpm,
    volumesNoetig: Math.max(1, waehleVolumes(eintraege, bpm, budgetSekunden).length),
    tekkEmpfohlen: tekkDrumsEmpfohlen(eintraege),
  };
}

export function dateiArt(name: string): "wav" | "audio" | "skip" {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (ext === "wav" || ext === "wave") return "wav";
  if (["mp3", "m4a", "aac", "ogg", "flac", "aif", "aiff"].includes(ext)) return "audio";
  return "skip";
}

export interface Erzeugt {
  modus: Modus;
  rezepte: Rezept[];
  patterns: E2PatternInput[];
  bytes: Uint8Array;
  dateiname: string;
  hinweise: string[];
  warumSo: string;
}

export function erzeuge(
  projekt: Projekt,
  wunsch: { modus: Modus; bpm: number; melo?: string; beschreibung?: string; startSlot?: number },
): Erzeugt {
  const basis = projekt.name.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (wunsch.modus === "promelo") {
    const rezepte = regelRezeptProMelo(projekt, wunsch.bpm);
    const { patterns, hinweise } = baueProMelo(rezepte, projekt);
    return {
      modus: "promelo", rezepte, patterns, bytes: new Uint8Array(alsAllPat(patterns)),
      dateiname: `${basis}-promelo.e2sallpat`, hinweise,
      warumSo: `${rezepte.length} Melodien, je ein Jam-Pattern; Kick-Familien rotieren: ${rezepte.map((r) => `${r.thema.melo} → ${r.thema.kickFamilie}`).join(", ")}.`,
    };
  }
  const rezept = regelRezept(projekt, { modus: wunsch.modus, bpm: wunsch.bpm, melo: wunsch.melo, beschreibung: wunsch.beschreibung });
  const start = wunsch.startSlot ?? 1;
  const { patterns, hinweise } = baueRezept(rezept, projekt, { startSlot: start });
  const jam = wunsch.modus === "jam";
  return {
    modus: wunsch.modus, rezepte: [rezept], patterns,
    bytes: jam ? alsPat(patterns[0]) : new Uint8Array(alsAllPat(patterns, start)),
    dateiname: jam ? `${basis}-jam.e2spat` : `${basis}-miniset.e2sallpat`,
    hinweise, warumSo: rezept.begruendung,
  };
}

export function projektJson(projekt: Projekt): string {
  return JSON.stringify(projekt, null, 1);
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/generator-session.test.ts`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/generatorSession.ts tests/generator-session.test.ts
git commit -m "feat(generator): generatorSession — Zusammenfassung, tekk-Empfehlung, erzeuge()"
```

---

### Task 2: Dekodierung im Renderer

**Files:**
- Create: `src/gui/audioDecode.ts`

**Interfaces:**
- Produces: `dekodiere(file: File): Promise<ScanEingabe>` — mono 44 100 Hz; wirft `Error` mit deutscher Meldung.
- Consumes: `parseWav`, `downmixToMono`, `polyPhaseResample`, `dateiArt`.

- [ ] **Step 1: Implementierung** (kein Unit-Test — braucht Web Audio; Abnahme in Task 4 am Bildschirm)

```ts
// src/gui/audioDecode.ts
/**
 * audioDecode — Datei → mono 44,1 k fuer den Scan. WAV ueber parseWav (schnell,
 * kein Web Audio), alles andere ueber OfflineAudioContext.decodeAudioData
 * (Chromium dekodiert mp3/m4a/ogg/flac; resamplet auf die Context-Rate).
 */
import { parseWav } from "../core/wavCodec";
import { downmixToMono, polyPhaseResample } from "../core/audioProcessor";
import { dateiArt } from "../core/generatorSession";
import type { ScanEingabe } from "../core/sampleScan";

const SR = 44100;

export async function dekodiere(file: File): Promise<ScanEingabe> {
  const art = dateiArt(file.name);
  if (art === "skip") throw new Error("kein Audio");
  const bytes = await file.arrayBuffer();
  if (art === "wav") {
    const w = parseWav(new Uint8Array(bytes));
    let pcm = w.channels === 2 ? downmixToMono(w.pcm).pcm : w.pcm;
    if (w.sampleRate !== SR) pcm = polyPhaseResample(pcm, w.sampleRate, SR, 1);
    return { name: file.name, pcm, sampleRate: SR };
  }
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const pcm = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < pcm.length; i++) pcm[i] += ch[i] / buf.numberOfChannels;
  }
  return { name: file.name, pcm, sampleRate: SR };
}
```

- [ ] **Step 2: Typprüfung**

Run: `pnpm check`
Expected: keine Fehler (`OfflineAudioContext` ist im DOM-Lib-Typ).

- [ ] **Step 3: Commit**

```bash
git add src/gui/audioDecode.ts
git commit -m "feat(generator): audioDecode — WAV/mp3/m4a → mono 44,1 k im Renderer"
```

---

### Task 3: Tab „Generator" (Markup, CSS, Modul, Verdrahtung)

**Files:**
- Modify: `index.html` (Nav-Knopf nach `tabPadDeck`; Section nach `viewPadDeck`; CSS-Block)
- Create: `src/gui/generator.ts`
- Modify: `src/gui/main.ts` (Tab-Tabelle, Typ `Tab`, `initGenerator`)

**Interfaces:**
- Consumes: `dekodiere`, `scanne`, `planeBank`, `zusammenfassung`, `erzeuge`, `projektJson`, `importSamplesFromAll`, `editorProjectFromE2Files`, `alsAllPat`, `PreviewPlayer`, `download`, `escapeHtml`, `$`.
- Produces: `initGenerator(onEditor: (project: EditorProject) => void): void`, `generatorWirdSichtbar(): void` (kein-op-Render, falls noch nichts da).

- [ ] **Step 1: index.html — Knopf und Section**

Nach `<button id="tabPadDeck">Pad-Deck</button>` einfügen:
```html
          <button id="tabGenerator">Generator</button>
```
Nach `<section id="viewPadDeck" class="hidden"></section>` einfügen:
```html
      <section id="viewGenerator" class="hidden"></section>
```
Im `<style>`-Block (dort, wo `#viewPadDeck` steht) ergänzen:
```css
#viewGenerator { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr); gap: 14px; align-items: start; }
#viewGenerator .card h3 { margin: 0 0 8px; font-size: 15px; }
#viewGenerator .zeile { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
#viewGenerator .zeile label { min-width: 110px; color: #9aa; }
#viewGenerator textarea { width: 100%; min-height: 64px; background: #111; color: #eee; border: 1px solid #333; border-radius: 6px; padding: 6px; font: inherit; }
#viewGenerator .liste { max-height: 260px; overflow: auto; border: 1px solid #2a2a2a; border-radius: 6px; }
#viewGenerator .liste div { display: flex; gap: 8px; align-items: center; padding: 3px 6px; border-bottom: 1px solid #222; font-size: 13px; }
#viewGenerator .liste div:hover { background: #1b1b1b; }
#viewGenerator .liste .rolle { color: #8ad; min-width: 44px; }
#viewGenerator .liste .takte { color: #9aa; min-width: 44px; }
#viewGenerator .hinweis { color: #c9a; font-size: 13px; }
#viewGenerator .warum { background: #161616; border-left: 3px solid #6a8; padding: 6px 10px; font-size: 13px; margin-top: 8px; }
#viewGenerator .fortschritt { color: #9aa; font-size: 13px; }
@media (max-width: 900px) { #viewGenerator { grid-template-columns: 1fr; } }
```
(Wenn die App helle Farben nutzt — im `<style>` nachsehen, wie `.card` und Inputs gefärbt sind — die Farbwerte an die vorhandenen anpassen; Struktur bleibt.)

- [ ] **Step 2: `src/gui/generator.ts`**

```ts
/**
 * generator.ts — Tab „Generator": Verzeichnis scannen, Bank bauen,
 * Jam / Mini-Set / Pro Melo erzeugen, Vorhoeren, → Datei, → Editor.
 * Dünne DOM-Schicht; Entscheidungen in core/generatorSession.ts.
 */
import { $, download, escapeHtml } from "./shared";
import { dekodiere } from "./audioDecode";
import { PreviewPlayer } from "./preview";
import { scanne, type ScanEintrag } from "../core/sampleScan";
import { planeBank, type Projekt } from "../core/bankPlan";
import { zusammenfassung, erzeuge, projektJson, dateiArt, type Erzeugt, type Zusammenfassung } from "../core/generatorSession";
import { meloKandidaten, pools, type Modus } from "../core/rezept";
import { alsAllPat } from "../core/patternGen";
import { editorProjectFromE2Files, importSamplesFromAll, type EditorProject, type PoolSample } from "../core/editorModel";

interface Zustand {
  ordner: string;
  eintraege: ScanEintrag[];
  uebersprungen: { datei: string; grund: string }[];
  zusammen: Zusammenfassung | null;
  projekt: Projekt | null;
  bank: Uint8Array | null;
  pool: PoolSample[];
  ergebnis: Erzeugt | null;
  fortschritt: string;
}

const z: Zustand = { ordner: "", eintraege: [], uebersprungen: [], zusammen: null, projekt: null, bank: null, pool: [], ergebnis: null, fortschritt: "" };
const player = new PreviewPlayer();
let onEditor: (p: EditorProject) => void = () => {};
let tekkBytes: Uint8Array | null = null;

async function ladeTekkDrums(): Promise<Uint8Array | null> {
  if (tekkBytes) return tekkBytes;
  try {
    const res = await fetch("examples/e2s/tekk4.all");
    if (!res.ok) return null;
    tekkBytes = new Uint8Array(await res.arrayBuffer());
    return tekkBytes;
  } catch {
    return null;
  }
}

function render(): void {
  const host = $("viewGenerator");
  const zs = z.zusammen;
  const melos = z.projekt ? meloKandidaten(pools(z.projekt)) : [];
  const rollen = zs ? Object.entries(zs.rollen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
  host.innerHTML = `
    <div class="card">
      <h3>1 · Quelle</h3>
      <div class="zeile">
        <label for="genOrdner">Sample-Verzeichnis</label>
        <input id="genOrdner" type="file" webkitdirectory multiple />
      </div>
      <div class="fortschritt" id="genFortschritt">${escapeHtml(z.fortschritt)}</div>
      ${zs ? `
      <div class="zeile"><b>${escapeHtml(z.ordner)}</b> — ${zs.anzahl} Samples · ${zs.sekunden.toFixed(0)} s ≈ ${zs.megabyte.toFixed(1)} MB${zs.volumesNoetig > 1 ? ` · <span class="hinweis">zu viel fuers RAM → ${zs.volumesNoetig} Volumes</span>` : ""}</div>
      <div class="zeile">${escapeHtml(rollen)}</div>
      ${z.uebersprungen.length ? `<div class="hinweis">${z.uebersprungen.length} Dateien uebersprungen (${escapeHtml(z.uebersprungen.slice(0, 3).map((u) => u.datei).join(", "))}${z.uebersprungen.length > 3 ? " …" : ""})</div>` : ""}
      <div class="zeile">
        <label for="genBpm">Tempo</label>
        <input id="genBpm" type="number" min="60" max="300" value="${z.projekt?.bpm ?? zs.tempoVorschlag}" style="width:80px" />
        <span class="fortschritt">Vorschlag ${zs.tempoVorschlag} BPM</span>
      </div>
      <div class="zeile">
        <label for="genVolume">Volume</label>
        <select id="genVolume">${Array.from({ length: zs.volumesNoetig }, (_, i) => `<option value="${i + 1}">${i + 1} / ${zs.volumesNoetig}</option>`).join("")}</select>
        <label><input id="genTekk" type="checkbox" ${zs.tekkEmpfohlen ? "checked" : ""} /> tekk4-Drums dazu (501–535)</label>
      </div>
      <div class="zeile"><button id="genBank" class="primary">Bank bauen</button>
        ${z.projekt ? `<span>${escapeHtml(z.projekt.name)}.all · ${z.projekt.samples.length} Samples · Status ${z.projekt.status}</span>
        <button id="genBankSpeichern">.all speichern</button><button id="genProjektSpeichern">projekt.json</button>` : ""}
      </div>` : ""}
    </div>
    <div class="card">
      <h3>2 · Was bauen</h3>
      ${z.projekt ? `
      <div class="zeile">
        <label>Modus</label>
        <label><input type="radio" name="genModus" value="jam" checked /> Jam-Pattern</label>
        <label><input type="radio" name="genModus" value="miniset" /> Mini-Set (6)</label>
        <label><input type="radio" name="genModus" value="promelo" /> Pro Melo (${melos.length})</label>
      </div>
      <div class="zeile"><label>Melodie</label>
        <select id="genMelo"><option value="">KI / Regel waehlt</option>${melos.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${m.takte} T)</option>`).join("")}</select>
        <button id="genHoeren" title="Vorhoeren">▶</button>
      </div>
      <div class="zeile"><label for="genSlot">Start-Slot</label><input id="genSlot" type="number" min="1" max="250" value="1" style="width:70px" /></div>
      <div class="zeile"><label for="genText">Beschreibung</label></div>
      <textarea id="genText" placeholder="z. B. hart, rollende bass, arp stab — ohne API-Key wirken nur Schluesselwoerter (KI-Uebersetzung kommt mit Stufe 4)"></textarea>
      <div class="zeile"><button id="genLos" class="primary">Generieren</button></div>
      <div class="liste" id="genMeloListe">${melos.map((m) => `<div><span class="rolle">melo</span><span class="takte">${m.takte} T</span><span>${escapeHtml(m.name)}</span><button data-nr="${m.nr}" class="genPlay">▶</button></div>`).join("")}</div>
      ` : `<div class="hinweis">Erst Verzeichnis waehlen und Bank bauen.</div>`}
    </div>
    <div class="card" style="grid-column: 1 / -1">
      <h3>3 · Ergebnis</h3>
      ${z.ergebnis ? `
      <div class="zeile"><b>${z.ergebnis.patterns.length} Pattern(s)</b> · ${escapeHtml(z.ergebnis.dateiname)}
        <button id="genDatei" class="primary">→ Datei</button><button id="genEditor">→ Editor</button></div>
      <div class="liste">${z.ergebnis.patterns.map((p, i) => `<div><span class="takte">${i + 1}</span><span>${escapeHtml(p.name)}</span><span class="fortschritt">${p.parts.filter((x) => !x.muted).length} Parts · ${p.bpm} BPM${p.chainTo ? ` → ${p.chainTo}` : ""}</span></div>`).join("")}</div>
      <div class="warum"><b>Warum so?</b> ${escapeHtml(z.ergebnis.warumSo)}</div>
      ${z.ergebnis.hinweise.length ? `<div class="hinweis">${escapeHtml(z.ergebnis.hinweise.join(" · "))}</div>` : ""}
      ` : `<div class="fortschritt">Noch nichts erzeugt.</div>`}
    </div>`;
  verdrahte();
}

function verdrahte(): void {
  const ordner = $("genOrdner") as HTMLInputElement;
  ordner.addEventListener("change", () => void scanne_(ordner.files));
  $("genBank")?.addEventListener("click", () => void bankBauen());
  $("genBankSpeichern")?.addEventListener("click", () => { if (z.bank && z.projekt) download(z.bank, `${z.projekt.name}.all`, "application/octet-stream"); });
  $("genProjektSpeichern")?.addEventListener("click", () => { if (z.projekt) download(projektJson(z.projekt), "projekt.json", "application/json"); });
  $("genLos")?.addEventListener("click", generieren);
  $("genHoeren")?.addEventListener("click", () => { const n = ($("genMelo") as HTMLSelectElement).value; const s = z.projekt?.samples.find((x) => x.name === n); if (s) hoeren(s.nr); });
  $("genDatei")?.addEventListener("click", () => { if (z.ergebnis) download(z.ergebnis.bytes, z.ergebnis.dateiname, "application/octet-stream"); });
  $("genEditor")?.addEventListener("click", inEditor);
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genPlay")) b.addEventListener("click", () => hoeren(Number(b.dataset.nr)));
}

function hoeren(nr: number): void {
  const s = z.pool.find((p) => p.number === nr);
  if (s) player.audition(s);
}

async function scanne_(files: FileList | null): Promise<void> {
  if (!files?.length) return;
  const liste = Array.from(files).filter((f) => dateiArt(f.name) !== "skip" && !f.webkitRelativePath.split("/").slice(1, -1).length);
  z.ordner = files[0].webkitRelativePath.split("/")[0] || "Verzeichnis";
  z.projekt = null; z.bank = null; z.ergebnis = null; z.pool = [];
  const eingaben = [];
  const fehler: { datei: string; grund: string }[] = [];
  for (let i = 0; i < liste.length; i++) {
    z.fortschritt = `Dekodiere ${i + 1}/${liste.length}: ${liste[i].name}`;
    const el = document.getElementById("genFortschritt");
    if (el) el.textContent = z.fortschritt;
    try { eingaben.push(await dekodiere(liste[i])); } catch (e) { fehler.push({ datei: liste[i].name, grund: e instanceof Error ? e.message : String(e) }); }
    await new Promise((r) => setTimeout(r, 0));
  }
  const res = scanne(eingaben);
  z.eintraege = res.eintraege;
  z.uebersprungen = [...fehler, ...res.uebersprungen];
  z.zusammen = zusammenfassung(z.eintraege);
  z.fortschritt = "";
  render();
}

async function bankBauen(): Promise<void> {
  if (!z.eintraege.length) return;
  const bpm = Number(($("genBpm") as HTMLInputElement).value) || z.zusammen!.tempoVorschlag;
  const volume = Number(($("genVolume") as HTMLSelectElement).value) || 1;
  const tekk = ($("genTekk") as HTMLInputElement).checked ? await ladeTekkDrums() : null;
  if (($("genTekk") as HTMLInputElement).checked && !tekk) alert("tekk4.all nicht gefunden (examples/e2s/tekk4.all) — Bank ohne tekk-Drums.");
  const name = z.ordner.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "projekt";
  try {
    const { projekt, bank, warnungen } = planeBank(z.eintraege, { name, bpm, volume, tekkDrumsBank: tekk ?? undefined });
    z.projekt = projekt;
    z.bank = new Uint8Array(bank);
    z.pool = importSamplesFromAll(z.bank);
    z.ergebnis = null;
    if (warnungen.length) alert("Hinweise beim Bankbau:\n" + warnungen.join("\n"));
  } catch (e) {
    alert("Bank konnte nicht gebaut werden: " + (e instanceof Error ? e.message : String(e)));
  }
  render();
}

function generieren(): void {
  if (!z.projekt) return;
  const modus = (document.querySelector<HTMLInputElement>("input[name=genModus]:checked")?.value ?? "jam") as Modus;
  const bpm = Number(($("genBpm") as HTMLInputElement).value) || z.projekt.bpm;
  const melo = ($("genMelo") as HTMLSelectElement).value || undefined;
  const beschreibung = ($("genText") as HTMLTextAreaElement).value;
  const startSlot = Number(($("genSlot") as HTMLInputElement).value) || 1;
  z.ergebnis = erzeuge(z.projekt, { modus, bpm, melo, beschreibung, startSlot });
  render();
}

function inEditor(): void {
  if (!z.ergebnis || !z.bank) return;
  const allpat = new Uint8Array(alsAllPat(z.ergebnis.patterns));
  onEditor(editorProjectFromE2Files(allpat, z.bank));
}

export function initGenerator(cb: (p: EditorProject) => void): void {
  onEditor = cb;
  render();
}

export function generatorWirdSichtbar(): void {
  // nichts zu tun — Zustand lebt im Modul; Render passiert bei Aenderungen
}
```

- [ ] **Step 3: `src/gui/main.ts` verdrahten**

```ts
// oben:
import { initGenerator, generatorWirdSichtbar } from "./generator";
// Typ erweitern:
type Tab = "editor" | "converter" | "panel" | "paddeck" | "generator";
// Tabelle ergänzen:
  generator: { view: "viewGenerator", knopf: "tabGenerator", sichtbar: generatorWirdSichtbar },
// nach initConverter(...):
initGenerator((project: EditorProject) => {
  if (loadProject(project)) {
    switchTab("editor");
    alert(`Generator → Editor: ${project.patterns.length} Pattern(s), ${project.samples.length} Sample(s).`);
  }
});
```

- [ ] **Step 4: Typprüfung + Build**

Run: `pnpm check && pnpm build:gui`
Expected: keine Fehler. Falls `webkitRelativePath`/`webkitdirectory` im TS-DOM-Typ fehlen: `(f as File & { webkitRelativePath: string })` bzw. das Attribut per `setAttribute("webkitdirectory", "")` im Markup setzen.

- [ ] **Step 5: Commit**

```bash
git add index.html src/gui/generator.ts src/gui/main.ts
git commit -m "feat(generator): Tab Generator — Scan, Bank bauen, Jam/Mini-Set/Pro Melo, Vorhoeren, Datei/Editor"
```

---

### Task 4: Abnahme am Bildschirm + README

**Files:**
- Modify: `README.md` (Schnellstart: ein Absatz „Generator")

- [ ] **Step 1: App starten und durchklicken** (Skill `run-tekkforge`: `pnpm desktop`, Screenshot)

Ablauf: Tab „Generator" → Verzeichnis `examples/e2s/korg3` wählen → Zusammenfassung zeigt 42 Samples, Tempo 180, Rollen → „Bank bauen" → Status `gebaut`, Melodie-Liste mit ▶ (Vorhören tut Ton) → Modus Jam, „Generieren" → Ergebnis 1 Pattern, „Warum so?" → „→ Editor" wechselt in den Editor mit Pattern + 42 Samples → zurück, Mini-Set mit Beschreibung „hart, arp" → 6 Patterns mit Kette → „→ Datei" lädt `.e2sallpat`.
Expected: keine Konsolenfehler; Screenshot unter `.tekkforge-shots/generator.png` (ist git-ignoriert).

- [ ] **Step 2: README**

Unter „## Schnellstart" als letzten Punkt:
```markdown
5. **Generator** (Tab): Sample-Verzeichnis wählen → Scan zeigt Rollen, Tempo-Vorschlag und
   RAM-Bedarf → „Bank bauen" (`.all` speichern, per SD laden) → Jam-Pattern, Mini-Set (6
   gechainte Patterns) oder Pro Melo erzeugen → „→ Datei" oder „→ Editor". Melodien bleiben
   ganz; die Beschreibung steuert Kick/Bass/Stab per Schlüsselwort (KI-Übersetzung folgt).
```

- [ ] **Step 3: Tests + Commit**

Run: `pnpm check && pnpm test`
```bash
git add README.md
git commit -m "docs: Generator-Tab im Schnellstart"
```

---

## Self-Review

- **Spec-Abdeckung (Bedienung):** Quelle/Scan/Volumes/tekk-Drums (Task 3 Karte 1), Modus/Tempo/Melodie mit Vorhören/Beschreibung/Generieren (Karte 2), Ergebnis mit → Datei/→ Editor/Warum so? (Karte 3). Fehlt bewusst bis Stufe 3: „auf SD kopieren", „als geladen markieren", „→ Gerät" — Status bleibt `gebaut`. Lied-Analyse = Stufe 5.
- **Typen:** `Erzeugt`, `Zusammenfassung` aus Task 1 werden in Task 3 importiert; `ScanEingabe` aus sampleScan; `PoolSample.number`/`.pcm`/`.sampleRate` für `audition` (bestehend).
- **Offen benannt:** Farbwerte im CSS an den Bestand anpassen (Anweisung in Task 3 Schritt 1).
