import { describe, it, expect } from "vitest";
import { vergleicheVersionen } from "../src/core/updateCheck";

describe("updateCheck", () => {
  it("erkennt neuere, gleiche und aeltere Tags (mit und ohne v-Praefix)", () => {
    expect(vergleicheVersionen("0.5.0", "v0.5.1")).toBe("neuer");
    expect(vergleicheVersionen("0.5.0", "0.5.0")).toBe("gleich");
    expect(vergleicheVersionen("0.5.0", "v0.4.9")).toBe("aelter");
    expect(vergleicheVersionen("0.5.0", "v1.0.0")).toBe("neuer");
    expect(vergleicheVersionen("0.10.0", "v0.9.9")).toBe("aelter");
  });
  it("wirft bei unlesbaren Tags", () => {
    expect(() => vergleicheVersionen("0.5.0", "release-candidate")).toThrow();
  });
});
