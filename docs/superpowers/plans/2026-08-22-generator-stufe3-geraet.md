# Generator Stufe 3 — Gerät & Projekt-Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projekt auf Platte (`<Verzeichnis>/TekkForge/<name>.all` + `projekt.json`), Kopie auf die SD-Karte, „als geladen markieren" (überlebt Neustart), und „→ Gerät ab Slot N" über den bestehenden 0x4C-Slot-Weg — gesperrt mit sichtbarem Grund, solange die Bank nicht als geladen gilt oder kein Gerät bereit ist.

**Architecture:** Ein reines Modul `src/core/projektStatus.ts` (Status-Übergänge, Lade-Marker, Sperrgrund, SD-Zielpfad, `E2PatternInput` → `EditorPattern`) mit Tests. Ein schmaler Electron-Bridge `window.tekkFs` (preload/main, CommonJS wie `tekkMidi`): absoluter Pfad einer per Dialog gewählten Datei (`webUtils.getPathForFile`), Dateien in einen Ordner schreiben (mkdir -p), Wechselmedien auflisten, `tekk4.all` aus dem App-Verzeichnis lesen. `generator.ts` verdrahtet beides; Senden ans Gerät über `panelBridge.writePatternToSlotDirect` (eine MidiIO, Single-Client-Treiber). Im reinen Browser (kein `tekkFs`) bleiben die Platten-/SD-Knöpfe weg, Download bleibt.

**Tech Stack:** TypeScript, Electron 40 (`webUtils`), Vitest; Abnahme über `.claude/skills/run-tekkforge/driver.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-22-generator-design.md` (Abschnitte „Projekt", „Gerät", „Fehler")

## Global Constraints

- Kein Dateisystem-Zugriff im Renderer außer über `window.tekkFs`; Main-Prozess schreibt nur in den per Dialog gewählten Ordner, nach `<ordner>/TekkForge/` oder auf ein Wechselmedium — nie anderswohin.
- „→ Gerät" ausschließlich über `panelBridge.writePatternToSlotDirect` (0x4C mit Slot, am Gerät geprüft); nie über den Edit-Buffer.
- Lade-Marker = `{ name, bankZeit }` in `localStorage` unter `tekkforge.generator.geladen`.
- SD-Ziel: `<Laufwerk>\2026\` (Konvention des Nutzers), Dateinamen wie im Projekt.
- `pnpm check && pnpm test` grün; Deutsch in UI/Kommentaren/Commits.

---

## Dateiplan

| Datei | Verantwortung |
|---|---|
| `src/core/projektStatus.ts` | Marker lesen/schreiben, `istGeladen`, `statusMit`, `geraetSperrgrund`, `sdZielpfad`, `patternFuerGeraet` |
| `tests/generator-status.test.ts` | Tests dazu |
| `electron/preload.cjs` | `window.tekkFs` |
| `electron/main.cjs` | IPC `fs:pfadVon` (kein IPC nötig — `webUtils` im Preload), `fs:schreibe`, `fs:wechselmedien`, `fs:tekkDrums` |
| `src/gui/tekkFs.ts` | typisierter Zugriff auf `window.tekkFs` (optional) |
| `src/gui/generator.ts` | Knöpfe Projekt speichern / auf SD / als geladen / → Gerät; Status-Anzeige; tekk-Drums über Bridge |

---

### Task 1: projektStatus — reine Logik

**Files:**
- Create: `src/core/projektStatus.ts`
- Test: `tests/generator-status.test.ts`

**Interfaces:**
- `interface GeladenMarker { name: string; bankZeit: string }`
- `interface MarkerSpeicher { getItem(k: string): string | null; setItem(k: string, v: string): void }`
- `MARKER_KEY = "tekkforge.generator.geladen"`
- `markerLesen(sp: MarkerSpeicher): GeladenMarker | null`
- `markerSchreiben(sp: MarkerSpeicher, p: Projekt): GeladenMarker`
- `istGeladen(p: Projekt, m: GeladenMarker | null): boolean` — Name und bankZeit gleich
- `statusMit(p: Projekt, m: GeladenMarker | null): Projekt["status"]` — `geladen` wenn Marker passt, sonst `p.status`
- `geraetSperrgrund(p: Projekt | null, m: GeladenMarker | null, midiReady: boolean): string | null` — null = frei; Gründe: „Erst Bank bauen", „Bank „<name>" ist nicht als geladen markiert", „Kein Gerät verbunden — MIDI im Editor aktivieren"
- `sdZielpfad(laufwerk: string, ordner = "2026"): string` — `H:` → `H:\2026`
- `patternFuerGeraet(input: E2PatternInput): EditorPattern` — `editorPatternFromBody(buildE2PatternBody(input))`

- [ ] **Step 1: Failing test**

```ts
// tests/generator-status.test.ts
import { describe, it, expect } from "vitest";
import type { Projekt } from "../src/core/bankPlan";
import { markerLesen, markerSchreiben, istGeladen, statusMit, geraetSperrgrund, sdZielpfad, patternFuerGeraet, MARKER_KEY } from "../src/core/projektStatus";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";

const P: Projekt = { name: "korg3", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, samples: [], status: "gebaut", bankZeit: "2026-08-22T12:00:00Z" };
function speicher(): { sp: { getItem(k: string): string | null; setItem(k: string, v: string): void }; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, sp: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) } };
}

