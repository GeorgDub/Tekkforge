/**
 * audioDecode — Datei → PCM. Drei Wege, in dieser Reihenfolge:
 *
 *   1. WAV ueber parseWav (schnell, kein Web Audio).
 *   2. Alles, was Chromium kennt, ueber OfflineAudioContext.decodeAudioData
 *      (mp3/m4a/aac/ogg/opus/flac/webm …).
 *   3. Der Rest — und alles, woran Chromium scheitert — ueber die
 *      ffmpeg-Bruecke (tekkAudio, nur unter Electron): WMA, APE, WavPack,
 *      AC3, DTS, AMR, CAF, AIFF-Sonderfaelle, Video-Container.
 *
 * `dekodiere` liefert mono 44,1 k fuer Scan und Transkription; `dekodiereWav`
 * liefert 16-Bit-WAV-Bytes mit Originalkanaelen und -rate fuer den Sample-Pool,
 * der daraus wie bisher sein Mono-Sample macht.
 */
import { parseWav, encodeWav16 } from "../core/wavCodec";
import { downmixToMono, polyPhaseResample } from "../core/audioProcessor";
import { dateiArt } from "../core/generatorSession";
import type { ScanEingabe } from "../core/sampleScan";
import { tekkAudio } from "./tekkAudio";

const SR = 44100;

interface Dekodiert {
  sampleRate: number;
  channels: number;
  /** je Kanal ein Float32Array */
  kanaele: Float32Array[];
}

async function ueberChromium(bytes: ArrayBuffer): Promise<Dekodiert> {
  // Ein 1-Frame-Kontext reicht: decodeAudioData liefert den ganzen Puffer in Kontext-Rate.
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const kanaele: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) kanaele.push(buf.getChannelData(c).slice());
  return { sampleRate: buf.sampleRate, channels: buf.numberOfChannels, kanaele };
}

function ausWav(bytes: Uint8Array): Dekodiert {
  const w = parseWav(bytes);
  if (w.channels === 2) {
    const l = new Float32Array(w.pcm.length / 2);
    const r = new Float32Array(w.pcm.length / 2);
    for (let i = 0; i < l.length; i++) {
      l[i] = w.pcm[2 * i];
      r[i] = w.pcm[2 * i + 1];
    }
    return { sampleRate: w.sampleRate, channels: 2, kanaele: [l, r] };
  }
  return { sampleRate: w.sampleRate, channels: 1, kanaele: [w.pcm] };
}

async function ueberFfmpeg(name: string, bytes: ArrayBuffer): Promise<Dekodiert> {
  const b = tekkAudio();
  if (!b) throw new Error(`„${name}“: dieses Format dekodiert der Browser nicht — unter Electron springt ffmpeg ein`);
  const r = await b.dekodieren(name, new Uint8Array(bytes));
  return ausWav(r.bytes);
}

/** Datei → Kanaele in Originalrate. Wirft „kein Audio“ fuer Unbekanntes. */
export async function dekodiereRoh(file: File): Promise<Dekodiert> {
  const art = dateiArt(file.name);
  if (art === "skip") throw new Error("kein Audio");
  const bytes = await file.arrayBuffer();
  if (art === "wav") return ausWav(new Uint8Array(bytes));
  if (art === "audio") {
    try {
      return await ueberChromium(bytes);
    } catch (e) {
      // Chromium kennt das Format auf dem Papier, scheitert aber (Codec-Variante, kaputter Kopf) — ffmpeg versucht es.
      if (!tekkAudio()) throw e;
      return ueberFfmpeg(file.name, bytes);
    }
  }
  return ueberFfmpeg(file.name, bytes);
}

/** Datei → mono 44,1 k (Scan, Transkription, Lied). */
export async function dekodiere(file: File): Promise<ScanEingabe> {
  const d = await dekodiereRoh(file);
  let pcm: Float32Array;
  if (d.channels === 1) pcm = d.kanaele[0];
  else if (d.channels === 2) {
    const inter = new Float32Array(d.kanaele[0].length * 2);
    for (let i = 0; i < d.kanaele[0].length; i++) {
      inter[2 * i] = d.kanaele[0][i];
      inter[2 * i + 1] = d.kanaele[1][i];
    }
    pcm = downmixToMono(inter).pcm;
  } else {
    pcm = new Float32Array(d.kanaele[0].length);
    for (const k of d.kanaele) for (let i = 0; i < pcm.length; i++) pcm[i] += k[i] / d.channels;
  }
  if (d.sampleRate !== SR) pcm = polyPhaseResample(pcm, d.sampleRate, SR, 1);
  return { name: file.name, pcm, sampleRate: SR };
}

/**
 * Datei → 16-Bit-WAV-Bytes (Originalrate, mono oder stereo) — fuer alles, was
 * bisher nur WAV nahm (Sample-Pool, Ersetzen). Eine WAV-Datei geht unveraendert
 * durch; mehr als zwei Kanaele werden auf stereo gefaltet.
 */
export async function dekodiereWav(file: File): Promise<Uint8Array> {
  if (dateiArt(file.name) === "wav") return new Uint8Array(await file.arrayBuffer());
  const d = await dekodiereRoh(file);
  if (d.channels === 1) return encodeWav16(d.kanaele[0], d.sampleRate, 1);
  const n = d.kanaele[0].length;
  const inter = new Float32Array(n * 2);
  const links = d.kanaele.filter((_, i) => i % 2 === 0);
  const rechts = d.kanaele.filter((_, i) => i % 2 === 1);
  for (let i = 0; i < n; i++) {
    let l = 0;
    let r = 0;
    for (const k of links) l += k[i] / links.length;
    for (const k of rechts) r += k[i] / rechts.length;
    inter[2 * i] = l;
    inter[2 * i + 1] = r;
  }
  return encodeWav16(inter, d.sampleRate, 2);
}
