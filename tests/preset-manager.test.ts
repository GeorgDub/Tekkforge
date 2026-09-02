import { describe, it, expect } from "vitest";
import {
  IFX_PLAETZE,
  MFX_PLAETZE,
  leererBlock,
  istLeer,
  nameVon,
  zustandAusBloecken,
  zustandAusFirmware,
  umbenennen,
  verschieben,
  tauschen,
  loeschen,
  leeren,
  ersetzen,
  einfuegen,
  unterschiede,
  alsSammlung,
  hoechsterBelegter,
  luecken,
  type ManagerZustand,
} from "../src/core/presetManager";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { dateiOffset, VSB_GROESSE } from "../src/core/firmwareBau";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";

/**
 * Der Preset-Manager: die ganze Bank als Liste, Plaetze wie am Geraet ab 1.
 * Jede Operation liefert einen neuen Zustand; geschrieben wird spaeter nur,
 * was sich gegen die Basis unterscheidet.
 */

function block(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}

/** Ein Geraetestand wie der echte: 49 IFX benannt, Rest leer; 32 MFX benannt. */
function geraet(): ManagerZustand {
  const ifx = Array.from({ length: IFX_PLAETZE }, (_, i) => (i < 49 ? block(`Werk ${i + 1}`) : leererBlock("ifx")));
  const mfx = Array.from({ length: MFX_PLAETZE }, (_, i) => block(`Master ${i + 1}`, true));
  return zustandAusBloecken(ifx, mfx, 48);
}

const namen = (z: ManagerZustand, art: "ifx" | "mfx", bis: number): string[] =>
  z[art].slice(0, bis).map((b) => nameVon(b));

describe("presetManager — Grundlagen", () => {
  it("96 IFX- und 32 MFX-Plaetze; ein leerer Block hat keinen Namen, aber die Pegel-Bytes", () => {
    expect(IFX_PLAETZE).toBe(96);
    expect(MFX_PLAETZE).toBe(32);
    const l = leererBlock("ifx");
    expect(l.length).toBe(FX_PRESET_SIZE);
    expect(istLeer(l)).toBe(true);
    expect(l[0x12b]).toBe(0x40); // post_level — wie die Init-Bloecke auf dem Geraet
    expect(istLeer(block("X"))).toBe(false);
  });

  it("zustandAusBloecken: Laengen werden geprueft", () => {
    expect(() => zustandAusBloecken([block("A")], [], 0)).toThrow(/96/);
  });

  it("zustandAusFirmware liest dieselben Stellen wie der Firmware-Bau", () => {
    const fw = new Uint8Array(VSB_GROESSE);
    fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
    fw.set(new TextEncoder().encode("E2S"), 0x10);
    const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
    const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;
    fw.set(block("Punch"), dateiOffset(addressForSlot(ifxMap, 0)));
    fw.set(block("Tube Drive", true), dateiOffset(addressForSlot(mfxMap, 31)));
    for (const zl of IFX_ZAEHLER) fw[dateiOffset(zl.addr)] = zl.plusEins ? 49 : 48;
    const z = zustandAusFirmware(fw);
    expect(nameVon(z.ifx[0])).toBe("Punch");
    expect(nameVon(z.mfx[31])).toBe("Tube Drive");
    expect(z.ifxMaxIndex).toBe(48);
  });
});

