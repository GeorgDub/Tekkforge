/**
 * kiPlaner — Prompt, JSON-Schema und Antwort-Auswertung fuer das Claude-
 * Rezept. Claude bekommt eine kompakte Projekt-Zusammenfassung plus die
 * Beschreibung und liefert genau das Rezept-JSON; pruefeRezept macht aus
 * jeder Antwort ein gueltiges Rezept. Kein Netz hier — der Aufruf laeuft im
 * Electron-Main-Prozess (electron/main.cjs, "ki:rezept").
 */
import type { Projekt } from "./bankPlan";
import { type Rezept, pools, meloKandidaten, pruefeRezept, regelRezept, KICK_FIGUREN, BASS_FIGUREN, STAB_FIGUREN, LAGEN } from "./rezept";

export const KI_MODELL_STANDARD = "claude-opus-5";

const STRING = { type: "string" };
// Kardinalitaeten (genau 2, 1–8, 1–5) prueft pruefeRezept — output_config.format erlaubt kein minItems/maxItems/minimum/maximum
const STRING_PAAR = { type: "array", items: STRING };

/** JSON-Schema des Rezepts (output_config.format). Optionale Thema-Felder duerfen leer bleiben. */
export const REZEPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["modus", "bpm", "begruendung", "thema", "abschnitte", "figuren"],
  properties: {
    modus: { type: "string", enum: ["jam", "miniset"] },
    bpm: { type: "number" },
    begruendung: STRING,
    thema: {
      type: "object",
      additionalProperties: false,
      required: ["kickFamilie", "snare", "hats"],
      properties: {
        melo: STRING, vers: STRING, kickFamilie: STRING, snare: STRING, clap: STRING, hats: STRING_PAAR,
        percs: STRING_PAAR, bass: STRING, stab: STRING, shots: STRING_PAAR, riser: STRING,
      },
    },
    abschnitte: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "wiederholungen", "intensitaet", "kick", "lagen"],
        properties: {
          name: STRING,
          wiederholungen: { type: "integer" },
          intensitaet: { type: "integer" },
          kick: { type: "string", enum: KICK_FIGUREN },
          lagen: { type: "array", items: { type: "string", enum: LAGEN } },
        },
      },
    },
    figuren: {
      type: "object",
      additionalProperties: false,
      required: ["bass", "stab", "hatsOffbeat"],
      properties: {
        bass: { type: "string", enum: BASS_FIGUREN },
        stab: { type: "string", enum: STAB_FIGUREN },
        hatsOffbeat: { type: "boolean" },
      },
    },
  },
};

/** Kompakte Projekt-Zusammenfassung: was es gibt, mit Namen, Takten, Sekunden, Pegel. */
export function projektZusammenfassung(p: Projekt): string {
  const pl = pools(p);
  const z = (s: { name: string; takte: number; sekunden: number; rmsDb: number }) =>
    `"${s.name}"${s.takte ? ` ${s.takte} Takte` : ` ${s.sekunden.toFixed(2)} s`} ${s.rmsDb.toFixed(0)} dB`;
  const zeilen: string[] = [];
  zeilen.push(`Tempo-Vorschlag: ${p.bpm} BPM. Samples gesamt: ${p.samples.length}.`);
  zeilen.push(`Kick-Familien (Name: Kicks): ${pl.familien.map((f) => `${f.name}: ${f.kicks.map((k) => `"${k.name}"`).join(", ")}`).join("; ") || "keine"}`);
  zeilen.push(`Snares: ${pl.snares.map(z).join(", ") || "keine"}`);
  zeilen.push(`Claps: ${pl.claps.map(z).join(", ") || "keine"}`);
  zeilen.push(`Hats geschlossen: ${pl.hatsClosed.map(z).join(", ") || "keine"}; Hats offen: ${pl.hatsOpen.map(z).join(", ") || "keine"}`);
  zeilen.push(`Percs/Tons: ${pl.percs.slice(0, 24).map(z).join(", ") || "keine"}${pl.percs.length > 24 ? " …" : ""}`);
  zeilen.push(`Baesse: ${pl.basses.map(z).join(", ") || "keine (dann Kick eine Oktave tiefer)"}`);
  zeilen.push(`Stabs (Tons/Phrasen): ${pl.stabs.slice(0, 24).map(z).join(", ") || "keine"}`);
  zeilen.push(`Melodien (Loops): ${meloKandidaten(pl).map(z).join(", ") || "keine"}`);
  zeilen.push(`Vocal-Loops: ${pl.voxLoops.filter((v) => v.chunk === undefined || v.chunk === 0).map(z).join(", ") || "keine"}`);
  zeilen.push(`Vocal-Shots: ${pl.voxShots.slice(0, 24).map(z).join(", ") || "keine"}`);
  zeilen.push(`FX-Shots: ${pl.fxShots.map(z).join(", ") || "keine"}; FX-Loops (Riser): ${pl.fxLoops.map(z).join(", ") || "keine"}`);
  return zeilen.join("\n");
}

