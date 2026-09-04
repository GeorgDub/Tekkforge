/**
 * stemWerkbank (Oberflaeche) — die Spuren eines Lieds untereinander, auf einer
 * gemeinsamen Zeitachse.
 *
 * Was der Generator automatisch schneidet, laesst sich hier von Hand
 * nachziehen: anhoeren, Marken setzen, Abschnitte in den Pool schneiden,
 * einzelne Stellen kuerzen, blenden, normalisieren. Die Rechnungen dahinter
 * stehen in `core/stemWerkbank` und `core/sampleEdit` — hier ist nur die
 * Bedienung.
 *
 * Zwei Wege zu den Marken stehen nebeneinander und tun absichtlich
 * Verschiedenes: **Raster** legt sie auf die Taktgrenzen (vorhersagbar, gut
 * fuer Drum-Loops), **Vorschlagen** liest die Spur und legt sie dorthin, wo
 * sich wirklich etwas aendert — bei Vocals in die Pausen, bei Melodien an den
 * Klangwechsel. Was das Verfahren getan hat, steht danach in der Meldung; es
 * bleibt eine Marke wie jede andere und laesst sich verschieben und loeschen.
 *
 * Gehoert wird ueber EINEN AudioContext, in dem alle hoerbaren Spuren
 * gleichzeitig starten. Ein eigener Player je Spur waere einfacher zu
 * schreiben und innerhalb eines Taktes hoerbar auseinandergelaufen — bei
 * Stems desselben Lieds ist genau das der Unterschied zwischen „passt" und
 * „klingt falsch".
 */

import { escapeHtml } from "./shared";
import { tekkLied } from "./tekkLied";
import { panelBridge } from "./editor";
import { dekodiere } from "./audioDecode";
import { encodeWav16, parseWav } from "../core/wavCodec";
import { wellenform, schneide, blenden, normalisiere, umkehren, stilleGrenzen } from "../core/sampleEdit";
import {
  neueSpur,
  setzeMarke,
  setzeMarken,
  entferneMarke,
  abschnitte,
  rasterMarken,
  vorschlagMarken,
  schneideSpur,
  spurText,
  zeitachse,
  hoerbareSpuren,
  type Spur,
  type SpurRolle,
} from "../core/stemWerkbank";
import { nextFreeSampleNumber, type PoolSample } from "../core/editorModel";
import { RAM_BUDGET_BYTES } from "../core/zielBank";
import { ramBytesFuer } from "../core/sampleRam";

const BREITE = 900;
const HOEHE = 78;
/** Ab so vielen Pixeln Mausweg ist es ein Zug und kein Klick. */
const ZUG_SCHWELLE = 4;

interface Zustand {
  spuren: Spur[];
  /** Auswahl in Frames auf der gemeinsamen Zeitachse (bis > von = aktiv). */
  auswahl: { von: number; bis: number };
  /** Welche Spur die Werkzeuge betreffen. */
  aktiv: string | null;
  bpm: number;
  takte: number;
  meldung: string;
  laeuft: boolean;
  spielt: boolean;
  /** Rueckgaengig je Spur — nur die Daten, nicht die Marken. */
  verlauf: Map<string, Float32Array[]>;
}

const z: Zustand = {
  spuren: [],
  auswahl: { von: 0, bis: 0 },
  aktiv: null,
  bpm: 180,
  takte: 8,
  meldung: "",
  laeuft: false,
  spielt: false,
  verlauf: new Map(),
};

// ── Wiedergabe ───────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let quellen: AudioBufferSourceNode[] = [];
let startZeit = 0;
let startFrame = 0;
let anim = 0;

function stoppe(): void {
  for (const q of quellen) {
    try {
      q.stop();
    } catch {
      /* schon zu Ende */
    }
  }
  quellen = [];
  z.spielt = false;
  if (anim) cancelAnimationFrame(anim);
  anim = 0;
  zeichneAlle();
}

