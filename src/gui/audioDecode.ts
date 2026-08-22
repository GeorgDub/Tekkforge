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
