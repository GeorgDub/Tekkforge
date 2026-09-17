/**
 * geraeteBericht — ein Klick, der ganze Gerätezustand als Text: Kennungen (Stempel, Version,
 * PCM), Global (gespeichert / Werk / laufend), Pattern-Bank gegen Werksbank, Slice-Region,
 * Stimmen-Monitor und Sample-Katalog. Nur Lesen; alle Leser gibt es einzeln, hier laufen sie
 * nacheinander und schreiben Markdown. Dauer am Gerät: gut eine halbe Minute (die Pattern-Bank
 * ist der größte Posten, 4 MiB).
 */
import { liesFlashKennungen, kennungenText, probeHaeppchen, liesPatternBankVomGeraet, liesFlashKomplett, type LesenFlash } from "./geraeteFlash";
import { liesGlobalVomGeraet } from "./geraeteFlash";
import { globalBerichtZeilen, globalLiveZeile } from "./globalFlash";
import { baueWerksbank, werksbankZeile } from "./werksbank";
import { liesSqezKopfDaten, SQEZ_KOPF } from "./sqez";
import { GLOBAL_FLASH } from "./globalFlash";
import { PATTERN_BANK, patternNamenAusBank } from "./flashKarte";
import { SLICE_FLASH, sliceKarte, sliceZeile } from "./sliceFlash";
import { liesMonitor, liesSampleStandBisLeer, monitorText, sampleStandText, type Lesen } from "./geraeteMonitor";

export interface GeraeteBerichtQuellen {
  lesenFlash: LesenFlash;
  lesenRam?: Lesen;
  globalLive?: () => Promise<Uint8Array | null>;
  oszName?: (nummer: number) => string;
  fortschritt?: (schritt: string) => void;
  /** Für Tests: Häppchengröße fest statt Probe. */
  chunk?: number;
  /** Sample-Katalog: ab Index, Anzahl (Standard 500, 32). */
  samples?: { abIndex: number; anzahl: number };
}

export interface GeraeteBerichtErgebnis {
  zeilen: string[];
  /** Pattern-Bank des Geräts (e2sallpat), wenn gelesen. */
  patternBank: Uint8Array | null;
  dauerMs: number;
}

const h2 = (t: string): string => `\n## ${t}\n`;

