/**
 * bspatch — einen BSDIFF40-Patch anwenden, wie ihn `bsdiff` (Colin Percival)
 * schreibt. Damit entsteht die Hacktribe-Firmware IN der App aus der
 * offiziellen Sampler-Firmware und `hacktribe-2.patch` — niemand muss mehr
 * ein Python-Skript anwerfen, und es liegt keine Korg-Firmware in TekkForge.
 *
 * Format (bsdiff 4.x):
 *     0x00  "BSDIFF40"
 *     0x08  Laenge des bzip2-komprimierten Steuerblocks     (offtin, 8 Byte)
 *     0x10  Laenge des bzip2-komprimierten Diff-Blocks       (offtin)
 *     0x18  Groesse der neuen Datei                          (offtin)
 *     0x20  ctrl (bzip2) | diff (bzip2) | extra (bzip2, Rest)
 * `offtin`: 8 Byte little-endian Betrag, hoechstes Bit von Byte 7 = Vorzeichen.
 * Steuerblock: Tripel (x, y, z) — x Diff-Bytes (neu = diff + alt), y Extra-
 * Bytes (neu = extra), dann alt-Zeiger um z verschieben.
 *
 * Belegt am 2026-09-07: Stock-Sampler v2.02 (1d0f0689…) + hacktribe-2.patch
 * (e70406ec…) ergibt byte-genau die Hacktribe-Firmware 7cb4825c… aus
 * `hacktribe/hash/hacked-SYSTEM.VSB.sha`. `hacktribeAusStock` prueft alle
 * drei Hashes und liefert sonst einen Grund statt einer Datei.
 */
import { bunzip2 } from "./bunzip2";

export const BSDIFF_MAGIC = "BSDIFF40";

/** SHA-256 von `hacktribe-2.patch` (bangcorrupt/hacktribe, Release 2.x). */
export const HACKTRIBE_PATCH_SHA256 = "e70406ec6e2ff295460d387ac55712c0113a8a3b5b01c705c56e49f0f182bcd8";

function offtin(b: Uint8Array, o: number): number {
  let y = b[o + 7] & 0x7f;
  for (let i = 6; i >= 0; i--) y = y * 256 + b[o + i];
  return b[o + 7] & 0x80 ? -y : y;
}

export interface BsdiffKopf {
  ctrlLaenge: number;
  diffLaenge: number;
  neueGroesse: number;
}

/** Nur den Kopf lesen — zur Anzeige und Vorpruefung. Wirft bei falschem Magic. */
export function liesBsdiffKopf(patch: Uint8Array): BsdiffKopf {
  if (patch.length < 32) throw new Error(`Patch hat nur ${patch.length} Bytes — ein BSDIFF40-Kopf hat 32`);
  let magic = "";
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(patch[i]);
  if (magic !== BSDIFF_MAGIC) throw new Error(`Kein bsdiff-Patch (Magic „${magic.replace(/[^\x20-\x7e]/g, "?")}“ statt „${BSDIFF_MAGIC}“)`);
  const ctrlLaenge = offtin(patch, 8);
  const diffLaenge = offtin(patch, 16);
  const neueGroesse = offtin(patch, 24);
  if (ctrlLaenge < 0 || diffLaenge < 0 || neueGroesse < 0) throw new Error("bsdiff-Kopf mit negativer Länge");
  if (32 + ctrlLaenge + diffLaenge > patch.length) throw new Error("bsdiff-Kopf nennt mehr Bytes, als der Patch hat");
  return { ctrlLaenge, diffLaenge, neueGroesse };
}

/**
 * Patch anwenden. Reine Byte-Operation nach der Referenz `bspatch.c`;
 * die Eingaben bleiben unangetastet. Wirft bei jedem Formatfehler.
 */
