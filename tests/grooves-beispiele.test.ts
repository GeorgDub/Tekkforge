import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeGroove, encodeGroove, erkenneStepBasis, GROOVE_SIZE, GROOVE_STEP_BASIS, TRIGGER_MAX, VELOCITY_MAX, GATE_MAX } from "../src/core/e2Groove";
import { istGroovePlatzLeer } from "../src/core/firmwareBau";
import { leseSammlung } from "../src/core/sammlung";

/**
 * Die mitgelieferten Tekk-Groove-Vorlagen aus `examples/grooves/`: 320 Byte,
 * Rahmen GVST…GVED, Name fuers Menue, Laenge 1..64, alle Werte in den
 * Bereichen des Geraets — und jede Vorlage tut etwas anderes als die
 * naechste. Erzeugt von `scripts/make-grooves.mjs`.
 */
const ORDNER = path.resolve("examples/grooves");
const dateien = fs.readdirSync(ORDNER).filter((f) => f.endsWith(".e2gv")).sort();
const lies = (f: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(ORDNER, f)));

describe("Tekk-Groove-Vorlagen", () => {
  it("es gibt welche", () => {
    expect(dateien.length).toBeGreaterThanOrEqual(12);
  });

  it.each(dateien)("%s ist ein gueltiger 320-Byte-Block mit Rahmen und Step-Tabelle bei 0x30", (f) => {
    const b = lies(f);
    expect(b.length).toBe(GROOVE_SIZE);
    expect(istGroovePlatzLeer(b)).toBe(false);
    expect(String.fromCharCode(...b.subarray(GROOVE_SIZE - 4))).toBe("GVED");
    expect(erkenneStepBasis(b)).toBe(GROOVE_STEP_BASIS);
  });

  it.each(dateien)("%s: Name, Laenge und Werte liegen in den Bereichen des Geraets", (f) => {
    const g = decodeGroove(lies(f));
    expect(g.name.length).toBeGreaterThan(0);
    expect(g.name.length).toBeLessThanOrEqual(15);
    expect(g.laenge).toBeGreaterThanOrEqual(1);
    expect(g.laenge).toBeLessThanOrEqual(64);
    for (const s of g.steps.slice(0, g.laenge)) {
      expect(Math.abs(s.trigger)).toBeLessThanOrEqual(TRIGGER_MAX);
      expect(s.velocity).toBeLessThanOrEqual(VELOCITY_MAX);
      expect(s.velocity).toBeGreaterThan(0); // ein stummer Step waere ein Fehler, keine Vorlage
      expect(s.gate).toBeLessThanOrEqual(GATE_MAX);
      expect(s.gate).toBeGreaterThan(0);
    }
    // Step 1 bleibt an Ort und Stelle — der Puls haengt an ihm
    expect(g.steps[0].trigger).toBe(0);
  });

  it.each(dateien)("%s ueberlebt lesen und zurueckschreiben byte-genau", (f) => {
    const roh = lies(f);
    expect(Buffer.from(encodeGroove(decodeGroove(roh), roh)).equals(Buffer.from(roh))).toBe(true);
  });

  it("keine zwei Vorlagen sind gleich", () => {
    const alle = dateien.map((f) => Buffer.from(lies(f)).toString("base64"));
    expect(new Set(alle).size).toBe(alle.length);
  });

  it("die Sammlung traegt genau die Dateien, alle als Groove", () => {
    const s = leseSammlung(fs.readFileSync(path.join(ORDNER, "TekkForge-Grooves-Tekk.tfsam"), "utf8"));
    expect(s.eintraege.every((e) => e.art === "groove")).toBe(true);
    const inSammlung = s.eintraege.map((e) => Buffer.from(e.bytes).toString("base64")).sort();
    const aufPlatte = dateien.map((f) => Buffer.from(lies(f)).toString("base64")).sort();
    expect(inSammlung).toEqual(aufPlatte);
  });

  it("die Vorlagen unterscheiden sich in dem, was sie versprechen", () => {
    const g = (name: string) => decodeGroove(lies(dateien.find((f) => f.includes(name))!));
    const straight = g("tekk-straight");
    expect(straight.steps.slice(0, 16).every((s) => s.trigger === 0)).toBe(true);
    expect(straight.steps[0].velocity).toBe(127);
    expect(g("tekk-push").steps[2].trigger).toBeLessThan(0);
    expect(g("tekk-drag").steps[2].trigger).toBeGreaterThan(0);
    expect(g("swing-8-hard").steps[2].trigger).toBeGreaterThan(g("swing-8-light").steps[2].trigger);
    expect(g("hat-ghost").steps[1].velocity).toBeLessThan(g("hat-ghost").steps[0].velocity);
    expect(g("gate-chop").steps[1].gate).toBeLessThan(g("gate-chop").steps[0].gate);
    expect(g("hardtekk-64").laenge).toBe(64);
    expect(g("hardtekk-64").steps[63].velocity).toBe(127);
    expect(g("breaker-32").laenge).toBe(32);
    expect(g("rush").steps[1].trigger).toBe(-20);
  });
});
