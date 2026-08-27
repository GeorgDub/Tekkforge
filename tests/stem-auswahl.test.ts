import { describe, it, expect } from "vitest";
import {
  teileAus,
  pruefeAuswahl,
  auswahlText,
  STEM_VORGABE,
  ALLE_TEILE,
  type StemAuswahl,
} from "../src/core/stemAuswahl";

const nichts: StemAuswahl = { melo: false, vox: false, drums: false, bass: false };

describe("teileAus", () => {
  it("gibt die angehakten Teile in stabiler Reihenfolge", () => {
    expect(teileAus({ melo: true, vox: true, drums: false, bass: true })).toEqual(["melo", "vox", "bass"]);
  });

  it("die Vorgabe ist der bisherige Satz — Bass steckt in der Melodie", () => {
    expect(teileAus(STEM_VORGABE)).toEqual(["melo", "vox", "drums"]);
    expect(STEM_VORGABE.bass).toBe(false);
  });

  it("nichts angehakt ergibt eine leere Liste", () => {
    expect(teileAus(nichts)).toEqual([]);
  });

  it("alles angehakt ergibt alle vier", () => {
    expect(teileAus({ melo: true, vox: true, drums: true, bass: true })).toEqual([...ALLE_TEILE]);
  });
});

describe("pruefeAuswahl", () => {
  it("ohne Auswahl geht es nicht los", () => {
    const p = pruefeAuswahl(nichts);
    expect(p.ok).toBe(false);
    expect(p.hinweise.join(" ")).toMatch(/mindestens ein Teil/i);
  });

  it("die Vorgabe läuft ohne Warnung", () => {
    expect(pruefeAuswahl(STEM_VORGABE)).toEqual({ ok: true, hinweise: [] });
  });

  it("warnt, wenn die Melodie fehlt — daran erkennt man das Lied", () => {
    const p = pruefeAuswahl({ ...STEM_VORGABE, melo: false });
    expect(p.ok).toBe(true);
    expect(p.hinweise.join(" ")).toMatch(/Melodie/i);
  });

  it("warnt vor einem Drop ohne Schlagzeug", () => {
    // Genau der Fall aus dem Stapellauf: keine Drums aus dem Lied UND kein
    // tekk4 — der Drop war an Part 1 stumm.
    const p = pruefeAuswahl({ ...STEM_VORGABE, drums: false });
    expect(p.hinweise.join(" ")).toMatch(/kein Schlagzeug/i);
  });

  it("mit tekk4-Kit ist fehlendes Schlagzeug kein Thema", () => {
    const p = pruefeAuswahl({ ...STEM_VORGABE, drums: false }, { tekkDrums: true });
    expect(p.hinweise.join(" ")).not.toMatch(/kein Schlagzeug/i);
  });

  it("sagt, dass getrennter Bass aus der Melodie herausfällt", () => {
    const p = pruefeAuswahl({ ...STEM_VORGABE, bass: true });
    expect(p.hinweise.join(" ")).toMatch(/Bass fällt getrennt/i);
  });

  it("„nur Vocals“ ist erlaubt, sagt aber was fehlt", () => {
    const p = pruefeAuswahl({ melo: false, vox: true, drums: false, bass: false });
    expect(p.ok).toBe(true);
    expect(p.hinweise.length).toBeGreaterThanOrEqual(2);
  });
});

describe("auswahlText", () => {
  it("nennt die Teile beim Namen", () => {
    expect(auswahlText({ melo: true, vox: true, drums: false, bass: false })).toBe("Melodie + Vocals");
  });

  it("sagt es, wenn nichts gewählt ist", () => {
    expect(auswahlText(nichts)).toBe("nichts ausgewählt");
  });
});
