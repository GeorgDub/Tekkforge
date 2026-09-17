/** tests/sd-paket.test.ts — SD-Update-Paket: Kopfprüfung je Datei, Reihenfolge, Pfade, LIESMICH. */
import { describe, it, expect } from "vitest";
import { baueSdPaket } from "../src/core/sdPaket";
import { standardKopf } from "../src/core/vsbKopf";

const datei = (art: Parameters<typeof standardKopf>[1], variante: "synth" | "sampler", laenge: number) => {
  const kopf = standardKopf(variante, art, laenge);
  const b = new Uint8Array(kopf.length + laenge);
  b.set(kopf, 0);
  return b;
};

describe("baueSdPaket", () => {
  it("prüft jede Datei, ordnet sie in die Update-Reihenfolge und schreibt gültige Pfade", () => {
    const p = baueSdPaket(
      [
        { art: "PCM", bytes: datei("PCM", "sampler", 0x800000), herkunft: "Werks-PCM" },
        { art: "SYSTEM", bytes: datei("SYSTEM", "sampler", 0x200000), herkunft: "Gerätelesung" },
      ],
      "sampler",
      { sdOrdner: "Hacktribe", stempel: "2026-09-17" },
    );
    expect(p.alleOk).toBe(true);
    expect(p.dateien.map((d) => d.pfad)).toEqual([
      "SD-Update-2026-09-17\\KORG\\Hacktribe\\System\\SYSTEM.VSB",
      "SD-Update-2026-09-17\\KORG\\Hacktribe\\System\\PCM.VSB",
    ]);
    expect(p.pruefungen.map((x) => x.art)).toEqual(["SYSTEM", "PCM"]);
    expect(p.liesmich).toMatch(/DATA UTILITY → SOFTWARE UPDATE/);
    expect(p.liesmich).toMatch(/electribe 2 sampler/);
    expect(p.liesmich).toMatch(/✅ ok/);
  });
  it("erkennt eine Datei mit falscher Identität und warnt in der LIESMICH", () => {
    const p = baueSdPaket([{ art: "SYSTEM", bytes: datei("SYSTEM", "synth", 0x200000), herkunft: "Synth-Build" }], "sampler", { stempel: "2026-09-17" });
    expect(p.alleOk).toBe(false);
    expect(p.pruefungen[0].ok).toBe(false);
    expect(p.liesmich).toMatch(/NICHT einspielen/);
    expect(p.liesmich).toMatch(/❌/);
  });
  it("nimmt eine MD5-Funktion und schreibt die Prüfsumme in die Tabelle", () => {
    const p = baueSdPaket([{ art: "SLICE", bytes: datei("SLICE", "sampler", 0x1000), herkunft: "Gerät" }], "sampler", { stempel: "2026-09-17", md5: () => "abc123" });
    expect(p.liesmich).toMatch(/`abc123`/);
    expect(p.dateien[0].pfad).toMatch(/SLICE\.VSB$/);
  });
});
