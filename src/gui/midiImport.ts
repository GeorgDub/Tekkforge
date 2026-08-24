/**
 * midiImport.ts (GUI) — Tab „MIDI zu Korg": SMF ODER Audio laden (Audio wird
 * einstimmig transkribiert) → Spuren den Parts zuordnen → Piano Roll (ansehen,
 * Noten abwaehlen) → Patterns in den Editor.
 */

import { $, escapeHtml } from "./shared";
import { parseSmf, baueMidiPatterns, MIDI_PATTERN_MAX, type SmfLied, type SmfNote } from "../core/midiImport";
import { transkribiereAudio, alsSmfLied } from "../core/audioZuMidi";
import { tempoSchaetzen } from "../core/tempoAnalyse";
import { dateiArt } from "../core/generatorSession";
import { dekodiere } from "./audioDecode";
import { PART_LAYOUT_LABELS, type EditorProject } from "../core/editorModel";
import { merkeLetzteDatei } from "./start";

interface Zustand {
  lied: SmfLied | null;
  dateiname: string;
  fehler: string;
  /** spurIndex -> Ziel-Part (0..15) oder null = aus. */
  ziel: Map<number, number | null>;
  /** Im Piano Roll abgewaehlte Noten ("spur:tick:note"). */
  weg: Set<string>;
  /** Spur, die der Piano Roll zeigt. */
  rollSpur: number;
  stepLength: 16 | 32 | 64;
  hinweise: string[];
  /** dekodiertes Audio fuer die Transkription (null = echte MIDI-Datei) */
  audio: { pcm: Float32Array; name: string } | null;
  audioBpm: number;
  audioLaeuft: boolean;
}

const z: Zustand = {
  lied: null, dateiname: "", fehler: "", ziel: new Map(), weg: new Set(), rollSpur: 0, stepLength: 64, hinweise: [],
  audio: null, audioBpm: 120, audioLaeuft: false,
};

let uebergabe: ((p: EditorProject) => void) | null = null;

const notenKey = (spur: number, n: SmfNote): string => `${spur}:${n.tick}:${n.note}`;

function vorschlagZiel(lied: SmfLied): void {
  z.ziel.clear();
  // Spuren mit Noten der Reihe nach auf die Melodie-Parts (Lead/Stab/Pad …, Index 10+),
  // Kanal 10 auf die Drum-Parts vorn.
  let melo = 10;
  let drum = 0;
  lied.spuren.forEach((s, i) => {
    if (!s.noten.length) {
      z.ziel.set(i, null);
      return;
    }
    if (s.kanal === 9) z.ziel.set(i, drum < 8 ? drum++ : null);
    else z.ziel.set(i, melo < 16 ? melo++ : null);
  });
  z.rollSpur = lied.spuren.findIndex((s) => s.noten.length > 0);
}

const MIDI_ENDUNGEN = /\.(mid|midi|kar|rmi|rmid|smf)$/i;

/** Audio einstimmig transkribieren und als Pseudo-SMF in den Wizard legen. */
function transkribieren(): void {
  if (!z.audio) return;
  const noten = transkribiereAudio(z.audio.pcm, 44100, { bpm: z.audioBpm });
  z.lied = alsSmfLied(noten, z.audioBpm, z.audio.name.replace(/\.[^.]+$/, "").slice(0, 12) || "Audio");
  z.weg.clear();
  z.hinweise = noten.length
    ? [`${noten.length} Noten transkribiert (einstimmig, 16tel-Raster bei ${z.audioBpm} BPM) — im Piano Roll pruefen.`]
    : ["keine Tonhoehen gefunden — anderes BPM probieren oder stimmhafteres Material (Melodie/Bass-Stem statt Vollmix)."];
  vorschlagZiel(z.lied);
}

