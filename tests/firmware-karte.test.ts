import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  erkenneKarte,
  KARTEN,
  KARTE_HACKTRIBE,
  KARTE_SAMPLER_STOCK,
  KARTE_SYNTH_STOCK,
  IFX_ZAEHLER_SYNTH,
  dateiOffset,
  ramAdresse,
  leseZaehler,
  presetOffset,
  presetPlaetze,
  presetName,
  grooveOffset,
  karteLabel,
  presetBlockMitName,
  HACKTRIBE_SHA256,
  SAMPLER_STOCK_SHA256,
  SYNTH_STOCK_SHA256,
} from "../src/core/firmwareKarte";
import { VSB_TOTAL, VARIANTEN, OFF_ID_LOW, OFF_SUFFIX, OFF_TAG } from "../src/core/crossgrade";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import { leseLdrKette } from "../src/core/dspPatch";
import { decodeOsz } from "../src/core/oszTabelle";
import { modName } from "../src/core/modTabelle";
import { freigabe } from "../src/core/firmwareFreigabe";
import { firmwareOrdner, firmwareDatei } from "./helpers/firmwareDateien";

const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};

/** Drei gueltige Stock-IFX-Zeiger (auf Bloecke mit Kategorie 0 und Namen) — so unterscheidet sich Stock von Hacktribe. */
function stockZeiger(b: Uint8Array, k: typeof KARTE_SAMPLER_STOCK): void {
  for (let s = 0; s < 3; s++) {
    const block = 0x150000 + s * 0x20c;
    asc(b, block + 1, ["Punch", "Overdrive", "Distortion"][s]);
    const ram = block - 0x100 + 0xc0000000;
    const z = dateiOffset(k.ifxZeiger!.addr) + 4 * s;
    b[z] = ram & 0xff;
    b[z + 1] = (ram >>> 8) & 0xff;
    b[z + 2] = (ram >>> 16) & 0xff;
    b[z + 3] = (ram >>> 24) & 0xff;
  }
}

/** Ein Abbild mit Kopf, den Init-Bloecken der gewuenschten Familie und (Stock) den Zeigern. */
function abbild(familie: "sampler" | "synth", kopf: "sampler" | "synth" = familie): Uint8Array {
  const b = new Uint8Array(VSB_TOTAL);
  asc(b, 0, "KORG SYSTEM FILE");
  asc(b, 0x10, kopf === "sampler" ? "E2S" : "E2");
  asc(b, OFF_TAG, "SYSTEM");
  b[0x2d] = 0x01;
  b[OFF_ID_LOW] = VARIANTEN[kopf].idLow;
  b[OFF_SUFFIX] = VARIANTEN[kopf].suffix;
  const k = familie === "sampler" ? KARTE_SAMPLER_STOCK : KARTE_SYNTH_STOCK;
  asc(b, dateiOffset(k.initPattern), "PTST");
  asc(b, dateiOffset(k.initPattern) + 0x3c00 - 4, "PTED");
  asc(b, dateiOffset(k.initGlobal), "GLST");
  asc(b, dateiOffset(k.initGlobal) + 0xfc, "GLED");
  stockZeiger(b, k);
  return b;
}

