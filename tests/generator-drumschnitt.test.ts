import { describe, it, expect } from "vitest";
import { schneideDrums, drumOnsets } from "../src/core/drumSchnitt";

const SR = 44100;

function burst(pcm: Float32Array, startSek: number, freq: number, dauerSek: number, amp: number): void {
  const start = Math.round(startSek * SR);
  const n = Math.round(dauerSek * SR);
  for (let i = 0; i < n && start + i < pcm.length; i++) {
    pcm[start + i] += Math.sin((2 * Math.PI * freq * i) / SR) * amp * Math.exp(-i / (n / 4));
  }
}

/** Synthetischer Drums-Stem: 60-Hz-Kicks, 400-Hz-Snares, 8-kHz-Hats. */
function stem(): Float32Array {
  const pcm = new Float32Array(2 * SR);
  for (const t of [0.05, 0.55, 1.05, 1.55]) burst(pcm, t, 60, 0.15, 0.8);
  for (const t of [0.3, 1.3]) burst(pcm, t, 400, 0.1, 0.6);
  for (const t of [0.18, 0.68, 1.18, 1.68]) burst(pcm, t, 8000, 0.05, 0.5);
  return pcm;
}

describe("drumSchnitt", () => {
  it("drumOnsets: findet alle zehn Anschlaege mit Mindestabstand", () => {
    const onsets = drumOnsets(stem(), SR);
    expect(onsets.length).toBe(10);
    for (let i = 1; i < onsets.length; i++) expect(onsets[i] - onsets[i - 1]).toBeGreaterThanOrEqual(0.06 * SR);
  });
  it("schneideDrums: klassifiziert Kick/Snare/Hat, hoechstens 2 je Rolle, Shots kurz", () => {
    const treffer = schneideDrums(stem(), SR);
    const rollen = (r: string) => treffer.filter((t) => t.rolle === r);
    expect(rollen("kick").length).toBeGreaterThanOrEqual(1);
    expect(rollen("snare").length).toBeGreaterThanOrEqual(1);
    expect(rollen("hat").length).toBeGreaterThanOrEqual(1);
    for (const r of ["kick", "snare", "hat"]) expect(rollen(r).length).toBeLessThanOrEqual(2);
    for (const t of treffer) {
      // Kicks duerfen laenger sein als der Rest — der Ausklang gehoert dazu.
      expect(t.pcm.length).toBeLessThanOrEqual(Math.round((t.rolle === "kick" ? 0.45 : 0.4) * SR));
      expect(t.pcm.length).toBeGreaterThanOrEqual(1024);
      expect(t.rmsDb).toBeGreaterThan(-40);
    }
    // Startzeiten passen zur Rolle
    const kickStarts = rollen("kick").map((t) => Math.round(t.startSek * 100) / 100);
    for (const s of kickStarts) expect([0.05, 0.55, 1.05, 1.55].some((t) => Math.abs(t - s) < 0.03)).toBe(true);
  });
  it("stiller Stem → keine Treffer", () => {
    expect(schneideDrums(new Float32Array(SR), SR)).toEqual([]);
  });
});

/**
 * Dichter Tekk-Stem: lange Kicks, denen kurz darauf eine Hat folgt.
 * Genau die Lage, die den Kicks den Bauch nahm.
 */
function dichterStem(): Float32Array {
  const pcm = new Float32Array(3 * SR);
  // Kick alle 0,5 s, 300 ms lang — der lange, gestimmte Tekk-Bauch
  for (const t of [0.1, 0.6, 1.1, 1.6, 2.1]) burst(pcm, t, 55, 0.3, 0.9);
  // Durchgehende Sechzehntel-Hats, laut genug für eigene Onsets. Genau so
  // sieht ein Tekk-Drums-Stem bei 200 BPM aus — und genau daran zerbrach der
  // Schnitt: die Kicks kamen mit 0,09 s heraus, wie im echten Lied gemessen.
  for (let t = 0.19; t < 2.9; t += 0.09) burst(pcm, t, 9000, 0.03, 1.4);
  return pcm;
}

describe("drumSchnitt: der Bauch der Kick", () => {
  it("die Kick behält ihren Ausklang, auch wenn kurz danach eine Hat kommt", () => {
    // Nutzerbefund: "es hat nicht gekickt". Nachgemessen war die aus dem Lied
    // geschnittene Kick 0,09 s lang — die tekk4-Kicks sind 0,32 bis 0,37 s.
    // Ein Tekk-Kick IST der lange Bauch; 90 ms sind nur der Anschlag.
    const kicks = schneideDrums(dichterStem(), SR).filter((t) => t.rolle === "kick");
    expect(kicks.length).toBeGreaterThan(0);
    for (const k of kicks) {
      expect(k.pcm.length / SR, "Kick zu kurz — der Ausklang fehlt").toBeGreaterThanOrEqual(0.18);
    }
  });

  it("die Hat bleibt kurz — sie hat keinen Bauch zu verlieren", () => {
    const hats = schneideDrums(dichterStem(), SR).filter((t) => t.rolle === "hat");
    for (const h of hats) expect(h.pcm.length / SR).toBeLessThan(0.2);
  });

  it("keine Kick wird länger als die Obergrenze", () => {
    for (const t of schneideDrums(dichterStem(), SR)) {
      expect(t.pcm.length).toBeLessThanOrEqual(Math.round(0.5 * SR));
    }
  });

  it("eine Kick reicht nicht in die nächste Kick hinein", () => {
    // Bei 0,5 s Abstand darf der Ausklang nicht über den nächsten Schlag laufen,
    // sonst steckt im Sample zweimal dieselbe Kick.
    for (const k of schneideDrums(dichterStem(), SR).filter((t) => t.rolle === "kick")) {
      expect(k.pcm.length / SR).toBeLessThanOrEqual(0.5);
    }
  });
});