async function dateiLaden(f: File): Promise<void> {
  try {
    if (MIDI_ENDUNGEN.test(f.name) || dateiArt(f.name) === "skip") {
      const lied = parseSmf(new Uint8Array(await f.arrayBuffer()));
      z.lied = lied;
      z.audio = null;
      z.dateiname = f.name;
      z.fehler = "";
      z.weg.clear();
      z.hinweise = [];
      vorschlagZiel(lied);
    } else {
      // Audio-zu-MIDI: dekodieren, Tempo schaetzen, transkribieren
      z.audioLaeuft = true;
      z.fehler = "";
      render();
      const { pcm } = await dekodiere(f);
      const bpm = Math.round(tempoSchaetzen(pcm, 44100));
      z.audioBpm = bpm >= 60 && bpm <= 300 ? bpm : 120;
      z.audio = { pcm, name: f.name };
      z.dateiname = f.name;
      transkribieren();
    }
    merkeLetzteDatei(f.name, "midi");
  } catch (e) {
    z.lied = null;
    z.audio = null;
    z.fehler = e instanceof Error ? e.message : String(e);
  } finally {
    z.audioLaeuft = false;
  }
  render();
}

function spurenMitNoten(): number[] {
  return (z.lied?.spuren ?? []).map((s, i) => (s.noten.length ? i : -1)).filter((i) => i >= 0);
}

function inEditor(): void {
  const lied = z.lied;
  if (!lied || !uebergabe) return;
  const bpm = Math.min(300, Math.max(20, Number(($("miBpm") as HTMLInputElement).value) || Math.round(lied.bpm)));
  const basis = (($("miName") as HTMLInputElement).value || z.dateiname.replace(/\.[^.]+$/, "")).toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 13) || "MIDI";
  // abgewaehlte Noten rausfiltern, dann bauen
  const gefiltert = {
    ticksProViertel: lied.ticksProViertel,
    spuren: lied.spuren.map((s, i) => ({ ...s, noten: s.noten.filter((n) => !z.weg.has(notenKey(i, n))) })),
  };
  const zuordnung = [...z.ziel.entries()]
    .filter((e): e is [number, number] => e[1] !== null)
    .map(([spurIndex, part]) => ({ spurIndex, part }));
  const { patterns, hinweise } = baueMidiPatterns(gefiltert, zuordnung, { bpm, stepLength: z.stepLength, namensBasis: basis });
  z.hinweise = hinweise;
  if (!patterns.length) {
    z.hinweise = [...hinweise, "Nichts zu uebergeben — Zuordnung pruefen."];
    render();
    return;
  }
  uebergabe({ version: 1, patterns, samples: [] });
}

// ─── Piano Roll ──────────────────────────────────────────────────────────────

const ROLL_STEP_PX = 9;
const ROLL_NOTE_PX = 7;