function spieleAb(frame: number): void {
  stoppe();
  const hoerbar = hoerbareSpuren(z.spuren);
  if (!hoerbar.length) return;
  ctx = ctx ?? new AudioContext();
  void ctx.resume();
  const start = ctx.currentTime + 0.08;
  for (const s of hoerbar) {
    const ab = Math.min(s.pcm.length, Math.max(0, Math.round(frame)));
    if (ab >= s.pcm.length) continue;
    const buf = ctx.createBuffer(1, s.pcm.length - ab, s.sampleRate);
    buf.getChannelData(0).set(s.pcm.subarray(ab));
    const q = ctx.createBufferSource();
    q.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = s.gain;
    q.connect(g).connect(ctx.destination);
    q.start(start);
    quellen.push(q);
  }
  startZeit = start;
  startFrame = frame;
  z.spielt = true;
  const takt = (): void => {
    if (!z.spielt) return;
    zeichneAlle();
    anim = requestAnimationFrame(takt);
  };
  anim = requestAnimationFrame(takt);
}

/** Wo der Kopf gerade steht, in Frames der Zeitachse (−1 wenn still). */
function kopfFrame(): number {
  if (!z.spielt || !ctx) return -1;
  // Die Rate der laengsten Spur — sie spannt die Achse auf. Die erste Spur zu
  // nehmen ginge schief, sobald eine Spur mit anderer Rate dazukommt: der Kopf
  // liefe dann gegen die gezeichnete Wellenform davon.
  const sr = achsenRate();
  const f = startFrame + (ctx.currentTime - startZeit) * sr;
  if (f > zeitachse(z.spuren)) {
    stoppe();
    return -1;
  }
  return f;
}

/** Abtastrate der Spur, die die Zeitachse vorgibt. */
function achsenRate(): number {
  let laengste: Spur | null = null;
  for (const s of z.spuren) if (!laengste || s.pcm.length > laengste.pcm.length) laengste = s;
  return laengste?.sampleRate ?? 44100;
}

// ── Zeichnen ─────────────────────────────────────────────────────────────────

function farbe(n: string, ersatz: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || ersatz;
}

function zeichne(spur: Spur): void {
  const canvas = document.getElementById(`sw-${spur.id}`) as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.width = BREITE;
  canvas.height = HOEHE;
  const g = canvas.getContext("2d")!;
  const achse = zeitachse(z.spuren);
  const x = (frame: number) => (frame / achse) * BREITE;

  g.fillStyle = farbe("--bg", "#101014");
  g.fillRect(0, 0, BREITE, HOEHE);

  // Auswahl hinterlegen — sie gilt fuer alle Spuren, also auf jeder sichtbar.
  if (z.auswahl.bis > z.auswahl.von) {
    g.fillStyle = "rgba(255,106,0,.16)";
    g.fillRect(x(z.auswahl.von), 0, x(z.auswahl.bis) - x(z.auswahl.von), HOEHE);
  }

  // Die Spur endet dort, wo ihre Daten enden — nicht am Rand der Zeitachse.
  const eigeneBreite = Math.max(1, Math.round(x(spur.pcm.length)));
  const { min, max } = wellenform(spur.pcm, eigeneBreite);
  g.strokeStyle = spur.stumm && !spur.solo ? farbe("--border", "#2c2c38") : farbe("--accent2", "#4db8ff");
  g.beginPath();
  for (let s = 0; s < eigeneBreite; s++) {
    g.moveTo(s + 0.5, HOEHE / 2 - max[s] * (HOEHE / 2 - 2));
    g.lineTo(s + 0.5, HOEHE / 2 - min[s] * (HOEHE / 2 - 2));
  }
  g.stroke();

  g.strokeStyle = farbe("--border", "#2c2c38");
  g.beginPath();
  g.moveTo(0, HOEHE / 2);
  g.lineTo(eigeneBreite, HOEHE / 2);
  g.stroke();

  // Marken
  g.strokeStyle = farbe("--accent", "#ff6a00");
  for (const m of spur.marken) {
    g.beginPath();
    g.moveTo(x(m), 0);
    g.lineTo(x(m), HOEHE);
    g.stroke();
  }

  const kopf = kopfFrame();
  if (kopf >= 0) {
    g.strokeStyle = "#5ed49a";
    g.beginPath();
    g.moveTo(x(kopf), 0);
    g.lineTo(x(kopf), HOEHE);
    g.stroke();
  }
}

