/**
 * firmwareFreigabe — die letzte Instanz vor dem Flashen: Zielgeraet und
 * laufende Firmware waehlen, den Kopf passend setzen, das Abbild auf alles
 * pruefen, was ein Brick werden koennte, und erst dann freigeben.
 *
 * Was den Kopf bestimmt, ist NICHT die Hardware, sondern die Firmware, die
 * das Update ausfuehrt: der SD-Updater der laufenden Firmware prueft die
 * Device-ID im Kopf strikt gegen die eigene Variante (Omnitribe
 * `docs/reverse/e2synth_auf_e2s_crossgrade_v202.md`, `family_check` mit
 * Flag 0). Ein Sampler, auf dem schon eine (umgekoepfte) Synth-Firmware
 * laeuft, verlangt also einen SYNTH-Kopf (0x0123) und den Synth-SD-Pfad —
 * obwohl die Hardware ein Sampler ist. Genau diese Falle nimmt die Freigabe
 * dem Nutzer ab: Geraet + laufende Firmware waehlen, den Rest rechnet sie.
 *
 * Geprueft wird (jede Pruefung einzeln benannt, damit der Bericht lesbar ist):
 *   - Groesse 0x200100, Magic, Tag „SYSTEM“, Version 02 02, Kopf-Rest 0xFF
 *   - Payload-Layout erkannt (Karte), Kopf passt zur laufenden Firmware
 *   - ARM-Vektortabelle am Payload-Anfang (acht `ldr pc,[pc,#0x18]`)
 *   - IFX-/Groove-Zaehler stimmig, Init-Pattern/-Global gerahmt
 *   - DSP-Kette gueltig (wo die Lage bekannt ist)
 *   - Referenz-Vergleich: Bytes ausserhalb der bekannten Bereiche (Hinweis)
 * Der Bootloader (BOOT.VSB, Masked-ROM-Stufe davor) wird von SYSTEM.VSB nie
 * beruehrt — der SD-Rueckweg mit der Werks-SYSTEM.VSB bleibt immer offen; die
 * Freigabe sagt das dazu.
 */
import { VARIANTEN, VSB_TOTAL, OFF_ID_LOW, OFF_ID_HIGH, OFF_SUFFIX, OFF_TAG, type Variante } from "./crossgrade";
import { erkenneKarte, dateiOffset, leseZaehler, VSB_HEADER, type KartenBefund } from "./firmwareKarte";
import { leseLdrKette } from "./dspPatch";
import { unterschiedsLaeufe, bekannteBereiche } from "./firmwareAnalyse";

export type LaufendeFirmware = "sampler-stock" | "hacktribe" | "synth-stock" | "synth-crossgrade";

export interface LaufendeFirmwareDef {
  label: string;
  /** Welche Kopf-Variante der Updater dieser Firmware verlangt. */
  kopf: Variante;
  /** Auf welcher Hardware sie ueblicherweise laeuft. */
  geraet: Variante;
}

export const LAUFENDE_FIRMWARE: Record<LaufendeFirmware, LaufendeFirmwareDef> = {
  "sampler-stock": { label: "Sampler-Firmware (Korg v2.02)", kopf: "sampler", geraet: "sampler" },
  hacktribe: { label: "Hacktribe (oder TekkForge-Fassung davon)", kopf: "sampler", geraet: "sampler" },
  "synth-stock": { label: "Synth-Firmware (Korg v2.02)", kopf: "synth", geraet: "synth" },
  "synth-crossgrade": { label: "Synth-Firmware, umgeköpft (Crossgrade auf Sampler-Hardware)", kopf: "synth", geraet: "sampler" },
};

export interface Ziel {
  geraet: Variante;
  laufend: LaufendeFirmware;
}

export interface Pruefung {
  name: string;
  ok: boolean;
  text: string;
  /** false: nur Hinweis, blockiert nicht. */
  hart: boolean;
}

export interface Freigabe {
  ok: boolean;
  bytes: Uint8Array;
  kopfVariante: Variante;
  sdPfad: string;
  befund?: KartenBefund;
  pruefungen: Pruefung[];
  warnungen: string[];
  zeilen: string[];
}

const ascii = (b: Uint8Array, off: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i] ?? 0);
  return s;
};
const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/**
 * Kopf auf die laufende Firmware setzen (nur 0x12 und 0x2D/0x2E), alles
 * pruefen, Bericht bauen. `referenz` (das unveraenderte Abbild derselben
 * Bauart) ist optional und liefert nur den Hinweis, wie viel ausserhalb der
 * bekannten Bereiche geaendert wurde.
 */
