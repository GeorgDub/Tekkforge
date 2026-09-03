/**
 * splash — der Startbildschirm der Electribe als 1-Bit-Bild, 128 × 64.
 *
 * Er liegt in der Firmware als 1024 Bytes (Datei-Offset 0xF9954, siehe
 * `firmwareBau`). Die Belegung ist am Decoder von hacktribes
 * `ht_splash_screen.py` abgeleitet und mit Einzel-Bit-Sonden bestaetigt
 * (2026-09-02): acht Baender zu je acht Zeilen, je Band 128 Bytes — ein
 * Byte pro Spalte. Bit 7 ist die oberste Zeile des Bands, Bit 0 die
 * unterste. Bitwert 1 = hell, 0 = dunkel: ein Puffer aus lauter 0xFF ist
 * ein leerer Bildschirm.
 *
 *     byte  = (y >> 3) * 128 + x
 *     bit   = 7 - (y & 7)
 *     dunkel ⇔ (byte >> bit) & 1 === 0
 *
 * Pixel werden hier als `Uint8Array(128 * 64)` gefuehrt, zeilenweise, 1 =
 * dunkel (gesetzt) — das ist die Sicht dessen, der malt.
 */
export const SPLASH_BREITE = 128;
export const SPLASH_HOEHE = 64;
export const SPLASH_BYTES = (SPLASH_BREITE * SPLASH_HOEHE) / 8;

/** Ein leerer (heller) Bildschirm. */
export function leererSplash(): Uint8Array {
  return new Uint8Array(SPLASH_BYTES).fill(0xff);
}

export function splashZuPixel(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== SPLASH_BYTES) throw new Error(`${bytes.length} Bytes — der Startbildschirm hat ${SPLASH_BYTES}`);
  const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  for (let y = 0; y < SPLASH_HOEHE; y++) {
    const band = (y >> 3) * SPLASH_BREITE;
    const bit = 7 - (y & 7);
    for (let x = 0; x < SPLASH_BREITE; x++) {
      px[y * SPLASH_BREITE + x] = ((bytes[band + x] >> bit) & 1) === 0 ? 1 : 0;
    }
  }
  return px;
}

export function pixelZuSplash(px: Uint8Array): Uint8Array {
  if (px.length !== SPLASH_BREITE * SPLASH_HOEHE) throw new Error(`${px.length} Pixel — erwartet ${SPLASH_BREITE} × ${SPLASH_HOEHE}`);
  const out = leererSplash();
  for (let y = 0; y < SPLASH_HOEHE; y++) {
    const band = (y >> 3) * SPLASH_BREITE;
    const bit = 7 - (y & 7);
    for (let x = 0; x < SPLASH_BREITE; x++) {
      if (px[y * SPLASH_BREITE + x]) out[band + x] &= ~(1 << bit) & 0xff;
    }
  }
  return out;
}

/**
 * Ein beliebiges Bild (RGBA, beliebige Groesse) auf 128 × 64 bringen:
 * seitenverhaeltnis-treu einpassen, mittig, mit Helligkeitsschwelle
 * (0..255; dunkler als die Schwelle = gesetzt). Alpha unter 128 zaehlt als
 * hell — transparente Raender bleiben leer.
 */
export function bildZuPixel(rgba: Uint8Array | Uint8ClampedArray, breite: number, hoehe: number, schwelle = 128, invertieren = false): Uint8Array {
  return helligkeitZuPixel(bildZuHelligkeit(rgba, breite, hoehe), schwelle, invertieren);
}

/**
 * Erste Stufe: das Bild einmal auf 128 × 64 Helligkeiten (0..255) bringen,
 * -1 ausserhalb des eingepassten Bereichs. Danach kostet jeder Schwellwert nur
 * noch 8192 Vergleiche — statt bei jedem Reglerzug ueber alle Quellpixel zu laufen.
 */
