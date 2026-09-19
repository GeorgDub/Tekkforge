// Buendelt die kompilierten Omnitribe-Modul-.bin als Base64 in src/core/omniModuleBins.ts.
// Neu ausfuehren, wenn sich ein Modul aendert: node scripts/bundle-omni-modules.mjs
import fs from "node:fs";
import path from "node:path";

const SRC = process.env.OMNI_BUILD_DIR || "G:/IdeaProjects/Omnitribe/build/modules_abs";
const MODULE = [
  { id: 9, datei: "chord.bin" },
  { id: 1, datei: "arpeggiator.bin" },
  { id: 19, datei: "spectral_morph.bin" },
  { id: 20, datei: "sd_stream.bin" },
  { id: 21, datei: "audio_input_routing.bin" },
  { id: 30, datei: "audio_test.bin" },
];
const eintraege = [];
for (const m of MODULE) {
  const p = path.join(SRC, m.datei);
  if (!fs.existsSync(p)) { console.warn(`uebersprungen (fehlt): ${p}`); continue; }
  const b64 = fs.readFileSync(p).toString("base64");
  eintraege.push(`  ${m.id}: "${b64}",`);
  console.log(`gebuendelt id ${m.id}: ${m.datei} (${fs.statSync(p).size} B)`);
}
const out = `// AUTOGENERIERT von scripts/bundle-omni-modules.mjs — nicht von Hand editieren.
// Base64 der kompilierten Omnitribe-Modul-.bin (Header + code + data).
export const OMNI_MODULE_BINS: Record<number, string> = {
${eintraege.join("\n")}
};

export function omniModuleBytes(id: number): Uint8Array | null {
  const b64 = OMNI_MODULE_BINS[id];
  if (!b64) return null;
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
`;
fs.writeFileSync("src/core/omniModuleBins.ts", out);
console.log("geschrieben: src/core/omniModuleBins.ts");
