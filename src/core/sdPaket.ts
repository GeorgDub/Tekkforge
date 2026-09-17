/**
 * sdPaket — ein SD-Update-Paket zusammenstellen, so wie das Gerät es erwartet:
 * `KORG\<Ordner>\System\SYSTEM.VSB` (+ `PCM.VSB`, `USER.VSB`, `SLICE.VSB`, `BOOT.VSB` optional), dazu eine
 * LIESMICH mit Kopfprüfung, Länge und MD5 je Datei. Der Ordnername unter KORG hängt vom Build ab
 * (Hacktribe-Builds lesen `Hacktribe`, Stock `electribe sampler` / `electribe`); das Gerät flasht die
 * gefundenen Dateien in der Reihenfolge System → BOOT → PCM → USER → SLICE (Update-Sequenz aus der
 * Firmware, siehe vsbKopf.ts). Hier wird nur geprüft und geschrieben — nichts ans Gerät.
 */
import { pruefeVsbKopf, liesVsbKopf, type VsbArt } from "./vsbKopf";
import type { Variante } from "./crossgrade";

export interface PaketDatei {
  art: VsbArt;
  bytes: Uint8Array;
  herkunft: string;
}

export interface PaketPruefung {
  art: VsbArt;
  dateiname: string;
  ok: boolean;
  grund: string | null;
  laenge: number;
  identitaet: string;
  name: string;
}

export interface SdPaket {
  ordner: string;
  dateien: { pfad: string; bytes: Uint8Array }[];
  pruefungen: PaketPruefung[];
  liesmich: string;
  alleOk: boolean;
}

const REIHENFOLGE: VsbArt[] = ["SYSTEM", "BOOT", "PCM", "USER", "SLICE"];
const hex2 = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Prüft die Dateien gegen die Variante des Geräts und baut Pfade + LIESMICH. */
export function baueSdPaket(dateien: PaketDatei[], variante: Variante, opts: { sdOrdner?: string; stempel?: string; md5?: (b: Uint8Array) => string; identitaetQuelle?: "Gerätestempel" | "Auswahl"; hinweis?: string } = {}): SdPaket {
  const sdOrdner = opts.sdOrdner ?? "Hacktribe";
  const stempel = opts.stempel ?? new Date().toISOString().slice(0, 10);
  const basis = `SD-Update-${stempel}`;
  const sortiert = [...dateien].sort((a, b) => REIHENFOLGE.indexOf(a.art) - REIHENFOLGE.indexOf(b.art));
  const pruefungen: PaketPruefung[] = [];
  const out: SdPaket["dateien"] = [];
  for (const d of sortiert) {
    const p = pruefeVsbKopf(d.bytes, variante);
    const k = liesVsbKopf(d.bytes);
    const dateiname = `${d.art}.VSB`;
    const passtArt = p.art === d.art;
    const grund = !p.ok ? p.pruefungen.find((x) => !x.ok)?.detail ?? "Kopfprüfung nicht bestanden" : !passtArt ? `Kopf sagt ${p.art ?? "?"}, erwartet ${d.art}` : null;
    pruefungen.push({ art: d.art, dateiname, ok: p.ok && passtArt, grund, laenge: d.bytes.length, identitaet: hex2(d.bytes.subarray(0x2c, 0x2f)), name: k.name });
    out.push({ pfad: `${basis}\\KORG\\${sdOrdner}\\System\\${dateiname}`, bytes: d.bytes });
  }
  const alleOk = pruefungen.every((p) => p.ok);
  const quelle = opts.identitaetQuelle ?? "Gerätestempel";
  const dateiListe = pruefungen.map((p) => `\`${p.dateiname}\``).join(" und ");
  const z: string[] = [
    `# SD-Update-Paket — ${stempel}`,
    "",
    ...(opts.hinweis ? [opts.hinweis, ""] : []),
    `Kopiere aus diesem Ordner die Datei${pruefungen.length > 1 ? "en" : ""} ${dateiListe} nach \`KORG\\${sdOrdner}\\System\\\` auf der SD-Karte (vorhandene Dateien gleichen Namens vorher wegsichern). Einen etwaigen \`backups\\\`-Unterordner NICHT mitkopieren — er gehört nicht aufs Gerät.`,
    "Dann am Gerät: DATA UTILITY → SOFTWARE UPDATE. Das Gerät flasht in der Reihenfolge System → BOOT → PCM → USER → SLICE, fehlende Dateien werden übersprungen.",
    "Gerät am Netzteil lassen und nicht ausschalten; die Batterie-Stufe muss ≥ 2 sein (am Netzteil zählt der Listener-State).",
    "",
    `Geprüft für: ${variante === "synth" ? "electribe 2 (Synth, Identität 0x123)" : "electribe 2 sampler (Identität 0x124)"} (Variante ${quelle === "Gerätestempel" ? "aus dem Gerätestempel gelesen" : "⚠ aus der Auswahl gewählt, NICHT vom Gerät gelesen — vor dem Flashen bestätigen"}) — ${alleOk ? "alle Dateien bestehen die Kopfprüfung, das Gerät nähme sie an." : "⚠ mindestens eine Datei fällt durch (siehe Tabelle) — NICHT einspielen."}`,
    "",
    "| Datei | Kopf-Name | Identität | Länge | Prüfung | Herkunft" + (opts.md5 ? " | MD5" : "") + " |",
    "|---|---|---|---|---|---" + (opts.md5 ? "|---" : "") + "|",
  ];
  for (const [i, p] of pruefungen.entries()) {
    z.push(`| \`${p.dateiname}\` | ${p.name || "?"} | 0x${p.identitaet} | ${p.laenge} B | ${p.ok ? "✅ ok" : `❌ ${p.grund}`} | ${sortiert[i].herkunft}` + (opts.md5 ? ` | \`${opts.md5(sortiert[i].bytes)}\`` : "") + " |");
  }
  z.push("", "Rückweg: Boot-Kombi LPF+HPF beim Einschalten öffnet den Update-Bildschirm ohne PCM-Ladung. Sicherungen (kompletter Flash, Boot-Sektor, Regionen) liegen in `Downloads\\TekkForge\\Firmware`.", "", "Nach dem Update in TekkForge „Gerätebericht (alles lesen)“ ausführen und Kennungen/PCM-Kopf vergleichen.");
  return { ordner: basis, dateien: out, pruefungen, liesmich: z.join("\n") + "\n", alleOk };
}
