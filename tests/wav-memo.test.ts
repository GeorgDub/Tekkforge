import { describe, it, expect } from "vitest";
import { wavBase64 } from "../src/core/wavMemo";

/** Kodierer, der mitzaehlt, wie oft er wirklich rechnen musste. */
function zaehlenderKodierer() {
  const k = {
    laeufe: 0,
    fn(pcm: Float32Array, sampleRate: number): string {
      k.laeufe++;
      return `${sampleRate}:${Array.from(pcm).join(",")}`;
    },
  };
  return k;
}

describe("wavBase64", () => {
  it("kodiert dieselben Klangdaten nur einmal", () => {
    const k = zaehlenderKodierer();
    const pcm = new Float32Array([0.5, -0.5]);
    const a = wavBase64(pcm, 44100, k.fn);
    const b = wavBase64(pcm, 44100, k.fn);
    expect(b).toBe(a);
    expect(k.laeufe).toBe(1);
  });

  it("kodiert neu, sobald die Klangdaten andere sind", () => {
    const k = zaehlenderKodierer();
    wavBase64(new Float32Array([0.5]), 44100, k.fn);
    wavBase64(new Float32Array([0.5]), 44100, k.fn); // gleicher Inhalt, anderes Array
    expect(k.laeufe).toBe(2);
  });

  it("kodiert neu, wenn sich nur die Abtastrate ändert", () => {
    const k = zaehlenderKodierer();
    const pcm = new Float32Array([0.5, -0.5]);
    const a = wavBase64(pcm, 44100, k.fn);
    const b = wavBase64(pcm, 22050, k.fn);
    expect(k.laeufe).toBe(2);
    expect(b).not.toBe(a);
    // und danach ist der neue Stand der gemerkte
    wavBase64(pcm, 22050, k.fn);
    expect(k.laeufe).toBe(2);
  });

  it("hält viele Samples gleichzeitig", () => {
    const k = zaehlenderKodierer();
    const alle = [new Float32Array([1]), new Float32Array([2]), new Float32Array([3])];
    for (const p of alle) wavBase64(p, 44100, k.fn);
    for (const p of alle) wavBase64(p, 44100, k.fn);
    expect(k.laeufe).toBe(3);
  });
});