describe("firmwareKarte — Erkennung", () => {
  it("Sampler-Layout ohne Hacktribe-Baenke ist die Stock-Karte", () => {
    const r = erkenneKarte(abbild("sampler"));
    expect(r.ok && r.karte.id).toBe("sampler-stock");
    expect(r.ok && r.hacktribe).toBe(false);
    expect(r.ok && r.umgekoepft).toBe(false);
  });

  it("ohne gültige Stock-Zeiger ist ein Sampler-Layout Hacktribe — auch mit leerem Slot 1 und leerer Groove-Bank", () => {
    const h = abbild("sampler");
    // Zeiger zerstoeren: Hacktribe hat dort Bank-Inhalt
    h.fill(0, dateiOffset(KARTE_SAMPLER_STOCK.ifxZeiger!.addr), dateiOffset(KARTE_SAMPLER_STOCK.ifxZeiger!.addr) + 12);
    const r = erkenneKarte(h);
    expect(r.ok && r.karte.id).toBe("hacktribe");
    expect(presetBlockMitName(new Uint8Array(0x20c))).toBe(false);
    const ok = new Uint8Array(0x20c);
    asc(ok, 1, "Punch");
    expect(presetBlockMitName(ok)).toBe(true);
    ok[0] = 0x40;
    expect(presetBlockMitName(ok)).toBe(false);
  });

  it("Name in Slot 0 der flachen IFX-Bank oder GVST in der Groove-Bank → Hacktribe", () => {
    const a = abbild("sampler");
    a[dateiOffset(KARTE_HACKTRIBE.ifxBank!.base) + 1] = 0x50; // "P"
    expect(erkenneKarte(a).ok && (erkenneKarte(a) as { karte: { id: string } }).karte.id).toBe("hacktribe");
    const g = abbild("sampler");
    asc(g, dateiOffset(KARTE_HACKTRIBE.grooveBank!.base), "GVST");
    const r = erkenneKarte(g);
    expect(r.ok && r.karte.id).toBe("hacktribe");
    expect(r.ok && r.hacktribe).toBe(true);
  });

  it("Synth-Layout wird am Payload erkannt — auch mit Sampler-Kopf (umgeköpft)", () => {
    const r = erkenneKarte(abbild("synth"));
    expect(r.ok && r.karte.id).toBe("synth-stock");
    expect(r.ok && r.umgekoepft).toBe(false);
    const x = erkenneKarte(abbild("synth", "sampler"));
    expect(x.ok && x.karte.id).toBe("synth-stock");
    expect(x.ok && x.kopfVariante).toBe("sampler");
    expect(x.ok && x.umgekoepft).toBe(true);
    expect(x.ok && karteLabel(x)).toMatch(/umgeköpft auf electribe 2 sampler/);
  });

  it("lehnt falsche Größe, fehlendes Magic und unbekanntes Layout ab — der Tag ist Sache der Freigabe", () => {
    expect(erkenneKarte(new Uint8Array(10)).ok).toBe(false);
    const m = abbild("sampler");
    m[0] = 0x58;
    expect(erkenneKarte(m).ok).toBe(false);
    const t = abbild("sampler");
    asc(t, OFF_TAG, "PCM\0\0\0");
    expect(erkenneKarte(t).ok).toBe(true);
    const leer = abbild("sampler");
    leer.fill(0, dateiOffset(KARTE_SAMPLER_STOCK.initPattern), dateiOffset(KARTE_SAMPLER_STOCK.initPattern) + 4);
    const r = erkenneKarte(leer);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/unbekanntes Layout/);
  });
});

