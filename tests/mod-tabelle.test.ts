import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  MOD_EINTRAG,
  MOD_TABELLE_ADDR_HACKTRIBE,
  decodeMod,
  modName,
  modQuelleZiel,
  liesModTabelle,
  modUmbenennen,
  modFreilaufend,
  modBpm,
  modKombinationen,
  setzeModTabelle,
  istModLeer,
} from "../src/core/modTabelle";
import { MOD_TYPEN } from "../src/core/e2ModTypen";
import { dateiOffset } from "../src/core/firmwareBau";

const hexZu = (h: string): Uint8Array => Uint8Array.from(h.replace(/\s+/g, "").match(/../g)!.map((x) => parseInt(x, 16)));
/** Ein Eintrag aus Name + den 67 Datenbytes ab +0x15 (so, wie sie in der Hacktribe-Tabelle stehen). */
const eintrag = (name: string, datenHex: string): Uint8Array => {
  const out = new Uint8Array(MOD_EINTRAG);
  for (let i = 0; i < name.length; i++) out[i] = name.charCodeAt(i);
  out.set(hexZu(datenHex), 0x15);
  return out;
};
const LFOTRI_PITCH = eintrag("LFOTri Pitch", "01 1f 4e 02 00 00 4e 00 7f 00 00 00 00 00 00 00 00 00 00 01 01 0f 00 3f 01 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00");
const LFOTRIB_PITCH = eintrag("LFOTriB Pitch", "01 47 3f 02 01 01 08 01 10 00 00 00 00 00 00 00 00 00 00 01 01 23 00 3f 01 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00");

describe("modTabelle — Eintraege", () => {
  it("dekodiert Wellenform, BPM, Ziel und Depth-Bereich", () => {
    const a = decodeMod(LFOTRI_PITCH);
    expect(a).toMatchObject({ name: "LFOTri Pitch", welle: 2, bpm: false, ziel: 1, speedVorgabe: 0x4e, speedMax: 0x7f, depthVorgabe: 0x0f, depthMin: 0, depthMax: 0x3f });
    expect(LFOTRIB_PITCH).toHaveLength(MOD_EINTRAG);
    const b = decodeMod(LFOTRIB_PITCH);
    expect(b).toMatchObject({ name: "LFOTriB Pitch", welle: 2, bpm: true, ziel: 1, speedVorgabe: 8, speedMax: 0x10 });
    expect(modQuelleZiel("SawUpB Pitch")).toEqual({ quelle: "SawUpB", ziel: "Pitch" });
    expect(() => decodeMod(new Uint8Array(3))).toThrow(/88/);
    expect(istModLeer(new Uint8Array(MOD_EINTRAG).fill(0xff))).toBe(true);
  });

  it("umbenennen, frei ↔ BPM: nur die Speed-Bytes wandern", () => {
    const u = modUmbenennen(LFOTRI_PITCH, "Tri Pitch");
    expect(modName(u)).toBe("Tri Pitch");
    expect(Array.from(u.subarray(0x15))).toEqual(Array.from(LFOTRI_PITCH.subarray(0x15)));
    expect(() => modUmbenennen(LFOTRI_PITCH, "Ä")).toThrow(/ASCII/);
    const b = modBpm(LFOTRI_PITCH, LFOTRIB_PITCH, "TriB Pitch");
    expect(decodeMod(b)).toMatchObject({ name: "TriB Pitch", bpm: true, speedVorgabe: 8, speedMax: 0x10, welle: 2, depthVorgabe: 0x0f });
    const f = modFreilaufend(LFOTRIB_PITCH, LFOTRI_PITCH, "Tri2 Pitch");
    expect(decodeMod(f)).toMatchObject({ name: "Tri2 Pitch", bpm: false, speedVorgabe: 0x4e, speedMax: 0x7f, depthVorgabe: 0x23 });
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  it.skipIf(!fs.existsSync(VSB))("echte Hacktribe-Datei: 96 Eintraege, Namen wie e2ModTypen, 36 Kombinationen, anhaengen ab 97", () => {
    const fw = new Uint8Array(fs.readFileSync(VSB));
    const t = liesModTabelle(fw);
    expect(t).toHaveLength(96);
    expect(t.map((b) => modName(b).replace(/ Osc$/, " OSC"))).toEqual([...MOD_TYPEN]);
    expect(decodeMod(t[0])).toMatchObject({ name: "EG+ Filter", ziel: 3 });
    expect(decodeMod(t[36])).toMatchObject({ name: "SawUpB Filter", welle: 0, bpm: true, ziel: 3 });
    expect(decodeMod(t[37])).toMatchObject({ name: "SawUpB Pitch", depthMin: -63, depthMax: 0 }); // „Up“ bei Pitch: Hacktribe-Bereich, wie er ist
    expect(decodeMod(t[72])).toMatchObject({ name: "SinUp Filter", welle: 6, bpm: false });
    expect(decodeMod(t[84])).toMatchObject({ name: "SinUpB Filter", welle: 6, bpm: true });
    const k = modKombinationen(t);
    expect(k.fehlend).toEqual([]);
    expect(k.eintraege).toHaveLength(36);
    expect(k.eintraege.map((e) => e.name).slice(0, 7)).toEqual(["SawUp Filter", "SawUp Pitch", "SawUp OSC", "SawUp Level", "SawUp Pan", "SawUp IFX", "SawDwn Filter"]);
    const sawUpPitch = decodeMod(k.eintraege[1].bytes);
    expect(sawUpPitch).toMatchObject({ welle: 0, bpm: false, ziel: 1, speedMax: 0x7f });
    const randomB = decodeMod(k.eintraege.find((e) => e.name === "RandomB Pitch")!.bytes);
    expect(randomB).toMatchObject({ welle: 4, bpm: true, ziel: 1, speedMax: 0x10 });
    // schon vorhandene Kombinationen werden nicht noch einmal erzeugt
    expect(modKombinationen([...t, ...k.eintraege.map((e) => e.bytes)]).eintraege).toEqual([]);
    // anhaengen ab Platz 96 (Anzeige 97)
    const r = setzeModTabelle(fw, k.eintraege.map((e, i) => ({ platz: 96 + i, bytes: e.bytes })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ anzahlVorher: 96, anzahlNachher: 132 });
    expect(liesModTabelle(r.bytes)).toHaveLength(132);
    expect(modName(liesModTabelle(r.bytes)[131])).toBe("RandomB IFX");
    // ausserhalb der Tabelle aendert sich nichts
    const von = dateiOffset(MOD_TABELLE_ADDR_HACKTRIBE);
    let anders = 0;
    for (let i = 0; i < fw.length; i++) if (fw[i] !== r.bytes[i] && (i < von + 96 * MOD_EINTRAG || i >= von + 132 * MOD_EINTRAG)) anders++;
    expect(anders).toBe(0);
    // Luecke wird abgelehnt
    expect(setzeModTabelle(fw, [{ platz: 98, bytes: k.eintraege[0].bytes }])).toMatchObject({ ok: false, reason: expect.stringMatching(/Lücke/) });
  });
});