describe("projektStatus", () => {
  it("Marker schreiben/lesen, istGeladen nur bei gleichem Namen und bankZeit", () => {
    const { sp, map } = speicher();
    expect(markerLesen(sp)).toBeNull();
    const m = markerSchreiben(sp, P);
    expect(map.get(MARKER_KEY)).toContain("korg3");
    expect(markerLesen(sp)).toEqual(m);
    expect(istGeladen(P, m)).toBe(true);
    expect(istGeladen({ ...P, bankZeit: "anders" }, m)).toBe(false);
    expect(istGeladen({ ...P, name: "x" }, m)).toBe(false);
    expect(istGeladen(P, null)).toBe(false);
  });
  it("markerLesen ueberlebt kaputtes JSON", () => {
    const { sp } = speicher();
    sp.setItem(MARKER_KEY, "{kaputt");
    expect(markerLesen(sp)).toBeNull();
  });
  it("statusMit: geladen nur mit passendem Marker", () => {
    expect(statusMit(P, null)).toBe("gebaut");
    expect(statusMit({ ...P, status: "exportiert" }, null)).toBe("exportiert");
    expect(statusMit(P, { name: "korg3", bankZeit: P.bankZeit })).toBe("geladen");
  });
  it("geraetSperrgrund: Reihenfolge Bank → geladen → MIDI", () => {
    const m = { name: "korg3", bankZeit: P.bankZeit };
    expect(geraetSperrgrund(null, m, true)).toBe("Erst Bank bauen");
    expect(geraetSperrgrund(P, null, true)).toContain("nicht als geladen markiert");
    expect(geraetSperrgrund(P, m, false)).toContain("Kein Geraet");
    expect(geraetSperrgrund(P, m, true)).toBeNull();
  });
  it("sdZielpfad", () => {
    expect(sdZielpfad("H:")).toBe("H:\\2026");
    expect(sdZielpfad("H:\\")).toBe("H:\\2026");
    expect(sdZielpfad("H:", "KORG")).toBe("H:\\KORG");
  });
  it("patternFuerGeraet: E2PatternInput → EditorPattern mit Name, BPM und Steps", () => {
    const input: E2PatternInput = { name: "TEST JAM", bpm: 176, stepLength: 64, parts: [{ steps: [{ active: true, notes: [60], velocity: 100, gate: 40 }], volume: 120 }] };
    const p = patternFuerGeraet(input);
    expect(p.name.trim()).toBe("TEST JAM");
    expect(p.bpm).toBe(176);
    expect(p.parts[0].steps[0].on).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run tests/generator-status.test.ts`)

- [ ] **Step 3: Implementierung**

```ts
// src/core/projektStatus.ts
/**
 * projektStatus — Lade-Marker („diese Bank steckt im Geraet"), Status-
 * Ableitung, Sperrgrund fuer „→ Geraet", SD-Zielpfad und die Umwandlung
 * E2PatternInput → EditorPattern fuer den Slot-Weg. Reine Funktionen.
 */
import type { Projekt } from "./bankPlan";
import type { E2PatternInput } from "./electribePatternBuilder";
import { buildE2PatternBody } from "./e2sExport";
import { editorPatternFromBody, type EditorPattern } from "./editorModel";

export const MARKER_KEY = "tekkforge.generator.geladen";
export interface GeladenMarker { name: string; bankZeit: string }
export interface MarkerSpeicher { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function markerLesen(sp: MarkerSpeicher): GeladenMarker | null {
  try {
    const roh = sp.getItem(MARKER_KEY);
    if (!roh) return null;
    const m = JSON.parse(roh) as Partial<GeladenMarker>;
    return typeof m.name === "string" && typeof m.bankZeit === "string" ? { name: m.name, bankZeit: m.bankZeit } : null;
  } catch {
    return null;
  }
}
export function markerSchreiben(sp: MarkerSpeicher, p: Projekt): GeladenMarker {
  const m = { name: p.name, bankZeit: p.bankZeit };
  sp.setItem(MARKER_KEY, JSON.stringify(m));
  return m;
}
export function istGeladen(p: Projekt, m: GeladenMarker | null): boolean {
  return !!m && m.name === p.name && m.bankZeit === p.bankZeit;
}
export function statusMit(p: Projekt, m: GeladenMarker | null): Projekt["status"] {
  return istGeladen(p, m) ? "geladen" : p.status;
}
export function geraetSperrgrund(p: Projekt | null, m: GeladenMarker | null, midiReady: boolean): string | null {
  if (!p) return "Erst Bank bauen";
  if (!istGeladen(p, m)) return `Bank "${p.name}" ist nicht als geladen markiert`;
  if (!midiReady) return "Kein Geraet verbunden — MIDI im Editor aktivieren";
  return null;
}
export function sdZielpfad(laufwerk: string, ordner = "2026"): string {
  return `${laufwerk.replace(/[\\/]+$/, "")}\\${ordner}`;
}
export function patternFuerGeraet(input: E2PatternInput): EditorPattern {
  return editorPatternFromBody(buildE2PatternBody(input));
}
```

- [ ] **Step 4: Run → PASS**, Commit `feat(generator): projektStatus — Lade-Marker, Sperrgrund, Pattern fuer den Slot-Weg`

---

### Task 2: Electron-Bridge `tekkFs`

**Files:**
- Modify: `electron/preload.cjs`, `electron/main.cjs`
- Create: `src/gui/tekkFs.ts`

**Interfaces (Renderer-Sicht, alle optional — fehlt im Browser):**
- `pfadVon(file: File): string` — absoluter Pfad (`webUtils.getPathForFile`), "" wenn unbekannt
- `schreibe(ordner: string, dateien: { name: string; bytes: Uint8Array }[]): Promise<{ ordner: string; geschrieben: string[] }>` — legt `ordner` an (rekursiv), schreibt, prüft Länge nach dem Schreiben
- `wechselmedien(): Promise<{ pfad: string; label: string }[]>` — Windows: `wmic logicaldisk where drivetype=2`; Fallback: Laufwerksbuchstaben D–Z mit vorhandenem `KORG`-Ordner
- `tekkDrums(): Promise<Uint8Array | null>` — `examples/e2s/tekk4.all` relativ zum App-Verzeichnis (`app.getAppPath()`), sonst null

- [ ] **Step 1: preload.cjs** — nach dem `tekkMidi`-Block:

```js
const { webUtils } = require("electron");
contextBridge.exposeInMainWorld("tekkFs", {
  available: true,
  /** Absoluter Pfad einer per Dialog/Drop gewaehlten Datei ("" wenn unbekannt). */
  pfadVon: (file) => { try { return webUtils.getPathForFile(file) || ""; } catch { return ""; } },
  /** Dateien in einen Ordner schreiben (Ordner wird angelegt). */
  schreibe: (ordner, dateien) => ipcRenderer.invoke("fs:schreibe", ordner, dateien.map((d) => ({ name: d.name, bytes: Array.from(d.bytes) }))),
  /** Wechselmedien (SD-Karten) mit Pfad und Label. */
  wechselmedien: () => ipcRenderer.invoke("fs:wechselmedien"),
  /** examples/e2s/tekk4.all aus dem App-Verzeichnis, sonst null. */
  tekkDrums: () => ipcRenderer.invoke("fs:tekkDrums"),
});
```

- [ ] **Step 2: main.cjs** — neben `registerMidiIpc`:

```js
const { execFileSync } = require("child_process");
function registerFsIpc() {
  ipcMain.handle("fs:schreibe", (_e, ordner, dateien) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    fs.mkdirSync(ordner, { recursive: true });
    const geschrieben = [];
    for (const d of dateien) {
      const name = path.basename(String(d.name));
      const ziel = path.join(ordner, name);
      const bytes = Buffer.from(d.bytes);
      fs.writeFileSync(ziel, bytes);
      if (fs.statSync(ziel).size !== bytes.length) throw new Error(`${name}: Laenge nach dem Schreiben falsch`);
      geschrieben.push(ziel);
    }
    return { ordner, geschrieben };
  });
  ipcMain.handle("fs:wechselmedien", () => {
    const out = [];
    if (process.platform === "win32") {
      try {
        const txt = execFileSync("wmic", ["logicaldisk", "where", "drivetype=2", "get", "deviceid,volumename"], { encoding: "utf8", timeout: 5000 });
        for (const zeile of txt.split(/\r?\n/).slice(1)) {
          const m = zeile.trim().match(/^([A-Z]:)\s*(.*)$/);
          if (m) out.push({ pfad: m[1], label: m[2].trim() || "Wechselmedium" });
        }
      } catch { /* Fallback unten */ }
      if (!out.length) for (const b of "DEFGHIJKLMNOPQRSTUVWXYZ") { const p = `${b}:\\`; try { if (fs.existsSync(path.join(p, "KORG"))) out.push({ pfad: `${b}:`, label: "KORG-Karte" }); } catch { /* weiter */ } }
    }
    return out;
  });
  ipcMain.handle("fs:tekkDrums", () => {
    for (const p of [path.join(app.getAppPath(), "examples", "e2s", "tekk4.all"), path.join(process.resourcesPath || "", "examples", "e2s", "tekk4.all")]) {
      try { if (fs.existsSync(p)) return Array.from(fs.readFileSync(p)); } catch { /* naechster */ }
    }
    return null;
  });
}
```
und im `app.whenReady()`-Block nach `registerMidiIpc(win)` → `registerFsIpc();`.

- [ ] **Step 3: `src/gui/tekkFs.ts`**

```ts
/** Typisierter Zugriff auf die Electron-Dateibruecke; im Browser undefined. */
export interface TekkFs {
  available: boolean;
  pfadVon(file: File): string;
  schreibe(ordner: string, dateien: { name: string; bytes: Uint8Array }[]): Promise<{ ordner: string; geschrieben: string[] }>;
  wechselmedien(): Promise<{ pfad: string; label: string }[]>;
  tekkDrums(): Promise<number[] | null>;
}
export function tekkFs(): TekkFs | undefined {
  const w = globalThis as unknown as { tekkFs?: TekkFs };
  return w.tekkFs?.available ? w.tekkFs : undefined;
}
```

- [ ] **Step 4:** `pnpm check && pnpm build:gui`; Treiber-Probe: `node .claude/skills/run-tekkforge/driver.mjs --run "launch; eval window.tekkFs.wechselmedien(); eval (await window.tekkFs.tekkDrums())?.length"` → Liste (ggf. leer) und `17…` Bytes. Commit `feat(generator): tekkFs-Bruecke — Pfad, schreiben, Wechselmedien, tekk4.all`.

---

### Task 3: GUI — Projekt speichern, SD, geladen, → Gerät

**Files:**
- Modify: `src/gui/generator.ts`

- [ ] **Step 1: Zustand erweitern** — `ordnerPfad: string` (absolut, aus `tekkFs().pfadVon(files[0])` → `path.dirname`-Logik im Renderer: alles vor dem letzten `\`/`/`), `marker: GeladenMarker | null` (beim Init aus `localStorage`), `sendeStatus: string`.

- [ ] **Step 2: Karte 1 ergänzen** (nur wenn `tekkFs()`):
  - „Projekt speichern" → `schreibe(`${ordnerPfad}\TekkForge`, [ {name: `${projekt.name}.all`, bytes}, {name: "projekt.json", bytes} ])` → Status bleibt `gebaut`, Hinweis mit Pfad.
  - „auf SD kopieren" → `wechselmedien()`; keine → alert „Keine SD-Karte gefunden"; eine → direkt; mehrere → `prompt` mit Liste (1..n) → `schreibe(sdZielpfad(pfad), […])` → `projekt.status = "exportiert"`; Hinweis mit Pfad.
  - „als geladen markieren" → `markerSchreiben(localStorage, projekt)`; Anzeige Status = `statusMit(projekt, marker)`.
  - tekk-Drums: erst `tekkFs().tekkDrums()`, dann `fetch`-Fallback.
- [ ] **Step 3: Karte 3 ergänzen** — Knopf „→ Gerät ab Slot N" (N = Start-Slot-Feld); `disabled` + `title` = `geraetSperrgrund(projekt, marker, panelBridge.midi.ready)`; Klick: nacheinander `panelBridge.writePatternToSlotDirect(patternFuerGeraet(p), slot + i)`, Fortschritt `sendeStatus` („2/6 gesendet · Slot 11 bestätigt"), Fehler abfangen und anzeigen, am Ende „fertig — am Gerät per Program Change hinwechseln". Import `panelBridge` aus `./editor`.
- [ ] **Step 4:** `pnpm check && pnpm build:gui`; Treiber-Abnahme ohne Gerät: Bank bauen → „→ Gerät" ist disabled mit Grund „nicht als geladen markiert" → „als geladen markieren" → Grund wechselt auf „Kein Geraet verbunden" → `eval localStorage.getItem("tekkforge.generator.geladen")` zeigt Marker. „Projekt speichern" in ein Scratch-Verzeichnis (Treiber `files` mit Verzeichnis; `ordnerPfad` kommt über `webUtils`) → Dateien existieren. Commit `feat(generator): Projekt speichern, auf SD kopieren, als geladen markieren, → Geraet ab Slot`.

---

### Task 4: README + Memory

- README „Sample-Ordner → Bank + Pattern-Set" / Schnellstart Punkt 5: Satz zu Projekt speichern, SD, geladen, → Gerät.
- Memory `generator-tab-stand.md`: Stufe 3 fertig; Hinweis, dass „→ Gerät" ohne Gerät nur bis zur Sperre geprüft ist (Geräteabnahme offen).
- Commit `docs: Generator Stufe 3`.

## Self-Review
- Spec „Projekt": Ordner `<Verzeichnis>/TekkForge/`, Status gebaut → exportiert → geladen ✔ (Task 3). „Gerät": Slot-Weg 0x4C, Sperre mit Grund, Slot-Vorgabe ✔. „Fehler": Bank nicht geladen → gesperrt, Datei bleibt ✔; kein Gerät → Grund ✔.
- Typen: `GeladenMarker`, `geraetSperrgrund`, `patternFuerGeraet` aus Task 1 werden in Task 3 benutzt; `tekkFs()` aus Task 2.
- Offen und benannt: Geräteabnahme (Slot-Dump am echten Gerät) erst, wenn das Gerät am Port hängt.
