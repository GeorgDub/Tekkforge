import { describe, it, expect } from "vitest";
import { ramBytesFuer, ramBytesSumme, RAM_BUDGET_BYTES } from "../src/core/sampleRam";

const smp = (frames: number, sampleRate: number) => ({ pcm: new Float32Array(frames), sampleRate });

describe("ramBytesFuer", () => {
  it("zwei Bytes je Bild — so liegt es im Gerät", () => {
    expect(ramBytesFuer(smp(1000, 44100))).toBe(2000);
  });

  it("ein 22050er Sample kostet die HÄLFTE eines gleich langen 44100ers", () => {
    // Genau darum geht es bei den sparsamen Vocals: gleiche Spieldauer, halber
    // Speicher. Die alte Rechnung rechnete jede Dauer auf 44,1 kHz hoch und
    // sah deshalb keinen Unterschied — die Funktion brachte im Bank-Planer
    // nichts, obwohl sie am Gerät nachweislich wirkt (Messung 2026-08-27).
    const eine = ramBytesFuer(smp(44100, 44100)); // 1 s bei voller Rate
    const halbe = ramBytesFuer(smp(22050, 22050)); // 1 s bei halber Rate
    expect(halbe).toBe(eine / 2);
  });

  it("die Rate allein ändert nichts — die Bildzahl zählt", () => {
    expect(ramBytesFuer(smp(1000, 22050))).toBe(ramBytesFuer(smp(1000, 44100)));
  });

  it("ein leeres Sample kostet nichts", () => {
    expect(ramBytesFuer(smp(0, 44100))).toBe(0);
  });
});

describe("ramBytesSumme", () => {
  it("addiert über die Bank", () => {
    expect(ramBytesSumme([smp(1000, 44100), smp(500, 22050)])).toBe(3000);
  });

  it("eine leere Bank belegt nichts", () => {
    expect(ramBytesSumme([])).toBe(0);
  });

  it("das Budget ist die bekannte Gerätegrenze", () => {
    expect(RAM_BUDGET_BYTES).toBe(24 * 1024 * 1024);
  });
});
