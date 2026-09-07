import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { ordneDateiEin, ablageStand, basisMoeglich, kartenIdFuerWahl, ROLLEN_LABEL, BASIS_WAHL_LABEL } from "../src/core/firmwareAblage";
import { HACKTRIBE_SHA256, SAMPLER_STOCK_SHA256, SYNTH_STOCK_SHA256 } from "../src/core/firmwareKarte";
import { HACKTRIBE_PATCH_SHA256 } from "../src/core/bspatch";
import { fakeHacktribe, fakeSamplerStock, fakeSynthStock } from "./helpers/fakeFirmware";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Der lokale Firmware-Ordner: Rollen am Hash, Beschaedigung erkennen, Basis-Wahlen. */
describe("firmwareAblage", () => {
  it("bekannte Hashes bekommen ihre Rolle — auch ohne Inhalt", () => {
    expect(ordneDateiEin("SYSTEM.VSB", SYNTH_STOCK_SHA256).rolle).toBe("synth-stock");
    expect(ordneDateiEin("x.vsb", SAMPLER_STOCK_SHA256.toUpperCase()).rolle).toBe("sampler-stock");
    expect(ordneDateiEin("h.vsb", HACKTRIBE_SHA256).rolle).toBe("hacktribe");
    expect(ordneDateiEin("hacktribe-2.patch", HACKTRIBE_PATCH_SHA256).hinweis).toMatch(/Hash stimmt/);
    expect(ordneDateiEin("egal", "00".repeat(32)).rolle).toBe("fremd");
  });

  it("ein Stock-artiges Abbild mit falschem Hash ist beschädigt, eine Hacktribe-Fassung ist „eigene“", () => {
    const s = fakeSamplerStock();
    const d = ordneDateiEin("SYSTEM.VSB", sha(s), s);
    expect(d.rolle).toBe("beschaedigt");
    expect(d.hinweis).toMatch(/sieht aus wie electribe 2 sampler v2.02/);
    expect(d.befund?.karte.id).toBe("sampler-stock");
    const y = ordneDateiEin("synth.vsb", sha(fakeSynthStock()), fakeSynthStock());
    expect(y.rolle).toBe("beschaedigt");
    expect(y.hinweis).toMatch(/41fc5f1c3320/);
    const h = fakeHacktribe();
    const e = ordneDateiEin("tekk.vsb", sha(h), h);
    expect(e.rolle).toBe("eigene");
    expect(e.hinweis).toMatch(/Hacktribe/);
    expect(e.groesse).toBe(h.length);
  });

  it("fremde Dateien und fremde Patches", () => {
    const m = new Uint8Array(100);
    expect(ordneDateiEin("readme.txt", sha(m), m).rolle).toBe("fremd");
    const p = new Uint8Array(64);
    "BSDIFF40".split("").forEach((c, i) => (p[i] = c.charCodeAt(0)));
    p[24] = 1; // neue Groesse 1
    const r = ordneDateiEin("anderer.patch", sha(p), p);
    expect(r.rolle).toBe("beschaedigt");
    expect(r.hinweis).toMatch(/nicht hacktribe-2.patch/);
    const kaputt = new Uint8Array(10);
    expect(ordneDateiEin("k.patch", sha(kaputt), kaputt).rolle).toBe("fremd");
  });

  it("ablageStand: Rollen sammeln, Fehlendes benennen, Basis-Wahlen prüfen", () => {
    const leer = ablageStand([]);
    expect(leer.fehlend.length).toBe(3);
    expect(basisMoeglich(leer, "sampler-stock")).toEqual({ ok: false, grund: "Sampler v2.02 fehlt in der Ablage" });
    expect(basisMoeglich(leer, "hacktribe").ok).toBe(false);
    expect(basisMoeglich(leer, "eigene").ok).toBe(true);

    const mitStock = ablageStand([ordneDateiEin("s.vsb", SAMPLER_STOCK_SHA256), ordneDateiEin("y.vsb", SYNTH_STOCK_SHA256)]);
    expect(mitStock.fehlend).toEqual(["hacktribe-2.patch (bangcorrupt/hacktribe) — oder eine fertige Hacktribe-SYSTEM.VSB"]);
    expect(basisMoeglich(mitStock, "hacktribe")).toEqual({ ok: false, grund: "hacktribe-2.patch fehlt (oder eine fertige Hacktribe-SYSTEM.VSB)" });
    expect(basisMoeglich(mitStock, "synth-stock").ok).toBe(true);

    const komplett = ablageStand([ordneDateiEin("s.vsb", SAMPLER_STOCK_SHA256), ordneDateiEin("p.patch", HACKTRIBE_PATCH_SHA256)]);
    expect(basisMoeglich(komplett, "hacktribe").ok).toBe(true);
    expect(komplett.patch?.name).toBe("p.patch");
    const fertig = ablageStand([ordneDateiEin("h.vsb", HACKTRIBE_SHA256)]);
    expect(basisMoeglich(fertig, "hacktribe").ok).toBe(true);
    expect(fertig.zeilen[0]).toMatch(/^✓ h.vsb/);
    const h = fakeHacktribe();
    const eig = ablageStand([ordneDateiEin("tekk.vsb", sha(h), h)]);
    expect(eig.eigene.length).toBe(1);
  });

  it("Labels und Karten-Zuordnung", () => {
    expect(kartenIdFuerWahl("hacktribe")).toBe("hacktribe");
    expect(kartenIdFuerWahl("eigene")).toBeNull();
    expect(Object.keys(ROLLEN_LABEL).length).toBe(7);
    expect(BASIS_WAHL_LABEL["synth-stock"]).toMatch(/Synth/);
  });
});
