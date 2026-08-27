import { describe, it, expect } from "vitest";
import { createPattern, type PoolSample } from "../src/core/editorModel";
import { E2S_BODY_SIZE } from "../src/core/e2sExport";
import { eintragZuJson, eintragAusJson } from "../src/core/bibliothekAblage";
import type { BibliothekEintrag } from "../src/core/bibliothek";

function sample(nr: number, name: string): PoolSample {
  const pcm = new Float32Array(1000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.8;
  return { number: nr, name, sampleRate: 44100, pcm };
}

function eintrag(): BibliothekEintrag {
  const p = createPattern("HARDTEKK 1");
  p.bpm = 172;
  p.stepLength = 64;
  p.parts[0].sampleNumber = 501;
  p.parts[0].steps[0].on = true;
  p.parts[0].steps[0].velocity = 111;
  return { id: "abc123", name: "HARDTEKK 1", pattern: p, samples: [sample(501, "Kick")], wann: 1_700_000_000_000 };
}

describe("bibliothekAblage", () => {
  it("bringt einen Eintrag unverändert zurück", () => {
    const e = eintrag();
    const zurueck = eintragAusJson(eintragZuJson(e));
    expect(zurueck.id).toBe("abc123");
    expect(zurueck.name).toBe("HARDTEKK 1");
    expect(zurueck.wann).toBe(1_700_000_000_000);
    expect(zurueck.pattern.name).toBe("HARDTEKK 1");
    expect(zurueck.pattern.bpm).toBe(172);
    expect(zurueck.pattern.stepLength).toBe(64);
    expect(zurueck.pattern.parts[0].sampleNumber).toBe(501);
    expect(zurueck.pattern.parts[0].steps[0].on).toBe(true);
    expect(zurueck.pattern.parts[0].steps[0].velocity).toBe(111);
  });

  it("legt die Samples mit Nummer, Name und Klang ab", () => {
    const e = eintrag();
    const zurueck = eintragAusJson(eintragZuJson(e));
    expect(zurueck.samples).toHaveLength(1);
    const s = zurueck.samples[0];
    expect(s.number).toBe(501);
    expect(s.name).toBe("Kick");
    expect(s.sampleRate).toBe(44100);
    expect(s.pcm.length).toBe(1000);
    // 16 Bit hin und zurück: nicht bitgleich, aber hörbar dasselbe.
    for (let i = 0; i < 1000; i += 97) expect(s.pcm[i]).toBeCloseTo(e.samples[0].pcm[i], 3);
  });

  it("rettet den Roh-Body — sonst gehen Filter, IFX und Motion beim Ablegen verloren", () => {
    const e = eintrag();
    const roh = new Uint8Array(E2S_BODY_SIZE);
    roh[0x25] = 64;
    roh[0x3d] = 7;
    e.pattern.rawBody = roh;
    const zurueck = eintragAusJson(eintragZuJson(e));
    expect(zurueck.pattern.rawBody?.length).toBe(E2S_BODY_SIZE);
    expect(zurueck.pattern.rawBody?.[0x3d]).toBe(7);
  });

  it("behaelt die Kette — sonst spielt der Roh-Body die alte Kette weiter", () => {
    // Der Roh-Body traegt die Kettenbytes mit. Kaeme chainTo beim Laden nicht
    // zurueck, uebernaehme der Body still die Kette von damals — und das
    // Geraet spraenge beim Abspielen woandershin.
    const e = eintrag();
    e.pattern.chainTo = 7;
    e.pattern.chainRepeat = 2;
    const zurueck = eintragAusJson(eintragZuJson(e));
    expect(zurueck.pattern.chainTo).toBe(7);
    expect(zurueck.pattern.chainRepeat).toBe(2);
  });

  it("schreibt die Sample-Anzahl in den Kopf — die Liste liest den Eintrag nicht ganz", () => {
    // Die Ablage listet nur Kopfdaten, damit nicht die halbe Bibliothek im
    // Speicher landet. Was dort stehen soll, muss also im Kopf stehen.
    const doc = JSON.parse(eintragZuJson(eintrag()));
    expect(doc.sampleAnzahl).toBe(1);
    expect(doc.name).toBe("HARDTEKK 1");
    expect(doc.wann).toBe(1_700_000_000_000);
  });

  it("kaputter Text wird als solcher gemeldet, nicht halb geladen", () => {
    expect(() => eintragAusJson("{kein json")).toThrow(/Bibliothek/i);
  });

  it("eine fremde Datei wird abgelehnt", () => {
    expect(() => eintragAusJson(JSON.stringify({ app: "etwas anderes" }))).toThrow(/Bibliothek/i);
  });

  it("ein Eintrag ohne Pattern ist kein Eintrag", () => {
    expect(() => eintragAusJson(JSON.stringify({ app: "tekkforge-bib", version: 1, id: "x" }))).toThrow(
      /Bibliothek/i,
    );
  });
});
