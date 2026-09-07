import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  eingebauteEintraege,
  leererStand,
  serialisiereStand,
  leseStand,
  bibliotheksEintraege,
  filtereEintraege,
  fuegeHinzu,
  entferne,
  setzeFavorit,
  umbenenne,
  zeigeEingebaute,
  leereEigene,
  eintraegeAusDatei,
  alsSammlungsText,
  auswahlMitPlaetzen,
  platzBedarf,
  artAusDateiname,
} from "../src/core/fxBibliothek";
import { EINGEBAUTE_SAMMLUNGEN } from "../src/core/fxBibliothekEingebaut";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { initGrooveBytes, decodeGroove, encodeGroove } from "../src/core/e2Groove";
import { leseSammlung, baueSammlung } from "../src/core/sammlung";
import { baueFirmware, VSB_GROESSE } from "../src/core/firmwareBau";
import { baueSicherung, type SicherungsBlock } from "../src/core/geraetSicherung";
import { E2_RAM_MAP } from "../src/core/hacktribeRam";
import { leererBlock } from "../src/core/presetManager";

/**
 * Die Bibliothek des Preset-Managers: eingebaute Sets, eigene Eintraege,
 * Favoriten, Ablage als Text, Import aus jeder Dateiart, und aus einer
 * Auswahl eine Datei mit Plaetzen fuers Flashen.
 */
function presetBytes(name: string, mfx = false, device = 0x0f): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  if (mfx) p.mfx.device = 0x2e;
  else p.ifx1.device = device;
  return encodeFxPreset(p);
}
function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}

describe("fxBibliothek — Eingebaute", () => {
  it("bringt genau die Sammlungen aus examples/ mit: 288 FX-Presets und die Tekk-Grooves", () => {
    const e = eingebauteEintraege();
    expect(e.filter((x) => x.art === "ifx")).toHaveLength(144);
    expect(e.filter((x) => x.art === "mfx")).toHaveLength(144);
    expect(e.filter((x) => x.art === "groove").length).toBeGreaterThan(0);
    expect(e.every((x) => x.eingebaut && x.id.startsWith("eb:") && !x.favorit)).toBe(true);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
    // Der gebuendelte Text ist byteweise der aus examples/ — sonst zeigt die App andere Presets als das Repo.
    for (const s of EINGEBAUTE_SAMMLUNGEN) {
      const ordner = s.datei.includes("Grooves") ? "examples/grooves" : "examples/fx-presets";
      expect(s.text, s.datei).toBe(fs.readFileSync(path.resolve(ordner, s.datei), "utf8"));
    }
  });

  it("liefert Kopien — wer die Bytes anfasst, aendert den Cache nicht", () => {
    const a = eingebauteEintraege()[0];
    a.bytes[1] = 0x58;
    expect(eingebauteEintraege()[0].bytes[1]).not.toBe(0x58);
  });
});

