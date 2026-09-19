import { describe, it, expect } from "vitest";
import { omniModuleBytes } from "../src/core/omniModuleBins";

describe("Omni-Modul-Bundle", () => {
  it("liefert Chord (id9) und Arp (id1) mit passender Header-id", () => {
    for (const [id] of [[9], [1]] as const) {
      const b = omniModuleBytes(id);
      expect(b, `Modul ${id} muss gebuendelt sein`).not.toBeNull();
      expect(b!.length).toBeGreaterThan(44); // Header + code
      const headerId = b![6] | (b![7] << 8); // OTMR-Header: id bei Offset 6/7
      expect(headerId).toBe(id);
    }
  });
  it("liefert null fuer ein nicht gebuendeltes Modul", () => {
    expect(omniModuleBytes(255)).toBeNull();
  });
});
