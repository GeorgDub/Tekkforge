/**
 * generator.ts — Tab „Generator": Verzeichnis scannen, Bank bauen,
 * Jam / Mini-Set / Pro Melo erzeugen, Vorhoeren, → Datei, → Editor,
 * Projekt auf Platte / SD, „als geladen markieren", → Geraet (Slot-Weg).
 * Duenne DOM-Schicht; Entscheidungen in core/generatorSession.ts und
 * core/projektStatus.ts.
 */
import { rendereKette } from "../core/patternRender";
import { STEM_VORGABE, TEIL_NAME, teileAus, pruefeAuswahl, auswahlText, ALLE_TEILE, type StemAuswahl } from "../core/stemAuswahl";
import { $, download, escapeHtml, frageText, frageAuswahl } from "./shared";
import { dekodiere } from "./audioDecode";
import { PreviewPlayer } from "./preview";
import { panelBridge } from "./editor";
import { tekkFs, ordnerVon } from "./tekkFs";
import { tekkKi } from "./tekkKi";
import { tekkLied } from "./tekkLied";
import { analysiereLied, type LiedFenster } from "../core/liedAnalyse";
import { tekkZielTempo, TEKK_MITTE } from "../core/tempoAnalyse";
import { encodeWav16, parseWav } from "../core/wavCodec";
import { rmsDb, peakVon, familie } from "../core/sampleScan";
import { schneideDrums, type DrumTreffer, type DrumRolle } from "../core/drumSchnitt";
import {
  promptFuer, antwortZuRezept, REZEPT_SCHEMA, KI_MODELL_STANDARD, KI_MODELLE, promptFuerProMelo, antwortZuRezepte, REZEPT_LISTE_SCHEMA,
} from "../core/kiPlaner";
import type { Rezept } from "../core/rezept";
import { scanne, type ScanEintrag, type ScanEingabe } from "../core/sampleScan";
import { merkeLetzteDatei } from "./start";
import { tekkUrl } from "./tekkUrl";
import { tonartErkennen } from "../core/keyAnalyse";
import { klangProfil } from "../core/klangProfil";
import { planeBank, type Projekt } from "../core/bankPlan";
import { zusammenfassung, erzeuge, projektJson, dateiRelevant, eindeutigeKuerzel, teileLieder, voxSegmentEintrag, type LiedGruppe, type Erzeugt, type Zusammenfassung } from "../core/generatorSession";
import { bassNoten } from "../core/grundton";
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
  /** Haken "Stems per Demucs" — lebt im Zustand, weil render() die Checkbox neu baut. */
  demucsGewuenscht: boolean;
  /** zuletzt analysierte Lieder (Multi-Select: alle aus einem Analyse-Lauf) */
  lieder: { name: string; bpm: number; k: number; fenster: string[]; stems: boolean; dateien: string[]; zeile: string }[];
  liedLaeuft: boolean;
  liedStatus: string;
  /** Aufbau-Kette: Steps ueberall gesetzt, entmutet wird stufenweise; Drop kickt haerter, Vocal-Paare wandern ueber die Kette */
  aufbau: boolean;
  /** Welche Stems aus dem Lied geholt werden (Vorgabe: Melodie+Vocals+Drums). */
  stemAuswahl: StemAuswahl;
  /** Index des gerade vorgehoerten Patterns, sonst null. */
  hoertPattern: number | null;
  /** Erste Aufbau-Stufe nur mit jedem zweiten Schlagzeug-Schlag. */
  duennesIntro: boolean;
  /** Alter, dichter Satz statt des schlanken. */
  dichteVoll: boolean;
  /** eigene Drums (tekk/Ordner) statt aus dem Lied geschnittener Kick/Snare/Hat */
  liedDrumsEigene: boolean;
  /** Ziel-BPM der letzten Lied-Analyse — Bank und Patterns muessen im selben Tempo laufen wie die geschnittenen Fenster */
  liedBpm: number | null;
  /** Vocals mit halber Abtastrate in die Bank (spart Speicher, am Geraet noch unbestaetigt) */
  sparsameVocals: boolean;
  /** Stem-Trennung genauer statt schneller (mittelt ueber verschobene Durchlaeufe) */
  trennungGenau: boolean;
  /** yt-dlp/ffmpeg-Probe fuer den URL-Import (nur Electron) */
  url: { ok: boolean; meldung: string } | null;
  urlLaeuft: boolean;
  /** Per URL geholtes Lied — render() leert File-Inputs, darum liegt die Datei hier. */
  urlDatei: File | null;
  /** Aufgeteilte Multi-Lied-Sets (je eigene .all + .e2sallpat), wenn 250 Slots nicht reichen. */
  sets: {
    name: string;
    lieder: string[];
    bank: Uint8Array;
    bankName: string;
    pat: Uint8Array;
    patName: string;
    patterns: number;
    samples: number;
  }[];
}

