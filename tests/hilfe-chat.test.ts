import { describe, it, expect } from "vitest";
import { HILFE_SYSTEM, baueChatAnfrage, VERLAUF_MAX } from "../src/core/hilfeChat";

describe("hilfeChat", () => {
  it("System-Prompt kennt die Module und bleibt deutsch", () => {
    for (const wort of ["TekkForge", "Editor", "Generator", "Pad-Deck", "Electribe"]) {
      expect(HILFE_SYSTEM).toContain(wort);
    }
  });
  it("baut aus dem Verlauf abwechselnde user/assistant-Messages", () => {
    const a = baueChatAnfrage([
      { rolle: "nutzer", text: "Wie lade ich eine Bank?" },
      { rolle: "ki", text: "Im Generator …" },
      { rolle: "nutzer", text: "Und aufs Geraet?" },
    ]);
    expect(a.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(a.messages[2].content).toBe("Und aufs Geraet?");
    expect(a.system).toBe(HILFE_SYSTEM);
  });
  it("kappt einen langen Verlauf auf die letzten Eintraege", () => {
    const lang = Array.from({ length: 40 }, (_, i) => ({
      rolle: (i % 2 ? "ki" : "nutzer") as "ki" | "nutzer",
      text: `Nr ${i}`,
    }));
    const a = baueChatAnfrage(lang);
    expect(a.messages.length).toBeLessThanOrEqual(VERLAUF_MAX);
    expect(a.messages[a.messages.length - 1].content).toBe("Nr 39");
    expect(a.messages[0].role).toBe("user");
  });
});
