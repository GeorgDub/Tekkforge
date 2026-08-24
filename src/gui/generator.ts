/**
 * generator.ts — Tab „Generator": Verzeichnis scannen, Bank bauen,
 * Jam / Mini-Set / Pro Melo erzeugen, Vorhoeren, → Datei, → Editor,
 * Projekt auf Platte / SD, „als geladen markieren", → Geraet (Slot-Weg).
 * Duenne DOM-Schicht; Entscheidungen in core/generatorSession.ts und
 * core/projektStatus.ts.
 */
import { $, download, escapeHtml } from "./shared";
import { dekodiere } from "./audioDecode";
import { PreviewPlayer } from "./preview";
import { panelBridge } from "./editor";
import { tekkFs, ordnerVon } from "./tekkFs";
import { tekkKi } from "./tekkKi";
import { tekkLied } from "./tekkLied";
import { analysiereLied, type LiedFenster } from "../core/liedAnalyse";
import { encodeWav16, parseWav } from "../core/wavCodec";
import { rmsDb, peakVon, familie } from "../core/sampleScan";
import { schneideDrums, type DrumTreffer, type DrumRolle } from "../core/drumSchnitt";
import {
  promptFuer, antwortZuRezept, REZEPT_SCHEMA, KI_MODELL_STANDARD, KI_MODELLE, promptFuerProMelo, antwortZuRezepte, REZEPT_LISTE_SCHEMA,
} from "../core/kiPlaner";
import type { Rezept } from "../core/rezept";
import { scanne, type ScanEintrag, type ScanEingabe } from "../core/sampleScan";
import { merkeLetzteDatei } from "./start";
import { planeBank, type Projekt } from "../core/bankPlan";
import { zusammenfassung, erzeuge, projektJson, dateiRelevant, type Erzeugt, type Zusammenfassung } from "../core/generatorSession";
import {
  type GeladenMarker, markerLesen, markerSchreiben, statusMit, geraetSperrgrund, sdZielpfad, patternFuerGeraet,
} from "../core/projektStatus";
import { meloKandidaten, pools, type Modus } from "../core/rezept";
import { alsAllPat } from "../core/patternGen";
import { editorProjectFromE2Files, importSamplesFromAll, type EditorProject, type PoolSample } from "../core/editorModel";

interface Zustand {
  ordner: string;
  /** absoluter Pfad des gewaehlten Verzeichnisses (nur Electron) */
  ordnerPfad: string;
  eintraege: ScanEintrag[];
  uebersprungen: { datei: string; grund: string }[];
  zusammen: Zusammenfassung | null;
  projekt: Projekt | null;
  bank: Uint8Array | null;
  pool: PoolSample[];
  ergebnis: Erzeugt | null;
  fortschritt: string;
  meldung: string;
  marker: GeladenMarker | null;
  sendeStatus: string;
  sendet: boolean;
  /** API-Key-Status aus den App-Einstellungen (nur Electron) */
  ki: { gesetzt: boolean; modell: string; vorschau?: string } | null;
  kiLaeuft: boolean;
  kiHinweis: string;
  /** Python/Demucs-Probe (nur Electron) */
  python: { demucs: boolean; meldung: string } | null;
  /** zuletzt analysiertes Lied */
  lied: { name: string; bpm: number; k: number; fenster: string[]; stems: boolean; dateien: string[] } | null;
  liedLaeuft: boolean;
  liedStatus: string;
  /** Aufbau-Kette: identische Steps in allen Patterns, entmutet wird stufenweise */
  aufbau: boolean;
  /** eigene Drums (tekk/Ordner) statt aus dem Lied geschnittener Kick/Snare/Hat */
  liedDrumsEigene: boolean;
}

const z: Zustand = {
  ordner: "", ordnerPfad: "", eintraege: [], uebersprungen: [], zusammen: null, projekt: null, bank: null, pool: [],
  ergebnis: null, fortschritt: "", meldung: "", marker: null, sendeStatus: "", sendet: false, ki: null, kiLaeuft: false, kiHinweis: "",
  python: null, lied: null, liedLaeuft: false, liedStatus: "", aufbau: true, liedDrumsEigene: false,
};
const player = new PreviewPlayer();

// Vorhoeren der Lied-Fenster (8 Takte) mit Stopp — eigener Context, damit ein laufendes Fenster abbrechbar ist
let fensterCtx: AudioContext | null = null;
let fensterQuelle: AudioBufferSourceNode | null = null;
let fensterSpielt: string | null = null;

function fensterStopp(): void {
  try {
    fensterQuelle?.stop();
  } catch {
    /* schon zu Ende */
  }
  fensterQuelle = null;
  fensterSpielt = null;
}

function fensterHoeren(datei: string): void {
  if (fensterSpielt === datei) {
    fensterStopp();
    render();
    return;
  }
  fensterStopp();
  const e = z.eintraege.find((x) => x.datei === datei);
  if (!e) return;
  fensterCtx = fensterCtx ?? new AudioContext();
  void fensterCtx.resume();
  const buf = fensterCtx.createBuffer(1, Math.max(1, e.pcm.length), e.sampleRate);
  buf.getChannelData(0).set(e.pcm);
  const src = fensterCtx.createBufferSource();
  src.buffer = buf;
  src.connect(fensterCtx.destination);
  src.onended = () => {
    if (fensterQuelle === src) {
      fensterQuelle = null;
      fensterSpielt = null;
      render();
    }
  };
  src.start();
  fensterQuelle = src;
  fensterSpielt = datei;
  render();
}
let onEditor: (p: EditorProject) => void = () => {};
let tekkBytes: Uint8Array | null = null;

