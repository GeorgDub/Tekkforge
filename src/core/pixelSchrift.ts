/**
 * pixelSchrift — eine 5 × 7 Pixelschrift fuer den Startbildschirm.
 *
 * Grossbuchstaben, Ziffern und ein paar Zeichen; alles andere wird zum
 * Kaestchen, damit man sieht, dass etwas fehlt, statt dass es still
 * verschwindet. Umlaute werden auf AE/OE/UE/SS abgebildet — auf 128 × 64
 * Pixeln ist das lesbarer als ein Punktepaar ueber einem 7 Pixel hohen A.
 *
 * Jede Glyphe ist 5 Spalten × 7 Zeilen, dazwischen eine Spalte Luft. Mit
 * `skala` 2 oder 3 wird jeder Punkt zum Block — fuer ein Wort quer ueber den
 * ganzen Bildschirm reicht 3 (21 Pixel hoch, 7 Zeichen breit).
 */
import { SPLASH_BREITE, SPLASH_HOEHE } from "./splash";

const G: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "&": [".##..", "#..#.", "#..#.", ".##..", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
  "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
};
const UNBEKANNT = ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"];

export const SCHRIFT_BREITE = 5;
export const SCHRIFT_HOEHE = 7;
/** Eine Spalte Luft zwischen zwei Zeichen. */
export const SCHRIFT_ABSTAND = 1;

/** Zeichen auf die Schrift abbilden: Grossschreibung, Umlaute ausgeschrieben. */
export function normalisiere(text: string): string {
  return text
    .toUpperCase()
    .replace(/Ä/g, "AE")
    .replace(/Ö/g, "OE")
    .replace(/Ü/g, "UE")
    .replace(/ß/g, "SS");
}

export function glyphe(zeichen: string): string[] {
  return G[zeichen] ?? UNBEKANNT;
}

/** Breite eines Textes in Pixeln bei Skala `skala` (ohne Luft nach dem letzten Zeichen). */
export function textBreite(text: string, skala = 1): number {
  const t = normalisiere(text);
  if (!t.length) return 0;
  return (t.length * SCHRIFT_BREITE + (t.length - 1) * SCHRIFT_ABSTAND) * skala;
}

export function textHoehe(skala = 1): number {
  return SCHRIFT_HOEHE * skala;
}

/**
 * Text in ein 128 × 64-Pixelfeld schreiben (1 = dunkel). `x`/`y` ist die
 * linke obere Ecke; `"mitte"` zentriert. Was ueber den Rand ragt, wird
 * abgeschnitten. Liefert das Feld zurueck (dasselbe Objekt).
 */
export function schreibeText(
  px: Uint8Array,
  text: string,
  x: number | "mitte",
  y: number | "mitte",
  skala = 1,
): Uint8Array {
  if (px.length !== SPLASH_BREITE * SPLASH_HOEHE) throw new Error("falsche Pixelzahl");
  const t = normalisiere(text);
  const breite = textBreite(t, skala);
  const hoehe = textHoehe(skala);
  const x0 = x === "mitte" ? Math.floor((SPLASH_BREITE - breite) / 2) : x;
  const y0 = y === "mitte" ? Math.floor((SPLASH_HOEHE - hoehe) / 2) : y;
  let cx = x0;
  for (const zeichen of t) {
    const g = glyphe(zeichen);
    for (let gy = 0; gy < SCHRIFT_HOEHE; gy++) {
      for (let gx = 0; gx < SCHRIFT_BREITE; gx++) {
        if (g[gy][gx] !== "#") continue;
        for (let sy = 0; sy < skala; sy++) {
          for (let sx = 0; sx < skala; sx++) {
            const X = cx + gx * skala + sx;
            const Y = y0 + gy * skala + sy;
            if (X >= 0 && Y >= 0 && X < SPLASH_BREITE && Y < SPLASH_HOEHE) px[Y * SPLASH_BREITE + X] = 1;
          }
        }
      }
    }
    cx += (SCHRIFT_BREITE + SCHRIFT_ABSTAND) * skala;
  }
  return px;
}