function zeichneAlle(): void {
  for (const s of z.spuren) zeichne(s);
}

// ── Aufbau ───────────────────────────────────────────────────────────────────

const sek = (frames: number, sr: number): string => (frames / sr).toFixed(2);

/**
 * Gemessene Kennzahlen je Spur, gemerkt.
 *
 * Die Messung ist eine FFT ueber die halbe Spur und darf nicht bei jedem
 * Neuzeichnen laufen — gerendert wird nach jedem Klick. Der Schluessel ist der
 * PCM-Puffer selbst: jede Bearbeitung legt einen neuen an, damit veraltet der
 * Eintrag von allein und niemand muss ans Aufraeumen denken.
 */
const profilCache = new WeakMap<Float32Array, string>();

function profilZeile(s: Spur): string {
  let t = profilCache.get(s.pcm);
  if (t === undefined) {
    t = spurText(s, z.bpm);
    profilCache.set(s.pcm, t);
  }
  return t;
}

function spurZeile(s: Spur): string {
  const a = abschnitte(s).length;
  const aktiv = z.aktiv === s.id;
  return `<div class="card" style="padding:8px;margin-bottom:8px;${aktiv ? `outline:1px solid ${farbe("--accent", "#ff6a00")}` : ""}">
    <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
      <button class="swWahl" data-id="${s.id}" title="Diese Spur bearbeiten">${aktiv ? "◆" : "◇"}</button>
      <b>${escapeHtml(s.name)}</b>
      <span class="sub">${escapeHtml(s.rolle)} · ${sek(s.pcm.length, s.sampleRate)} s · ${a} Abschnitt(e)</span>
      <span class="railSpacer"></span>
      <button class="swStumm" data-id="${s.id}">${s.stumm ? "stumm" : "an"}</button>
      <button class="swSolo" data-id="${s.id}">${s.solo ? "SOLO" : "solo"}</button>
      <label class="sub">Pegel <input class="swGain" data-id="${s.id}" type="range" min="0" max="150" value="${Math.round(s.gain * 100)}" style="width:80px;vertical-align:middle" /></label>
      <button class="swVorschlag" data-id="${s.id}" title="Marken dorthin legen, wo sich der Klang ändert">Marken vorschlagen</button>
      <button class="swSchneiden" data-id="${s.id}">Abschnitte in den Pool</button>
      <button class="swWeg" data-id="${s.id}">Spur entfernen</button>
    </div>
    <div class="sub" style="margin-top:4px">${escapeHtml(profilZeile(s))}</div>
    <canvas id="sw-${s.id}" width="${BREITE}" height="${HOEHE}" style="width:100%;height:${HOEHE}px;display:block;margin-top:6px;cursor:crosshair"></canvas>
  </div>`;
}