const z: Zustand = {
  ordner: "", ordnerPfad: "", eintraege: [], uebersprungen: [], zusammen: null, projekt: null, bank: null, pool: [],
  ergebnis: null, fortschritt: "", meldung: "", marker: null, sendeStatus: "", sendet: false, ki: null, kiLaeuft: false, kiHinweis: "",
  python: null, demucsGewuenscht: false, lieder: [], liedLaeuft: false, liedStatus: "", aufbau: true, stemAuswahl: { ...STEM_VORGABE }, hoertPattern: null, duennesIntro: false, dichteVoll: false, liedDrumsEigene: false, liedBpm: null, sparsameVocals: false, trennungGenau: false,
  url: null, urlLaeuft: false, urlDatei: null, sets: [],
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
/** Vom Hauptmodul gesetzt: Lied an die Stem-Werkbank uebergeben und dorthin wechseln. */
let onWerkbank: (dateien: File[]) => void = () => {};
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
  // Die Vorschau gehoert zu EINEM Ergebnis. Verschwindet es (neuer Scan, neue
  // Bank, neues Erzeugen), muss der Ton weg — sonst laeuft die Schleife weiter,
  // waehrend der Knopf zum Stoppen aus der Liste verschwunden ist. Hier statt
  // an den fuenf Stellen, an denen z.ergebnis genullt wird: aufhoeren darf
  // nicht davon abhaengen, dass jemand daran denkt.
  if (z.hoertPattern !== null && vorschauFuer !== z.ergebnis) {
    player.stop();
    z.hoertPattern = null;
  }
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
        <input id="genBpm" type="number" min="60" max="300" value="${z.projekt?.bpm ?? z.liedBpm ?? zs.tempoVorschlag}" style="width:80px" />
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
      <div class="zeile"><label title="Steps in allen Patterns gesetzt; entmutet wird stufenweise (Melo+Snare → Hats → … → Drop mit Kick). Aufbau leicht gedimmt, Snare-Fill vor dem Drop, Drop-Kicks auf Maximum; die Vocal-Paare des Lieds wandern ueber die Kette (AUF → DROP → VRS). Spielweise: am Geraet Parts entmuten.">
        <input id="genAufbau" type="checkbox" ${z.aufbau ? "checked" : ""} /> Aufbau-Kette (Mute/Unmute-Spielweise)</label>
      </div>
      <div class="zeile"><label title="Laesst die erste Stufe nur jeden zweiten Schlagzeug-Schlag spielen. Melodie und Vocals bleiben ganz. Ohne diesen Haken tragen alle Stufen dieselben Steps und nur die Mutes unterscheiden sich — das ist die Spielweise, fuer die die Kette gebaut ist.">
        <input id="genIntroDuenn" type="checkbox" ${z.duennesIntro ? "checked" : ""} /> Anfangsstufe ausduennen</label>
      </div>
      <div class="zeile"><label title="Der schlanke Satz ist die Vorgabe: offene HiHat als Achtel-Akzent statt Dauerrasseln, Clap nur in Takt 2 und 4 statt auf jeder Snare, und die Kick bekommt einen eigenen vierten Takt. Nachgemessen: 109 Treffer und null leere Steps vorher, 82 Treffer und 16 leere Steps danach. Dieser Haken holt den alten, dichten Satz zurueck.">
        <input id="genDichteVoll" type="checkbox" ${z.dichteVoll ? "checked" : ""} /> Dichter Satz (alt)</label>
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
  const setAnsicht = z.sets.length
    ? `
      <div class="zeile"><b>${z.sets.length} Set(s)</b> — je Set erst die .all importieren, dann die .e2sallpat
        ${fsb ? `<button id="genSetsSd" class="primary">alle auf SD kopieren</button>` : ""}</div>
      <div class="liste">${z.sets
        .map(
          (s, i) =>
            `<div><span class="takte">${i + 1}</span><span class="rolle">${escapeHtml(s.name)}</span><span style="flex:1">${escapeHtml(s.lieder.join(" + "))}</span><span class="fortschritt">${s.patterns} Patterns · ${s.samples} Samples</span><button class="genSetAll" data-set="${i}" title="${escapeHtml(s.bankName)}">⬇ .all</button><button class="genSetPat" data-set="${i}" title="${escapeHtml(s.patName)}">⬇ .e2sallpat</button></div>`,
        )
        .join("")}</div>`
    : "";
  const ergebnis = z.sets.length
    ? setAnsicht
    : z.ergebnis
    ? `
      <div class="zeile"><b>${z.ergebnis.patterns.length} Pattern(s)</b> · ${escapeHtml(z.ergebnis.dateiname)}
        <button id="genDatei" class="primary">→ Datei</button><button id="genEditor">→ Editor</button>
        <button id="genWav" title="Die ganze Kette als WAV ausrechnen — zum Anhoeren auf Kopfhoerern oder unterwegs. Vereinfachte Vorschau ohne Filter und Effekte, also nicht der Klang des Geraets.">→ WAV</button>
        <button id="genGeraet" ${sperre || z.sendet ? "disabled" : ""} title="${escapeHtml(sperre ?? "0x4C-Slot-Dump, laufendes Pattern bleibt unberuehrt")}">→ Geraet ab Slot <span id="genGeraetSlot">${z.ergebnis.startSlot}</span></button>
        ${sperre ? `<span class="fortschritt">${escapeHtml(sperre)}</span>` : ""}</div>
      <div class="liste">${z.ergebnis.patterns
        .map(
          (p, i) =>
            `<div><span class="takte">${i + 1}</span><span style="flex:1">${escapeHtml(p.name)}</span><span class="fortschritt">${p.parts.filter((x) => !x.muted).length} Parts · ${p.bpm} BPM${p.chainTo ? ` → ${p.chainTo}` : ""}</span><button class="genPatPlay" data-pat="${i}" title="Am Rechner vorhoeren — genau das, was auch aufs Geraet ginge">${z.hoertPattern === i ? "■" : "▶"}</button></div>`,
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
        <input id="genLied" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" multiple />
      </div>
      <div class="zeile">
        <label for="genUrl" title="${escapeHtml(z.url?.meldung ?? "Probe laeuft …")}">Von URL</label>
        <input id="genUrl" type="text" placeholder="YouTube- oder SoundCloud-Link" style="flex:1;min-width:220px" ${z.url?.ok && !z.urlLaeuft ? "" : "disabled"} />
        <button id="genUrlHolen" ${z.url?.ok && !z.urlLaeuft ? "" : "disabled"}>${z.urlLaeuft ? "Laedt …" : "Holen"}</button>
        ${z.url && !z.url.ok ? `<span class="fortschritt" title="${escapeHtml(z.url.meldung)}">nicht verfuegbar</span>` : ""}
      </div>
      <div class="zeile">
        <label for="genLiedBpm">Lied-BPM</label>
        <input id="genLiedBpm" type="number" min="40" max="300" placeholder="messen" style="width:80px" />
        <label title="${escapeHtml(z.python?.meldung ?? "Probe laeuft …")}"><input id="genDemucs" type="checkbox" ${z.python?.demucs ? (z.demucsGewuenscht ? "checked" : "") : "disabled"} /> Stems per Demucs${z.python ? (z.python.demucs ? "" : " (nicht verfuegbar)") : " (Probe …)"}</label>
        <label title="Ohne Haken werden Kick/Snare/Hat aus dem Drums-Stem des Lieds geschnitten; mit Haken kommen die Drums aus tekk4 bzw. dem gescannten Ordner."><input id="genLiedEigene" type="checkbox" ${z.liedDrumsEigene ? "checked" : ""} ${z.python?.demucs ? "" : "disabled"} /> eigene Drums statt Lied-Drums</label>
      </div>
      <div class="zeile" title="Welche Teile aus dem Lied herausgetrennt werden. Weniger Teile heißt mehr Platz im Sample-RAM für das, was du wirklich brauchst.">
        <label style="min-width:110px">Stems holen</label>
        ${ALLE_TEILE.map((t) => `<label><input type="checkbox" class="genStemTeil" data-teil="${t}" ${z.stemAuswahl[t] ? "checked" : ""} ${z.python?.demucs ? "" : "disabled"} /> ${TEIL_NAME[t]}</label>`).join(" ")}
        <span class="fortschritt" id="genStemInfo">${escapeHtml(auswahlText(z.stemAuswahl))}</span>
        <label title="Genauer mittelt über zusätzlich verschobene Durchläufe — rund ein Viertel mehr Zeit für einen meist kaum hörbaren Unterschied."><input id="genTrennungGenau" type="checkbox" ${z.trennungGenau ? "checked" : ""} ${z.python?.demucs ? "" : "disabled"} /> Trennung genauer (langsamer)</label>
        <label title="Vocals mit halber Abtastrate ablegen — halber Speicher, doppelt so viel Lied passt in eine Bank. Gesang verliert dabei kaum hörbar. ⚠ Am Gerät noch nicht abgenommen: klingen die Vocals doppelt so schnell, beachtet die Electribe die gespeicherte Rate nicht — dann Haken wieder raus."><input id="genSparsameVox" type="checkbox" ${z.sparsameVocals ? "checked" : ""} /> Vocals sparsam (halbe Rate)</label>
        <button id="genLiedLos" ${z.liedLaeuft ? "disabled" : ""}>${z.liedLaeuft ? "Analysiere …" : "Fenster holen"}</button>
        <button id="genLiedAlles" class="primary" ${z.liedLaeuft ? "disabled" : ""} title="Analysieren → Stems → Drums schneiden → Bank bauen → Patterns erzeugen in einem Ablauf">${z.liedLaeuft ? "Laeuft …" : "Alles aus dem Lied"}</button>
        <button id="genWerkbank" ${z.liedLaeuft ? "disabled" : ""} title="Das gewaehlte Lied in der Stem-Werkbank oeffnen: Spuren untereinander, anhoeren, von Hand schneiden.">In die Stem-Werkbank</button>
      </div>
      ${z.liedStatus ? `<div class="fortschritt" id="genLiedStatus">${escapeHtml(z.liedStatus)}</div>` : ""}
      ${
        z.lieder.some((l) => l.dateien.length)
          ? `<div class="liste" id="genFensterListe">${z.lieder
              .flatMap((l) => l.dateien)
              .map((d) => z.eintraege.find((e) => e.datei === d))
              .filter((e): e is ScanEintrag => !!e)
              .map(
                (e) =>
                  `<div><span class="rolle">${e.rolle}</span><span class="takte">${(e.sekunden / (240 / (z.liedBpm || z.zusammen?.tempoVorschlag || 180))).toFixed(0)} T</span><span style="flex:1">${escapeHtml(e.stem)}</span><span class="fortschritt">${e.rmsDb.toFixed(0)} dB</span><button class="genFensterPlay" data-datei="${escapeHtml(e.datei)}" title="${fensterSpielt === e.datei ? "Stopp" : "Vorhoeren (8 Takte)"}">${fensterSpielt === e.datei ? "■" : "▶"}</button></div>`,
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
  knopf("genWerkbank", () => {
    // Das gewaehlte Lied weiterreichen, statt es dort noch einmal auswaehlen
    // zu lassen — inklusive der per URL geholten Datei.
    const inp = document.getElementById("genLied") as HTMLInputElement | null;
    const dateien = inp?.files?.length ? Array.from(inp.files) : z.urlDatei ? [z.urlDatei] : [];
    if (!dateien.length) {
      z.liedStatus = "Erst eine Audiodatei waehlen (oder per URL holen).";
      render();
      return;
    }
    onWerkbank(dateien);
  });
  knopf("genLiedAlles", () => void alleAusLied());
  knopf("genUrlHolen", () => void urlHolen());
  knopf("genSetsSd", () => void aufSd());
  for (const b of document.querySelectorAll<HTMLButtonElement>(".genSetAll")) {
    b.addEventListener("click", () => {
      const s = z.sets[Number(b.dataset.set)];
      if (s) download(s.bank, s.bankName, "application/octet-stream");
    });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(".genSetPat")) {
    b.addEventListener("click", () => {
      const s = z.sets[Number(b.dataset.set)];
      if (s) download(s.pat, s.patName, "application/octet-stream");
    });
  }
  document.getElementById("genLiedEigene")?.addEventListener("change", (e) => {
    z.liedDrumsEigene = (e.target as HTMLInputElement).checked;
  });
  document.getElementById("genDemucs")?.addEventListener("change", (e) => {
    z.demucsGewuenscht = (e.target as HTMLInputElement).checked;
  });
  document.getElementById("genSparsameVox")?.addEventListener("change", (e) => {
    z.sparsameVocals = (e.target as HTMLInputElement).checked;
  });
  document.getElementById("genTrennungGenau")?.addEventListener("change", (e) => {
    z.trennungGenau = (e.target as HTMLInputElement).checked;
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
  for (const b of document.querySelectorAll<HTMLInputElement>("#viewGenerator .genStemTeil")) {
    b.addEventListener("change", () => {
      const teil = b.dataset.teil as keyof StemAuswahl;
      z.stemAuswahl = { ...z.stemAuswahl, [teil]: b.checked };
      const p = pruefeAuswahl(z.stemAuswahl, { tekkDrums: z.liedDrumsEigene });
      const info = document.getElementById("genStemInfo");
      // Hinweise stehen daneben, nicht im Weg: wer nur Vocals will, darf das —
      // er soll nur vorher wissen, was dem Set dann fehlt.
      if (info) info.textContent = auswahlText(z.stemAuswahl) + (p.hinweise.length ? " — " + p.hinweise.join(" ") : "");
    });
  }
  document.getElementById("genIntroDuenn")?.addEventListener("change", (e) => {
    z.duennesIntro = (e.target as HTMLInputElement).checked;
  });
  document.getElementById("genDichteVoll")?.addEventListener("change", (e) => {
    z.dichteVoll = (e.target as HTMLInputElement).checked;
  });
  knopf("genKeySpeichern", () => void keySpeichern(($("genKey") as HTMLInputElement).value));
  knopf("genKeyLoeschen", () => void keySpeichern(""));
  document.getElementById("genModell")?.addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    let modell = sel.value;
    if (modell === "__frei") {
      const eingabe = await frageText("Modell-ID (z. B. claude-opus-5):", z.ki?.modell ?? KI_MODELL_STANDARD);
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
  knopf("genWav", alsWav);
  knopf("genGeraet", () => void anGeraet());
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genPlay")) {
    b.addEventListener("click", () => hoeren(Number(b.dataset.nr)));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genPatPlay")) {
    b.addEventListener("click", () => patternHoeren(Number(b.dataset.pat)));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewGenerator .genFensterPlay")) {
    b.addEventListener("click", () => fensterHoeren(b.dataset.datei ?? ""));
  }
}

/**
 * Vorhoeren eines erzeugten Patterns.
 *
 * Der Umweg ueber die fertige Bank-Datei ist Absicht: gespielt wird GENAU das,
 * was auch aufs Geraet ginge, samt Mutes, Anschlag, Lautstaerke, Panorama und
 * Tonhoehe. Eine Vorschau, die den Umweg abkuerzt, klaenge womoeglich besser
 * als das Ergebnis — und waere damit wertlos.
 *
 * Die Wandlung kostet ein paar Zehntel (4-MB-Bank bauen und wieder lesen),
 * deshalb wird sie gemerkt, bis ein neues Ergebnis entsteht.
 */
let vorschauProjekt: EditorProject | null = null;
/**
 * Wofuer die gemerkte Vorschau gilt. Ueber die Objektidentitaet statt ueber
 * ein Zuruecksetzen an fuenf Stellen: ein neues Ergebnis ungueltig zu machen
 * darf nicht davon abhaengen, dass jemand daran denkt.
 */
let vorschauFuer: unknown = null;

function vorschauStoppen(): void {
  if (z.hoertPattern === null) return;
  player.stop();
  z.hoertPattern = null;
}

function patternHoeren(i: number): void {
  if (z.hoertPattern === i) {
    player.stop();
    z.hoertPattern = null;
    render();
    return;
  }
  if (!z.ergebnis || !z.bank) return;
  try {
    if (vorschauFuer !== z.ergebnis) {
      vorschauProjekt = editorProjectFromE2Files(new Uint8Array(alsAllPat(z.ergebnis.patterns)), z.bank);
      vorschauFuer = z.ergebnis;
    }
  } catch (err) {
    z.meldung = `Vorhoeren nicht moeglich: ${err instanceof Error ? err.message : String(err)}`;
    render();
    return;
  }
  const projekt = vorschauProjekt;
  const pat = projekt?.patterns[i];
  if (!projekt || !pat) return;
  player.start(pat, projekt.samples);
  z.hoertPattern = i;
  render();
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

/** Ein Fenster (mono 44,1 k) als Melo-Scan-Eintrag — 8 Takte, ein Sample. */
function fensterEintrag(liedName: string, label: string, pcm: Float32Array): ScanEintrag {
  const kurz = liedName.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`, stem, rolle: "melo", familie: familie(stem), sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm), peak: peakVon(pcm), pcm, sampleRate: 44100, lied: liedName, klang: klangProfil(pcm, 44100),
  };
}

const DRUM_KURZ: Record<DrumRolle, string> = { kick: "KICK", snare: "SNR", hat: "HAT" };

/** Ein geschnittener Drum-Shot als Scan-Eintrag — Name "<Lied> KICK1" usw., Familie teilt der Lied-Stamm. */
/** Bass-Loop aus dem getrennten Bass-Stem — eigene Rolle, damit er auf Part 9 landet. */
function bassEintrag(liedName: string, label: string, pcm: Float32Array): ScanEintrag {
  const stem = `${liedName.slice(0, 10)} B${label.slice(0, 4)}`;
  return {
    datei: `${stem}.wav`, stem, rolle: "ton", familie: familie(stem), sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm), peak: peakVon(pcm), pcm, sampleRate: 44100, lied: liedName, klang: klangProfil(pcm, 44100),
  };
}

function drumEintrag(liedName: string, t: DrumTreffer, nr: number): ScanEintrag {
  const label = `${DRUM_KURZ[t.rolle]}${nr}`;
  const kurz = liedName.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`, stem, rolle: t.rolle, familie: familie(stem), sekunden: t.pcm.length / 44100,
    rmsDb: t.rmsDb, peak: peakVon(t.pcm), pcm: t.pcm, sampleRate: 44100, lied: liedName, klang: klangProfil(t.pcm, 44100),
  };
}

/** YouTube-/SoundCloud-Link als WAV holen und ins Lied-Feld legen. */
async function urlHolen(): Promise<void> {
  const bruecke = tekkUrl();
  const feld = document.getElementById("genUrl") as HTMLInputElement | null;
  const url = feld?.value.trim();
  if (!bruecke || !url || z.urlLaeuft) return;
  z.urlLaeuft = true;
  z.liedStatus = "Lade Audio von der URL …";
  render();
  const abmelden = bruecke.onFortschritt((t) => {
    if (!t) return;
    const el = document.getElementById("genLiedStatus");
    if (el) el.textContent = t;
  });
  try {
    const res = await bruecke.laden(url);
    z.urlDatei = new File([new Uint8Array(res.bytes)], res.name, { type: "audio/wav" });
    z.liedStatus = `${res.name} geladen (${(res.bytes.length / 1024 / 1024).toFixed(1)} MB) — jetzt „Fenster holen" oder „Alles aus dem Lied"`;
  } catch (e) {
    z.liedStatus = "URL-Import fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  } finally {
    abmelden();
    z.urlLaeuft = false;
    render();
  }
}

/**
 * Lied(er) dekodieren → Fenster (TS) → optional Demucs-Stems → als Melo/Vox-
 * Eintraege in den Scan. Multi-Select: alle gewaehlten Dateien nacheinander;
 * das ERSTE Lied bestimmt das gemeinsame Ziel-BPM (sonst chainen die Patterns
 * nicht), alle weiteren werden per Varispeed daraufgerechnet.
 */
async function liedAnalysieren(): Promise<void> {
  const input = document.getElementById("genLied") as HTMLInputElement | null;
  // frisch gewaehlte Dateien gewinnen; sonst die per URL geholte (render() leert Inputs)
  const gewaehlt = input?.files?.length ? Array.from(input.files) : z.urlDatei ? [z.urlDatei] : [];
  if (!gewaehlt.length) {
    z.liedStatus = "Erst eine Audiodatei waehlen (oder per URL holen).";
    render();
    return;
  }
  if (z.liedLaeuft) return;
  z.liedLaeuft = true;
  const lied = tekkLied();
  let abmelden: (() => void) | null = null;
  const kuerzel = eindeutigeKuerzel(gewaehlt.map((d) => d.name));
  const alleNeuen: ScanEintrag[] = [];
  const neueLieder: Zustand["lieder"] = [];
  // Ziel-Tempo: Feld bzw. Verzeichnis-Vorschlag; ohne beides das Tempo des ERSTEN Lieds in der Tekk-Oktave
  let zielBpm = Number((document.getElementById("genBpm") as HTMLInputElement | null)?.value) || z.zusammen?.tempoVorschlag || 0;
  try {
    for (let li = 0; li < gewaehlt.length; li++) {
      const datei = gewaehlt[li];
      const prefix = gewaehlt.length > 1 ? `Lied ${li + 1}/${gewaehlt.length} — ` : "";
      merkeLetzteDatei(datei.name, "lied");
      z.liedStatus = `${prefix}Dekodiere ${datei.name} …`;
      render();
      const eingabe = await dekodiere(datei);
      // der BPM-Hinweis aus dem Feld gilt nur fuers erste Lied — die anderen haben eigene Tempi
      const hinweis = li === 0 ? Number((document.getElementById("genLiedBpm") as HTMLInputElement | null)?.value) || undefined : undefined;
      z.liedStatus = `${prefix}Tempo messen, Fenster waehlen …`;
      render();
      await new Promise((r) => setTimeout(r, 0));
      if (!zielBpm) {
        const vor = analysiereLied(eingabe.pcm, 44100, { zielBpm: TEKK_MITTE, bpmHinweis: hinweis, anzahl: 1, beatRaster: false, hook: false });
        // Die gewaehlte Oktave darf nicht aus dem Tekk-Bereich fallen. Bei drei
        // Rap-Tracks (2026-08-29) gewann die Verdopplung von 127 auf 254 um
        // 0,006 — und weil das ERSTE Lied das Tempo fuer alle vorgibt, waere
        // das ganze Set bei 254 BPM gelandet.
        zielBpm = tekkZielTempo(vor.bpm * vor.k);
      }
      const res = analysiereLied(eingabe.pcm, 44100, { zielBpm, bpmHinweis: hinweis });
      if (!res.fenster.length) throw new Error(`${datei.name}: kein hoerbares Fenster gefunden`);
      const liedName = kuerzel[li];
      const demucs = z.demucsGewuenscht && !!lied && !!z.python?.demucs;
      const neue: ScanEintrag[] = [];
      if (demucs && lied) {
        abmelden?.();
        abmelden = lied.onFortschritt((t) => {
          z.liedStatus = prefix + t;
          const el = document.getElementById("genLiedStatus");
          if (el) el.textContent = prefix + t;
        });
        // Vocal-Vollabdeckung: ALLE hoerbaren 8-Takt-Abschnitte durch Demucs —
        // die gewaehlten Fenster voll (Melo/Vox/Drums), der Rest nur Vocals
        const gewaehlteIdx = new Set(res.fenster.map((f) => f.index));
        const rest = res.segmente.filter((s) => !gewaehlteIdx.has(s.index));
        z.liedStatus = `${prefix}Demucs auf ${res.segmente.length} Abschnitten — ganze Vocalspur, dauert einige Minuten …`;
        render();
        const antwort = await lied.stems({
          qualitaet: z.trennungGenau ? "genau" : "schnell",
          teile: teileAus(z.stemAuswahl),
          fenster: [
            ...res.fenster.map((f) => ({ id: f.label, bytes: encodeWav16(f.pcm, 44100, 1) })),
            ...rest.map((s) => ({ id: `SEG${s.index}`, bytes: encodeWav16(s.pcm, 44100, 1), nurVox: true })),
          ],
        });
        const je = new Map(antwort.fenster.map((f) => [f.id, f]));
        for (const f of res.fenster) {
          const r = je.get(f.label) as { melo?: Uint8Array | number[] | null; bass?: Uint8Array | number[] | null } | undefined;
          if (!r?.melo) continue;
          const m = fensterEintrag(liedName, f.label, parseWav(Uint8Array.from(r.melo)).pcm);
          // Bassline aus dem Bass-Stem (Note je Viertel, vier Takte) — der
          // Synth-Bass spielt dann die Linie des Originals
          if (r.bass) {
            const linie = bassNoten(parseWav(Uint8Array.from(r.bass)).pcm, 44100, zielBpm, 4);
            if (linie.some((n) => n !== null)) m.bassLinie = linie;
          }
          neue.push(m);
        }
        // je hoerbarem Segment mit Vocals ein "V01…"-Eintrag in Liedreihenfolge
        let vNr = 0;
        for (const s of res.segmente) {
          const fensterLabel = res.fenster.find((f) => f.index === s.index)?.label;
          const r = je.get(fensterLabel ?? `SEG${s.index}`);
          if (r?.vox) neue.push(voxSegmentEintrag(liedName, ++vNr, parseWav(Uint8Array.from(r.vox)).pcm));
        }
        // Bass als eigener Teil (nur wenn angehakt) — ein Loop je Fenster.
        if (z.stemAuswahl.bass) {
          for (const f of res.fenster) {
            const r = je.get(f.label) as { bass?: Uint8Array | number[] | null } | undefined;
            if (r?.bass) neue.push(bassEintrag(liedName, f.label, parseWav(Uint8Array.from(r.bass)).pcm));
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
        for (const f of res.fenster as LiedFenster[]) neue.push(fensterEintrag(liedName, f.label, f.pcm));
      }
      const drumZahl = neue.filter((e) => e.rolle === "kick" || e.rolle === "snare" || e.rolle === "hat").length;
      const voxZahl = neue.filter((e) => e.rolle === "vox").length;
      const tonart = tonartErkennen(eingabe.pcm, 44100);
      const tonartText = tonart.konfidenz >= 0.03 ? ` · ${tonart.name} (${tonart.camelot})${tonart.konfidenz < 0.08 ? "?" : ""}` : "";
      neueLieder.push({
        name: liedName, bpm: res.bpm, k: res.k, fenster: res.fenster.map((f) => f.label), stems: demucs,
        dateien: neue.map((e) => e.datei),
        zeile: `${datei.name}: ${res.bpm.toFixed(1)} BPM ×${res.k} → ${zielBpm} BPM (Varispeed ${res.rate.toFixed(3)})${tonartText} · Fenster ${res.fenster
          .map((f) => `${f.label} @ ${f.startSek.toFixed(0)} s`)
          .join(", ")}${demucs ? ` · Stems: bass+other als Melo, Vocalspur in ${voxZahl} Segmenten${drumZahl ? `, ${drumZahl} Drum-Shots geschnitten` : ""}` : " · Vollmix (ohne Demucs)"}`,
      });
      alleNeuen.push(...neue);
    }
    // Eintraege des vorherigen Lied-Laufs als Ganzes ersetzen, andere Samples behalten
    const alt = new Set(z.lieder.flatMap((l) => l.dateien));
    z.eintraege = z.eintraege.filter((e) => !alt.has(e.datei)).concat(alleNeuen);
    if (!z.ordner) z.ordner = gewaehlt.length > 1 ? "multi" : kuerzel[0];
    z.zusammen = zusammenfassung(z.eintraege);
    z.projekt = null;
    z.bank = null;
    z.ergebnis = null;
    z.pool = [];
    z.sets = [];
    z.lieder = neueLieder;
    z.liedBpm = zielBpm || null;
    z.liedStatus =
      (gewaehlt.length > 1 ? `${gewaehlt.length} Lieder, gemeinsames Ziel ${zielBpm} BPM · ` : "") +
      neueLieder.map((l) => l.zeile).join(" ‖ ") +
      ` — jetzt „Bank bauen"`;
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
  // Mehrere Lieder: "Pro Melo" baut je Melodie eine Kette — alles landet in
  // EINER .e2sallpat, die Samples aller Lieder stecken schon in EINER Bank.
  if (z.lieder.length > 1) {
    const radio = document.querySelector<HTMLInputElement>('input[name=genModus][value="promelo"]');
    if (radio) radio.checked = true;
    // 250-Slot-Deckel: je Melo-Kette entstehen bis zu 6 Patterns, dazu die
    // VRS-Extras der Vocal-Abdeckung (Paare, die nicht in AUF/DROP der Ketten
    // passen) — reisst die Schaetzung den Deckel, VOR dem Generieren fragen.
    const melosJeLied = z.lieder.map((l) => z.eintraege.filter((e) => l.dateien.includes(e.datei) && e.rolle === "melo").length);
    const extrasJeLied = z.lieder.map((l, i) => {
      const vox = z.eintraege.filter((e) => l.dateien.includes(e.datei) && e.rolle === "vox").length;
      return Math.max(0, vox - 2 * Math.max(1, melosJeLied[i]));
    });
    const gruppen = teileLieder(melosJeLied, 6, 250, extrasJeLied);
    if (gruppen.length > 1) {
      const erste = gruppen[0];
      const geschaetzt = gruppen.reduce((a, g) => a + g.patterns, 0);
      const ja = confirm(
        `Rund ${geschaetzt} Patterns aus ${z.lieder.length} Liedern — mehr als 250 passen nicht in eine .e2sallpat.\n\n` +
          `Bis Lied ${erste.bisLied + 1} („${z.lieder[erste.bisLied].name}") in die erste Datei packen und die uebrigen ` +
          `${z.lieder.length - erste.bisLied - 1} Lieder auf ${gruppen.length - 1} weitere(s) Set(s) verteilen (je eigene .all + .e2sallpat)?\n\n` +
          `Abbrechen = alles in eine Datei, nur die ersten 250 Slots werden gefuellt.`,
      );
      if (ja) {
        await setsBauen(gruppen);
        return;
      }
    }
  }
  await generieren();
  const gedeckelt = (z.ergebnis?.patterns.length ?? 0) > 250 ? " — Achtung: nur die ersten 250 landen in der Datei" : "";
  z.liedStatus = `${z.liedStatus.replace(/ — jetzt „Bank bauen"$/, "")} — Bank gebaut, ${z.ergebnis?.patterns.length ?? 0} Pattern(s) erzeugt${
    z.lieder.length > 1 ? ` (Pro Melo ueber ${z.lieder.length} Lieder in einer Datei)` : ""
  }${gedeckelt}`;
  render();
}

/**
 * Multi-Lied-Split: je Gruppe eine eigene Bank (.all) + Pattern-Datei
 * (.e2sallpat), Rezepte per Regel-Planer (kein KI-Aufruf je Gruppe).
 */
async function setsBauen(gruppen: LiedGruppe[]): Promise<void> {
  const bpm = Number(($("genBpm") as HTMLInputElement | null)?.value) || z.liedBpm || z.zusammen?.tempoVorschlag || 180;
  const tekkGewuenscht = (document.getElementById("genTekk") as HTMLInputElement | null)?.checked ?? false;
  const tekk = tekkGewuenscht ? await ladeTekkDrums() : null;
  const basis = z.ordner.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10) || "multi";
  z.sets = [];
  const probleme: string[] = [];
  for (let g = 0; g < gruppen.length; g++) {
    const gruppe = gruppen[g];
    const lieder = z.lieder.slice(gruppe.vonLied, gruppe.bisLied + 1);
    const dateien = new Set(lieder.flatMap((l) => l.dateien));
    const eintraege = z.eintraege.filter((e) => dateien.has(e.datei));
    const name = `${basis}${g + 1}`;
    z.liedStatus = `Set ${g + 1}/${gruppen.length} („${name}"): Bank + Patterns …`;
    render();
    await new Promise((r) => setTimeout(r, 0));
    try {
      const { projekt, bank } = planeBank(eintraege, {
        name, bpm, volume: 1, tekkDrumsBank: tekk ?? undefined, sparsameVocals: z.sparsameVocals,
      });
      const ergebnis = erzeuge(projekt, { modus: "promelo", bpm, aufbau: z.aufbau, duennesIntro: z.duennesIntro, dichteVoll: z.dichteVoll, startSlot: 1 });
      z.sets.push({
        name,
        lieder: lieder.map((l) => l.name),
        bank: new Uint8Array(bank),
        bankName: `${name}.all`,
        pat: ergebnis.bytes,
        patName: ergebnis.dateiname,
        patterns: ergebnis.patterns.length,
        samples: projekt.samples.length,
      });
    } catch (e) {
      probleme.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  z.ergebnis = null;
  z.projekt = null;
  z.bank = null;
  z.liedStatus = `${z.sets.length} Set(s) gebaut (${z.sets.map((s) => `${s.name}: ${s.lieder.join("+")} → ${s.patterns} Patterns`).join(" · ")})${
    probleme.length ? ` — Probleme: ${probleme.join("; ")}` : ""
  } — je Set erst die .all importieren, dann die .e2sallpat`;
  render();
}

async function bankBauen(): Promise<void> {
  if (!z.eintraege.length || !z.zusammen) return;
  const bpm = Number(($("genBpm") as HTMLInputElement).value) || z.liedBpm || z.zusammen.tempoVorschlag;
  const volume = Number(($("genVolume") as HTMLSelectElement).value) || 1;
  const tekkGewuenscht = ($("genTekk") as HTMLInputElement).checked;
  const tekk = tekkGewuenscht ? await ladeTekkDrums() : null;
  if (tekkGewuenscht && !tekk) alert("tekk4.all nicht gefunden (examples/e2s/tekk4.all) — Bank ohne tekk-Drums.");
  const name = z.ordner.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "projekt";
  try {
    const { projekt, bank, warnungen } = planeBank(z.eintraege, {
      name, bpm, volume, tekkDrumsBank: tekk ?? undefined, sparsameVocals: z.sparsameVocals,
    });
    z.projekt = projekt;
    z.bank = new Uint8Array(bank);
    z.pool = importSamplesFromAll(z.bank);
    z.ergebnis = null;
    z.sets = [];
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
  if (!fsb || (!z.projekt && !z.sets.length)) return;
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
  // Steckt genau EINE KORG-Karte, ist die Frage ueberfluessig.
  const korgKarten = medien.filter((m) => (m as { korg?: boolean }).korg);
  if (korgKarten.length === 1) wahl = korgKarten[0];
  else if (medien.length > 1) {
    // Kein `prompt()`: Electron kennt es nicht und wirft — die Kopie brach
    // genau dann ab, wenn mehr als eine Karte steckte, und meldete nichts.
    const i = await frageAuswahl("Auf welche Karte?", medien.map((m) => `${m.pfad}  ${m.label}`));
    if (i === null) return;
    wahl = medien[i];
  }
  try {
    // Sets: alle .all/.e2sallpat-Paare; sonst Projekt + (falls erzeugt) die Pattern-Datei
    const dateien = z.sets.length
      ? z.sets.flatMap((s) => [
          { name: s.bankName, bytes: s.bank },
          { name: s.patName, bytes: s.pat },
        ])
      : [...projektDateien(), ...(z.ergebnis ? [{ name: z.ergebnis.dateiname, bytes: z.ergebnis.bytes }] : [])];
    const res = await fsb.schreibe(sdZielpfad(wahl.pfad), dateien);
    if (z.projekt) z.projekt.status = "exportiert";
    z.meldung = `Auf SD kopiert: ${res.ordner} (${res.geschrieben.length} Datei(en)) — am Geraet erst die .all importieren, dann die .e2sallpat`;
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
  vorschauStoppen();
  z.ergebnis = erzeuge(z.projekt, { modus, bpm, melo, beschreibung, startSlot, rezept, rezepte, aufbau: z.aufbau, duennesIntro: z.duennesIntro, dichteVoll: z.dichteVoll });
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

/**
 * Die ganze Kette zu einer WAV ausrechnen.
 *
 * Gedacht zum Anhoeren dort, wo kein Geraet steht — Kopfhoerer, Handy, Auto.
 * Gerechnet wird dieselbe vereinfachte Vorschau wie beim Vorhoeren im Fenster
 * (patternRender): kein Filter, keine Huellkurve, keine Effekte. Der Knopf
 * sagt das im Titel, damit niemand die Datei fuer den Geraeteklang haelt.
 */
function alsWav(): void {
  if (!z.ergebnis || !z.bank) return;
  try {
    if (vorschauFuer !== z.ergebnis) {
      vorschauProjekt = editorProjectFromE2Files(new Uint8Array(alsAllPat(z.ergebnis.patterns)), z.bank);
      vorschauFuer = z.ergebnis;
    }
    const projekt = vorschauProjekt;
    if (!projekt) return;
    const r = rendereKette(projekt.patterns, projekt.samples);
    const name = z.ergebnis.dateiname.replace(/\.[^.]+$/, "") + "-vorschau.wav";
    download(encodeWav16(r.pcm, r.sampleRate, r.kanaele), name, "audio/wav");
    z.meldung = `${name} — ${Math.round(r.sekunden)} s, vereinfachte Vorschau ohne Filter und Effekte.`;
  } catch (err) {
    z.meldung = `WAV konnte nicht gebaut werden: ${err instanceof Error ? err.message : String(err)}`;
  }
  render();
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

export function initGenerator(cb: (p: EditorProject) => void, werkbank?: (dateien: File[]) => void): void {
  onEditor = cb;
  if (werkbank) onWerkbank = werkbank;
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
      z.demucsGewuenscht = s.demucs;
      render();
    }).catch((e: unknown) => {
      z.python = { demucs: false, meldung: "Probe fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)) };
      render();
    });
  } else {
    z.python = { demucs: false, meldung: "nur in der Desktop-App" };
  }
  const urlBruecke = tekkUrl();
  if (urlBruecke) {
    void urlBruecke
      .probe()
      .then((s) => {
        z.url = { ok: s.ok, meldung: s.meldung };
        render();
      })
      .catch((e: unknown) => {
        z.url = { ok: false, meldung: "Probe fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)) };
        render();
      });
  } else {
    z.url = { ok: false, meldung: "nur in der Desktop-App" };
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