/** Liest alles nacheinander und liefert Markdown-Zeilen; Fehler einzelner Schritte stehen im Text, brechen aber nichts ab. */
export async function erstelleGeraeteBericht(q: GeraeteBerichtQuellen, stempel = new Date().toISOString().slice(0, 16).replace("T", " ")): Promise<GeraeteBerichtErgebnis> {
  const t0 = Date.now();
  const z: string[] = [`# Gerätebericht — ${stempel}`, "", "Nur gelesen (Hacktribe 0x52/0x55, SysEx 0x51); nichts geschrieben."];
  const schritt = (s: string) => q.fortschritt?.(s);

  schritt("Kennungen");
  z.push(h2("Kennungen (Flash)"));
  const k = await liesFlashKennungen(q.lesenFlash);
  z.push(...kennungenText(k).map((s) => `- ${s}`));

  const chunk = q.chunk ?? (await probeHaeppchen(q.lesenFlash)).chunk;

  schritt("Global");
  z.push(h2("Global-Einstellungen"));
  const g = await liesGlobalVomGeraet(q.lesenFlash);
  if (g.ok) {
    z.push(...globalBerichtZeilen(g.global, true).map((s) => (s.startsWith("  ") ? `    ${s.trim()}` : `- ${s}`)));
    if (q.globalLive && g.global.gespeichert) {
      let live: Uint8Array | null = null;
      try {
        live = await q.globalLive();
      } catch {
        live = null;
      }
      z.push(`- ${globalLiveZeile(g.global.gespeichert, live)}`);
    }
  } else z.push(`- Global nicht lesbar: ${g.reason}`);

  schritt("Pattern-Bank (4 MiB)");
  z.push(h2("Pattern-Bank (Flash 0x230000) gegen Werksbank (SQEZ)"));
  let patternBank: Uint8Array | null = null;
  const pb = await liesPatternBankVomGeraet(q.lesenFlash, { chunk });
  if (pb.ok) {
    patternBank = pb.bank;
    const namen = pb.namen.filter((n) => n);
    z.push(`- ${namen.length} von 250 Slots mit Pattern; Namen 1–10: ${pb.namen.slice(0, 10).map((n) => `„${n}“`).join(", ")}`);
    const sq = await q.lesenFlash(GLOBAL_FLASH.sqez, 16);
    const kopf = sq.ok ? liesSqezKopfDaten(sq.bytes) : null;
    if (kopf?.ok && g.ok && g.global.werk) {
      const strom = await liesFlashKomplett(q.lesenFlash, { start: GLOBAL_FLASH.sqez, gesamt: Math.min(kopf.seriell + SQEZ_KOPF, 0x70000), chunk, block: 0x4000 });
      if (strom.ok) {
        const w = baueWerksbank(g.global.werk, strom.bytes, patternBank.subarray(0x100 + PATTERN_BANK.glstGroesse));
        z.push(`- ${werksbankZeile(w)}`);
        if (w.ok && w.abweichungen?.length) z.push(...w.abweichungen.map((a) => `    - Pattern ${a.nummer}: im Gerät „${a.imFlash}“${a.imFlash !== a.imWerk ? `, im Werk „${a.imWerk}“` : " (Inhalt geändert, Name gleich)"}`));
      } else z.push(`- Werksbank: SQEZ-Strom nicht lesbar (${strom.reason})`);
    } else z.push("- Werksbank: kein SQEZ-Strom oder kein Werks-Global");
  } else z.push(`- Pattern-Bank nicht lesbar: ${pb.reason}`);

  schritt("Slices");
  z.push(h2("Slice-Region (Flash 0x750000)"));
  const sl = await liesFlashKomplett(q.lesenFlash, { start: SLICE_FLASH.offset, gesamt: SLICE_FLASH.groesse, chunk });
  if (sl.ok) {
    const karte = sliceKarte(sl.bytes);
    z.push(`- ${sliceZeile(karte)}`);
    for (const r of karte.mitSlices) z.push(`    - Sample ${r.index + 1}: ${r.aktiv} Slices, ${r.schritte} Schritte, Beat ${r.beat}`);
  } else z.push(`- Slice-Region nicht lesbar: ${sl.reason}`);

  if (q.lesenRam) {
    schritt("Stimmen-Monitor");
    z.push(h2("Stimmen, Ereignisse, Batterie (RAM)"));
    try {
      const m = await liesMonitor(q.lesenRam);
      z.push(...monitorText(m, q.oszName ?? ((n) => `Osz ${n}`)).split("\n").map((s) => (s.trim() ? `    ${s}` : "")));
    } catch (e) {
      z.push(`- Monitor nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    }
    schritt("Sample-Katalog");
    const ab = q.samples?.abIndex ?? 500;
    const block = q.samples?.anzahl ?? 32;
    const st = await liesSampleStandBisLeer(q.lesenRam, ab, block, (bis) => schritt(`Sample-Katalog bis ${bis}`));
    z.push(h2(`Sample-Katalog (RAM, User-Samples ab ${ab + 1}, gelesen bis ${ab + st.stand.length})`));
    z.push(`- ${st.geladen} geladen, zusammen ${(st.bytes / 1048576).toFixed(2)} MB${st.fehler ? ` — Lesefehler: ${st.fehler}` : ""}`);
    if (st.stand.length) z.push(...sampleStandText(st.stand).split("\n").map((s) => (s.trim() ? `    ${s}` : "")));
  }

  const dauerMs = Date.now() - t0;
  z.push("", `_Dauer ${(dauerMs / 1000).toFixed(0)} s, Häppchen 0x${chunk.toString(16)}._`);
  return { zeilen: z, patternBank, dauerMs };
}

export { patternNamenAusBank };