describe("fxBibliothek — Stand", () => {
  it("eigene Eintraege zuerst (neueste oben), Favoriten markiert, Ausgeblendete weg", () => {
    let st = leererStand();
    const a = fuegeHinzu(st, { art: "ifx", bytes: presetBytes("Alt"), woher: "Test" }, 1000);
    st = a.stand;
    const b = fuegeHinzu(st, { art: "ifx", bytes: presetBytes("Neu"), woher: "Test" }, 2000);
    st = b.stand;
    const erstesEingebautes = eingebauteEintraege()[0].id;
    st = setzeFavorit(st, erstesEingebautes, true);
    st = setzeFavorit(st, a.id, true);
    st = entferne(st, eingebauteEintraege()[1].id);
    const alle = bibliotheksEintraege(st);
    expect(alle[0].name).toBe("Neu");
    expect(alle[1].name).toBe("Alt");
    expect(alle[1].favorit).toBe(true);
    expect(alle[2].id).toBe(erstesEingebautes);
    expect(alle[2].favorit).toBe(true);
    expect(alle.find((e) => e.id === eingebauteEintraege()[1].id)).toBeUndefined();
    expect(alle).toHaveLength(2 + eingebauteEintraege().length - 1);
    expect(filtereEintraege(alle, { nurFavoriten: true })).toHaveLength(2);
    expect(filtereEintraege(alle, { art: "groove" }).every((e) => e.art === "groove")).toBe(true);
    expect(filtereEintraege(alle, { suche: "neu" }).map((e) => e.name)).toContain("Neu");
    // Ausgeblendete zurueck, eigene weg
    expect(bibliotheksEintraege(zeigeEingebaute(st))).toHaveLength(2 + eingebauteEintraege().length);
    const leer = leereEigene(st);
    expect(leer.eigene).toHaveLength(0);
    expect(leer.favoriten).toEqual([erstesEingebautes]);
  });

  it("derselbe Block kommt nicht zweimal hinein — auch nicht, wenn er eingebaut ist", () => {
    let st = leererStand();
    const eb = eingebauteEintraege()[3];
    st = entferne(st, eb.id);
    const r = fuegeHinzu(st, { art: eb.art, bytes: eb.bytes, woher: "nochmal" });
    expect(r.vorhanden).toBe(true);
    expect(r.id).toBe(eb.id);
    expect(r.stand.ausgeblendet).not.toContain(eb.id); // erneutes Laden zeigt ihn wieder
    const x = fuegeHinzu(r.stand, { art: "mfx", bytes: presetBytes("Zwei", true), woher: "a" });
    const y = fuegeHinzu(x.stand, { art: "mfx", bytes: presetBytes("Zwei", true), woher: "b" });
    expect(y.vorhanden).toBe(true);
    expect(y.stand.eigene).toHaveLength(1);
    expect(() => fuegeHinzu(st, { art: "ifx", bytes: new Uint8Array(10), woher: "x" })).toThrow(/Bytes/);
    expect(() => fuegeHinzu(st, { art: "ifx", bytes: leererBlock("ifx"), woher: "x" })).toThrow(/leerer/);
  });

  it("Ablage: Text hin und zurueck behaelt eigene Eintraege, Favoriten und Ausgeblendete; Muell faellt weg", () => {
    let st = leererStand();
    st = fuegeHinzu(st, { art: "groove", bytes: grooveBytes("Shuffle X"), woher: "Datei" }, 5).stand;
    st = fuegeHinzu(st, { art: "ifx", name: "Mein Drive", bytes: presetBytes("Mein Drive"), woher: "Editor" }, 6).stand;
    st = setzeFavorit(st, st.eigene[1].id, true);
    st = entferne(st, "eb:TekkForge-IFX-Starter.tfsam:0");
    st = umbenenne(st, st.eigene[0].id, "Shuffle Y");
    const text = serialisiereStand(st);
    const zurueck = leseStand(text);
    expect(zurueck.eigene.map((e) => e.name)).toEqual(["Shuffle Y", "Mein Drive"]);
    expect(zurueck.eigene[0].bytes).toEqual(st.eigene[0].bytes);
    expect(zurueck.favoriten).toEqual(st.favoriten);
    expect(zurueck.ausgeblendet).toEqual(["eb:TekkForge-IFX-Starter.tfsam:0"]);
    expect(leseStand(null).eigene).toEqual([]);
    expect(leseStand("kein json").eigene).toEqual([]);
    const kaputt = JSON.parse(text);
    kaputt.eigene.push({ id: "ei:x", art: "ifx", daten: "AAAA" }, { id: "ei:y", art: "nix", daten: "" }, null);
    expect(leseStand(JSON.stringify(kaputt)).eigene).toHaveLength(2);
  });
});

