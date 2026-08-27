/**
 * sampleEditor.ts (GUI) — Samples von Hand nachbearbeiten.
 *
 * Wellenform ansehen, Anfang und Ende ziehen, ein- und ausblenden,
 * normalisieren, umkehren, Loop setzen. Alle Rechnungen liegen in
 * `core/sampleEdit`; hier steht nur Darstellung und Bedienung.
 *
 * Bis „Übernehmen" bleibt das Original unangetastet — gerechnet wird auf einer
 * Kopie, und ein Zurück-Knopf holt jeden Schritt zurueck.
 */
import { $, escapeHtml } from "./shared";
import { wieAmGeraet, GERAET_RATE } from "../core/geraeteKlang";
import {
  schneide,
  blenden,
  normalisiere,
  umkehren,
  wellenform,
  stilleGrenzen,
  pruefeLoop,
  LOOP_AUS,
  LOOP_VORWAERTS,
} from "../core/sampleEdit";

export interface SampleZumBearbeiten {
  nummer: number;
  name: string;
  pcm: Float32Array;
  sampleRate: number;
  loopType?: number;
  loopStartFrame?: number;
}

export interface SampleEditorHooks {
  /** Übernehmen: geänderte Daten zurück ins Projekt. */
  uebernehmen(nummer: number, pcm: Float32Array, loop: { loopType: number; loopStartFrame: number }): void;
  /** Vorhören eines beliebigen Ausschnitts. */
  anhoeren(pcm: Float32Array, sampleRate: number): void;
}

let hooks: SampleEditorHooks | null = null;
let offen: SampleZumBearbeiten | null = null;
let arbeit: Float32Array = new Float32Array();
let verlauf: Float32Array[] = [];
let auswahl = { von: 0, bis: 0 };
let loop = { loopType: LOOP_AUS, loopStartFrame: 0 };
let ziehen: "von" | "bis" | null = null;

const BREITE = 760;
const HOEHE = 150;

const setStatus = (t: string): void => {
  const el = document.getElementById("seStatus");
  if (el) el.textContent = t;
};

const sek = (frames: number): string => (frames / (offen?.sampleRate ?? 44100)).toFixed(3);

