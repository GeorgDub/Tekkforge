import { describe, it, expect } from "vitest";
import {
  sicherungsPlan,
  baueSicherung,
  leseSicherung,
  vergleicheSicherung,
  SICHERUNG_VERSION,
  type SicherungsBlock,
} from "../src/core/geraetSicherung";
import { E2_RAM_MAP } from "../src/core/hacktribeRam";

/** Plan mit Zufallsbytes füllen, damit ein vollständiger Satz entsteht. */
function fuelle(): SicherungsBlock[] {
  return sicherungsPlan().map((p, i) => ({
    ...p,
    bytes: new Uint8Array(p.laenge).map((_, k) => (i * 7 + k) & 0xff),
  }));
}

describe("geraetSicherung", () => {
  it("Plan deckt alle bekannten Bereiche mit ihrer echten Größe ab", () => {
    const plan = sicherungsPlan();
    for (const eintrag of E2_RAM_MAP) {
      const p = plan.find((x) => x.key === eintrag.key);
      expect(p, `Bereich ${eintrag.key} fehlt im Plan`).toBeDefined();
      expect(p!.laenge).toBe(eintrag.stride * eintrag.count);
      expect(p!.adresse).toBe(eintrag.base);
    }
    // Die Presets sind der größte Brocken — grobe Größenordnung prüfen
    const gesamt = plan.reduce((s, p) => s + p.laenge, 0);
    expect(gesamt).toBeGreaterThan(90_000);
    expect(gesamt).toBeLessThan(200_000);
  });

  it("Sicherung schreiben und wieder einlesen ergibt dieselben Bytes", () => {
    const bloecke = fuelle();
    const gelesen = leseSicherung(baueSicherung(bloecke, { geraet: "E2S", firmware: "hacktribe" }));
    expect(gelesen.version).toBe(SICHERUNG_VERSION);
    expect(gelesen.geraet).toBe("E2S");
    expect(gelesen.bloecke).toHaveLength(bloecke.length);
    for (const b of bloecke) {
      const w = gelesen.bloecke.find((x) => x.key === b.key)!;
      expect(w.adresse).toBe(b.adresse);
      expect(Array.from(w.bytes)).toEqual(Array.from(b.bytes));
    }
  });

  it("Zeitstempel und Blockzahl stehen in der Datei", () => {
    const text = baueSicherung(fuelle(), { geraet: "E2S", wann: "2026-08-26T04:00:00Z" });
    expect(text).toContain("2026-08-26T04:00:00Z");
    expect(leseSicherung(text).wann).toBe("2026-08-26T04:00:00Z");
  });

  it("kaputte oder fremde Dateien werden abgelehnt, nicht halb geladen", () => {
    expect(() => leseSicherung("kein json")).toThrow();
    expect(() => leseSicherung("{}")).toThrow(/Sicherung|Version/i);
    expect(() => leseSicherung(JSON.stringify({ version: 999, bloecke: [] }))).toThrow(/Version/i);
    // Block mit falscher Länge fällt auf
    const kaputt = JSON.parse(baueSicherung(fuelle(), {}));
    kaputt.bloecke[0].laenge = 5;
    expect(() => leseSicherung(JSON.stringify(kaputt))).toThrow(/Länge|laenge/i);
  });

  it("Vergleich nennt genau die abweichenden Bereiche", () => {
    const a = fuelle();
    const b = fuelle();
    b[1].bytes[10] ^= 0xff;
    b[1].bytes[11] ^= 0x0f;
    const d = vergleicheSicherung(a, b);
    expect(d).toHaveLength(1);
    expect(d[0].key).toBe(a[1].key);
    expect(d[0].abweichendeBytes).toBe(2);
    expect(d[0].ersteStelle).toBe(10);
    // Gleiche Sicherungen: keine Abweichung
    expect(vergleicheSicherung(a, fuelle())).toHaveLength(0);
  });

  it("Vergleich meldet fehlende Bereiche statt sie zu übergehen", () => {
    const a = fuelle();
    const b = fuelle().slice(0, 2);
    const d = vergleicheSicherung(a, b);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => /fehlt/i.test(x.hinweis ?? ""))).toBe(true);
  });
});
