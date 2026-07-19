/**
 * wavCodec.ts — Minimaler, reiner WAV-Parser/-Encoder (isomorph, testbar).
 *
 * Parser: RIFF/WAVE-Chunk-Walk, unterstützt PCM 8/16/24/32-bit int,
 * 32/64-bit float, mono/stereo/n-Kanal (interleaved), inkl. WAVE_FORMAT_EXTENSIBLE.
 * Encoder: 16-bit PCM LE (für Projekt-Serialisierung + Sample-Export).
 *
 * Kein DOM, kein Node — Base64-Helper wählen zur Laufzeit Buffer bzw. atob/btoa.
 */

export interface DecodedWav {
  sampleRate: number;
  /** Anzahl Kanäle (interleaved im pcm-Array). */
  channels: number;
  /** Frames pro Kanal. */
  frames: number;
  /** Float32 [-1,+1], interleaved. */
  pcm: Float32Array;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourCC(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

/**
 * Parst eine WAV-Datei. Wirft `Error` mit deutscher Meldung bei ungültigem
 * Format; truncated data-Chunks werden defensiv auf die realen Bytes geclampt.
 */
export function parseWav(bytes: Uint8Array): DecodedWav {
  if (bytes.length < 44) throw new Error("WAV zu kurz (< 44 Bytes)");
  if (fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WAVE")
    throw new Error("Kein RIFF/WAVE-Header — ist das eine WAV-Datei?");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;

  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = fourCC(bytes, off);
    const size = view.getUint32(off + 4, true);
    const payload = off + 8;
    if (id === "fmt ") {
      if (payload + 16 > bytes.length) throw new Error("fmt-Chunk truncated");
      let format = view.getUint16(payload, true);
      const channels = view.getUint16(payload + 2, true);
      const sampleRate = view.getUint32(payload + 4, true);
      const bits = view.getUint16(payload + 14, true);
      if (format === WAVE_FORMAT_EXTENSIBLE && payload + 26 <= bytes.length) {
        // SubFormat-GUID: erste 2 Bytes = eigentliches Format
        format = view.getUint16(payload + 24, true);
      }
      fmt = { format, channels, sampleRate, bits };
    } else if (id === "data") {
      dataOff = payload;
      dataLen = Math.min(size, bytes.length - payload);
    }
    off = payload + size + (size & 1); // Chunks sind even-aligned
  }

  if (!fmt) throw new Error("Kein fmt-Chunk gefunden");
  if (dataOff < 0) throw new Error("Kein data-Chunk gefunden");
  if (fmt.channels < 1 || fmt.channels > 8)
    throw new Error(`Nicht unterstützte Kanalzahl: ${fmt.channels}`);
  if (!Number.isFinite(fmt.sampleRate) || fmt.sampleRate <= 0)
    throw new Error(`Ungültige Sample-Rate: ${fmt.sampleRate}`);

  const bytesPerSample = fmt.bits / 8;
  if (![1, 2, 3, 4, 8].includes(bytesPerSample))
    throw new Error(`Nicht unterstützte Bit-Tiefe: ${fmt.bits}`);
  const totalSamples = Math.floor(dataLen / bytesPerSample);
  const frames = Math.floor(totalSamples / fmt.channels);
  const count = frames * fmt.channels;
  const pcm = new Float32Array(count);

  const f = fmt.format;
  const b = fmt.bits;
  if (f === WAVE_FORMAT_PCM && b === 8) {
    for (let i = 0; i < count; i++) pcm[i] = (bytes[dataOff + i] - 128) / 128;
  } else if (f === WAVE_FORMAT_PCM && b === 16) {
    for (let i = 0; i < count; i++) pcm[i] = view.getInt16(dataOff + i * 2, true) / 32768;
  } else if (f === WAVE_FORMAT_PCM && b === 24) {
    for (let i = 0; i < count; i++) {
      const o = dataOff + i * 3;
      let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      if (v & 0x800000) v |= ~0xffffff; // sign-extend
      pcm[i] = v / 8388608;
    }
  } else if (f === WAVE_FORMAT_PCM && b === 32) {
    for (let i = 0; i < count; i++) pcm[i] = view.getInt32(dataOff + i * 4, true) / 2147483648;
  } else if (f === WAVE_FORMAT_IEEE_FLOAT && b === 32) {
    for (let i = 0; i < count; i++) pcm[i] = view.getFloat32(dataOff + i * 4, true);
  } else if (f === WAVE_FORMAT_IEEE_FLOAT && b === 64) {
    for (let i = 0; i < count; i++) pcm[i] = view.getFloat64(dataOff + i * 8, true);
  } else {
    throw new Error(`Nicht unterstütztes WAV-Format (format=${f}, ${b} bit)`);
  }

  return { sampleRate: fmt.sampleRate, channels: fmt.channels, frames, pcm };
}

/** Encodiert Float32-PCM (interleaved) als 16-bit-PCM-WAV. */
export function encodeWav16(pcm: Float32Array, sampleRate: number, channels: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i];
    if (!Number.isFinite(v)) v = 0;
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    view.setInt16(44 + i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
  }
  return out;
}

/** Isomorphes Base64-Encoding (Node-Buffer oder btoa in Chunks). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Isomorphes Base64-Decoding. */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