describe("firmwareKarte — Karten", () => {
  it("Hacktribe-Karte trägt die bisherigen Adressen byte-genau", () => {
    expect(KARTE_HACKTRIBE.ifxBank).toEqual({ base: 0xc00a80f0, stride: 0x20c, count: 100 });
    expect(KARTE_HACKTRIBE.mfxBank).toEqual({ base: 0xc00b4f30, stride: 0x20c, count: 32 });
    expect(KARTE_HACKTRIBE.grooveBank).toEqual({ base: 0xc0143b00, stride: 0x140, count: 96 });
    expect(KARTE_HACKTRIBE.ifxZaehler).toBe(IFX_ZAEHLER);
    expect(dateiOffset(KARTE_HACKTRIBE.initPattern)).toBe(0xd0058);
    expect(dateiOffset(KARTE_HACKTRIBE.initGlobal)).toBe(0xcff58);
    expect(dateiOffset(KARTE_HACKTRIBE.splash!)).toBe(0xf9954);
    expect(KARTE_HACKTRIBE.ldrStart).toBe(0xf9f10);
    expect(KARTE_HACKTRIBE.sha256).toBe(HACKTRIBE_SHA256);
    expect(KARTE_SAMPLER_STOCK.sha256).toBe(SAMPLER_STOCK_SHA256);
    expect(KARTE_SYNTH_STOCK.sha256).toBe(SYNTH_STOCK_SHA256);
  });

  it("Synth-Karte: Datei-Offsets aus den Probes, kein Startbild, nicht erweiterbar", () => {
    expect(dateiOffset(KARTE_SYNTH_STOCK.initPattern)).toBe(0xba9b0);
    expect(dateiOffset(KARTE_SYNTH_STOCK.initGlobal)).toBe(0xba8b0);
    expect(dateiOffset(KARTE_SYNTH_STOCK.ifxZeiger!.addr)).toBe(0x98a8c);
    expect(dateiOffset(KARTE_SYNTH_STOCK.mfxZeiger!.addr)).toBe(0x99e88);
    expect(dateiOffset(KARTE_SYNTH_STOCK.oszTabelle!.base)).toBe(0xc14e8);
    expect(dateiOffset(KARTE_SYNTH_STOCK.modTabelle!.base)).toBe(0xc1f68);
    expect(KARTE_SYNTH_STOCK.splash).toBeUndefined();
    expect(KARTE_SYNTH_STOCK.ifxErweiterbar).toBe(false);
    expect(KARTE_SYNTH_STOCK.ifxZaehlerVollstaendig).toBe(true);
    expect(IFX_ZAEHLER_SYNTH.length).toBe(13);
    expect(dateiOffset(IFX_ZAEHLER_SYNTH[3].addr)).toBe(0x443f8);
    expect(dateiOffset(IFX_ZAEHLER_SYNTH[0].addr)).toBe(0x39cfc);
    expect(ramAdresse(dateiOffset(0xc0012345))).toBe(0xc0012345);
    expect(KARTE_SYNTH_STOCK.patternEndung).toBe(".e2pat");
    expect(KARTE_SYNTH_STOCK.sdOrdner).toBe("KORG/electribe/System");
  });

  it("Plätze: Bank direkt, Zeigertabelle über die Bytes, Groove nur bei Hacktribe", () => {
    expect(presetOffset(KARTE_HACKTRIBE, new Uint8Array(0), "ifx", 3)).toBe(dateiOffset(0xc00a80f0 + 3 * 0x20c));
    expect(presetOffset(KARTE_HACKTRIBE, new Uint8Array(0), "ifx", 100)).toBeNull();
    expect(presetPlaetze(KARTE_HACKTRIBE, "ifx")).toBe(100);
    expect(presetPlaetze(KARTE_SAMPLER_STOCK, "ifx")).toBe(38);
    expect(presetPlaetze(KARTE_SYNTH_STOCK, "mfx")).toBe(32);
    const b = abbild("sampler");
    const zeigerOff = dateiOffset(KARTE_SAMPLER_STOCK.ifxZeiger!.addr);
    // Zeiger 0 → RAM 0xC00A8790
    b[zeigerOff] = 0x90;
    b[zeigerOff + 1] = 0x87;
    b[zeigerOff + 2] = 0x0a;
    b[zeigerOff + 3] = 0xc0;
    expect(presetOffset(KARTE_SAMPLER_STOCK, b, "ifx", 0)).toBe(dateiOffset(0xc00a8790));
    expect(presetOffset(KARTE_SAMPLER_STOCK, b, "ifx", 1)).toBe(dateiOffset(0xc0000000 + 0x150000 - 0x100 + 0x20c)); // aus stockZeiger()
    expect(presetOffset(KARTE_SAMPLER_STOCK, b, "ifx", 3)).toBeNull(); // Zeiger 0 → ungültig
    expect(presetOffset(KARTE_SAMPLER_STOCK, b, "ifx", 38)).toBeNull();
    expect(grooveOffset(KARTE_SAMPLER_STOCK, 0)).toBeNull();
    expect(grooveOffset(KARTE_HACKTRIBE, 95)).toBe(dateiOffset(0xc0143b00 + 95 * 0x140));
    expect(grooveOffset(KARTE_HACKTRIBE, 96)).toBeNull();
    const blk = new Uint8Array(0x20c);
    asc(blk, 1, "Punch");
    expect(presetName(blk)).toBe("Punch");
  });

  it("leseZaehler: stimmig, widersprüchlich, leer", () => {
    const b = new Uint8Array(VSB_TOTAL);
    for (const z of IFX_ZAEHLER_SYNTH) b[dateiOffset(z.addr)] = z.plusEins ? 38 : 37;
    expect(leseZaehler(b, IFX_ZAEHLER_SYNTH)).toEqual({ ok: true, maxIndex: 37 });
    b[dateiOffset(IFX_ZAEHLER_SYNTH[5].addr)] = 40;
    const r = leseZaehler(b, IFX_ZAEHLER_SYNTH);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/widersprechen/);
    expect(leseZaehler(b, []).ok).toBe(false);
  });
});

/**
 * Gegenprobe an den echten Abbildern — nur, wenn sie lokal liegen (sie sind
 * Korg-Eigentum und nie im Repo). Ordner: TEKKFORGE_FIRMWARE_DIR oder
 * ../omnitribe/vendor/firmware.
 */