export function bildZuHelligkeit(rgba: Uint8Array | Uint8ClampedArray, breite: number, hoehe: number): Float32Array {
  if (rgba.length < breite * hoehe * 4) throw new Error("Bilddaten zu kurz");
  const hell = new Float32Array(SPLASH_BREITE * SPLASH_HOEHE).fill(-1);
  const skala = Math.min(SPLASH_BREITE / breite, SPLASH_HOEHE / hoehe);
  const zb = Math.max(1, Math.round(breite * skala));
  const zh = Math.max(1, Math.round(hoehe * skala));
  const x0 = Math.floor((SPLASH_BREITE - zb) / 2);
  const y0 = Math.floor((SPLASH_HOEHE - zh) / 2);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zb; x++) {
      // Mittelwert ueber das Quellfenster dieses Zielpixels
      const qx0 = Math.floor((x / zb) * breite);
      const qx1 = Math.max(qx0 + 1, Math.floor(((x + 1) / zb) * breite));
      const qy0 = Math.floor((y / zh) * hoehe);
      const qy1 = Math.max(qy0 + 1, Math.floor(((y + 1) / zh) * hoehe));
      let summe = 0;
      let n = 0;
      for (let qy = qy0; qy < qy1; qy++) {
        for (let qx = qx0; qx < qx1; qx++) {
          const i = (qy * breite + qx) * 4;
          const a = rgba[i + 3];
          const hell = a < 128 ? 255 : Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
          summe += hell;
          n++;
        }
      }
      hell[(y0 + y) * SPLASH_BREITE + (x0 + x)] = summe / n;
    }
  }
  return hell;
}

/** Zweite Stufe: Helligkeiten schwellen (dunkler als `schwelle` = gesetzt); -1 bleibt leer. */
export function helligkeitZuPixel(hell: Float32Array, schwelle = 128, invertieren = false): Uint8Array {
  if (hell.length !== SPLASH_BREITE * SPLASH_HOEHE) throw new Error("falsche Pixelzahl");
  const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  for (let i = 0; i < px.length; i++) {
    if (hell[i] < 0) continue;
    let dunkel = hell[i] < schwelle;
    if (invertieren) dunkel = !dunkel;
    px[i] = dunkel ? 1 : 0;
  }
  return px;
}

/** Pixel als PBM (P4) — das aelteste 1-Bit-Format, jedes Grafikprogramm liest es. */
export function pixelZuPbm(px: Uint8Array): Uint8Array {
  const kopf = new TextEncoder().encode(`P4\n${SPLASH_BREITE} ${SPLASH_HOEHE}\n`);
  const zeile = SPLASH_BREITE / 8;
  const out = new Uint8Array(kopf.length + zeile * SPLASH_HOEHE);
  out.set(kopf, 0);
  for (let y = 0; y < SPLASH_HOEHE; y++) {
    for (let x = 0; x < SPLASH_BREITE; x++) {
      if (px[y * SPLASH_BREITE + x]) out[kopf.length + y * zeile + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** PBM (P4, 128 × 64) zurueck zu Pixeln. */
export function pbmZuPixel(bytes: Uint8Array): Uint8Array {
  // Kopf: "P4", dann Breite und Hoehe — dazwischen duerfen Kommentarzeilen
  // stehen (GIMP schreibt "# CREATOR: …" hinter das Magic). Der Kopf endet mit
  // genau einem Weissraum-Zeichen vor den Bilddaten.
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  if (!text.startsWith("P4")) throw new Error("Kein PBM (P4)");
  const zahlen: number[] = [];
  let pos = 2;
  while (zahlen.length < 2 && pos < text.length) {
    const c = text[pos];
    if (c === "#") {
      const ende = text.indexOf("\n", pos);
      pos = ende < 0 ? text.length : ende + 1;
    } else if (/\s/.test(c)) {
      pos++;
    } else {
      const m = /^\d+/.exec(text.slice(pos));
      if (!m) throw new Error("Kein PBM (P4): Kopf unlesbar");
      zahlen.push(Number(m[0]));
      pos += m[0].length;
    }
  }
  if (zahlen.length < 2) throw new Error("Kein PBM (P4): Kopf unvollstaendig");
  const b = zahlen[0];
  const h = zahlen[1];
  if (b !== SPLASH_BREITE || h !== SPLASH_HOEHE) throw new Error(`PBM ist ${b} × ${h}, erwartet ${SPLASH_BREITE} × ${SPLASH_HOEHE}`);
  const start = pos + 1; // das eine Weissraum-Zeichen nach der Hoehe
  const zeile = SPLASH_BREITE / 8;
  const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  for (let y = 0; y < SPLASH_HOEHE; y++) {
    for (let x = 0; x < SPLASH_BREITE; x++) {
      px[y * SPLASH_BREITE + x] = (bytes[start + y * zeile + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
  }
  return px;
}
