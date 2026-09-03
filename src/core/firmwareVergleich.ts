/**
 * firmwareVergleich — zwei Firmware-Abbilder nebeneinander: was unterscheidet
 * sich, und wo.
 *
 * Ein Byte-Diff sagt „1317 Bytes anders". Das hier sagt: IFX-Platz 50 heisst
 * links „— leer —" und rechts „Tekk Drive", die IFX-Zaehler stehen auf 49
 * bzw. 96, das Startbild ist gleich, und ausserhalb der bekannten Bereiche
 * gibt es drei Laeufe bei 0x… — die man dann gezielt anschauen kann. Damit
 * laesst sich pruefen, was ein Bau veraendert hat, und was eine fremde
 * Firmware (Stock, Hacktribe, eine Omnitribe-Fassung) anders macht.
 *
 * Die bekannten Bereiche kommen aus der RAM-Karte (nur die, die im Abbild
 * liegen), den Zaehler-Tabellen und den Offsets in `firmwareBau`.
 */
import { E2_RAM_MAP, addressForSlot } from "./hacktribeRam";
import { IFX_ZAEHLER } from "./ifxErweiterung";
import {
  GROOVE_ZAEHLER,
  VSB_GROESSE,
  VSB_HEADER,
  dateiOffset,
  INIT_PATTERN_OFFSET,
  INIT_PATTERN_GROESSE,
  SPLASH_OFFSET,
  SPLASH_GROESSE,
  INIT_GLOBAL_OFFSET,
  INIT_GLOBAL_GROESSE,
} from "./firmwareBau";
import { decodeGroove } from "./e2Groove";
import { E2_GLOBAL_CHAIN_MODE_OFF, E2_GLOBAL_CLOCK_SOURCE_OFF } from "./e2sysex";
import { leseLdrKette, LDR_START, dspPatchStand } from "./dspPatch";
import { DSP_PATCH_REGISTER } from "./dspPatchRegister";

export interface Unterschied {
  /** ifx | mfx | groove | initPattern | splash | zaehler | header */
  bereich: string;
  /** Platz (Geraete-Zaehlung) bei Baenken, sonst undefined. */
  platz?: number;
  /** Anzeigename links/rechts (Preset-/Groove-Name, Zaehlerwert, …). */
  links: string;
  rechts: string;
  bytes: number;
  offset: number;
}

export interface SonstigerLauf {
  von: number;
  bis: number;
  bytes: number;
}

export interface FirmwareVergleich {
  gleich: boolean;
  unterschiede: Unterschied[];
  /** Byte-Laeufe ausserhalb der bekannten Bereiche (Luecken bis 16 Bytes zusammengefasst). */
  sonstige: SonstigerLauf[];
  sonstigeBytes: number;
  /** Kurzfassung, eine Zeile je Bereich. */
  zeilen: string[];
}

