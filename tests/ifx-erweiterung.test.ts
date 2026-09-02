import { describe, it, expect } from "vitest";
import {
  IFX_ZAEHLER,
  IFX_ANZAHL_ADDR,
  zaehlerSchreibliste,
  leseZaehlerStand,
  istPresetPlatzLeer,
  planeIfxErweiterung,
} from "../src/core/ifxErweiterung";
import { E2_RAM_MAP, IFX_PRESET_WRITE_MAX, validateRamRange } from "../src/core/hacktribeRam";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";

/**
 * Das IFX-Menue erweitern — der Weg, den hacktribe `add_ifx` geht: Preset in
 * den naechsten freien Platz, danach 13 Zaehler nachziehen, damit das Menue
 * den Platz auch zeigt. Hier die Planung ohne Geraet.
 */

/** Ein konsistenter Zaehlerstand fuer Max-Index `max` (0-basiert). */
const stand = (max: number) => IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: z.plusEins ? max + 1 : max }));

describe("IFX-Zähler (hacktribe add_ifx)", () => {
  it("es sind genau die 13 Adressen aus e2sysex.py, alle im DDR2-Fenster", () => {
    expect(IFX_ZAEHLER.length).toBe(13);
    expect(new Set(IFX_ZAEHLER.map((z) => z.addr)).size).toBe(13);
    for (const z of IFX_ZAEHLER) expect(validateRamRange(z.addr, 1).ok).toBe(true);
    expect(IFX_ZAEHLER.filter((z) => z.plusEins).length).toBe(7);
    expect(IFX_ZAEHLER[0].addr).toBe(IFX_ANZAHL_ADDR);
  });

  it("der Max-IFX-Index aus der RAM-Karte ist einer der idx-Zähler", () => {
    const max = E2_RAM_MAP.find((e) => e.key === "maxIfxIndex")!;
    const z = IFX_ZAEHLER.find((x) => x.addr === max.base);
    expect(z).toBeDefined();
    expect(z!.plusEins).toBe(false);
  });

  it("zaehlerSchreibliste: idx-Zellen bekommen den Max-Index, die Anzahl-Zellen eins mehr", () => {
    const liste = zaehlerSchreibliste(60);
    expect(liste.length).toBe(13);
    expect(liste.find((w) => w.addr === IFX_ANZAHL_ADDR)!.wert).toBe(61);
    expect(liste.find((w) => w.addr === 0xc0048f80)!.wert).toBe(60);
    for (const w of liste) expect([60, 61]).toContain(w.wert);
  });

  it("leseZaehlerStand: ein stimmiger Satz ergibt den Max-Index — der vom Gerät (48) eingeschlossen", () => {
    expect(leseZaehlerStand(stand(48))).toEqual({ ok: true, maxIndex: 48 });
  });

  it("leseZaehlerStand: ein halb hochgezählter Satz wird gemeldet, nicht geraten", () => {
    const kaputt = stand(48);
    kaputt[3] = { ...kaputt[3], wert: 49 };
    const r = leseZaehlerStand(kaputt);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/0xC004A1F8/i);
  });

  it("leseZaehlerStand: fehlende oder fremde Adressen fallen auf", () => {
    expect(leseZaehlerStand(stand(48).slice(1)).ok).toBe(false);
    expect(leseZaehlerStand([...stand(48), { addr: 0xc0000000, wert: 1 }]).ok).toBe(false);
  });

  it("istPresetPlatzLeer: der leere Platz vom Gerät ist lauter Nullen, ein benanntes Preset nicht", () => {
    expect(istPresetPlatzLeer(new Uint8Array(FX_PRESET_SIZE))).toBe(true);
    const p = decodeFxPreset(initFxPresetBytes());
    p.name = "Ring LFO";
    expect(istPresetPlatzLeer(encodeFxPreset(p))).toBe(false);
    // Ohne Namen zeigt das Menue nichts Brauchbares — zaehlt als leer.
    p.name = "";
    expect(istPresetPlatzLeer(encodeFxPreset(p))).toBe(true);
  });

  it("planeIfxErweiterung: von 48 auf 51, alle drei neuen Plätze belegt → 13 Schreibungen", () => {
    const plan = planeIfxErweiterung(48, 51, () => false);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.schreiben.length).toBe(13);
      expect(plan.neuePlaetze).toEqual([49, 50, 51]);
    }
  });

  it("planeIfxErweiterung: eine Lücke im neuen Bereich stoppt die Erweiterung — das Menü zeigte sonst Leerplätze", () => {
    const plan = planeIfxErweiterung(48, 51, (slot) => slot === 50);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/Platz 51/); // Geraete-Zaehlung: Slot 50 = Platz 51
  });

  it("planeIfxErweiterung: nichts zu tun, wenn das Ziel schon im Menü ist", () => {
    const plan = planeIfxErweiterung(48, 40, () => false);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/schon/);
  });

  it("planeIfxErweiterung: nicht über die Schreibgrenze hinaus", () => {
    expect(planeIfxErweiterung(48, IFX_PRESET_WRITE_MAX + 1, () => false).ok).toBe(false);
    expect(planeIfxErweiterung(48, IFX_PRESET_WRITE_MAX, () => false).ok).toBe(true);
  });
});