function rollZeichnen(): void {
  const canvas = document.getElementById("miRoll") as HTMLCanvasElement | null;
  const lied = z.lied;
  if (!canvas || !lied) return;
  const spur = lied.spuren[z.rollSpur];
  if (!spur) return;
  const t16 = lied.ticksProViertel / 4;
  const steps = Math.max(z.stepLength, Math.ceil((Math.max(0, ...spur.noten.map((n) => n.tick + n.dauer)) + 1) / t16));
  const tief = Math.min(...spur.noten.map((n) => n.note), 60) - 2;
  const hoch = Math.max(...spur.noten.map((n) => n.note), 72) + 2;
  const stil = getComputedStyle(document.documentElement);
  canvas.width = steps * ROLL_STEP_PX + 1;
  canvas.height = (hoch - tief + 1) * ROLL_NOTE_PX + 1;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = stil.getPropertyValue("--bg").trim() || "#101014";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Raster: 16tel duenn, Takte kraeftig, Pattern-Fenster farbig
  for (let s = 0; s <= steps; s++) {
    const x = s * ROLL_STEP_PX + 0.5;
    ctx.strokeStyle = s % z.stepLength === 0 ? stil.getPropertyValue("--accent").trim() : s % 16 === 0 ? stil.getPropertyValue("--dim").trim() : stil.getPropertyValue("--border").trim();
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let n = tief; n <= hoch; n++) {
    if (n % 12 === 0) {
      const y = (hoch - n) * ROLL_NOTE_PX + 0.5;
      ctx.strokeStyle = stil.getPropertyValue("--border").trim();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }
  const akzent = stil.getPropertyValue("--accent2").trim() || "#00c8ff";
  const dim = stil.getPropertyValue("--dim").trim() || "#62627a";
  for (const n of spur.noten) {
    const x = (n.tick / t16) * ROLL_STEP_PX;
    const b = Math.max(3, (n.dauer / t16) * ROLL_STEP_PX - 1);
    const y = (hoch - n.note) * ROLL_NOTE_PX;
    ctx.fillStyle = z.weg.has(notenKey(z.rollSpur, n)) ? dim : akzent;
    ctx.fillRect(x + 1, y + 1, b, ROLL_NOTE_PX - 1);
  }
}

function rollKlick(ev: MouseEvent): void {
  const canvas = ev.currentTarget as HTMLCanvasElement;
  const lied = z.lied;
  if (!lied) return;
  const spur = lied.spuren[z.rollSpur];
  const rect = canvas.getBoundingClientRect();
  const t16 = lied.ticksProViertel / 4;
  const tief = Math.min(...spur.noten.map((n) => n.note), 60) - 2;
  const hoch = Math.max(...spur.noten.map((n) => n.note), 72) + 2;
  const x = ev.clientX - rect.left + canvas.parentElement!.scrollLeft;
  const y = ev.clientY - rect.top;
  const note = hoch - Math.floor(y / ROLL_NOTE_PX);
  const tick = (x / ROLL_STEP_PX) * t16;
  const treffer = spur.noten.find((n) => n.note === note && tick >= n.tick && tick <= n.tick + Math.max(n.dauer, t16 / 2));
  if (!treffer) return;
  const key = notenKey(z.rollSpur, treffer);
  if (z.weg.has(key)) z.weg.delete(key);
  else z.weg.add(key);
  rollZeichnen();
  const info = document.getElementById("miWegInfo");
  if (info) info.textContent = z.weg.size ? `${z.weg.size} Note(n) abgewaehlt` : "";
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render(): void {
  const host = $("viewMidi");
  const lied = z.lied;
  host.innerHTML = `
    <div class="card">
      <h2>1 · MIDI- oder Audio-Datei</h2>
      <div class="zeileEinst">
        <input id="miDatei" type="file" accept=".mid,.midi,.kar,.rmi,.rmid,.smf,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aif,.aiff" />
        ${lied ? `<span class="sub" style="margin:0">${escapeHtml(z.dateiname)}${z.audio ? " · transkribiert" : ` · Format ${lied.format}`} · ${lied.spuren.length} Spur(en) · ${Math.round(lied.bpm)} BPM</span>` : ""}
      </div>
      ${
        z.audio
          ? `<div class="zeileEinst" style="margin-top:6px">
              <label for="miAudioBpm">Audio-BPM</label>
              <input id="miAudioBpm" type="number" min="60" max="300" value="${z.audioBpm}" style="width:80px" />
              <button id="miNeu" class="ghost">Neu transkribieren</button>
              <span class="sub" style="margin:0">einstimmig — am besten Melodie- oder Bass-Stem, kein Vollmix</span>
            </div>`
          : ""
      }
      ${z.audioLaeuft ? `<p class="sub" style="margin:6px 0 0">Dekodiere und transkribiere …</p>` : ""}
      ${z.fehler ? `<p class="warn">${escapeHtml(z.fehler)}</p>` : ""}
      ${!lied && !z.fehler && !z.audioLaeuft ? `<p class="sub" style="margin:6px 0 0">SMF 0/1 (.mid, .kar, .rmi) — oder eine Audio-Datei: die wird einstimmig zu Noten transkribiert (Audio zu Korg).</p>` : ""}
    </div>
    ${
      lied
        ? `
    <div class="card">
      <h2>2 · Spuren → Parts</h2>
      <table>
        <thead><tr><th>Spur</th><th>Kanal</th><th>Noten</th><th>Ziel-Part</th><th></th></tr></thead>
        <tbody>
          ${spurenMitNoten()
            .map((i) => {
              const s = lied.spuren[i];
              const ziel = z.ziel.get(i);
              return `<tr>
                <td>${escapeHtml(s.name || `Spur ${i + 1}`)}</td>
                <td>${s.kanal + 1}${s.kanal === 9 ? " · Drums" : ""}</td>
                <td>${s.noten.length}</td>
                <td><select class="miZiel" data-spur="${i}">
                  <option value="">aus</option>
                  ${PART_LAYOUT_LABELS.map((l, p) => `<option value="${p}" ${ziel === p ? "selected" : ""}>${p + 1} · ${l}</option>`).join("")}
                </select></td>
                <td><button class="ghost miRollWahl" data-spur="${i}" style="padding:2px 10px;font-size:11px">${i === z.rollSpur ? "▣" : "▢"} Roll</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>3 · Piano Roll — ${escapeHtml(lied.spuren[z.rollSpur]?.name || `Spur ${z.rollSpur + 1}`)}</h2>
      <p class="sub" style="margin-top:0">Klick auf eine Note nimmt sie aus dem Import (nochmal Klick holt sie zurueck). Orange Linien = Pattern-Fenster.</p>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px"><canvas id="miRoll"></canvas></div>
      <div id="miWegInfo" class="sub" style="margin:4px 0 0">${z.weg.size ? `${z.weg.size} Note(n) abgewaehlt` : ""}</div>
    </div>
    <div class="card">
      <h2>4 · Uebernehmen</h2>
      <div class="zeileEinst">
        <label for="miBpm">BPM</label><input id="miBpm" type="number" min="20" max="300" value="${Math.round(lied.bpm)}" style="width:80px" />
        <label for="miLen">Laenge</label>
        <select id="miLen">
          <option value="16" ${z.stepLength === 16 ? "selected" : ""}>16 Steps (1 Takt)</option>
          <option value="32" ${z.stepLength === 32 ? "selected" : ""}>32 Steps (2 Takte)</option>
          <option value="64" ${z.stepLength === 64 ? "selected" : ""}>64 Steps (4 Takte)</option>
        </select>
        <label for="miName">Name</label><input id="miName" type="text" maxlength="13" value="${escapeHtml(z.dateiname.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 13))}" style="width:140px" />
        <button id="miLos" class="primary">→ In den Editor</button>
      </div>
      <p class="sub" style="margin:6px 0 0">Je ${z.stepLength} Steps ein Pattern (max ${MIDI_PATTERN_MAX}); Samples ordnest du danach im Editor zu.</p>
      ${z.hinweise.length ? `<div class="hinweis">${escapeHtml(z.hinweise.join(" · "))}</div>` : ""}
    </div>`
        : ""
    }`;
  $("miDatei").addEventListener("change", () => {
    const f = ($("miDatei") as HTMLInputElement).files?.[0];
    if (f) void dateiLaden(f);
  });
  if (z.audio) {
    $("miNeu").addEventListener("click", () => {
      z.audioBpm = Math.min(300, Math.max(60, Number(($("miAudioBpm") as HTMLInputElement).value) || z.audioBpm));
      transkribieren();
      render();
    });
  }
  if (lied) {
    for (const sel of host.querySelectorAll<HTMLSelectElement>(".miZiel")) {
      sel.addEventListener("change", () => {
        z.ziel.set(Number(sel.dataset.spur), sel.value === "" ? null : Number(sel.value));
      });
    }
    for (const b of host.querySelectorAll<HTMLButtonElement>(".miRollWahl")) {
      b.addEventListener("click", () => {
        z.rollSpur = Number(b.dataset.spur);
        render();
      });
    }
    $("miLen").addEventListener("change", () => {
      z.stepLength = Number(($("miLen") as HTMLSelectElement).value) as 16 | 32 | 64;
      render();
    });
    $("miLos").addEventListener("click", inEditor);
    const canvas = document.getElementById("miRoll") as HTMLCanvasElement;
    canvas.addEventListener("click", rollKlick);
    rollZeichnen();
  }
}

export function initMidiImport(cb: (p: EditorProject) => void): void {
  uebergabe = cb;
  render();
}

export function midiImportWirdSichtbar(): void {
  render();
}