/** Wellenform samt Auswahl und Loop-Marke zeichnen. */
function zeichne(): void {
  const canvas = document.getElementById("seWelle") as HTMLCanvasElement | null;
  if (!canvas || !offen) return;
  canvas.width = BREITE;
  canvas.height = HOEHE;
  const ctx = canvas.getContext("2d")!;
  const stil = getComputedStyle(document.documentElement);
  const farbe = (n: string, ersatz: string) => stil.getPropertyValue(n).trim() || ersatz;
  ctx.fillStyle = farbe("--bg", "#101014");
  ctx.fillRect(0, 0, BREITE, HOEHE);

  // Bereich ausserhalb der Auswahl abdunkeln
  const x = (frame: number) => (frame / Math.max(1, arbeit.length)) * BREITE;
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(0, 0, x(auswahl.von), HOEHE);
  ctx.fillRect(x(auswahl.bis), 0, BREITE - x(auswahl.bis), HOEHE);

  const { min, max } = wellenform(arbeit, BREITE);
  ctx.strokeStyle = farbe("--accent2", "#4db8ff");
  ctx.beginPath();
  for (let s = 0; s < BREITE; s++) {
    const y1 = HOEHE / 2 - max[s] * (HOEHE / 2 - 2);
    const y2 = HOEHE / 2 - min[s] * (HOEHE / 2 - 2);
    ctx.moveTo(s + 0.5, y1);
    ctx.lineTo(s + 0.5, y2);
  }
  ctx.stroke();

  // Mittellinie
  ctx.strokeStyle = farbe("--border", "#2c2c38");
  ctx.beginPath();
  ctx.moveTo(0, HOEHE / 2);
  ctx.lineTo(BREITE, HOEHE / 2);
  ctx.stroke();

  // Griffe fuer Anfang und Ende
  for (const [frame, f] of [[auswahl.von, farbe("--accent", "#ff6a00")], [auswahl.bis, farbe("--accent", "#ff6a00")]] as const) {
    ctx.strokeStyle = f;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(frame), 0);
    ctx.lineTo(x(frame), HOEHE);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // Loop-Start
  if (loop.loopType === LOOP_VORWAERTS) {
    ctx.strokeStyle = "#5ed49a";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x(loop.loopStartFrame), 0);
    ctx.lineTo(x(loop.loopStartFrame), HOEHE);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function renderInfo(): void {
  const el = document.getElementById("seInfo");
  if (!el || !offen) return;
  el.textContent =
    `${arbeit.length} Frames · ${sek(arbeit.length)} s · Auswahl ${sek(auswahl.bis - auswahl.von)} s ` +
    `(${auswahl.von}–${auswahl.bis})${loop.loopType === LOOP_VORWAERTS ? ` · Loop ab ${loop.loopStartFrame}` : ""}`;
  const zurueck = document.getElementById("seZurueck") as HTMLButtonElement | null;
  if (zurueck) zurueck.disabled = verlauf.length === 0;
}

/** Neuen Stand setzen und den alten auf den Rückweg-Stapel legen. */
function setze(neu: Float32Array, was: string): void {
  verlauf.push(arbeit);
  if (verlauf.length > 20) verlauf.shift();
  arbeit = neu;
  auswahl = { von: 0, bis: arbeit.length };
  loop.loopStartFrame = Math.min(loop.loopStartFrame, Math.max(0, arbeit.length - 1));
  zeichne();
  renderInfo();
  setStatus(`${was} — noch nicht übernommen.`);
}

function render(): void {
  const host = document.getElementById("seBox");
  if (!host || !offen) return;
  host.classList.remove("hidden");
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <b>Sample bearbeiten — #${offen.nummer} ${escapeHtml(offen.name)}</b>
      <button id="seSchliessen" class="ghost">Schließen</button>
    </div>
    <canvas id="seWelle" style="width:100%;max-width:${BREITE}px;border:1px solid var(--border);border-radius:6px;margin-top:6px;cursor:ew-resize"></canvas>
    <div id="seInfo" class="sub" style="margin:4px 0"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin-top:4px">
      <button id="seStille" class="ghost" title="Anfang und Ende auf den hörbaren Bereich setzen">Stille finden</button>
      <button id="seSchneiden" class="ghost">Auf Auswahl kürzen</button>
      <div><label style="display:block;color:var(--muted);font-size:10px">Einblende (ms)</label>
        <input id="seFadeEin" type="number" min="0" max="5000" value="2" style="width:70px" /></div>
      <div><label style="display:block;color:var(--muted);font-size:10px">Ausblende (ms)</label>
        <input id="seFadeAus" type="number" min="0" max="5000" value="5" style="width:70px" /></div>
      <button id="seBlenden" class="ghost">Blenden</button>
      <button id="seNorm" class="ghost">Normalisieren</button>
      <button id="seUm" class="ghost">Umkehren</button>
      <button id="seHoeren" class="ghost">▶ Auswahl</button>
      <button id="seZurueck" class="ghost">↶ Zurück</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <span class="sub" style="margin:0"><b>Klangprobe:</b></span>
      <button id="seProbeOrig" class="ghost" title="Die Auswahl so, wie sie hier vorliegt">▶ Original</button>
      <button id="seProbeGeraet" class="ghost" title="Auf einen Kanal, auf 16 Bit quantisiert — der Weg durch die Bank">▶ Wie am Gerät</button>
      ${
        offen.sampleRate !== GERAET_RATE
          ? `<button id="seProbeIgnoriert" class="ghost" title="Falls die Electribe die gespeicherte Rate nicht beachtet">▶ …wenn die Rate ignoriert wird</button>
             <span class="sub" style="margin:0">Gespeichert mit ${offen.sampleRate} Hz — am Gerät noch nicht abgenommen.</span>`
          : `<span class="sub" style="margin:0">44,1 kHz: hier ändert das Speichern nur die Wortbreite.</span>`
      }
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <label><input type="checkbox" id="seLoop" ${loop.loopType === LOOP_VORWAERTS ? "checked" : ""} /> Schleife (statt One-Shot)</label>
      <div><label style="display:block;color:var(--muted);font-size:10px">Loop-Start (Frame)</label>
        <input id="seLoopStart" type="number" min="0" value="${loop.loopStartFrame}" style="width:100px" /></div>
      <span style="flex:1"></span>
      <button id="seUebernehmen" class="primary">Übernehmen</button>
    </div>
    <div id="seStatus" class="sub" style="margin-top:4px">Anfang und Ende im Bild ziehen.</div>`;

  const canvas = $("seWelle") as HTMLCanvasElement;
  const frameAus = (ev: MouseEvent): number => {
    const r = canvas.getBoundingClientRect();
    return Math.round(((ev.clientX - r.left) / r.width) * arbeit.length);
  };
  canvas.addEventListener("mousedown", (ev) => {
    const f = frameAus(ev);
    ziehen = Math.abs(f - auswahl.von) <= Math.abs(f - auswahl.bis) ? "von" : "bis";
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: ev.clientX }));
  });
  canvas.addEventListener("mousemove", (ev) => {
    if (!ziehen) return;
    const f = Math.max(0, Math.min(arbeit.length, frameAus(ev)));
    if (ziehen === "von") auswahl.von = Math.min(f, auswahl.bis - 1);
    else auswahl.bis = Math.max(f, auswahl.von + 1);
    zeichne();
    renderInfo();
  });
  const losLassen = () => {
    ziehen = null;
  };
  canvas.addEventListener("mouseup", losLassen);
  canvas.addEventListener("mouseleave", losLassen);

  $("seSchliessen").addEventListener("click", schliesse);
  $("seStille").addEventListener("click", () => {
    const g = stilleGrenzen(arbeit, 45);
    auswahl = { von: g.von, bis: g.bis };
    zeichne();
    renderInfo();
    setStatus(`Hörbarer Bereich: ${sek(g.von)} s bis ${sek(g.bis)} s.`);
  });
  $("seSchneiden").addEventListener("click", () => setze(schneide(arbeit, auswahl.von, auswahl.bis), "Gekürzt"));
  $("seBlenden").addEventListener("click", () => {
    const ein = Number(($("seFadeEin") as HTMLInputElement).value) || 0;
    const aus = Number(($("seFadeAus") as HTMLInputElement).value) || 0;
    setze(blenden(arbeit, ein, aus, offen!.sampleRate), `Geblendet (${ein}/${aus} ms)`);
  });
  $("seNorm").addEventListener("click", () => setze(normalisiere(arbeit, 0.95), "Normalisiert"));
  $("seUm").addEventListener("click", () => setze(umkehren(arbeit), "Umgekehrt"));
  $("seHoeren").addEventListener("click", () => hooks?.anhoeren(schneide(arbeit, auswahl.von, auswahl.bis), offen!.sampleRate));
  $("seProbeOrig").addEventListener("click", () => probe("orig"));
  $("seProbeGeraet").addEventListener("click", () => probe("geraet"));
  document.getElementById("seProbeIgnoriert")?.addEventListener("click", () => probe("ignoriert"));
  $("seZurueck").addEventListener("click", () => {
    const vorher = verlauf.pop();
    if (!vorher) return;
    arbeit = vorher;
    auswahl = { von: 0, bis: arbeit.length };
    zeichne();
    renderInfo();
    setStatus("Ein Schritt zurück.");
  });
  $("seLoop").addEventListener("change", () => {
    loop.loopType = ($("seLoop") as HTMLInputElement).checked ? LOOP_VORWAERTS : LOOP_AUS;
    zeichne();
    renderInfo();
  });
  $("seLoopStart").addEventListener("change", () => {
    loop.loopStartFrame = Math.max(0, Math.round(Number(($("seLoopStart") as HTMLInputElement).value) || 0));
    zeichne();
    renderInfo();
  });
  $("seUebernehmen").addEventListener("click", () => {
    if (!offen || !hooks) return;
    if (loop.loopType === LOOP_VORWAERTS) {
      const p = pruefeLoop(loop.loopStartFrame, arbeit.length, arbeit.length);
      if (!p.ok) {
        setStatus(`Nicht übernommen: ${p.grund}`);
        return;
      }
    }
    hooks.uebernehmen(offen.nummer, arbeit, { ...loop });
    setStatus(`Übernommen — #${offen.nummer} hat jetzt ${arbeit.length} Frames (${sek(arbeit.length)} s).`);
  });

  zeichne();
  renderInfo();
}