function speicher(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** tekk4.all: zuerst ueber die Electron-Bruecke (App-Verzeichnis), sonst per fetch (Browser/Vite). */
async function ladeTekkDrums(): Promise<Uint8Array | null> {
  if (tekkBytes) return tekkBytes;
  const fsb = tekkFs();
  if (fsb) {
    const b = await fsb.tekkDrums();
    if (b) {
      tekkBytes = Uint8Array.from(b);
      return tekkBytes;
    }
  }
  for (const url of ["examples/e2s/tekk4.all", "../examples/e2s/tekk4.all"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      tekkBytes = new Uint8Array(await res.arrayBuffer());
      return tekkBytes;
    } catch {
      /* naechste URL */
    }
  }
  return null;
}

function render(): void {
  const host = $("viewGenerator");
  const zs = z.zusammen;
  const fsb = tekkFs();
  const melos = z.projekt ? meloKandidaten(pools(z.projekt)) : [];
  const status = z.projekt ? statusMit(z.projekt, z.marker) : null;
  const rollen = zs
    ? Object.entries(zs.rollen)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")
    : "";
  const quelle = zs
    ? `
      <div class="zeile"><b>${escapeHtml(z.ordner)}</b> — ${zs.anzahl} Samples · ${zs.sekunden.toFixed(0)} s ≈ ${zs.megabyte.toFixed(1)} MB${
        zs.volumesNoetig > 1 ? ` · <span class="hinweis">zu viel fuers Sample-RAM → ${zs.volumesNoetig} Volumes</span>` : ""
      }</div>
      <div class="zeile fortschritt">${escapeHtml(rollen)}${z.ordnerPfad ? ` · <span title="${escapeHtml(z.ordnerPfad)}">Pfad bekannt</span>` : ""}</div>
      ${
        z.uebersprungen.length
          ? `<div class="hinweis">${z.uebersprungen.length} Datei(en) uebersprungen: ${escapeHtml(
              z.uebersprungen.slice(0, 3).map((u) => `${u.datei} (${u.grund})`).join(", "),
            )}${z.uebersprungen.length > 3 ? " …" : ""}</div>`
          : ""
      }
      <div class="zeile">
        <label for="genBpm">Tempo</label>
        <input id="genBpm" type="number" min="60" max="300" value="${z.projekt?.bpm ?? zs.tempoVorschlag}" style="width:80px" />
        <span class="fortschritt">Vorschlag aus der Taktanalyse: ${zs.tempoVorschlag} BPM</span>
      </div>
      <div class="zeile">
        <label for="genVolume">Volume</label>
        <select id="genVolume">${Array.from({ length: zs.volumesNoetig }, (_, i) => `<option value="${i + 1}"${z.projekt?.volume === i + 1 ? " selected" : ""}>${i + 1} / ${zs.volumesNoetig}</option>`).join("")}</select>
        <label><input id="genTekk" type="checkbox" ${z.projekt ? (z.projekt.tekkDrums ? "checked" : "") : zs.tekkEmpfohlen ? "checked" : ""} /> tekk4-Drums dazu (501–535)${zs.tekkEmpfohlen ? " — empfohlen, Drums fehlen" : ""}</label>
      </div>
      <div class="zeile"><button id="genBank" class="primary">Bank bauen</button>
        ${
          z.projekt
            ? `<span>${escapeHtml(z.projekt.name)}.all · ${z.projekt.samples.length} Samples · Status <b id="genStatus">${status}</b></span>`
            : ""
        }
      </div>
      ${
        z.projekt
          ? `<div class="zeile">
        <button id="genBankSpeichern">.all herunterladen</button><button id="genProjektSpeichern">projekt.json</button>
        ${fsb && z.ordnerPfad ? `<button id="genProjektOrdner" title="${escapeHtml(z.ordnerPfad)}\\TekkForge">Projekt speichern (TekkForge/)</button>` : ""}
        ${fsb ? `<button id="genSd">auf SD kopieren</button>` : ""}
        <button id="genGeladen" ${status === "geladen" ? "disabled" : ""}>als geladen markieren</button>
      </div>`
          : ""
      }
      ${z.meldung ? `<div class="fortschritt" id="genMeldung">${escapeHtml(z.meldung)}</div>` : ""}`
    : "";
  const bauen = z.projekt
    ? `
      <div class="zeile">
        <label>Modus</label>
        <label><input type="radio" name="genModus" value="jam" checked /> Jam-Pattern</label>
        <label><input type="radio" name="genModus" value="miniset" /> Mini-Set (6)</label>
        <label><input type="radio" name="genModus" value="promelo" /> Pro Melo (${melos.length})</label>
      </div>
      <div class="zeile"><label title="Alle Patterns tragen dieselben vollen Steps; entmutet wird stufenweise (Melo+Snare → Hats → … → Drop mit Kick). Spielweise: am Geraet Parts entmuten.">
        <input id="genAufbau" type="checkbox" ${z.aufbau ? "checked" : ""} /> Aufbau-Kette (Mute/Unmute-Spielweise)</label>
      </div>
      <div class="zeile"><label for="genMelo">Melodie</label>
        <select id="genMelo"><option value="">Regel waehlt</option>${melos
          .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${m.takte} T)</option>`)
          .join("")}</select>
        <button id="genHoeren" title="Vorhoeren">▶</button>
      </div>
      <div class="zeile"><label for="genSlot">Start-Slot</label><input id="genSlot" type="number" min="1" max="250" value="1" style="width:70px" /></div>
      <div class="zeile"><label for="genText">Beschreibung</label></div>
      <textarea id="genText" placeholder="${
        z.ki?.gesetzt
          ? "z. B. duester, Aufbau ueber zwei Takte, Vocal nur im Break, Kick hart — Claude macht daraus das Rezept"
          : "z. B. hart, rollende bass, arp stab — ohne API-Key wirken nur Schluesselwoerter"
      }"></textarea>
      ${
        tekkKi()
          ? `<div class="zeile"><label for="genKey">KI (Premium)</label>
        ${
          z.ki?.gesetzt
            ? `<span class="ok">Key gesetzt (${escapeHtml(z.ki.vorschau ?? "")})</span>
          <select id="genModell" title="Modell-ID (wird in den App-Einstellungen gespeichert)">${[...new Set([...KI_MODELLE, z.ki.modell])]
            .map((m) => `<option value="${escapeHtml(m)}"${m === z.ki?.modell ? " selected" : ""}>${escapeHtml(m)}</option>`)
            .join("")}<option value="__frei">andere ID …</option></select>
          <button id="genKeyLoeschen">Key loeschen</button>`
            : `<input id="genKey" type="password" placeholder="Anthropic API-Key" style="width:240px" /><button id="genKeySpeichern">Key speichern</button><span class="fortschritt">kein Key — Regel-Planer</span>`
        }</div>`
          : ""
      }
      <div class="zeile"><button id="genLos" class="primary" ${z.kiLaeuft ? "disabled" : ""}>${z.kiLaeuft ? "KI denkt …" : "Generieren"}</button>
        ${z.kiHinweis ? `<span class="fortschritt">${escapeHtml(z.kiHinweis)}</span>` : ""}</div>
      <div class="liste" id="genMeloListe">${melos
        .map(
          (m) =>
            `<div><span class="rolle">melo</span><span class="takte">${m.takte} T</span><span style="flex:1">${escapeHtml(m.name)}</span><button data-nr="${m.nr}" class="genPlay" title="Vorhoeren">▶</button></div>`,
        )
        .join("")}</div>`
    : `<div class="fortschritt">Erst Verzeichnis waehlen und Bank bauen.</div>`;
  const sperre = geraetSperrgrund(z.projekt, z.marker, panelBridge.midi.ready);
  const ergebnis = z.ergebnis
    ? `
      <div class="zeile"><b>${z.ergebnis.patterns.length} Pattern(s)</b> · ${escapeHtml(z.ergebnis.dateiname)}
        <button id="genDatei" class="primary">→ Datei</button><button id="genEditor">→ Editor</button>
        <button id="genGeraet" ${sperre || z.sendet ? "disabled" : ""} title="${escapeHtml(sperre ?? "0x4C-Slot-Dump, laufendes Pattern bleibt unberuehrt")}">→ Geraet ab Slot <span id="genGeraetSlot">${z.ergebnis.startSlot}</span></button>
        ${sperre ? `<span class="fortschritt">${escapeHtml(sperre)}</span>` : ""}</div>
      <div class="liste">${z.ergebnis.patterns
        .map(
          (p, i) =>
            `<div><span class="takte">${i + 1}</span><span style="flex:1">${escapeHtml(p.name)}</span><span class="fortschritt">${p.parts.filter((x) => !x.muted).length} Parts · ${p.bpm} BPM${p.chainTo ? ` → ${p.chainTo}` : ""}</span></div>`,
        )
        .join("")}</div>
      <div class="warum"><b>Warum so?</b> ${escapeHtml(z.ergebnis.warumSo)}</div>
      ${z.ergebnis.hinweise.length ? `<div class="hinweis">${escapeHtml(z.ergebnis.hinweise.join(" · "))}</div>` : ""}
      ${z.sendeStatus ? `<div class="fortschritt" id="genSendeStatus">${escapeHtml(z.sendeStatus)}</div>` : ""}`
    : `<div class="fortschritt">Noch nichts erzeugt.</div>`;
  host.innerHTML = `
    <div class="card">
      <h3>1 · Quelle</h3>
      <div class="zeile">
        <label for="genOrdner">Sample-Verzeichnis</label>
        <input id="genOrdner" type="file" multiple />
      </div>
      <div class="fortschritt" id="genFortschritt">${escapeHtml(z.fortschritt)}</div>
      <div class="zeile">
        <label for="genLied">Lied analysieren</label>
        <input id="genLied" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" />
      </div>
      <div class="zeile">
        <label for="genLiedBpm">Lied-BPM</label>
        <input id="genLiedBpm" type="number" min="40" max="300" placeholder="messen" style="width:80px" />
        <label title="${escapeHtml(z.python?.meldung ?? "Probe laeuft …")}"><input id="genDemucs" type="checkbox" ${z.python?.demucs ? "checked" : "disabled"} /> Stems per Demucs${z.python ? (z.python.demucs ? "" : " (nicht verfuegbar)") : " (Probe …)"}</label>
        <label title="Ohne Haken werden Kick/Snare/Hat aus dem Drums-Stem des Lieds geschnitten; mit Haken kommen die Drums aus tekk4 bzw. dem gescannten Ordner."><input id="genLiedEigene" type="checkbox" ${z.liedDrumsEigene ? "checked" : ""} ${z.python?.demucs ? "" : "disabled"} /> eigene Drums statt Lied-Drums</label>
        <button id="genLiedLos" ${z.liedLaeuft ? "disabled" : ""}>${z.liedLaeuft ? "Analysiere …" : "Fenster holen"}</button>
        <button id="genLiedAlles" class="primary" ${z.liedLaeuft ? "disabled" : ""} title="Analysieren → Stems → Drums schneiden → Bank bauen → Patterns erzeugen in einem Ablauf">${z.liedLaeuft ? "Laeuft …" : "Alles aus dem Lied"}</button>
      </div>
      ${z.liedStatus ? `<div class="fortschritt" id="genLiedStatus">${escapeHtml(z.liedStatus)}</div>` : ""}
      ${
        z.lied?.dateien.length
          ? `<div class="liste" id="genFensterListe">${z.lied.dateien
              .map((d) => z.eintraege.find((e) => e.datei === d))
              .filter((e): e is ScanEintrag => !!e)
              .map(
                (e) =>
                  `<div><span class="rolle">${e.rolle}</span><span class="takte">${(e.sekunden / (240 / (z.zusammen?.tempoVorschlag || 180))).toFixed(0)} T</span><span style="flex:1">${escapeHtml(e.stem)}</span><span class="fortschritt">${e.rmsDb.toFixed(0)} dB</span><button class="genFensterPlay" data-datei="${escapeHtml(e.datei)}" title="${fensterSpielt === e.datei ? "Stopp" : "Vorhoeren (8 Takte)"}">${fensterSpielt === e.datei ? "■" : "▶"}</button></div>`,
              )
              .join("")}</div>`
          : ""
      }
      ${quelle}
    </div>
    <div class="card">
      <h3>2 · Was bauen</h3>
      ${bauen}
    </div>
    <div class="card" style="grid-column: 1 / -1">
      <h3>3 · Ergebnis</h3>
      ${ergebnis}
    </div>`;
  ($("genOrdner") as HTMLInputElement).setAttribute("webkitdirectory", "");
  verdrahte();
}

function knopf(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

function verdrahte(): void {
  const ordner = $("genOrdner") as HTMLInputElement;
  ordner.addEventListener("change", () => void scanneOrdner(ordner.files));
  knopf("genBank", () => void bankBauen());
  knopf("genLiedLos", () => void liedAnalysieren());
  knopf("genLiedAlles", () => void alleAusLied());
  document.getElementById("genLiedEigene")?.addEventListener("change", (e) => {
    z.liedDrumsEigene = (e.target as HTMLInputElement).checked;
  });
  knopf("genBankSpeichern", () => {
    if (z.bank && z.projekt) download(z.bank, `${z.projekt.name}.all`, "application/octet-stream");
  });
  knopf("genProjektSpeichern", () => {
    if (z.projekt) download(projektJson(z.projekt), "projekt.json", "application/json");
  });
  knopf("genProjektOrdner", () => void projektSpeichern());
  knopf("genSd", () => void aufSd());
  knopf("genGeladen", alsGeladen);
  knopf("genLos", () => void generieren());
  document.getElementById("genAufbau")?.addEventListener("change", (e) => {
    z.aufbau = (e.target as HTMLInputElement).checked;
  });
  knopf("genKeySpeichern", () => void keySpeichern(($("genKey") as HTMLInputElement).value));
  knopf("genKeyLoeschen", () => void keySpeichern(""));
  document.getElementById("genModell")?.addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    let modell = sel.value;
    if (modell === "__frei") {
      const eingabe = prompt("Modell-ID (z. B. claude-opus-5):", z.ki?.modell ?? KI_MODELL_STANDARD);
      if (!eingabe) {
        sel.value = z.ki?.modell ?? KI_MODELL_STANDARD;
        return;
      }
      modell = eingabe.trim();
    }
    void modellSpeichern(modell);
  });
  knopf("genHoeren", () => {
    const n = ($("genMelo") as HTMLSelectElement).value;
    const s = z.projekt?.samples.find((x) => x.name === n);
    if (s) hoeren(s.nr);
  });
  knopf("genDatei", () => {
    if (z.ergebnis) download(z.ergebnis.bytes, z.ergebnis.dateiname, "application/octet-stream");
  });
  knopf("genEditor", inEditor);
  knopf("genGeraet", () => void anGeraet());
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genPlay")) {
    b.addEventListener("click", () => hoeren(Number(b.dataset.nr)));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genFensterPlay")) {
    b.addEventListener("click", () => fensterHoeren(b.dataset.datei ?? ""));
  }
}

function hoeren(nr: number): void {
  const s = z.pool.find((p) => p.number === nr);
  if (s) player.audition(s);
}

type DateiMitPfad = File & { webkitRelativePath?: string };

async function scanneOrdner(files: FileList | null): Promise<void> {
  if (!files?.length) return;
  const alle = Array.from(files) as DateiMitPfad[];
  // alle Ebenen des gewaehlten Verzeichnisses; nur TekkForge/ (eigene Ausgabe) und versteckte Ordner bleiben draussen
  const liste = alle.filter((f) => dateiRelevant(f.webkitRelativePath ?? f.name, f.name));
  z.ordner = (alle[0].webkitRelativePath ?? "").split("/")[0] || "Verzeichnis";
  const fsb = tekkFs();
  const erste = liste[0] ?? alle[0];
  z.ordnerPfad = fsb && erste ? ordnerVon(fsb.pfadVon(erste)) : "";
  if (z.ordnerPfad && z.ordner === "Verzeichnis") z.ordner = z.ordnerPfad.split(/[\\/]/).pop() || z.ordner;
  z.projekt = null;
  z.bank = null;
  z.ergebnis = null;
  z.pool = [];
  z.meldung = "";
  z.sendeStatus = "";
  const eingaben: ScanEingabe[] = [];
  const fehler: { datei: string; grund: string }[] = [];
  for (let i = 0; i < liste.length; i++) {
    z.fortschritt = `Dekodiere ${i + 1}/${liste.length}: ${liste[i].name}`;
    const el = document.getElementById("genFortschritt");
    if (el) el.textContent = z.fortschritt;
    try {
      eingaben.push(await dekodiere(liste[i]));
    } catch (e) {
      fehler.push({ datei: liste[i].name, grund: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const res = scanne(eingaben);
  z.eintraege = res.eintraege;
  z.uebersprungen = [...fehler, ...res.uebersprungen];
  z.zusammen = zusammenfassung(z.eintraege);
  z.fortschritt = "";
  render();
}

/** Ein Fenster (mono 44,1 k) als Scan-Eintrag — 8 Takte, ein Sample, Gruppe melo:<lied> <label>. */
function fensterEintrag(liedName: string, label: string, pcm: Float32Array, rolle: "melo" | "vox"): ScanEintrag {
  // 16-Zeichen-Namen: "<Lied> <LABEL>" bzw. "<Lied> <LABEL> VX" — Liedname so kuerzen, dass das VX-Kuerzel sichtbar bleibt
  const kurz = rolle === "vox" ? liedName.slice(0, Math.max(3, 16 - label.length - 4)) : liedName.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}${rolle === "vox" ? " VX" : ""}`;
  return {
    datei: `${stem}.wav`, stem, rolle, familie: familie(stem), sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm), peak: peakVon(pcm), pcm, sampleRate: 44100,
  };
}

