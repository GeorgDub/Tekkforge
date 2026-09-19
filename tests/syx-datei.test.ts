/** tests/syx-datei.test.ts — .syx zerlegen/beschreiben und frameweise senden (mit/ohne Antwort, Abbruch, Fehlerantwort). */
import { describe, it, expect } from "vitest";
import { zerlegeSyx, beschreibeSyx, sendeSyxFrames, type SyxSendeIO } from "../src/core/syxDatei";

const otpFrame = (cmd: number, sub: number, ...daten: number[]) => [0xf0, 0x7d, 0x01, 0x02, cmd, sub, ...daten, 0xf7];
const korgFrame = [0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x10, 0xf7];

describe("zerlegeSyx", () => {
  it("findet alle Frames und meldet keine Fehler bei sauberer Datei", () => {
    const z = zerlegeSyx(Uint8Array.from([...otpFrame(0x05, 0x01, 0x00, 0x01, 0x22), ...korgFrame, ...otpFrame(0x05, 0x01, 0x00, 0x02, 0x33)]));
    expect(z.frames.length).toBe(3);
    expect(z.fehler).toEqual([]);
    expect(z.frames[1][1]).toBe(0x42);
  });
  it("meldet Streubytes, fehlendes F7 und Datenbytes ≥ 0x80", () => {
    const z = zerlegeSyx(Uint8Array.from([0x11, 0xf0, 0x7d, 0x90, 0xf7, 0xf0, 0x7d]));
    expect(z.frames.length).toBe(1);
    expect(z.fehler.join("\n")).toMatch(/außerhalb eines Frames bei 0/);
    expect(z.fehler.join("\n")).toMatch(/0x90 ≥ 0x80/);
    expect(z.fehler.join("\n")).toMatch(/ohne F7/);
  });
});

describe("beschreibeSyx", () => {
  it("zählt OTP/KORG/andere und die OTP-Kommandos", () => {
    const b = beschreibeSyx([
      Uint8Array.from(otpFrame(0x05, 0x01, 0x01)),
      Uint8Array.from(otpFrame(0x05, 0x01, 0x02)),
      Uint8Array.from(otpFrame(0x01, 0x00)),
      Uint8Array.from(korgFrame),
      Uint8Array.from([0xf0, 0x43, 0x00, 0xf7]),
    ]);
    expect(b.anzahl).toBe(5);
    expect(b.otp).toBe(3);
    expect(b.korg).toBe(1);
    expect(b.andere).toBe(1);
    expect(b.otpKommandos).toEqual({ "05/01": 2, "01/00": 1 });
    expect(b.groessterFrame).toBe(8); // F0 7D 01 02 05 01 01 F7 bzw. der 8-Byte-KORG-Frame
  });
});

function fakeIO(antwort: Uint8Array | null) {
  const gesendet: Uint8Array[] = [];
  const pausen: number[] = [];
  const io: SyxSendeIO = {
    async sende(f) { gesendet.push(f); },
    async sendeUndEmpfange(f) { gesendet.push(f); if (!antwort) throw new Error("timeout"); return antwort; },
    async warte(ms) { pausen.push(ms); },
  };
  return { io, gesendet, pausen };
}
const frames = [otpFrame(0x05, 0x01, 0x01), otpFrame(0x05, 0x01, 0x02), otpFrame(0x05, 0x01, 0x03)].map((f) => Uint8Array.from(f));

describe("sendeSyxFrames", () => {
  it("sendet alle Frames mit Pause dazwischen (ohne auf Antworten zu warten)", async () => {
    const { io, gesendet, pausen } = fakeIO(null);
    const r = await sendeSyxFrames(frames, io, { pauseMs: 15 });
    expect(r.ok).toBe(true);
    expect(gesendet.length).toBe(3);
    expect(pausen).toEqual([15, 15]); // nach dem letzten keine Pause
    expect(r.antworten).toBe(0);
  });
  it("zählt Antworten und Timeouts, ohne bei Timeout abzubrechen", async () => {
    const { io } = fakeIO(null);
    const r = await sendeSyxFrames(frames, io, { antwortTimeoutMs: 100, pauseMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.gesendet).toBe(3);
    expect(r.ohneAntwort).toBe(3);
    const ack = fakeIO(Uint8Array.from(otpFrame(0x05, 0x03, 0x00)));
    const r2 = await sendeSyxFrames(frames, ack.io, { antwortTimeoutMs: 100, pauseMs: 0 });
    expect(r2.antworten).toBe(3);
  });
  it("stoppt bei einer als Fehler erkannten Antwort", async () => {
    const nack = Uint8Array.from(otpFrame(0x05, 0x03, 0x07));
    const { io, gesendet } = fakeIO(nack);
    const r = await sendeSyxFrames(frames, io, { antwortTimeoutMs: 100, pauseMs: 0, istFehlerAntwort: (b) => b[6] !== 0x00 });
    expect(r.ok).toBe(false);
    expect(gesendet.length).toBe(1);
    expect(r.fehlerAntwort).toBe(nack);
  });
  it("bricht auf Wunsch ab", async () => {
    const { io, gesendet } = fakeIO(null);
    let n = 0;
    const r = await sendeSyxFrames(frames, io, { pauseMs: 0, abbruch: () => n++ >= 1 });
    expect(r.ok).toBe(false);
    expect(gesendet.length).toBe(1);
  });
});