export function freigabe(bytes: Uint8Array, ziel: Ziel, referenz?: Uint8Array): Freigabe {
  const lf = LAUFENDE_FIRMWARE[ziel.laufend];
  const kopfVariante = lf.kopf;
  const v = VARIANTEN[kopfVariante];
  const sdPfad = `${v.sdOrdner}/SYSTEM.VSB`;
  const pruefungen: Pruefung[] = [];
  const warnungen: string[] = [];
  const p = (name: string, ok: boolean, text: string, hart = true) => pruefungen.push({ name, ok, text, hart });

  const out = new Uint8Array(bytes);
  if (out.length !== VSB_TOTAL) {
    p("Größe", false, `${out.length} Bytes statt ${VSB_TOTAL}`);
    return { ok: false, bytes: out, kopfVariante, sdPfad, pruefungen, warnungen, zeilen: pruefungen.map((x) => `✗ ${x.name}: ${x.text}`) };
  }
  p("Größe", true, `${VSB_TOTAL} Bytes (0x100 Kopf + 2 MiB Payload)`);
  p("Magic", ascii(out, 0, 16) === "KORG SYSTEM FILE", `„${ascii(out, 0, 16).replace(/[^\x20-\x7e]/g, "?")}“`);
  p("Dateityp", ascii(out, OFF_TAG, 6) === "SYSTEM", `Tag „${ascii(out, OFF_TAG, 6).replace(/[^\x20-\x7e]/g, "?")}“`);
  const version = `${out[0x2a]}.${String(out[0x2b]).padStart(2, "0")}`;
  p("Version", out[0x2a] === 2 && out[0x2b] === 2, `Kopf nennt ${version}${out[0x2a] === 2 && out[0x2b] === 2 ? "" : " — die Karten gelten für 2.02"}`, false);
  let rest = true;
  for (let i = 0x42; i < VSB_HEADER; i++) if (out[i] !== 0xff) rest = false;
  p("Kopf-Rest", rest, rest ? "0x42…0xFF sind 0xFF" : "Bytes hinter 0x42 sind nicht 0xFF — ungewöhnlicher Kopf", false);

  // Kopf auf die laufende Firmware setzen
  const vorher = out[OFF_ID_LOW];
  out[OFF_SUFFIX] = v.suffix;
  out[OFF_ID_HIGH] = 0x01;
  out[OFF_ID_LOW] = v.idLow;
  p("Kopf", true, `Device-ID ${hex((out[OFF_ID_HIGH] << 8) | out[OFF_ID_LOW])} (${v.label})${vorher !== v.idLow ? ` — umgeköpft von ${hex(0x0100 | vorher)}` : ""}`);

  const befund = erkenneKarte(out);
  if (!befund.ok) {
    p("Layout", false, befund.reason);
  } else {
    const k = befund.karte;
    p("Layout", true, `${k.label}${befund.umgekoepft ? " — Payload einer anderen Variante als der Kopf (Crossgrade)" : ""}`);
    // Vektortabelle: acht `ldr pc,[pc,#imm]` (0xE59FF000 | imm12) am Payload-
    // Anfang — so beginnen Stock-Synth, Stock-Sampler und Hacktribe gleichermassen
    // (am Abbild: 5 × #0x18, dann #0x04, #0x14, #0x14; die Immediates sind je
    // Vektor verschieden, die Befehlsform nicht).
    let vektoren = 0;
    for (let i = 0; i < 8; i++) if (((u32(out, VSB_HEADER + i * 4) & 0xfffff000) >>> 0) === 0xe59ff000) vektoren++;
    p("Vektortabelle", vektoren === 8, `${vektoren}/8 Sprungvektoren (ldr pc,[pc,#…]) am Payload-Anfang`);
    const z = leseZaehler(out, k.ifxZaehler);
    p("IFX-Zähler", z.ok, z.ok ? `stimmig, Menü bis ${z.maxIndex + 1}${k.ifxZaehlerVollstaendig ? "" : " (nicht alle Zellen bekannt — nur gelesen)"}` : z.reason);
    if (k.grooveZaehler) {
      const g = leseZaehler(out, k.grooveZaehler);
      p("Groove-Zähler", g.ok, g.ok ? `stimmig, bis ${g.maxIndex + 1}` : g.reason);
    }
    const ip = dateiOffset(k.initPattern);
    p("Init-Pattern", ascii(out, ip, 4) === "PTST" && ascii(out, ip + 0x3c00 - 4, 4) === "PTED", `„${ascii(out, ip + 0x10, 16).replace(/\0.*$/, "").trim()}“`);
    const ig = dateiOffset(k.initGlobal);
    p("Init-Global", ascii(out, ig, 4) === "GLST" && ascii(out, ig + 0xfc, 4) === "GLED", "GLST … GLED");
    if (k.ldrStart !== undefined) {
      const kette = leseLdrKette(out, k.ldrStart);
      p("DSP-Kette", kette.ok, kette.ok ? `${kette.bloecke.length} Blöcke, alle Köpfe gültig` : kette.reason);
    }
    if (referenz && referenz.length === VSB_TOTAL) {
      const r = erkenneKarte(referenz);
      if (r.ok && r.karte.familie === k.familie) {
        const laeufe = unterschiedsLaeufe(out, referenz);
        const bereiche = bekannteBereiche(out, k);
        let draussen = 0;
        let dsp = 0;
        for (const l of laeufe) {
          for (let i = l.von; i < l.bis; i++) {
            if (out[i] === referenz[i]) continue;
            const b = bereiche.find((x) => x.von <= i && i < x.bis);
            if (!b) draussen++;
            else if (b.art === "dsp") dsp++;
          }
        }
        p("Referenz", true, `${laeufe.length} Byte-Läufe gegenüber ${r.karte.label}, davon ${draussen} Bytes im Code außerhalb der bekannten Bereiche und ${dsp} Bytes in der DSP-Kette`, false);
        if (draussen) warnungen.push(`${draussen} Bytes im Code außerhalb der bekannten Bereiche geändert — das ist Hacktribe-/Code-Patch-Gebiet; nur flashen, was man kennt.`);
        if (dsp) warnungen.push(`${dsp} Bytes in der BF523-DSP-Kette geändert — DSP-Patches sind experimentell; erst am Gerät hören.`);
      }
    }
    // Zielgeraet vs. Payload
    if (ziel.geraet === "sampler" && k.familie === "synth") warnungen.push("Synth-Klangerzeugung auf Sampler-Hardware: PCM-Instrumente kommen aus der Sampler-PCM.VSB und können anders klingen als am echten Synth.");
    if (ziel.geraet === "synth" && k.familie === "sampler") warnungen.push("Sampler-Firmware auf Synth-Hardware: Sample-Speicher/PCM des Synths sind nicht die des Samplers — am Gerät prüfen.");
    if (lf.geraet !== ziel.geraet) warnungen.push(`„${lf.label}“ läuft üblicherweise auf ${VARIANTEN[lf.geraet].label} — sicher, dass das Gerät ${VARIANTEN[ziel.geraet].label} ist?`);
    if (befund.umgekoepft && k.familie !== lf.kopf) {
      // Payload-Variante ≠ Kopf-Variante ist beabsichtigt (Crossgrade) — nur sagen.
      warnungen.push(`Das Abbild trägt ${k.label} mit ${v.label}-Kopf. Nach dem Flashen läuft die ${k.familie === "synth" ? "Synth" : "Sampler"}-Firmware — künftige Updates brauchen dann den ${k.familie === "synth" ? "Synth" : "Sampler"}-Kopf.`);
    }
  }
  warnungen.push(`Rückweg: die Werks-SYSTEM.VSB der laufenden Firmware (${lf.label}) als ${sdPfad} auf einer zweiten SD-Karte behalten; BOOT.VSB wird nie angefasst.`);
  const ok = pruefungen.every((x) => x.ok || !x.hart);
  const zeilen = [
    `Ziel: ${VARIANTEN[ziel.geraet].label}, darauf läuft „${lf.label}“ → Kopf ${v.label}, Pfad ${sdPfad}`,
    ...pruefungen.map((x) => `${x.ok ? "✓" : x.hart ? "✗" : "△"} ${x.name}: ${x.text}`),
    ...warnungen.map((w) => `⚠ ${w}`),
    ok ? "FREIGEGEBEN — als SYSTEM.VSB auf die SD-Karte, dann am Gerät DATA UTILITY → SOFTWARE UPDATE." : "NICHT FREIGEGEBEN — mindestens eine harte Prüfung ist rot.",
  ];
  return { ok, bytes: out, kopfVariante, sdPfad, befund: befund.ok ? befund : undefined, pruefungen, warnungen, zeilen };
}