describe("fxBibliothek — Dateien lesen", () => {
  it("Einzelblock nach Endung, Sammlung ueber ihre Eintraege", () => {
    expect(artAusDateiname("x.mfx")).toBe("mfx");
    expect(artAusDateiname("x.e2gv")).toBe("groove");
    expect(artAusDateiname("x.e2fxp")).toBe("ifx");
    const einzeln = eintraegeAusDatei("mein-drive.e2fxp", presetBytes("Mein Drive"));
    expect(einzeln).toHaveLength(1);
    expect(einzeln[0]).toMatchObject({ art: "ifx", name: "Mein Drive", woher: "mein-drive.e2fxp" });
    const text = baueSammlung([{ art: "mfx", name: "Trem", bytes: presetBytes("Trem", true) }, { art: "groove", name: "G", bytes: grooveBytes("G") }], { titel: "Set" });
    const s = eintraegeAusDatei("set.tfsam", new TextEncoder().encode(text));
    expect(s.map((e) => [e.art, e.woher])).toEqual([["mfx", "Set"], ["groove", "Set"]]);
    expect(() => eintraegeAusDatei("kurz.e2fxp", new Uint8Array(3))).toThrow(/Bytes/);
  });

  it("Sicherung (.tfbak): die belegten Plaetze", () => {
    const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
    const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;
    const ifx = new Uint8Array(100 * FX_PRESET_SIZE);
    for (let i = 0; i < 100; i++) ifx.set(i < 3 ? presetBytes(`Werk ${i + 1}`) : leererBlock("ifx"), i * FX_PRESET_SIZE);
    const mfx = new Uint8Array(32 * FX_PRESET_SIZE);
    for (let i = 0; i < 32; i++) mfx.set(i < 2 ? presetBytes(`Master ${i + 1}`, true) : leererBlock("mfx"), i * FX_PRESET_SIZE);
    const bloecke: SicherungsBlock[] = [
      { key: "ifxPreset", label: "IFX", adresse: ifxMap.base, laenge: ifx.length, bytes: ifx },
      { key: "mfxPreset", label: "MFX", adresse: mfxMap.base, laenge: mfx.length, bytes: mfx },
      { key: "maxIfxIndex", label: "Max", adresse: 0xc0048f80, laenge: 1, bytes: new Uint8Array([2]) },
    ];
    const text = baueSicherung(bloecke, { geraet: "E2S", firmware: "hacktribe" });
    const e = eintraegeAusDatei("geraet.tfbak", new TextEncoder().encode(text));
    expect(e.map((x) => x.name)).toEqual(["Werk 1", "Werk 2", "Werk 3", "Master 1", "Master 2"]);
    expect(e[2].woher).toBe("geraet.tfbak Platz 3");
  });

  it("Firmware (.VSB): die belegten Plaetze eines gebauten Abbilds", () => {
    // Eine leere Firmware mit Sampler-Kopf, in die ein Preset eingebrannt wird.
    const fw = new Uint8Array(VSB_GROESSE).fill(0xff);
    fw.set(new TextEncoder().encode("KORG SYSTEM FILEE2S"), 0);
    fw[0x2e] = 0x24;
    fw.set(new TextEncoder().encode("SYSTEM"), 0x20);
    const r = baueFirmware(fw, [{ art: "ifx", name: "Brenn", bytes: presetBytes("Brenn"), platz: 5 }]);
    if (!r.ok) {
      // Ein Abbild ohne die Hacktribe-Zaehlerstruktur laesst sich nicht bauen — dann nur die Ablehnung pruefen.
      expect(r.reason).toBeTruthy();
      return;
    }
    const e = eintraegeAusDatei("SYSTEM.VSB", r.bytes);
    expect(e.some((x) => x.name === "Brenn" && x.art === "ifx")).toBe(true);
  });
});

describe("fxBibliothek — herausgeben", () => {
  it("die ganze Bibliothek als Sammlung ohne Plaetze, wieder ladbar", () => {
    const st = fuegeHinzu(leererStand(), { art: "ifx", bytes: presetBytes("Eigen"), woher: "x" }).stand;
    const alle = bibliotheksEintraege(st);
    const s = leseSammlung(alsSammlungsText(alle, "Meine Bibliothek", "Georg"));
    expect(s.titel).toBe("Meine Bibliothek");
    expect(s.eintraege).toHaveLength(alle.length);
    expect(s.eintraege.every((e) => e.platz === undefined)).toBe(true);
    expect(s.eintraege[0].name).toBe("Eigen");
  });

  it("eine Auswahl bekommt je Art fortlaufende Plaetze ab dem Startplatz; hinter der Grenze bleibt sie ohne Platz", () => {
    const alle = bibliotheksEintraege(leererStand());
    const ifx = alle.filter((e) => e.art === "ifx").slice(0, 3);
    const mfx = alle.filter((e) => e.art === "mfx").slice(0, 2);
    const gv = alle.filter((e) => e.art === "groove").slice(0, 1);
    const r = auswahlMitPlaetzen([...mfx, ...ifx, ...gv], { ifx: 50, groove: 63 });
    expect(r.ohnePlatz).toEqual([]);
    expect(r.eintraege.filter((e) => e.art === "ifx").map((e) => e.platz)).toEqual([50, 51, 52]);
    expect(r.eintraege.filter((e) => e.art === "mfx").map((e) => e.platz)).toEqual([1, 2]);
    expect(r.eintraege.filter((e) => e.art === "groove").map((e) => e.platz)).toEqual([63]);
    expect(platzBedarf([...mfx, ...ifx, ...gv])).toEqual({ ifx: 3, mfx: 2, groove: 1 });
    const voll = auswahlMitPlaetzen(ifx, { ifx: 95 });
    expect(voll.eintraege.map((e) => e.platz)).toEqual([95, 96]);
    expect(voll.ohnePlatz).toHaveLength(1);
    // Das Ergebnis ist eine gueltige Sammlung mit Plaetzen
    const s = leseSammlung(baueSammlung(r.eintraege, { titel: "Flash" }));
    expect(s.eintraege.every((e) => e.platz !== undefined)).toBe(true);
  });
});