const DRUM_KURZ: Record<DrumRolle, string> = { kick: "KICK", snare: "SNR", hat: "HAT" };

/** Ein geschnittener Drum-Shot als Scan-Eintrag — Name "<Lied> KICK1" usw., Familie teilt der Lied-Stamm. */
function drumEintrag(liedName: string, t: DrumTreffer, nr: number): ScanEintrag {
  const label = `${DRUM_KURZ[t.rolle]}${nr}`;
  const kurz = liedName.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`, stem, rolle: t.rolle, familie: familie(stem), sekunden: t.pcm.length / 44100,
    rmsDb: t.rmsDb, peak: peakVon(t.pcm), pcm: t.pcm, sampleRate: 44100,
  };
}

/** Lied dekodieren → Fenster (TS) → optional Demucs-Stems → als Melo/Vox-Eintraege in den Scan. */
async function liedAnalysieren(): Promise<void> {
  const input = document.getElementById("genLied") as HTMLInputElement | null;
  const datei = input?.files?.[0];
  if (!datei) {
    z.liedStatus = "Erst eine Audiodatei waehlen.";
    render();
    return;
  }
  if (z.liedLaeuft) return;
  z.liedLaeuft = true;
  merkeLetzteDatei(datei.name, "lied");
  z.liedStatus = `Dekodiere ${datei.name} …`;
  render();
  const lied = tekkLied();
  let abmelden: (() => void) | null = null;
  try {
    const eingabe = await dekodiere(datei);
    const hinweis = Number((document.getElementById("genLiedBpm") as HTMLInputElement | null)?.value) || undefined;
    z.liedStatus = "Tempo messen, Fenster waehlen …";
    render();
    await new Promise((r) => setTimeout(r, 0));
    // Ziel-Tempo: Feld bzw. Verzeichnis-Vorschlag; ohne beides das Lied-Tempo in der Tekk-Oktave (kein Varispeed)
    let zielBpm = Number((document.getElementById("genBpm") as HTMLInputElement | null)?.value) || z.zusammen?.tempoVorschlag || 0;
    if (!zielBpm) {
      const vor = analysiereLied(eingabe.pcm, 44100, { zielBpm: 180, bpmHinweis: hinweis, anzahl: 1 });
      zielBpm = Math.round(vor.bpm * vor.k * 10) / 10;
    }
    const res = analysiereLied(eingabe.pcm, 44100, { zielBpm, bpmHinweis: hinweis });
    if (!res.fenster.length) throw new Error("kein hoerbares Fenster gefunden");
    const liedName = datei.name.replace(/\.[^.]+$/, "").slice(0, 10).trim() || "Lied";
    const demucs = !!(document.getElementById("genDemucs") as HTMLInputElement | null)?.checked && !!lied && !!z.python?.demucs;
    const neue: ScanEintrag[] = [];
    if (demucs && lied) {
      abmelden = lied.onFortschritt((t) => {
        z.liedStatus = t;
        const el = document.getElementById("genLiedStatus");
        if (el) el.textContent = t;
      });
      z.liedStatus = `Demucs auf ${res.fenster.length} Fenstern (dauert ein bis zwei Minuten) …`;
      render();
      const antwort = await lied.stems({
        fenster: res.fenster.map((f) => ({ id: f.label, bytes: Array.from(encodeWav16(f.pcm, 44100, 1)) })),
      });
      for (const f of antwort.fenster) {
        const melo = parseWav(Uint8Array.from(f.melo));
        neue.push(fensterEintrag(liedName, f.id, melo.pcm, "melo"));
        if (f.vox) {
          const vox = parseWav(Uint8Array.from(f.vox));
          neue.push(fensterEintrag(liedName, f.id, vox.pcm, "vox"));
        }
      }
      // Drums aus dem Lied: den Stem des lautesten Fensters (DROP) schneiden
      if (!z.liedDrumsEigene) {
        const dw = antwort.fenster.find((f) => f.id === "DROP" && f.drums) ?? antwort.fenster.find((f) => f.drums);
        if (dw?.drums) {
          const drums = parseWav(Uint8Array.from(dw.drums));
          const treffer = schneideDrums(drums.pcm, 44100);
          const zaehler: Record<DrumRolle, number> = { kick: 0, snare: 0, hat: 0 };
          for (const t of treffer) neue.push(drumEintrag(liedName, t, ++zaehler[t.rolle]));
        }
      }
    } else {
      for (const f of res.fenster as LiedFenster[]) neue.push(fensterEintrag(liedName, f.label, f.pcm, "melo"));
    }
    // Eintraege des vorherigen Lied-Laufs ersetzen, andere Samples behalten
    const alt = new Set(z.lied?.dateien ?? []);
    z.eintraege = z.eintraege.filter((e) => !alt.has(e.datei)).concat(neue);
    if (!z.ordner) z.ordner = liedName;
    z.zusammen = zusammenfassung(z.eintraege);
    z.projekt = null;
    z.bank = null;
    z.ergebnis = null;
    z.pool = [];
    z.lied = { name: liedName, bpm: res.bpm, k: res.k, fenster: res.fenster.map((f) => f.label), stems: demucs, dateien: neue.map((e) => e.datei) };
    const drumZahl = neue.filter((e) => e.rolle === "kick" || e.rolle === "snare" || e.rolle === "hat").length;
    z.liedStatus = `${datei.name}: ${res.bpm.toFixed(1)} BPM ×${res.k} → ${zielBpm} BPM (Varispeed ${res.rate.toFixed(3)}) · Fenster ${res.fenster
      .map((f) => `${f.label} @ ${f.startSek.toFixed(0)} s`)
      .join(", ")}${demucs ? ` · Stems: bass+other als Melo, Vocals als Vox${drumZahl ? `, ${drumZahl} Drum-Shots geschnitten` : ""}` : " · Vollmix (ohne Demucs)"} — jetzt „Bank bauen"`;
  } catch (e) {
    z.liedStatus = "Lied-Analyse fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  } finally {
    abmelden?.();
    z.liedLaeuft = false;
    render();
  }
}