describe("presetManager — Operationen", () => {
  it("umbenennen aendert nur den Namen und laesst die Eingabe unangetastet", () => {
    const z = geraet();
    const n = umbenennen(z, "ifx", 41, "Mein Drive");
    expect(nameVon(n.ifx[40])).toBe("Mein Drive");
    expect(nameVon(z.ifx[40])).toBe("Werk 41");
    // alles ausser dem Namen identisch
    const a = z.ifx[40], b = n.ifx[40];
    for (let i = 0x10; i < FX_PRESET_SIZE; i++) expect(b[i]).toBe(a[i]);
  });

  it("verschieben nimmt heraus und fuegt ein — der Rest rueckt", () => {
    const n = verschieben(geraet(), "ifx", 3, 1);
    expect(namen(n, "ifx", 4)).toEqual(["Werk 3", "Werk 1", "Werk 2", "Werk 4"]);
    const m = verschieben(geraet(), "ifx", 1, 3);
    expect(namen(m, "ifx", 4)).toEqual(["Werk 2", "Werk 3", "Werk 1", "Werk 4"]);
    expect(n.ifx.length).toBe(IFX_PLAETZE);
  });

  it("tauschen vertauscht zwei Plaetze", () => {
    const n = tauschen(geraet(), "mfx", 1, 32);
    expect(nameVon(n.mfx[0])).toBe("Master 32");
    expect(nameVon(n.mfx[31])).toBe("Master 1");
  });

  it("loeschen rueckt auf und haengt hinten einen leeren Block an", () => {
    const n = loeschen(geraet(), "ifx", 2);
    expect(namen(n, "ifx", 3)).toEqual(["Werk 1", "Werk 3", "Werk 4"]);
    expect(nameVon(n.ifx[47])).toBe("Werk 49");
    expect(istLeer(n.ifx[48])).toBe(true);
    expect(n.ifx.length).toBe(IFX_PLAETZE);
  });

  it("leeren laesst den Platz stehen und macht ihn leer — eine Luecke", () => {
    const n = leeren(geraet(), "ifx", 2);
    expect(istLeer(n.ifx[1])).toBe(true);
    expect(nameVon(n.ifx[2])).toBe("Werk 3");
    expect(luecken(n, "ifx")).toEqual([2]);
    expect(luecken(geraet(), "ifx")).toEqual([]);
  });

  it("ersetzen tauscht den Inhalt eines Platzes, einfuegen rueckt den Rest nach hinten", () => {
    const n = ersetzen(geraet(), "ifx", 50, block("Ring LFO"));
    expect(nameVon(n.ifx[49])).toBe("Ring LFO");
    const m = einfuegen(geraet(), "ifx", 1, block("Ganz vorn"));
    expect(namen(m, "ifx", 3)).toEqual(["Ganz vorn", "Werk 1", "Werk 2"]);
    expect(nameVon(m.ifx[49])).toBe("Werk 49");
  });

  it("einfuegen faellt durch, wenn hinten ein belegter Block herausfiele", () => {
    expect(() => einfuegen(geraet(), "mfx", 1, block("Noch einer", true))).toThrow(/voll|belegt/i);
  });

  it("Plaetze ausserhalb der Art-Grenze werden abgelehnt", () => {
    expect(() => umbenennen(geraet(), "ifx", 97, "X")).toThrow(/Platz/);
    expect(() => tauschen(geraet(), "mfx", 0, 1)).toThrow(/Platz/);
    expect(() => verschieben(geraet(), "ifx", 1, 100)).toThrow(/Platz/);
  });

  it("hoechsterBelegter zaehlt wie das Geraet", () => {
    expect(hoechsterBelegter(geraet(), "ifx")).toBe(49);
    expect(hoechsterBelegter(ersetzen(geraet(), "ifx", 60, block("X")), "ifx")).toBe(60);
    expect(hoechsterBelegter(geraet(), "mfx")).toBe(32);
  });
});

describe("presetManager — Unterschiede und Export", () => {
  it("unterschiede: nur die Plaetze, deren Bytes sich gegen die Basis aendern, mit Platz und Art", () => {
    const basis = geraet();
    const n = tauschen(umbenennen(basis, "ifx", 41, "Neu"), "mfx", 1, 2);
    const u = unterschiede(n, basis);
    expect(u.map((e) => `${e.art}:${e.platz}`)).toEqual(["ifx:41", "mfx:1", "mfx:2"]);
    expect(u[0].name).toBe("Neu");
    expect(unterschiede(basis, basis)).toEqual([]);
  });

  it("nach loeschen in der Mitte unterscheiden sich alle Plaetze dahinter bis zum letzten belegten", () => {
    const basis = geraet();
    const u = unterschiede(loeschen(basis, "ifx", 1), basis);
    // Werk 2..49 ruecken auf Platz 1..48, Platz 49 wird leer → 49 Unterschiede
    expect(u.length).toBe(49);
    expect(u[0].platz).toBe(1);
    expect(u[48].platz).toBe(49);
    expect(istLeer(u[48].bytes)).toBe(true);
  });

  it("alsSammlung: alle belegten Plaetze mit Platz, leere weggelassen", () => {
    const s = alsSammlung(geraet());
    expect(s.length).toBe(49 + 32);
    expect(s[0]).toMatchObject({ art: "ifx", platz: 1, name: "Werk 1" });
    expect(s[49]).toMatchObject({ art: "mfx", platz: 1, name: "Master 1" });
    expect(s.every((e) => e.bytes.length === FX_PRESET_SIZE)).toBe(true);
  });
});
