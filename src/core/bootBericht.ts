/**
 * bootBericht — Textberichte für die Werkbank-Abschnitte „Boot-Sektor & Flash-Dump“:
 * Kopfprüfung einer VSB für beide Updater, Boot-Sektor-Befund, Flash-Dump-Karte.
 * Reine Textbildung, damit die GUI dünn bleibt und die Zeilen testbar sind.
 */
import { pruefeVsbKopf, liesVsbKopf } from "./vsbKopf";
import type { BootSektorBefund } from "./bootSektor";
import type { FlashDumpBefund } from "./flashKarte";

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** Kopfprüfung gegen den Sampler- UND den Synth-Updater — man sieht, welches Gerät die Datei nähme. */
export function berichtVsbPruefung(bytes: Uint8Array, name: string): { zeilen: string[]; samplerOk: boolean; synthOk: boolean } {
  const k = liesVsbKopf(bytes);
  const zeilen: string[] = [];
  zeilen.push(`${name}: ${bytes.length} Bytes — Kürzel „${k.kuerzel}“, Name „${k.name}“${k.art ? ` (${k.art})` : ""}, Revision ${k.revision[0]}.${k.revision[1]}, Identität ${hex(k.identitaet)}, Nutzlast laut Kopf ${hex(k.laenge)}`);
  let samplerOk = false;
  let synthOk = false;
  for (const laufend of ["sampler", "synth"] as const) {
    const r = pruefeVsbKopf(bytes, laufend);
    if (laufend === "sampler") samplerOk = r.ok;
    else synthOk = r.ok;
    zeilen.push("", `Updater der ${laufend === "sampler" ? "Sampler" : "Synth"}-Firmware: ${r.ok ? "✅ nimmt die Datei an" : "❌ lehnt ab"}`);
    for (const p of r.pruefungen) zeilen.push(` ${p.ok ? "✓" : "✗"} ${p.titel}: ${p.detail}`);
  }
  return { zeilen, samplerOk, synthOk };
}

export function berichtBootSektor(b: BootSektorBefund): string[] {
  const z = [b.ok ? "✅ Boot-Sektor brauchbar: AIS lädt die SBL nach 0x80000000 und springt hinein." : "❌ Boot-Sektor unbrauchbar."];
  z.push(...b.kommandos.map((k) => ` ${k}`));
  z.push(` SBL: ${b.sblGroesse} Bytes${b.sbl.length >= 4 ? `, beginnt ${Array.from(b.sbl.subarray(0, 4)).map((x) => x.toString(16).padStart(2, "0")).join(" ")}` : ""}`);
  z.push(` Prüfsumme: ${b.pruefsumme.gespeichert === null ? "fehlt" : hex(b.pruefsumme.gespeichert)} ${b.pruefsumme.ok ? "✓" : `≠ berechnet ${hex(b.pruefsumme.berechnet)}`}`);
  z.push(...b.hinweise.map((h) => ` ⚠ ${h}`));
  return z;
}

export function berichtFlashDump(d: FlashDumpBefund): string[] {
  const z: string[] = [];
  z.push(`Gerätestempel: ${d.userIdentitaet ? `${d.userIdentitaet} → ${d.variante === "synth" ? "electribe 2 (Synth, 0x123)" : "electribe 2 sampler (0x124)"}` : "kein Produktstempel in der User-Region"}`);
  z.push(`Firmware: ${d.system.vektorOk ? "ARM-Vektortabelle OK" : "keine ARM-Vektortabelle"}${d.system.karte ? `, ${d.system.karte}` : d.system.familie ? `, ${d.system.familie === "sampler" ? "Sampler-Bauart" : "Synth-Bauart"} (Karte nicht erkannt)` : ""}${d.mainVersion ? `, Main ${d.mainVersion.map((x) => String(x).padStart(2, "0")).join(".")}` : ""}`);
  z.push(`PCM: ${d.pcm.magicOk ? `KORG ${d.pcm.format ?? "?"}` : "kein PCM-Image (kein KORG-Magic)"}`);
  z.push(`Boot-Sektor: ${d.boot.ok ? `SBL ${d.boot.sblGroesse} Bytes${d.boot.pruefsumme.ok ? ", vanasoft-Prüfsumme OK (Custom-Bootloader)" : " (ohne vanasoft-Prüfsumme — Korg-Werks-SBL oder fremd)"}` : "unbrauchbar"}`);
  z.push("", " Sel.  Offset     Größe      Inhalt");
  for (const r of d.regionen) z.push(` ${hex(r.selektor).padStart(4)}  ${hex(r.offset).padStart(9)}  ${hex(r.groesse).padStart(9)}  ${r.name} — ${r.befund}`);
  return z;
}
