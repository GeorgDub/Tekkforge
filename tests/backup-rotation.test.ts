import { describe, expect, it } from "vitest";
// CJS-Modul, damit electron/main.cjs dieselbe Logik nutzen kann.
import { backupDateiname, backupInfo, zuLoeschen } from "../electron/backup.cjs";

describe("Backup-Dateinamen", () => {
  it("haengt Zeitstempel und .bak an den Originalnamen", () => {
    const n = backupDateiname("scantest.all", new Date(2026, 7, 24, 11, 30, 5));
    expect(n).toBe("scantest.all.20260824-113005.bak");
  });

  it("liest Original und Zeit aus dem Backup-Namen zurueck", () => {
    const info = backupInfo("scantest.all.20260824-113005.bak");
    expect(info?.original).toBe("scantest.all");
    expect(info?.wann.getFullYear()).toBe(2026);
    expect(info?.wann.getMonth()).toBe(7);
    expect(info?.wann.getHours()).toBe(11);
  });

  it("liefert null fuer Fremddateien", () => {
    expect(backupInfo("scantest.all")).toBeNull();
    expect(backupInfo("irgendwas.bak")).toBeNull();
  });
});

describe("Backup-Rotation", () => {
  const namen = (n: number, original = "a.all"): string[] =>
    Array.from({ length: n }, (_, i) => `${original}.2026082${Math.floor(i / 10)}-11300${i % 10}.bak`);

  it("loescht nichts unterhalb des Deckels", () => {
    expect(zuLoeschen(namen(5), "a.all", 20)).toEqual([]);
  });

  it("loescht die aeltesten ueber dem Deckel — nur vom selben Original", () => {
    const alle = [...namen(22, "a.all"), ...namen(3, "b.all")];
    const weg = zuLoeschen(alle, "a.all", 20);
    expect(weg.length).toBe(2);
    expect(weg.every((n) => n.startsWith("a.all."))).toBe(true);
    // die zwei aeltesten Zeitstempel
    expect(weg).toEqual(namen(22, "a.all").slice(0, 2));
  });

  it("ignoriert Dateien, die keinem Backup-Muster folgen", () => {
    expect(zuLoeschen(["a.all", "notes.txt"], "a.all", 1)).toEqual([]);
  });
});