const presetName = (u: Uint8Array): string => {
  let t = "";
  for (let i = 1; i < 16 && u[i]; i++) t += String.fromCharCode(u[i]);
  return t || "— leer —";
};
const grooveName = (u: Uint8Array): string => {
  if (!(u[0] === 0x47 && u[1] === 0x56)) return "— leer —";
  try {
    return decodeGroove(u).name || "(ohne Namen)";
  } catch {
    return "(unlesbar)";
  }
};
const gleichBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const zaehlBytes = (a: Uint8Array, b: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

export function vergleicheFirmware(a: Uint8Array, b: Uint8Array): FirmwareVergleich {
  if (a.length !== VSB_GROESSE || b.length !== VSB_GROESSE) {
    throw new Error(`Beide Dateien müssen ${VSB_GROESSE} Bytes haben (${a.length} / ${b.length})`);
  }
  const unterschiede: Unterschied[] = [];
  const bekannt = new Uint8Array(VSB_GROESSE); // 1 = gehoert zu einem bekannten Bereich
  bekannt.fill(1, 0, VSB_HEADER);

  const kopf = a.subarray(0, VSB_HEADER);
  const kopfB = b.subarray(0, VSB_HEADER);
  if (!gleichBytes(kopf, kopfB)) {
    unterschiede.push({ bereich: "header", links: String.fromCharCode(...kopf.subarray(0x10, 0x13)), rechts: String.fromCharCode(...kopfB.subarray(0x10, 0x13)), bytes: zaehlBytes(kopf, kopfB), offset: 0 });
  }

  // Baenke je Platz
  const bank = (key: string, bereich: string, name: (u: Uint8Array) => string) => {
    const map = E2_RAM_MAP.find((e) => e.key === key)!;
    for (let slot = 0; slot < map.count; slot++) {
      const off = dateiOffset(addressForSlot(map, slot));
      if (off + map.size > VSB_GROESSE) break;
      bekannt.fill(1, off, off + map.size);
      const x = a.subarray(off, off + map.size);
      const y = b.subarray(off, off + map.size);
      if (!gleichBytes(x, y)) unterschiede.push({ bereich, platz: slot + 1, links: name(x), rechts: name(y), bytes: zaehlBytes(x, y), offset: off });
    }
  };
  bank("ifxPreset", "ifx", presetName);
  bank("mfxPreset", "mfx", presetName);
  bank("groove", "groove", grooveName);

  // Zaehler
  const zelle = (addr: number, was: string) => {
    const off = dateiOffset(addr);
    bekannt[off] = 1;
    if (a[off] !== b[off]) unterschiede.push({ bereich: "zaehler", links: `${was} ${a[off]}`, rechts: `${was} ${b[off]}`, bytes: 1, offset: off });
  };
  for (const z of IFX_ZAEHLER) zelle(z.addr, z.plusEins ? "IFX-Anzahl" : "IFX-Max");
  for (const z of GROOVE_ZAEHLER) zelle(z.addr, z.plusEins ? "Groove-Anzahl" : "Groove-Max");

  // Init-Pattern und Startbild
  const block = (off: number, len: number, bereich: string, name: (u: Uint8Array) => string) => {
    bekannt.fill(1, off, off + len);
    const x = a.subarray(off, off + len);
    const y = b.subarray(off, off + len);
    if (!gleichBytes(x, y)) unterschiede.push({ bereich, links: name(x), rechts: name(y), bytes: zaehlBytes(x, y), offset: off });
  };
  const initName = (u: Uint8Array): string => {
    let t = "";
    for (let i = 0; i < 16 && u[0x10 + i]; i++) t += String.fromCharCode(u[0x10 + i]);
    return t.trim() || "(ohne Namen)";
  };
  block(INIT_PATTERN_OFFSET, INIT_PATTERN_GROESSE, "initPattern", initName);
  // Zwei am Geraet zugeordnete Offsets (e2sysex): Chain Mode und Clock-Quelle — die Konstanten, nicht rohe Zahlen (Befund: 0x13 war die Pattern-Wechselsperre).
  block(INIT_GLOBAL_OFFSET, INIT_GLOBAL_GROESSE, "initGlobal", (u) => `Chain ${u[E2_GLOBAL_CHAIN_MODE_OFF]}, Clock ${u[E2_GLOBAL_CLOCK_SOURCE_OFF]}`);
  block(SPLASH_OFFSET, SPLASH_GROESSE, "splash", (u) => {
    let dunkel = 0;
    for (const v of u) for (let k = 0; k < 8; k++) if ((v >> k) & 1) dunkel++;
    return `${dunkel} dunkle Pixel`;
  });

  // DSP-Abbild (BF523-LDR-Kette): je Datenblock, dazu die Koepfe — nur wenn die Kette in A lesbar ist
  const kette = leseLdrKette(a);
  if (kette.ok) {
    const hx = (n: number): string => `0x${n.toString(16).toUpperCase()}`;
    bekannt.fill(1, LDR_START, kette.ende);
    for (const [i, bl] of kette.bloecke.entries()) {
      const kx = a.subarray(bl.kopf, bl.kopf + 16);
      const ky = b.subarray(bl.kopf, bl.kopf + 16);
      if (!gleichBytes(kx, ky)) unterschiede.push({ bereich: "dsp", platz: i, links: `Kopf von Block ${i}`, rechts: "anders — Kette vermutlich ungültig", bytes: zaehlBytes(kx, ky), offset: bl.kopf });
      if (bl.fuellung) continue;
      const x = a.subarray(bl.daten, bl.daten + bl.laenge);
      const y = b.subarray(bl.daten, bl.daten + bl.laenge);
      if (!gleichBytes(x, y)) unterschiede.push({ bereich: "dsp", platz: i, links: `Block ${i} @ ${hx(bl.ziel)}`, rechts: `${bl.laenge} Bytes lang`, bytes: zaehlBytes(x, y), offset: bl.daten });
    }
  }

  // Alles andere: Laeufe, Luecken bis 16 Bytes zusammengefasst
  const sonstige: SonstigerLauf[] = [];
  let sonstigeBytes = 0;
  let lauf: SonstigerLauf | null = null;
  for (let i = 0; i < VSB_GROESSE; i++) {
    if (bekannt[i] || a[i] === b[i]) continue;
    sonstigeBytes++;
    if (lauf && i - lauf.bis <= 16) {
      lauf.bis = i;
      lauf.bytes++;
    } else {
      lauf = { von: i, bis: i, bytes: 1 };
      sonstige.push(lauf);
    }
  }

  const zeilen: string[] = [];
  const je = (bereich: string) => unterschiede.filter((u) => u.bereich === bereich);
  const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;
  for (const [bereich, label] of [["ifx", "IFX"], ["mfx", "MFX"], ["groove", "Grooves"]] as const) {
    const l = je(bereich);
    if (!l.length) continue;
    const beispiele = l.slice(0, 6).map((u) => `${u.platz}: „${u.links}“ ↔ „${u.rechts}“`).join(", ");
    zeilen.push(`${label}: ${l.length} Platz/Plätze anders — ${beispiele}${l.length > 6 ? ", …" : ""}`);
  }
  const zl = je("zaehler");
  if (zl.length) {
    // Gleiche Uebergaenge zusammenfassen: „IFX-Anzahl 49 → 96 (7 Zellen)"
    const gruppen = new Map<string, number>();
    for (const u of zl) {
      const k = `${u.links} → ${u.rechts.replace(/^\S+ /, "")}`;
      gruppen.set(k, (gruppen.get(k) ?? 0) + 1);
    }
    zeilen.push(`Zähler: ${Array.from(gruppen, ([k, n]) => (n > 1 ? `${k} (${n} Zellen)` : k)).join(", ")}`);
  }
  for (const u of je("initPattern")) zeilen.push(`Init-Pattern: „${u.links}“ ↔ „${u.rechts}“ (${u.bytes} Bytes)`);
  for (const u of je("splash")) zeilen.push(`Startbild: ${u.links} ↔ ${u.rechts} (${u.bytes} Bytes)`);
  for (const u of je("initGlobal")) zeilen.push(`Init-Global: ${u.links} ↔ ${u.rechts} (${u.bytes} Bytes)`);
  for (const u of je("header")) zeilen.push(`Header: ${u.links} ↔ ${u.rechts} (${u.bytes} Bytes)`);
  const dsp = je("dsp");
  if (dsp.length) {
    zeilen.push(
      `DSP-Abbild: ${dsp.length} Block/Blöcke anders — ${dsp.slice(0, 6).map((u) => `${u.links} (${u.bytes} Bytes, ab ${hex(u.offset)})`).join(", ")}${dsp.length > 6 ? ", …" : ""}`,
    );
    // Und benannt, was davon ein bekannter Patch ist: Stand links ↔ rechts, nur wo er sich unterscheidet.
    const staende = DSP_PATCH_REGISTER.map((p) => [p.titel, dspPatchStand(a, p), dspPatchStand(b, p)] as const).filter(([, x, y]) => x !== y);
    if (staende.length) zeilen.push(`DSP-Patches: ${staende.map(([t, x, y]) => `„${t}“ ${x} ↔ ${y}`).join(", ")}`);
  }
  if (sonstige.length) {
    zeilen.push(
      `Außerhalb der bekannten Bereiche: ${sonstigeBytes} Bytes in ${sonstige.length} Lauf/Läufen — ` +
        sonstige
          .slice(0, 8)
          .map((s) => `${hex(s.von)}–${hex(s.bis)} (${s.bytes})`)
          .join(", ") +
        (sonstige.length > 8 ? ", …" : ""),
    );
  }
  const gleich = !unterschiede.length && !sonstige.length;
  if (gleich) zeilen.push("Die beiden Abbilder sind byteweise identisch.");
  return { gleich, unterschiede, sonstige, sonstigeBytes, zeilen };
}