/** Ein-Klick: Lied analysieren (mit Stems/Drums, falls verfuegbar) → Bank bauen → Patterns erzeugen. */
async function alleAusLied(): Promise<void> {
  if (z.liedLaeuft) return;
  await liedAnalysieren();
  if (!z.eintraege.length || !z.zusammen) return;
  await bankBauen();
  if (!z.projekt) return;
  await generieren();
  z.liedStatus = `${z.liedStatus.replace(/ — jetzt „Bank bauen"$/, "")} — Bank gebaut, ${z.ergebnis?.patterns.length ?? 0} Pattern(s) erzeugt`;
  render();
}

async function bankBauen(): Promise<void> {
  if (!z.eintraege.length || !z.zusammen) return;
  const bpm = Number(($("genBpm") as HTMLInputElement).value) || z.zusammen.tempoVorschlag;
  const volume = Number(($("genVolume") as HTMLSelectElement).value) || 1;
  const tekkGewuenscht = ($("genTekk") as HTMLInputElement).checked;
  const tekk = tekkGewuenscht ? await ladeTekkDrums() : null;
  if (tekkGewuenscht && !tekk) alert("tekk4.all nicht gefunden (examples/e2s/tekk4.all) — Bank ohne tekk-Drums.");
  const name = z.ordner.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "projekt";
  try {
    const { projekt, bank, warnungen } = planeBank(z.eintraege, { name, bpm, volume, tekkDrumsBank: tekk ?? undefined });
    z.projekt = projekt;
    z.bank = new Uint8Array(bank);
    z.pool = importSamplesFromAll(z.bank);
    z.ergebnis = null;
    z.meldung = "";
    z.sendeStatus = "";
    if (warnungen.length) alert("Hinweise beim Bankbau:\n" + warnungen.join("\n"));
  } catch (e) {
    alert("Bank konnte nicht gebaut werden: " + (e instanceof Error ? e.message : String(e)));
  }
  render();
}

