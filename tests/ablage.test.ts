import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { legeAb } from "../src/gui/ablage";

interface FakeFs {
  available: boolean;
  standardOrdner(): Promise<string>;
  schreibe(ordner: string, dateien: { name: string; bytes: Uint8Array }[]): Promise<{ ordner: string; geschrieben: string[] }>;
}

const w = globalThis as unknown as { tekkFs?: FakeFs };
let geschrieben: { ordner: string; name: string; bytes: Uint8Array }[] = [];

function bruecke(opts: { fehler?: string } = {}): FakeFs {
  return {
    available: true,
    standardOrdner: async () => "C:\\Users\\test\\Downloads\\TekkForge",
    schreibe: async (ordner, dateien) => {
      if (opts.fehler) throw new Error(opts.fehler);
      for (const d of dateien) geschrieben.push({ ordner, name: d.name, bytes: d.bytes });
      return { ordner, geschrieben: dateien.map((d) => `${ordner}\\${d.name}`) };
    },
  };
}

beforeEach(() => {
  geschrieben = [];
});
afterEach(() => {
  delete w.tekkFs;
});

describe("legeAb", () => {
  it("schreibt über die Brücke und nennt den Pfad", async () => {
    w.tekkFs = bruecke();
    const r = await legeAb("sicherung.tfbak", "{}", "Sicherungen", "application/json");
    expect(r.ueberDownload).toBe(false);
    expect(r.pfad).toBe("C:\\Users\\test\\Downloads\\TekkForge\\Sicherungen\\sicherung.tfbak");
    expect(geschrieben[0].ordner).toBe("C:\\Users\\test\\Downloads\\TekkForge\\Sicherungen");
  });

  it("ohne Unterordner landet die Datei direkt im Standardordner", async () => {
    w.tekkFs = bruecke();
    const r = await legeAb("x.bin", new Uint8Array([1, 2, 3]));
    expect(r.pfad).toBe("C:\\Users\\test\\Downloads\\TekkForge\\x.bin");
  });

  it("Text wird als Bytes geschrieben, nicht als Zeichenkette", async () => {
    // Die Brücke reicht die Bytes als Zahlen-Array weiter; ein String käme
    // dort als Zeichenkette an und würde zu einer unbrauchbaren Datei.
    w.tekkFs = bruecke();
    await legeAb("t.json", '{"a":1}');
    expect(geschrieben[0].bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(geschrieben[0].bytes)).toBe('{"a":1}');
  });

  it("ein Schreibfehler wird durchgereicht — nicht als Erfolg gemeldet", async () => {
    // Genau darum geht es: eine Sicherung, die nicht geschrieben wurde, darf
    // nicht als geschrieben durchgehen.
    w.tekkFs = bruecke({ fehler: "Laufwerk schreibgeschützt" });
    await expect(legeAb("s.tfbak", "{}", "Sicherungen")).rejects.toThrow(/schreibgesch/i);
  });
});