export function promptFuer(
  p: Projekt,
  wunsch: { modus: "jam" | "miniset"; bpm: number; beschreibung: string; melo?: string },
): { system: string; user: string } {
  const system = [
    "Du planst Hardtekk-/Tekk-Patterns fuer den KORG Electribe 2 Sampler. Du bekommst die Samples einer Bank",
    "(Namen sind exakt zu uebernehmen) und eine Beschreibung des Nutzers. Du lieferst ein Rezept-JSON, nichts anderes.",
    "",
    "Parts am Geraet: 1 Kick A, 2 Kick B, 3 Snare, 4 Clap, 5 Hat geschlossen, 6 Hat offen, 7/8 Perc, 9 Bass, 10 Stab,",
    "11 Shot A, 12 Shot B/Riser, 13/14 Melodie, 15/16 Vocal-Loop oder zweite Melodie. Ein Pattern hat 4 Takte.",
    `Kick-Figuren: ${KICK_FIGUREN.join(", ")} (vier = gerade Viertel, hart = mit Vorschlag auf 4+, roll = Wirbel im 4. Takt, galopp = Offbeat-Doppel).`,
    `Bass-Figuren: ${BASS_FIGUREN.join(", ")} (off = Offbeat-Achtel, roll = letzter Takt Achtel, acht = durchgehend Achtel).`,
    `Stab-Figuren: ${STAB_FIGUREN.join(", ")} (ruhig = alle 2 Takte, stab = auf 2 und 4, arp = Sechzehntel-Arpeggio, frage = Frage-Antwort).`,
    `Lagen je Abschnitt: ${LAGEN.join(", ")}. Intensitaet 1 = nur Kick+Hat, 3 = + Snare/Hat offen, 5 = alles.`,
    "",
    "Regeln: modus 'jam' = genau EIN Abschnitt mit allem, was gut zusammen klingt. modus 'miniset' = 4–8 Abschnitte",
    "als Spannungsbogen (z. B. INTRO, AUFBAU, DROP 1, BREAK, DROP 2, OUTRO) mit Wiederholungen 1–8.",
    "Nimm Melodie und Vocal-Loop aus der Liste, passe Kick-Familie und Figuren zur Beschreibung. Wenn der Nutzer",
    "nichts Bestimmtes sagt, waehle musikalisch sinnvoll (laute Kicks zu dichten Melodien, ruhigere zu Vocals).",
    "Die Begruendung: zwei kurze deutsche Saetze, warum diese Wahl.",
  ].join("\n");
  const user = [
    `Modus: ${wunsch.modus}. Tempo: ${wunsch.bpm} BPM (uebernehmen).${wunsch.melo ? ` Gewuenschte Melodie: "${wunsch.melo}".` : ""}`,
    `Beschreibung des Nutzers: ${wunsch.beschreibung.trim() || "(keine — waehle selbst)"}`,
    "",
    "Bank:",
    projektZusammenfassung(p),
  ].join("\n");
  return { system, user };
}

/** Antworttext (JSON) → geprueftes Rezept; Parse-Fehler → Regel-Rezept mit Korrektur. */
export function antwortZuRezept(text: string, p: Projekt): { rezept: Rezept; korrekturen: string[] } {
  let roh: unknown;
  try {
    const start = text.indexOf("{");
    const ende = text.lastIndexOf("}");
    roh = JSON.parse(start >= 0 && ende > start ? text.slice(start, ende + 1) : text);
  } catch {
    return { rezept: regelRezept(p, { modus: "jam" }), korrekturen: ["KI-Antwort war kein JSON → Regel-Planer"] };
  }
  return pruefeRezept(roh, p);
}