/**
 * Klangprobe: die Auswahl einmal so, wie sie hier liegt, und einmal so, wie
 * das Geraet sie spielt.
 *
 * Der Vergleich lohnt vor allem bei einer gespeicherten Rate unter 44,1 kHz:
 * beachtet die Electribe sie, klingt es wie das Original — beachtet sie sie
 * nicht, laeuft dasselbe Sample doppelt so schnell. Am Geraet ist das noch
 * nicht abgenommen, also kann man wenigstens vorher beide Faelle hoeren.
 */
function probe(was: "orig" | "geraet" | "ignoriert"): void {
  if (!offen || !hooks) return;
  const teil = schneide(arbeit, auswahl.von, auswahl.bis);
  if (was === "orig") {
    hooks.anhoeren(teil, offen.sampleRate);
    setStatus(`Original: ${sek(teil.length)} s bei ${offen.sampleRate} Hz.`);
    return;
  }
  const r = wieAmGeraet(teil, offen.sampleRate, { rateBeachtet: was !== "ignoriert" });
  hooks.anhoeren(r.pcm, r.sampleRate);
  const dauer = (r.pcm.length / r.sampleRate).toFixed(2);
  setStatus(
    (was === "ignoriert" ? "Rate ignoriert" : "Wie am Gerät") +
      `: ${dauer} s bei ${r.sampleRate} Hz.` +
      (r.hinweise.length ? ` ${r.hinweise.join(" ")}` : ""),
  );
}

function schliesse(): void {
  offen = null;
  verlauf = [];
  document.getElementById("seBox")?.classList.add("hidden");
}

export function initSampleEditor(h: SampleEditorHooks): void {
  hooks = h;
}

/** Editor für ein Sample öffnen (aus dem Pool heraus). */
export function oeffneSampleEditor(s: SampleZumBearbeiten): void {
  offen = s;
  arbeit = s.pcm.slice();
  verlauf = [];
  auswahl = { von: 0, bis: arbeit.length };
  loop = {
    loopType: s.loopType === LOOP_VORWAERTS ? LOOP_VORWAERTS : LOOP_AUS,
    loopStartFrame: Math.max(0, Math.min(s.loopStartFrame ?? 0, Math.max(0, arbeit.length - 1))),
  };
  render();
}