function render(): void {
  const host = document.getElementById("viewStems");
  if (!host) return;
  const achse = zeitachse(z.spuren);
  const sr = z.spuren[0]?.sampleRate ?? 44100;
  const auswahlText =
    z.auswahl.bis > z.auswahl.von
      ? `${sek(z.auswahl.von, sr)} s – ${sek(z.auswahl.bis, sr)} s (${sek(z.auswahl.bis - z.auswahl.von, sr)} s)`
      : "keine";

  host.innerHTML = `
    <h2>Stem-Werkbank</h2>
    <p class="sub">
      Die Spuren eines Lieds untereinander auf einer Zeitachse: anhören, Marken
      setzen, schneiden — von Hand, nicht nur automatisch.
      <b>Klick</b> setzt eine Marke, <b>Umschalt+Klick</b> nimmt sie weg,
      <b>Ziehen</b> wählt einen Bereich, <b>Doppelklick</b> spielt ab dort.
    </p>

    <div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button id="swDatei">Audiodateien als Spuren laden</button>
        <input id="swDateiIn" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" multiple class="hidden" />
        <button id="swTrennen" ${z.spuren.length ? "" : "disabled"}>Aktive Spur trennen (Demucs)</button>
        <span class="sub">Trennt das ganze Lied in Melodie, Vocals, Drums und Bass — gemessen rund 14 s für zwei Minuten auf der Grafikkarte.</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <button id="swSpielen" ${z.spuren.length ? "" : "disabled"}>${z.spielt ? "■ Stopp" : "▶ Abspielen"}</button>
        <label class="sub">Tempo <input id="swBpm" type="number" min="20" max="300" step="0.1" value="${z.bpm}" style="width:74px" /></label>
        <label class="sub">alle <input id="swTakte" type="number" min="1" max="64" value="${z.takte}" style="width:56px" /> Takte</label>
        <button id="swRasterAlle" ${z.spuren.length ? "" : "disabled"}>Raster auf alle Spuren</button>
        <button id="swRasterEine" ${z.aktiv ? "" : "disabled"}>Raster nur auf die aktive</button>
        <button id="swVorschlagAlle" ${z.spuren.length ? "" : "disabled"} title="Jede Spur nach ihrer Rolle: Vocals an den Pausen, Melodien am Klangwechsel, Drums am Anschlag">Marken vorschlagen</button>
        <button id="swMarkenWeg" ${z.spuren.length ? "" : "disabled"}>Marken löschen</button>
      </div>
      <p class="sub" style="margin:6px 0 0">
        <b>Raster</b> legt Marken auf die Taktgrenzen — vorhersagbar, egal was dort klingt.
        <b>Vorschlagen</b> liest die Spur: Vocals werden an ihren Pausen getrennt, Melodien
        nur beim Klangwechsel, Drums auf dem gespielten Anschlag statt auf dem Rechenwert.
      </p>
    </div>

    <div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b>Auswahl:</b> <span class="sub">${escapeHtml(auswahlText)}</span>
        <span class="railSpacer"></span>
        <button class="swWerk" data-was="behalten" ${z.aktiv ? "" : "disabled"}>Auf Auswahl kürzen</button>
        <button class="swWerk" data-was="stille" ${z.aktiv ? "" : "disabled"}>Stille Ränder weg</button>
        <button class="swWerk" data-was="blenden" ${z.aktiv ? "" : "disabled"}>Ein-/Ausblenden 10 ms</button>
        <button class="swWerk" data-was="normal" ${z.aktiv ? "" : "disabled"}>Normalisieren</button>
        <button class="swWerk" data-was="umkehren" ${z.aktiv ? "" : "disabled"}>Umkehren</button>
        <button id="swZurueck" ${z.aktiv && (z.verlauf.get(z.aktiv)?.length ?? 0) ? "" : "disabled"}>Rückgängig</button>
      </div>
      <p class="sub" style="margin:6px 0 0">Die Werkzeuge wirken auf die <b>aktive</b> Spur (◆) — bei gesetzter Auswahl nur auf diesen Bereich.</p>
    </div>

    ${z.spuren.length ? z.spuren.map(spurZeile).join("") : `<p class="sub">Noch keine Spuren — oben eine Audiodatei laden, dann trennen.</p>`}

    <p class="sub">Zeitachse: ${sek(achse, sr)} s · ${z.spuren.length} Spur(en)</p>
    ${z.meldung ? `<p class="sub" id="swMeldung" style="white-space:pre-wrap">${escapeHtml(z.meldung)}</p>` : ""}
  `;
  verdrahten();
  zeichneAlle();
}

