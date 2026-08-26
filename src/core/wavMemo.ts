/**
 * wavMemo — merkt sich die WAV/Base64-Fassung von Klangdaten.
 *
 * `serializeProject` kodiert jedes Sample nach 16-Bit-WAV und dann nach Base64.
 * Bei vollem Pool sind das gut 30 MB Text — pro Aufruf. Fuer das Speichern von
 * Hand faellt das kaum auf, fuer die stille Notfall-Sicherung im Minutentakt
 * dagegen sehr: sie liefe im Vordergrund und wuerde das Setzen von Steps
 * spuerbar haken lassen.
 *
 * Die Klangdaten eines Samples aendern sich beim Pattern-Bearbeiten nicht, und
 * der Sample-Editor gibt grundsaetzlich NEUE Float32Arrays zurueck statt die
 * alten zu ueberschreiben. Darum ist die Array-Referenz ein gueltiger
 * Schluessel: gleiche Referenz -> gleicher Inhalt. Die WeakMap gibt den Eintrag
 * automatisch frei, sobald das Sample aus dem Projekt verschwindet.
 */

import { bytesToBase64, encodeWav16 } from "./wavCodec";

interface Eintrag {
  sampleRate: number;
  b64: string;
}

const gemerkt = new WeakMap<Float32Array, Eintrag>();

function standardKodierer(pcm: Float32Array, sampleRate: number): string {
  return bytesToBase64(encodeWav16(pcm, sampleRate, 1));
}

/**
 * Base64 der Mono-WAV-Fassung. Der Kodierer ist nur fuer Tests austauschbar.
 */
export function wavBase64(
  pcm: Float32Array,
  sampleRate: number,
  kodiere: (pcm: Float32Array, sampleRate: number) => string = standardKodierer,
): string {
  const alt = gemerkt.get(pcm);
  if (alt && alt.sampleRate === sampleRate) return alt.b64;
  const b64 = kodiere(pcm, sampleRate);
  gemerkt.set(pcm, { sampleRate, b64 });
  return b64;
}