export function bspatch(alt: Uint8Array, patch: Uint8Array): Uint8Array {
  const kopf = liesBsdiffKopf(patch);
  const ctrl = bunzip2(patch.subarray(32, 32 + kopf.ctrlLaenge));
  const diff = bunzip2(patch.subarray(32 + kopf.ctrlLaenge, 32 + kopf.ctrlLaenge + kopf.diffLaenge), kopf.neueGroesse);
  const extra = bunzip2(patch.subarray(32 + kopf.ctrlLaenge + kopf.diffLaenge));
  const neu = new Uint8Array(kopf.neueGroesse);
  let oldpos = 0;
  let newpos = 0;
  let cp = 0;
  let dp = 0;
  let ep = 0;
  while (newpos < kopf.neueGroesse) {
    if (cp + 24 > ctrl.length) throw new Error("bsdiff-Steuerblock endet vor der neuen Datei");
    const x = offtin(ctrl, cp);
    const y = offtin(ctrl, cp + 8);
    const z = offtin(ctrl, cp + 16);
    cp += 24;
    if (x < 0 || y < 0 || newpos + x > kopf.neueGroesse) throw new Error("bsdiff-Steuerblock läuft über die neue Datei hinaus");
    if (dp + x > diff.length) throw new Error("bsdiff-Diff-Block zu kurz");
    for (let i = 0; i < x; i++) {
      const o = oldpos + i;
      neu[newpos + i] = (diff[dp + i] + (o >= 0 && o < alt.length ? alt[o] : 0)) & 0xff;
    }
    newpos += x;
    oldpos += x;
    dp += x;
    if (newpos + y > kopf.neueGroesse) throw new Error("bsdiff-Extra-Block läuft über die neue Datei hinaus");
    if (ep + y > extra.length) throw new Error("bsdiff-Extra-Block zu kurz");
    neu.set(extra.subarray(ep, ep + y), newpos);
    newpos += y;
    ep += y;
    oldpos += z;
  }
  return neu;
}

export type HacktribeErgebnis = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/**
 * Die Hacktribe-Firmware aus Stock + Patch — nur mit geprueften Hashes.
 * `hashVon` liefert SHA-256 als Hex (WebCrypto oder Node), damit dieses
 * Modul selbst keine Plattform kennt. Stock-Hash und Patch-Hash muessen
 * stimmen, das Ergebnis muss `zielHash` sein — sonst gibt es nur den Grund.
 */
export async function hacktribeAusStock(
  stock: Uint8Array,
  patch: Uint8Array,
  hashVon: (b: Uint8Array) => Promise<string | null>,
  erwartet: { stock: string; patch: string; ziel: string },
): Promise<HacktribeErgebnis> {
  const hs = await hashVon(stock);
  if (hs && hs !== erwartet.stock) return { ok: false, reason: `Die Sampler-Firmware ist nicht die unveränderte v2.02 (SHA-256 ${hs.slice(0, 12)}… statt ${erwartet.stock.slice(0, 12)}…)` };
  const hp = await hashVon(patch);
  if (hp && hp !== erwartet.patch) return { ok: false, reason: `hacktribe-2.patch ist nicht der bekannte Patch (SHA-256 ${hp.slice(0, 12)}… statt ${erwartet.patch.slice(0, 12)}…)` };
  let bytes: Uint8Array;
  try {
    bytes = bspatch(stock, patch);
  } catch (e) {
    return { ok: false, reason: `Patch nicht anwendbar: ${e instanceof Error ? e.message : String(e)}` };
  }
  const hz = await hashVon(bytes);
  if (hz && hz !== erwartet.ziel) return { ok: false, reason: `Ergebnis hat SHA-256 ${hz.slice(0, 12)}…, die Hacktribe-Firmware hätte ${erwartet.ziel.slice(0, 12)}… — nichts abgelegt` };
  if (!hz) return { ok: false, reason: "Kein SHA-256 verfügbar — ohne Hash-Abgleich wird keine Hacktribe-Firmware erzeugt" };
  return { ok: true, bytes };
}
