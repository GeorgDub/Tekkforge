/**
 * tests/firmware-mode.test.ts — Stock vs. Hacktribe: Feature-Tabelle,
 * Persistenz-Parsing und Erkennungsentscheidung.
 */

import { describe, it, expect } from "vitest";
import {
  FEATURES,
  FIRMWARE_MODES,
  FIRMWARE_PROBE,
  featureAvailable,
  featureHint,
  firmwareFromProbe,
  parseFirmwareMode,
  probeStatusText,
} from "../src/core/firmwareMode";
import { validateRamRange } from "../src/core/hacktribeRam";

describe("firmwareMode — Feature-Tabelle", () => {
  it("Hacktribe darf alles", () => {
    for (const f of Object.keys(FEATURES) as (keyof typeof FEATURES)[]) {
      expect(featureAvailable("hacktribe", f)).toBe(true);
      expect(featureHint("hacktribe", f)).toBe("");
    }
  });

  it("Stock bekommt keine NRPN- und RAM-Funktionen", () => {
    expect(featureAvailable("stock", "nrpnFx")).toBe(false);
    expect(featureAvailable("stock", "nrpnPanel")).toBe(false);
    expect(featureAvailable("stock", "ramAccess")).toBe(false);
  });

  it("Hinweis nennt Hacktribe und den Stock-Ausweg", () => {
    const hint = featureHint("stock", "nrpnPanel");
    expect(hint).toMatch(/Hacktribe/);
    expect(hint).toMatch(/Edit-Buffer/);
  });

  it("kennt genau die beiden Modi", () => {
    expect(FIRMWARE_MODES).toEqual(["stock", "hacktribe"]);
  });
});

describe("firmwareMode — Persistenz", () => {
  it("Default ist Stock, auch bei Müll", () => {
    expect(parseFirmwareMode(undefined)).toBe("stock");
    expect(parseFirmwareMode(null)).toBe("stock");
    expect(parseFirmwareMode("")).toBe("stock");
    expect(parseFirmwareMode("Hacktribe")).toBe("stock"); // exakt, kein Raten
    expect(parseFirmwareMode(42)).toBe("stock");
  });

  it("erkennt den gespeicherten Hacktribe-Wert", () => {
    expect(parseFirmwareMode("hacktribe")).toBe("hacktribe");
    expect(parseFirmwareMode("stock")).toBe("stock");
  });
});

describe("firmwareMode — Erkennung", () => {
  it("nur eine echte Antwort macht Hacktribe", () => {
    expect(firmwareFromProbe("reply")).toBe("hacktribe");
    expect(firmwareFromProbe("timeout")).toBe("stock");
    expect(firmwareFromProbe("error")).toBe("stock");
  });

  it("Probe liegt im erlaubten DDR2-Bereich (sonst würde der Lesepfad sie ablehnen)", () => {
    expect(validateRamRange(FIRMWARE_PROBE.addr, FIRMWARE_PROBE.len).ok).toBe(true);
    expect(FIRMWARE_PROBE.len).toBeLessThanOrEqual(16);
  });

  it("Statustext nennt den Port-Konflikt als Alternative zum Timeout", () => {
    expect(probeStatusText("timeout", "stock")).toMatch(/Port/);
    expect(probeStatusText("reply", "hacktribe")).toMatch(/Hacktribe/);
  });
});
