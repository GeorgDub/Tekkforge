/**
 * sampleScan — Rollen (kick/snare/clap/hat/perc/ton/bass/fx/vox/melo/track),
 * Familien (Namensstamm ohne Nummern), saubere 16-Zeichen-Namen und
 * Dubletten-Erkennung auf bereits dekodierten Mono-Puffern.
 * Port der Heuristik aus scripts/prep-folder.py (Stand 2026-08-22).
 */

export type Rolle = "kick" | "snare" | "clap" | "hat" | "perc" | "ton" | "bass" | "fx" | "vox" | "melo" | "track";

export interface ScanEingabe {
  name: string;
  /** mono, [-1, 1] */
  pcm: Float32Array;
  sampleRate: number;
}

export interface ScanEintrag {
  datei: string;
  stem: string;
  rolle: Rolle;
  familie: string;
  sekunden: number;
  rmsDb: number;
  peak: number;
  pcm: Float32Array;
  sampleRate: number;
  hinweis?: string;
  /** Lied-Kuerzel, wenn der Eintrag aus einer Lied-Analyse stammt */
  lied?: string;
}

export const LANG_AB = 2.5;
export const TRACK_AB = 60;
const STILL_PEAK = 0.05;

const UML: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
const umlaute = (s: string) => s.replace(/[äöüÄÖÜß]/g, (c) => UML[c]);

const RE = {
  vox: /vocal|vokal|vox\b|audio|whatsapp|stimme|voice|communic|prophet|gzuz|abriss|gefuehl|nase|seen me|gibs tekk|katze/,
  fx: /\bfx\b|effekt|effect|sweep|alarm|riser|noise|quietsch|schall|aufgeschlizt|impact|crash|scratch/,
  melo: /melo|mello|synth|syme|pad\b|\d+(me|sp)\w*heiko|liebestrank|krossi|lackleder|mega ton|metropole|\bbgg\b|biese|hawk|bush|devillache|hyper|barett|hibliebe|honig|hpbe|intro|default|dhrc|sound|ancer|lead|chord|string|piano|arp/,
  kick: /kick|kicker|kiuck|\bbd\b|bassdrum|bumbug|\bki\d|tetoki|vink\d|bilanz|kank|tropf|turbo|toumoux|hard french|taeter drum|bern drum|hardki|emmaki|luzz\d? 16|druff|hub kick|homm|\bexo|dudibrumm|geil\b|boooffl|futeloser|baus\d|\bbreak\b|piup|aniki/,
  bass: /bass|bas\b|\bsub\b|808 bass/,
  snare: /snar|snair|snarre|snaare|\bsn\d|\bsd\b|rim/,
  clap: /clap|klatsch|handclap/,
  hat: /\bhat|hihat|hi-hat|\bhh\b|eatclose|eatopen|zlzzer|cymbal|ride|crash/,
  ton: /\bton\b|\bto\[n\]|ton[-_ ]?\d|_ton|teeton|tee ton|techno ton|tekke ton|tontekk|\bfuer\b|\btab\b|\bdn\b|foterlo|bussmj|moral|rtw|\bfote/,
  perc: /perc|shaker|tom\b|conga|bongo|tab\b|wood|click/,
};

export function rolleFuer(stem: string, sekunden: number, rmsDb: number): Rolle {
  const s = umlaute(stem).toLowerCase().replace(/_+/g, " ");
  if (sekunden >= TRACK_AB) return "track";
  if (/\d+\s*bpm/.test(s) && sekunden >= 12) return "track";
  if (RE.vox.test(s)) return "vox";
  if (RE.fx.test(s) && !RE.hat.test(s)) return "fx";
  if (RE.kick.test(s)) return "kick";
  if (RE.bass.test(s)) return "bass";
  if (RE.clap.test(s)) return "clap";
  if (RE.snare.test(s)) return "snare";
  if (RE.hat.test(s)) return "hat";
  if (RE.melo.test(s) && sekunden >= 1) return "melo";
  if (RE.ton.test(s)) return sekunden < LANG_AB ? "ton" : "melo";
  if (RE.perc.test(s)) return "perc";
  if (sekunden >= LANG_AB) return "melo";
  if (sekunden < 0.9 && rmsDb > -8.5) return "kick";
  if (sekunden < 0.6) return "perc";
  return "ton";
}

export function familie(stem: string): string {
  let s = umlaute(stem).toLowerCase();
  s = s.replace(/\(.*?\)/g, "");
  s = s.replace(/^\d+\s*/, "");
  s = s.replace(/[\s_\-!#.]*\d+[\s_\-!#.\d]*$/, "");
  s = s.replace(/[\s_\-!#.]+/g, " ").trim();
  return s || stem.toLowerCase();
}

export function sauberName(s: string, maxLen = 16): string {
  const t = umlaute(s).replace(/[^\x20-\x7e]/g, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, maxLen).trim();
}

export function rmsDb(pcm: Float32Array): number {
  if (!pcm.length) return -120;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return 20 * Math.log10(Math.sqrt(s / pcm.length) + 1e-9);
}

export function peakVon(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Korrelation der ersten 0,2 s (One-Shots) bzw. des ganzen Puffers (Loops) — Fast-Dubletten. */
function korrelation(a: Float32Array, b: Float32Array, kurz: boolean, sr: number): number {
  const n = Math.min(a.length, b.length, kurz ? Math.round(0.2 * sr) : Infinity);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += a[i] * b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
  }
  return sab / (Math.sqrt(saa * sbb) + 1e-9);
}

export function scanne(
  eingaben: ScanEingabe[],
  overrides: Record<string, Rolle | "skip"> = {},
): { eintraege: ScanEintrag[]; uebersprungen: { datei: string; grund: string }[] } {
  const eintraege: ScanEintrag[] = [];
  const uebersprungen: { datei: string; grund: string }[] = [];
  for (const e of eingaben) {
    const stem = e.name.replace(/\.[^.]+$/, "");
    const ov = overrides[e.name] ?? overrides[stem];
    if (ov === "skip") {
      uebersprungen.push({ datei: e.name, grund: "overrides: skip" });
      continue;
    }
    const peak = peakVon(e.pcm);
    if (peak < STILL_PEAK || e.pcm.length < 64) {
      uebersprungen.push({ datei: e.name, grund: `still (Peak ${peak.toFixed(3)})` });
      continue;
    }
    const sekunden = e.pcm.length / e.sampleRate;
    const db = rmsDb(e.pcm);
    const dup = eintraege.find(
      (b) =>
        Math.abs(b.sekunden - sekunden) <= 0.05 &&
        sekunden <= 30 &&
        b.sampleRate === e.sampleRate &&
        korrelation(b.pcm, e.pcm, sekunden < LANG_AB, e.sampleRate) > 0.98,
    );
    if (dup) {
      uebersprungen.push({ datei: e.name, grund: `Dublette von ${dup.datei}` });
      continue;
    }
    eintraege.push({
      datei: e.name,
      stem,
      rolle: ov ?? rolleFuer(stem, sekunden, db),
      familie: familie(stem),
      sekunden,
      rmsDb: db,
      peak,
      pcm: e.pcm,
      sampleRate: e.sampleRate,
    });
  }
  return { eintraege, uebersprungen };
}