function projektDateien(): { name: string; bytes: Uint8Array }[] {
  if (!z.projekt || !z.bank) return [];
  return [
    { name: `${z.projekt.name}.all`, bytes: z.bank },
    { name: "projekt.json", bytes: new TextEncoder().encode(projektJson(z.projekt)) },
  ];
}

async function projektSpeichern(): Promise<void> {
  const fsb = tekkFs();
  if (!fsb || !z.projekt || !z.ordnerPfad) return;
  try {
    const res = await fsb.schreibe(`${z.ordnerPfad}\\TekkForge`, projektDateien());
    z.meldung = `Projekt gespeichert: ${res.ordner} (${res.geschrieben.length} Dateien)`;
    try {
      localStorage.setItem("tekkforge.letzterOrdner", res.ordner);
    } catch {
      /* ohne Speicher kein Backup-Manager-Vorschlag */
    }
  } catch (e) {
    z.meldung = "Speichern fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

async function aufSd(): Promise<void> {
  const fsb = tekkFs();
  if (!fsb || !z.projekt) return;
  let medien: { pfad: string; label: string }[] = [];
  try {
    medien = await fsb.wechselmedien();
  } catch (e) {
    alert("Wechselmedien konnten nicht ermittelt werden: " + (e instanceof Error ? e.message : String(e)));
    return;
  }
  if (!medien.length) {
    alert("Keine SD-Karte gefunden (kein Wechselmedium). Karte einstecken, Schreibschutz pruefen.");
    return;
  }
  let wahl = medien[0];
  if (medien.length > 1) {
    const antwort = prompt(medien.map((m, i) => `${i + 1}: ${m.pfad} ${m.label}`).join("\n") + "\n\nNummer der Karte:", "1");
    const i = Number(antwort) - 1;
    if (!(i >= 0 && i < medien.length)) return;
    wahl = medien[i];
  }
  try {
    const res = await fsb.schreibe(sdZielpfad(wahl.pfad), projektDateien());
    z.projekt.status = "exportiert";
    z.meldung = `Auf SD kopiert: ${res.ordner} — am Geraet erst die .all importieren, dann „als geladen markieren"`;
  } catch (e) {
    z.meldung = "SD-Kopie fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

function alsGeladen(): void {
  if (!z.projekt) return;
  const sp = speicher();
  if (sp) z.marker = markerSchreiben(sp, z.projekt);
  else z.marker = { name: z.projekt.name, bankZeit: z.projekt.bankZeit };
  z.meldung = `„${z.projekt.name}" gilt jetzt als im Geraet geladen — Patterns koennen live in Slots.`;
  render();
}

async function keySpeichern(key: string): Promise<void> {
  const ki = tekkKi();
  if (!ki) return;
  try {
    z.ki = await ki.keySetzen(key, KI_MODELL_STANDARD);
    z.kiHinweis = z.ki.gesetzt ? "Key gespeichert (App-Einstellungen, nicht im Projekt)" : "Key geloescht";
  } catch (e) {
    z.kiHinweis = "Key konnte nicht gespeichert werden: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

async function modellSpeichern(modell: string): Promise<void> {
  const ki = tekkKi();
  if (!ki) return;
  try {
    z.ki = await ki.modellSetzen(modell);
    z.kiHinweis = `Modell: ${z.ki.modell}`;
  } catch (e) {
    z.kiHinweis = "Modell nicht gespeichert: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

async function generieren(): Promise<void> {
  if (!z.projekt || z.kiLaeuft) return;
  const modus = (document.querySelector<HTMLInputElement>("input[name=genModus]:checked")?.value ?? "jam") as Modus;
  const bpm = Number(($("genBpm") as HTMLInputElement).value) || z.projekt.bpm;
  const melo = ($("genMelo") as HTMLSelectElement).value || undefined;
  const beschreibung = ($("genText") as HTMLTextAreaElement).value;
  const startSlot = Number(($("genSlot") as HTMLInputElement).value) || 1;
  const ki = tekkKi();
  let rezept;
  z.kiHinweis = "";
  if (ki && z.ki?.gesetzt && (modus === "jam" || modus === "miniset")) {
    z.kiLaeuft = true;
    render();
    try {
      const { system, user } = promptFuer(z.projekt, { modus, bpm, beschreibung, melo });
      const antwort = await ki.rezept({ system, user, schema: REZEPT_SCHEMA });
      const res = antwortZuRezept(antwort.text, z.projekt);
      rezept = res.rezept;
      z.kiHinweis = `Rezept von ${antwort.modell} (${antwort.tokens} Token)${res.korrekturen.length ? ` · ${res.korrekturen.length} Feld(er) korrigiert: ${res.korrekturen.slice(0, 3).join("; ")}` : ""}`;
    } catch (e) {
      z.kiHinweis = "KI nicht erreichbar (" + (e instanceof Error ? e.message : String(e)) + ") — Regel-Planer";
    } finally {
      z.kiLaeuft = false;
    }
  }
  let rezepte: Rezept[] | undefined;
  if (ki && z.ki?.gesetzt && modus === "promelo") {
    z.kiLaeuft = true;
    render();
    try {
      const { system, user } = promptFuerProMelo(z.projekt, { bpm, beschreibung });
      const melos = meloKandidaten(pools(z.projekt)).length;
      const antwort = await ki.rezept({ system, user, schema: REZEPT_LISTE_SCHEMA, maxTokens: Math.min(32000, 1500 + melos * 700), timeoutMs: 300_000 });
      const res = antwortZuRezepte(antwort.text, z.projekt);
      rezepte = res.rezepte;
      z.kiHinweis = `${melos} Rezepte von ${antwort.modell} (${antwort.tokens} Token)${res.korrekturen.length ? ` · ${res.korrekturen.length} Korrektur(en): ${res.korrekturen.slice(0, 3).join("; ")}` : ""}`;
    } catch (e) {
      z.kiHinweis = "KI nicht erreichbar (" + (e instanceof Error ? e.message : String(e)) + ") — Regel-Planer";
    } finally {
      z.kiLaeuft = false;
    }
  }
  // Beschreibung und Auswahl bleiben nach dem Rendern erhalten
  const text = beschreibung;
  z.ergebnis = erzeuge(z.projekt, { modus, bpm, melo, beschreibung, startSlot, rezept, rezepte, aufbau: z.aufbau });
  z.sendeStatus = "";
  render();
  const ta = document.getElementById("genText") as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  const radio = document.querySelector<HTMLInputElement>(`input[name=genModus][value=${modus}]`);
  if (radio) radio.checked = true;
  const sel = document.getElementById("genMelo") as HTMLSelectElement | null;
  if (sel && melo) sel.value = melo;
  const slot = document.getElementById("genSlot") as HTMLInputElement | null;
  if (slot) slot.value = String(startSlot);
}

function inEditor(): void {
  if (!z.ergebnis || !z.bank) return;
  const allpat = new Uint8Array(alsAllPat(z.ergebnis.patterns));
  onEditor(editorProjectFromE2Files(allpat, z.bank));
}

/** Alle erzeugten Patterns nacheinander per 0x4C auf Slots ab dem Start-Slot schreiben. */
async function anGeraet(): Promise<void> {
  if (!z.ergebnis || z.sendet) return;
  const sperre = geraetSperrgrund(z.projekt, z.marker, panelBridge.midi.ready);
  if (sperre) {
    alert(sperre);
    return;
  }
  const start = z.ergebnis.startSlot;
  const n = z.ergebnis.patterns.length;
  if (start + n - 1 > 250) {
    alert(`Slots ${start}–${start + n - 1} liegen ueber 250.`);
    return;
  }
  z.sendet = true;
  let bestaetigt = 0;
  try {
    for (let i = 0; i < n; i++) {
      const p = z.ergebnis.patterns[i];
      z.sendeStatus = `Sende ${i + 1}/${n}: „${p.name}" → Slot ${start + i} …`;
      render();
      const ok = await panelBridge.writePatternToSlotDirect(patternFuerGeraet(p), start + i);
      if (ok) bestaetigt++;
    }
    z.sendeStatus = `Fertig: ${n} Pattern(s) auf Slots ${start}–${start + n - 1} geschrieben, ${bestaetigt} vom Geraet bestaetigt — am Geraet per Program Change hinwechseln.`;
  } catch (e) {
    z.sendeStatus = "Senden abgebrochen: " + (e instanceof Error ? e.message : String(e));
  } finally {
    z.sendet = false;
    render();
  }
}

export function initGenerator(cb: (p: EditorProject) => void): void {
  onEditor = cb;
  const sp = speicher();
  z.marker = sp ? markerLesen(sp) : null;
  render();
  const ki = tekkKi();
  if (ki) {
    void ki.keyStatus().then((s) => {
      z.ki = s;
      render();
    }).catch(() => {
      z.ki = { gesetzt: false, modell: KI_MODELL_STANDARD };
    });
  }
  const lied = tekkLied();
  if (lied) {
    void lied.pythonStatus().then((s) => {
      z.python = { demucs: s.demucs, meldung: s.meldung };
      render();
    }).catch((e: unknown) => {
      z.python = { demucs: false, meldung: "Probe fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)) };
      render();
    });
  } else {
    z.python = { demucs: false, meldung: "nur in der Desktop-App" };
  }
}

export function generatorWirdSichtbar(): void {
  // Sperrgrund haengt am MIDI-Zustand, der im Editor-Tab wechselt — nur den Knopf nachziehen,
  // nicht neu rendern (sonst gehen Beschreibung und Auswahl verloren).
  const knopf = document.getElementById("genGeraet") as HTMLButtonElement | null;
  if (!knopf) return;
  const sperre = geraetSperrgrund(z.projekt, z.marker, panelBridge.midi.ready);
  knopf.disabled = !!sperre || z.sendet;
  knopf.title = sperre ?? "0x4C-Slot-Dump, laufendes Pattern bleibt unberuehrt";
  const grund = knopf.nextElementSibling;
  if (grund && grund.classList.contains("fortschritt")) grund.textContent = sperre ?? "";
}