function melde(t: string): void {
  z.meldung = t;
  render();
}

function knopf(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

function spurVon(el: Element): Spur | undefined {
  return z.spuren.find((s) => s.id === (el as HTMLElement).dataset.id);
}

function verdrahten(): void {
  knopf("swDatei", () => document.getElementById("swDateiIn")?.click());
  document.getElementById("swDateiIn")?.addEventListener("change", (e) => {
    const inp = e.target as HTMLInputElement;
    const dateien = Array.from(inp.files ?? []);
    inp.value = "";
    void ladeAlsSpuren(dateien);
  });
  knopf("swTrennen", () => void trenne());
  knopf("swSpielen", () => {
    if (z.spielt) stoppe();
    else spieleAb(z.auswahl.bis > z.auswahl.von ? z.auswahl.von : 0);
    render();
  });
  knopf("swRasterAlle", () => raster(z.spuren));
  knopf("swRasterEine", () => raster(z.spuren.filter((s) => s.id === z.aktiv)));
  knopf("swVorschlagAlle", () => schlageVor(z.spuren));
  knopf("swMarkenWeg", () => {
    for (const s of z.spuren) s.marken = [];
    melde("Marken gelöscht.");
  });
  knopf("swZurueck", () => zurueck());

  const bpm = document.getElementById("swBpm") as HTMLInputElement | null;
  bpm?.addEventListener("change", () => {
    z.bpm = Math.min(300, Math.max(20, Number(bpm.value) || 180));
  });
  const takte = document.getElementById("swTakte") as HTMLInputElement | null;
  takte?.addEventListener("change", () => {
    z.takte = Math.min(64, Math.max(1, Math.round(Number(takte.value) || 8)));
  });

  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swWahl"))
    b.addEventListener("click", () => {
      z.aktiv = (b.dataset.id ?? null) as string | null;
      render();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swStumm"))
    b.addEventListener("click", () => {
      const s = spurVon(b);
      if (!s) return;
      s.stumm = !s.stumm;
      render();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swSolo"))
    b.addEventListener("click", () => {
      const s = spurVon(b);
      if (!s) return;
      s.solo = !s.solo;
      render();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swWeg"))
    b.addEventListener("click", () => {
      const s = spurVon(b);
      if (!s) return;
      stoppe();
      z.spuren = z.spuren.filter((x) => x.id !== s.id);
      if (z.aktiv === s.id) z.aktiv = z.spuren[0]?.id ?? null;
      render();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swVorschlag"))
    b.addEventListener("click", () => {
      const s = spurVon(b);
      if (s) schlageVor([s]);
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swSchneiden"))
    b.addEventListener("click", () => {
      const s = spurVon(b);
      if (s) inDenPool(s);
    });
  for (const r of document.querySelectorAll<HTMLInputElement>("#viewStems .swGain"))
    r.addEventListener("input", () => {
      const s = spurVon(r);
      if (s) s.gain = Number(r.value) / 100;
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewStems .swWerk"))
    b.addEventListener("click", () => werkzeug(b.dataset.was ?? ""));

  for (const s of z.spuren) {
    const c = document.getElementById(`sw-${s.id}`) as HTMLCanvasElement | null;
    if (c) maus(c, s);
  }
}

/** Frame unter dem Mauszeiger — die Anzeige ist skaliert, also umrechnen. */
function frameVon(c: HTMLCanvasElement, ev: MouseEvent): number {
  const r = c.getBoundingClientRect();
  return ((ev.clientX - r.left) / r.width) * zeitachse(z.spuren);
}

function maus(c: HTMLCanvasElement, s: Spur): void {
  let runter: { x: number; frame: number } | null = null;
  c.addEventListener("mousedown", (ev) => {
    z.aktiv = s.id;
    runter = { x: ev.clientX, frame: frameVon(c, ev) };
  });
  c.addEventListener("mousemove", (ev) => {
    if (!runter) return;
    if (Math.abs(ev.clientX - runter.x) < ZUG_SCHWELLE) return;
    const jetzt = frameVon(c, ev);
    z.auswahl = { von: Math.min(runter.frame, jetzt), bis: Math.max(runter.frame, jetzt) };
    zeichneAlle();
  });
  c.addEventListener("mouseup", (ev) => {
    if (!runter) return;
    const gezogen = Math.abs(ev.clientX - runter.x) >= ZUG_SCHWELLE;
    const frame = frameVon(c, ev);
    runter = null;
    if (gezogen) {
      render();
      return;
    }
    if (ev.shiftKey) {
      if (!entferneMarke(s, frame)) return;
    } else {
      // Ein Klick ohne Zug hebt eine bestehende Auswahl auf — sonst wirken die
      // Werkzeuge auf einen Bereich, den man laengst vergessen hat.
      z.auswahl = { von: 0, bis: 0 };
      setzeMarke(s, frame);
    }
    render();
  });
  c.addEventListener("dblclick", (ev) => {
    spieleAb(frameVon(c, ev));
    render();
  });
}

/**
 * Marken vorschlagen lassen — je Spur nach ihrer Rolle.
 *
 * Die alten Marken bleiben stehen. Wer neu anfangen will, loescht vorher;
 * ungefragt wegzuwerfen, was jemand von Hand gesetzt hat, waere die
 * unangenehmere Ueberraschung.
 */
function schlageVor(spuren: readonly Spur[]): void {
  if (!spuren.length) return;
  const zeilen: string[] = [];
  let n = 0;
  for (const s of spuren) {
    const v = vorschlagMarken(s, { bpm: z.bpm });
    setzeMarken(s, v.frames);
    n += v.frames.length;
    zeilen.push(`„${s.name}" (${s.rolle}): ${v.hinweise.join(" ")}`);
  }
  melde(`${n} Marke(n) vorgeschlagen.\n${zeilen.join("\n")}`);
}

function raster(spuren: readonly Spur[]): void {
  if (!spuren.length) return;
  let n = 0;
  for (const s of spuren) {
    const marken = rasterMarken(s.pcm.length, s.sampleRate, z.bpm, z.takte);
    for (const m of marken) setzeMarke(s, m);
    n += marken.length;
  }
  melde(`${n} Marke(n) im Raster von ${z.takte} Takt(en) bei ${z.bpm} BPM gesetzt.`);
}

// ── Werkzeuge ────────────────────────────────────────────────────────────────

function merke(s: Spur): void {
  const liste = z.verlauf.get(s.id) ?? [];
  liste.push(s.pcm);
  // Zehn Schritte reichen; mehr sind bei Minuten langen Spuren nur Speicher.
  if (liste.length > 10) liste.shift();
  z.verlauf.set(s.id, liste);
}

function zurueck(): void {
  const s = z.spuren.find((x) => x.id === z.aktiv);
  if (!s) return;
  const liste = z.verlauf.get(s.id);
  const alt = liste?.pop();
  if (!alt) return;
  stoppe();
  s.pcm = alt;
  s.marken = s.marken.filter((m) => m < s.pcm.length);
  melde(`„${s.name}" einen Schritt zurück.`);
}

function werkzeug(was: string): void {
  const s = z.spuren.find((x) => x.id === z.aktiv);
  if (!s) return;
  const hatAuswahl = z.auswahl.bis > z.auswahl.von;
  const von = hatAuswahl ? Math.max(0, Math.round(z.auswahl.von)) : 0;
  const bis = hatAuswahl ? Math.min(s.pcm.length, Math.round(z.auswahl.bis)) : s.pcm.length;
  if (was === "behalten" && !hatAuswahl) {
    melde("Zum Kürzen erst einen Bereich ziehen.");
    return;
  }
  stoppe();
  const teil = s.pcm.subarray(von, bis);
  let neu: Float32Array;
  let text: string;
  switch (was) {
    case "behalten":
      merke(s);
      neu = schneide(s.pcm, von, bis);
      s.pcm = neu;
      // Marken wandern mit; was ausserhalb lag, ist weg.
      s.marken = s.marken.filter((m) => m > von && m < bis).map((m) => m - von);
      z.auswahl = { von: 0, bis: 0 };
      melde(`„${s.name}" auf ${sek(neu.length, s.sampleRate)} s gekürzt.`);
      return;
    case "stille": {
      const g = stilleGrenzen(s.pcm, 45);
      if (g.bis <= g.von) {
        // Ohne Ruecksprung stuende jetzt ein Rueckgaengig-Schritt bereit, der
        // nichts rueckgaengig macht.
        melde("Da ist alles still — nichts zu kürzen.");
        return;
      }
      merke(s);
      s.pcm = schneide(s.pcm, g.von, g.bis);
      s.marken = s.marken.filter((m) => m > g.von && m < g.bis).map((m) => m - g.von);
      melde(`Stille Ränder weg: ${sek(s.pcm.length, s.sampleRate)} s übrig.`);
      return;
    }
    case "blenden":
      merke(s);
      neu = blenden(teil.slice(), 10, 10, s.sampleRate);
      text = "ein- und ausgeblendet";
      break;
    case "normal":
      merke(s);
      neu = normalisiere(teil.slice());
      text = "normalisiert";
      break;
    case "umkehren":
      merke(s);
      neu = umkehren(teil.slice());
      text = "umgekehrt";
      break;
    default:
      return;
  }
  const ganz = new Float32Array(s.pcm);
  ganz.set(neu, von);
  s.pcm = ganz;
  melde(`„${s.name}" ${text}${hatAuswahl ? " (nur die Auswahl)" : ""}.`);
}

// ── Spuren beschaffen ────────────────────────────────────────────────────────

/**
 * Audiodateien als Spuren aufnehmen. Wird auch vom Generator benutzt: „In die
 * Stem-Werkbank" reicht das gewaehlte Lied hierher weiter, statt es ein
 * zweites Mal auswaehlen zu lassen.
 */
export async function ladeAlsSpuren(dateien: File[]): Promise<void> {
  if (!dateien.length) return;
  z.laeuft = true;
  try {
    for (const d of dateien) {
      const e = await dekodiere(d);
      const s = neueSpur(d.name.replace(/\.[^.]+$/, ""), e.pcm, e.sampleRate, "mix");
      z.spuren.push(s);
      z.aktiv = z.aktiv ?? s.id;
    }
    melde(`${dateien.length} Spur(en) geladen.`);
  } catch (err) {
    melde(`Laden ging nicht: ${(err as Error).message}`);
  } finally {
    z.laeuft = false;
  }
}

const ROLLEN: [keyof StemAntwort, SpurRolle, string][] = [
  ["melo", "melo", "MELO"],
  ["vox", "vox", "VOX"],
  ["drums", "drums", "DRUMS"],
  ["bass", "bass", "BASS"],
];

interface StemAntwort {
  melo: Uint8Array | number[] | null;
  vox: Uint8Array | number[] | null;
  drums?: Uint8Array | number[] | null;
  bass?: Uint8Array | number[] | null;
}

/**
 * Die aktive Spur durch Demucs schicken — in EINEM Fenster ueber die ganze
 * Laenge. Gemessen (2026-08-27, Grafikkarte): zwei Minuten Lied in 13,8 s,
 * 31 MB zurueck. In 30-s-Stuecken war derselbe Stoff langsamer (15,0 s), also
 * gibt es hier keine Stueckelung.
 */
async function trenne(): Promise<void> {
  const s = z.spuren.find((x) => x.id === z.aktiv) ?? z.spuren[0];
  if (!s) return;
  const lied = tekkLied();
  if (!lied) {
    melde("Die Trennung braucht die Desktop-App mit Python und Demucs.");
    return;
  }
  if (z.laeuft) return;
  z.laeuft = true;
  stoppe();
  const abmelden = lied.onFortschritt((t) => {
    const el = document.getElementById("swMeldung");
    if (el) el.textContent = t;
    else z.meldung = t;
  });
  melde(`„${s.name}" wird getrennt — das dauert bei einem ganzen Lied etwa eine Viertelminute je zwei Minuten Musik …`);
  try {
    const antwort = await lied.stems({
      qualitaet: "genau",
      teile: ["melo", "vox", "drums", "bass"],
      fenster: [{ id: "GANZ", bytes: encodeWav16(s.pcm, s.sampleRate, 1) }],
    });
    const r = antwort.fenster[0] as StemAntwort | undefined;
    if (!r) throw new Error("keine Antwort von der Trennung");
    let n = 0;
    for (const [feld, rolle, kuerzel] of ROLLEN) {
      const bytes = r[feld];
      if (!bytes) continue;
      const wav = parseWav(Uint8Array.from(bytes as number[]));
      z.spuren.push(neueSpur(`${kuerzel} ${s.name}`.slice(0, 24), wav.pcm, wav.sampleRate, rolle));
      n++;
    }
    melde(n ? `${n} Spur(en) aus „${s.name}" getrennt.` : "Die Trennung hat nichts geliefert.");
  } catch (err) {
    melde(`Trennung fehlgeschlagen: ${(err as Error).message}`);
  } finally {
    abmelden();
    z.laeuft = false;
  }
}

// ── In den Pool ──────────────────────────────────────────────────────────────

/** Was der Pool schon belegt — dieselbe Rechnung wie im Sample-Manager. */
function poolBytes(samples: readonly PoolSample[]): number {
  let b = 0;
  for (const s of samples) b += ramBytesFuer(s);
  return b;
}

function inDenPool(s: Spur): void {
  const projekt = panelBridge.project;
  const r = schneideSpur(s, { basisNummer: nextFreeSampleNumber(projekt.samples) });
  if (!r.samples.length) {
    melde(`Nichts zu schneiden.\n${r.hinweise.join("\n")}`);
    return;
  }
  // Dieselbe Regel wie beim Bibliotheks-Export: was nicht ins Sample-RAM
  // passt, wird gar nicht erst angelegt — sonst faellt es erst am Geraet auf.
  const gesamt = poolBytes(projekt.samples) + r.bytes;
  if (gesamt > RAM_BUDGET_BYTES) {
    melde(
      `${r.samples.length} Abschnitt(e) wären ${(r.bytes / 1048576).toFixed(1)} MB — zusammen mit dem Pool ${(gesamt / 1048576).toFixed(1)} MB von ${(RAM_BUDGET_BYTES / 1048576).toFixed(0)} MB. Das lädt das Gerät nicht, also nichts übernommen.`,
    );
    return;
  }
  // Nummern erst hier endgültig vergeben: zwischen Schnitt und Übernahme kann
  // der Pool sich geändert haben (anderer Tab, Import).
  for (const neu of r.samples) {
    neu.number = nextFreeSampleNumber(projekt.samples);
    projekt.samples.push(neu);
  }
  panelBridge.markDirty();
  melde(
    `${r.samples.length} Abschnitt(e) als #${r.samples[0].number}–#${r.samples[r.samples.length - 1].number} im Pool (${(r.bytes / 1048576).toFixed(2)} MB).` +
      (r.hinweise.length ? `\n${r.hinweise.join("\n")}` : ""),
  );
}

// ── Einstieg ─────────────────────────────────────────────────────────────────

export function initStemWerkbank(): void {
  render();
}

export function stemWerkbankWirdSichtbar(): void {
  render();
}

/**
 * Tab verlassen: Ton aus.
 *
 * Sonst spielt die Werkbank weiter, waehrend man laengst woanders ist — und
 * der Zeichentakt malt Wellenformen in einen versteckten Abschnitt.
 */
export function stemWerkbankVerlassen(): void {
  stoppe();
}