describe.skipIf(!firmwareOrdner())("firmwareKarte — echte Abbilder", () => {
  const laden = (name: string): Uint8Array | null => {
    const p = firmwareDatei(name);
    return p && existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  };
  const faelle: { datei: string; id: keyof typeof KARTEN; ifxMax: number }[] = [
    { datei: "stock_e2s_v202.vsb", id: "sampler-stock", ifxMax: 37 },
    { datei: "stock_e2synth_v202.vsb", id: "synth-stock", ifxMax: 37 },
    { datei: "hacktribe-2_SYSTEM.vsb", id: "hacktribe", ifxMax: 48 },
  ];
  for (const f of faelle) {
    it(`${f.datei}: Karte ${f.id}, Zähler, Preset-Namen, Tabellen, DSP-Kette`, () => {
      const fw = laden(f.datei);
      if (!fw) return;
      const r = erkenneKarte(fw);
      expect(r.ok && r.karte.id).toBe(f.id);
      expect(r.ok && r.umgekoepft).toBe(false);
      const k = KARTEN[f.id];
      expect(leseZaehler(fw, k.ifxZaehler)).toEqual({ ok: true, maxIndex: f.ifxMax });
      if (k.grooveZaehler) expect(leseZaehler(fw, k.grooveZaehler)).toEqual({ ok: true, maxIndex: 61 });
      const ifx0 = presetOffset(k, fw, "ifx", 0)!;
      expect(presetName(fw.subarray(ifx0, ifx0 + 0x20c))).toBe("Punch");
      const ifxLetzter = presetOffset(k, fw, "ifx", 37)!;
      expect(presetName(fw.subarray(ifxLetzter, ifxLetzter + 0x20c))).toBe("Slicer");
      const mfx0 = presetOffset(k, fw, "mfx", 0)!;
      expect(presetName(fw.subarray(mfx0, mfx0 + 0x20c))).toBe("Mod Delay");
      const mfx31 = presetOffset(k, fw, "mfx", 31)!;
      expect(presetName(fw.subarray(mfx31, mfx31 + 0x20c))).toBe(f.id === "hacktribe" ? "Tube Drive" : "Auto Pan"); // Hacktribe tauscht vier MFX
      // Osz-Tabelle: Platz 1 ist SAW; die Zahl belegter Eintraege passt zur Karte
      const osz = k.oszTabelle!;
      const e0 = fw.subarray(dateiOffset(osz.base), dateiOffset(osz.base) + osz.stride);
      expect(decodeOsz(e0).name).toBe("SAW");
      if (f.id === "synth-stock") {
        const e83 = fw.subarray(dateiOffset(osz.base) + 83 * osz.stride, dateiOffset(osz.base) + 84 * osz.stride);
        expect(decodeOsz(e83).name.length).toBeGreaterThan(0);
        // direkt hinter der Osz-Tabelle beginnt die Mod-Tabelle
        expect(dateiOffset(osz.base) + 84 * osz.stride).toBe(dateiOffset(k.modTabelle!.base));
      }
      const mod = k.modTabelle!;
      expect(modName(fw.subarray(dateiOffset(mod.base), dateiOffset(mod.base) + mod.stride))).toBe("EG+ Filter");
      const kette = leseLdrKette(fw, k.ldrStart);
      expect(kette.ok).toBe(true);
      expect(kette.bloecke.length).toBeGreaterThanOrEqual(150);
      expect(ascii(fw, dateiOffset(k.initPattern) + 0x10, 12)).toBe("Init Pattern");
      // Die Freigabe muss ein echtes, unveraendertes Abbild durchlassen — mit jedem plausiblen Ziel.
      const laufend = f.id === "synth-stock" ? "synth-stock" : f.id === "hacktribe" ? "hacktribe" : "sampler-stock";
      const fg = freigabe(fw, { geraet: k.variante, laufend }, fw);
      expect(fg.pruefungen.filter((p) => p.hart && !p.ok).map((p) => `${p.name}: ${p.text}`)).toEqual([]);
      expect(fg.ok).toBe(true);
      expect(fg.pruefungen.find((p) => p.name === "Vektortabelle")?.text).toMatch(/^8\/8/);
      // Synth-Payload fuer einen Sampler mit Stock-Firmware: Kopf umgekoepft, trotzdem frei
      if (f.id === "synth-stock") expect(freigabe(fw, { geraet: "sampler", laufend: "sampler-stock" }).ok).toBe(true);
    });
  }

  it("Stock-Sampler: die 38 gezeigten IFX-Blöcke sind byte-gleich mit Hacktribes Bank-Slots 0–37", () => {
    const sam = laden("stock_e2s_v202.vsb");
    const ht = laden("hacktribe-2_SYSTEM.vsb");
    if (!sam || !ht) return;
    for (let s = 0; s < 38; s++) {
      const a = presetOffset(KARTE_SAMPLER_STOCK, sam, "ifx", s)!;
      const b = presetOffset(KARTE_HACKTRIBE, ht, "ifx", s)!;
      expect(Buffer.compare(Buffer.from(sam.subarray(a, a + 0x20c)), Buffer.from(ht.subarray(b, b + 0x20c)))).toBe(0);
    }
  });

  it("Ordner-Helfer findet den lokalen Firmware-Ordner", () => {
    expect(existsSync(join(firmwareOrdner()!, "."))).toBe(true);
  });
});

const ascii = (b: Uint8Array, off: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
};
