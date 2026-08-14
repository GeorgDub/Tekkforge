/**
 * Golden-File-Tests für das korrigierte Step-Record-Layout
 * (b0=Trigger, b1=Gate, b2=Velocity, b3=Flag, b4=Note) gegen:
 *   - Hardtekk-Pattern A_Melodic155.e2spat (hardware-verifiziert, make_e2spat.py)
 *   - KORG-Factory-Pattern 245_BodyTalk1.e2spat (Geräte-Export)
 * Fixtures liegen in examples/golden/ (werden übersprungen, wenn sie fehlen).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseElectribePattern } from "../src/core/electribeImport";

const DIR = path.resolve(process.cwd(), "examples", "golden");
const MELODIC = path.join(DIR, "A_Melodic155.e2spat");
const BODYTALK = path.join(DIR, "245_BodyTalk1.e2spat");

(fs.existsSync(MELODIC) ? describe : describe.skip)("step layout — Hardtekk golden", () => {
  it("parses gate/velocity/note from the hardware-verified Hardtekk pattern", () => {
    const pat = parseElectribePattern(new Uint8Array(fs.readFileSync(MELODIC)));
    expect(pat.name).toContain("Melodic");
    // Part 1 (Kick), Step 0 — Raw-Record 01 48 60 00 3c
    const kick = pat.parts[0].steps[0];
    expect(kick.active).toBe(true);
    expect(kick.gate).toBe(0x48); // 72
    expect(kick.velocity).toBe(0x60); // 96
    // Rohbyte 0x3C, gespeichert als MIDI+1 → MIDI 59 (B3).
    // Der frühere Kommentar las 0x3C als C4 — das war dieselbe Annahme, die
    // auch der Schreibpfad hatte, weshalb der Test den Fehler nicht sah.
    expect(kick.note).toBe(59)
    // Part 9 (idx 8), Step 7 — Raw-Record 01 48 60 00 3f → Note variiert (D#4)
    const mel = pat.parts[8].steps[7];
    expect(mel.active).toBe(true);
    expect(mel.note).toBe(0x3f - 1); // Rohbyte 0x3F → MIDI 62
    // Melodie: mindestens 2 unterschiedliche Noten im Part
    const notes = new Set(
      pat.parts[8].steps.filter((s) => s.active).map((s) => s.note),
    );
    expect(notes.size).toBeGreaterThanOrEqual(2);
  });
});

(fs.existsSync(BODYTALK) ? describe : describe.skip)("step layout — Factory golden", () => {
  it("BodyTalk1: gates vary (incl. 0xFF tie), velocities are 0x60/0x7F, notes melodic", () => {
    const pat = parseElectribePattern(new Uint8Array(fs.readFileSync(BODYTALK)));
    const active = pat.parts.flatMap((p) => p.steps.filter((s) => s.active));
    expect(active.length).toBeGreaterThan(100);
    const gates = new Set(active.map((s) => s.gate));
    const vels = new Set(active.map((s) => s.velocity));
    const notes = new Set(active.map((s) => s.note));
    expect(gates.has(255)).toBe(true); // Tie-Sentinel kommt vor
    expect(vels.has(0x60)).toBe(true); // Standard-Velocity 96
    expect(vels.has(0x7f)).toBe(true); // Akzente 127
    // Kein "0xFF-Velocity" mehr — alle Velocities sind reguläre 0..127
    expect([...vels].every((v) => v >= 0 && v <= 127)).toBe(true);
    expect(notes.size).toBeGreaterThan(4); // melodisches Material
  });
});
