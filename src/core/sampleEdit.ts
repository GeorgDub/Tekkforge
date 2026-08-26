/**
 * sampleEdit — Samples von Hand nachbearbeiten: schneiden, ein- und
 * ausblenden, normalisieren, umkehren, Loop-Punkte setzen.
 *
 * Der Generator macht das beim Bankbau automatisch. Wenn ein Schnitt daneben
 * geht — ein Vocal zu frueh abgeschnitten, ein Loop mit Knacksen —, fehlte
 * bisher jede Moeglichkeit, das im Werkzeug zu korrigieren. Genau dafuer sind
 * diese Funktionen: reine Rechnungen auf Mono-PCM, ohne Oberflaeche und ohne
 * Geraetebezug, damit sie einzeln pruefbar bleiben.
 */

/** Loop-Modus wie im Bank-Format (`e2sBankBuilder`): 1 = One-Shot, 0 = Schleife. */
export const LOOP_AUS = 1;
export const LOOP_VORWAERTS = 0;

const klemme = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Ausschnitt `[von, bis)` in Frames. Grenzen werden geklemmt, nie geworfen. */
export function schneide(pcm: Float32Array, von: number, bis: number): Float32Array {
  const a = klemme(Math.round(von), 0, Math.max(0, pcm.length - 1));
  const b = klemme(Math.round(bis), a + 1, pcm.length);
  return pcm.slice(a, b);
}

/**
 * Ein- und Ausblende in Millisekunden. Zusammen laenger als das Sample? Dann
 * bekommt jede Seite die Haelfte — sonst wuerden sich die Rampen ueberlagern
 * und in der Mitte ein Loch hinterlassen.
 */
export function blenden(pcm: Float32Array, einMs: number, ausMs: number, sr: number): Float32Array {
  const out = pcm.slice();
  let ein = Math.max(0, Math.round((einMs / 1000) * sr));
  let aus = Math.max(0, Math.round((ausMs / 1000) * sr));
  if (ein + aus > out.length) {
    const anteil = out.length / (ein + aus);
    ein = Math.floor(ein * anteil);
    aus = Math.floor(aus * anteil);
  }
  for (let i = 0; i < ein; i++) out[i] *= i / ein;
  for (let i = 0; i < aus; i++) out[out.length - 1 - i] *= i / aus;
  return out;
}

/** Lautesten Punkt auf `ziel` heben. Stille bleibt Stille. */
export function normalisiere(pcm: Float32Array, ziel = 0.95): Float32Array {
  let spitze = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > spitze) spitze = a;
  }
  if (spitze <= 0) return pcm.slice();
  const f = ziel / spitze;
  return pcm.map((v) => v * f);
}

export function umkehren(pcm: Float32Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[pcm.length - 1 - i];
  return out;
}

/**
 * Huellkurve zum Zeichnen: je Bildspalte der tiefste und hoechste Wert.
 * Nicht jeder n-te Wert — sonst verschwinden kurze Spitzen zwischen den
 * Stuetzstellen, und die Wellenform sieht harmloser aus, als sie ist.
 */
export function wellenform(pcm: Float32Array, spalten: number): { min: Float32Array; max: Float32Array } {
  const n = Math.max(1, Math.round(spalten));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  if (!pcm.length) return { min, max };
  for (let s = 0; s < n; s++) {
    const von = Math.floor((s * pcm.length) / n);
    const bis = Math.max(von + 1, Math.floor(((s + 1) * pcm.length) / n));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = von; i < bis && i < pcm.length; i++) {
      if (pcm[i] < lo) lo = pcm[i];
      if (pcm[i] > hi) hi = pcm[i];
    }
    min[s] = Number.isFinite(lo) ? lo : 0;
    max[s] = Number.isFinite(hi) ? hi : 0;
  }
  return { min, max };
}

/**
 * Erster und letzter hoerbare Frame, `db` unter der Spitze. Ist alles still,
 * kommt der ganze Bereich zurueck — ein leerer Schnitt waere schlimmer als
 * ein zu grosser.
 */
export function stilleGrenzen(pcm: Float32Array, db = 45): { von: number; bis: number } {
  let spitze = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > spitze) spitze = a;
  }
  if (spitze <= 0) return { von: 0, bis: pcm.length };
  const schwelle = spitze * Math.pow(10, -Math.abs(db) / 20);
  let von = 0;
  let bis = pcm.length;
  while (von < bis && Math.abs(pcm[von]) < schwelle) von++;
  while (bis > von && Math.abs(pcm[bis - 1]) < schwelle) bis--;
  return { von, bis };
}

export type LoopPruefung = { ok: true } | { ok: false; grund: string };

/** Loop-Punkte in Frames pruefen. */
export function pruefeLoop(start: number, ende: number, laenge: number): LoopPruefung {
  if (!Number.isInteger(start) || !Number.isInteger(ende)) return { ok: false, grund: "Loop-Punkte müssen ganze Frames sein" };
  if (start < 0 || ende > laenge) return { ok: false, grund: `Loop liegt außerhalb des Samples (0–${laenge})` };
  if (start >= ende) return { ok: false, grund: "Der Loop-Start muss vor dem Ende liegen" };
  return { ok: true };
}
