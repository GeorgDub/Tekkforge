/**
 * dsp — kleine Signalbausteine ohne Abhaengigkeiten: radix-2-FFT (in place)
 * und Bandenergien (log-Baender 60 Hz–10 kHz) als Klangfarben-Vektor.
 */

/** In-place-FFT, Laenge muss eine Zweierpotenz sein. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error("fft: Laenge muss eine Zweierpotenz sein");
  // Bit-Umkehr
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Bandgrenzen logarithmisch zwischen fMin und fMax (baender+1 Werte). */
function bandGrenzen(baender: number, fMin: number, fMax: number): number[] {
  const out: number[] = [];
  for (let b = 0; b <= baender; b++) out.push(fMin * Math.pow(fMax / fMin, b / baender));
  return out;
}

/**
 * Mittlere Energie je log-Band (60 Hz–10 kHz) ueber Frames von 2048 Samples,
 * normiert auf Summe 1 — Klangfarben-Vektor fuer Abstandsvergleiche.
 */
export function bandEnergien(pcm: Float32Array, sr: number, baender = 24): Float32Array {
  const N = 2048;
  const grenzen = bandGrenzen(baender, 60, Math.min(10000, sr / 2 - 1));
  const summe = new Float64Array(baender);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const hop = N; // keine Ueberlappung — reicht fuer Mittelwerte
  let frames = 0;
  for (let start = 0; start + N <= pcm.length; start += hop) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); // Hann
      re[i] = pcm[start + i] * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      if (f < grenzen[0] || f >= grenzen[baender]) continue;
      let b = 0;
      while (b < baender - 1 && f >= grenzen[b + 1]) b++;
      summe[b] += re[k] * re[k] + im[k] * im[k];
    }
    frames++;
  }
  const out = new Float32Array(baender);
  let total = 0;
  for (let b = 0; b < baender; b++) total += summe[b];
  if (!frames || total <= 0) return out;
  for (let b = 0; b < baender; b++) out[b] = summe[b] / total;
  return out;
}

/** Anteil der Energie unterhalb `fGrenze` (Bassanteil) eines Ausschnitts. */
export function bassAnteil(pcm: Float32Array, sr: number, fGrenze = 150): number {
  const N = 2048;
  if (pcm.length < N) return 0;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    re[i] = pcm[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  fft(re, im);
  let tief = 0;
  let alles = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k] * re[k] + im[k] * im[k];
    alles += e;
    if ((k * sr) / N < fGrenze) tief += e;
  }
  return alles > 0 ? tief / alles : 0;
}
