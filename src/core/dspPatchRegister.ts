/**
 * dspPatchRegister — bekannte, gleichlange Aenderungen im BF523-DSP-Abbild.
 *
 * ERZEUGT von scripts/import-dsp-patches.mjs aus Omnitribes Patch-Dateien
 * (src/firmware/patches/*.json), nicht von Hand pflegen. Die alten Bytes sind
 * der Fingerabdruck, die neuen die Aenderung; Status ehrlich nach Omnitribes
 * Stand. Details zu Herkunft und Mechanik: core/dspPatch.ts.
 */
import { hexZuBytes, type DspPatch } from "./dspPatch";

const ROH = [
 {
  "id": "bf523_blk15_amount_halfmax",
  "titel": "Amount-Kurve: Maximum halbiert",
  "beschreibung": "14-stufige float-Kurve 0,02…1,00 im Sample-Pfad: nur das Maximum 1,0 → 0,5. Rolle unklar (Filter-Anteil, Pegel oder Modulationstiefe).",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0x99F8",
    "old": "0ad7a33c0ad7233d8fc2753d0ad7a33dcdcccc3dcdcc4c3e9a99993ecdcccc3e0000003f9a99193f3333333fcdcc4c3f6666663f0000803f",
    "new": "0ad7a33c0ad7233d8fc2753d0ad7a33dcdcccc3dcdcc4c3e9a99993ecdcccc3e0000003f9a99193f3333333fcdcc4c3f6666663f0000003f"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_blk15_amount_halfmax.json"
 },
 {
  "id": "bf523_blk15_paramcurve_halfall",
  "titel": "Voice-Kurve: alles halbiert",
  "beschreibung": "Dieselbe Kurve, alle 8 Stufen halbiert, Form bleibt.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0x9400",
    "old": "00006f4f00003b550000605b0000e1610000c668000013700000ce770000ff7f",
    "new": "0000b72700009d2a0000b02d0000f03000006334000009380000e73b0000ff3f"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_blk15_paramcurve_halfall.json"
 },
 {
  "id": "bf523_blk15_paramcurve_halftop",
  "titel": "Voice-Kurve: Endpunkt halbiert",
  "beschreibung": "8-stufige int16-Parameterkurve im Sample-Pfad (SDRAM-Block 15): nur der Vollausschlag 0x7FFF → 0x3FFF.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0x9400",
    "old": "00006f4f00003b550000605b0000e1610000c668000013700000ce770000ff7f",
    "new": "00006f4f00003b550000605b0000e1610000c668000013700000ce770000ff3f"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_blk15_paramcurve_halftop.json"
 },
 {
  "id": "bf523_coslut_halfamp",
  "titel": "Wellentabelle halbe Amplitude",
  "beschreibung": "Halbcosinus-Tabelle (129 × int16) um 6 dB leiser, gleiche Form. Betrifft Klangquellen, die diese Tabelle lesen (LFO/Oszillator im DSP).",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0xFF803BD8",
    "old": "ff7fff7fff7fff7fff7fff7ffe7ffc7ffa7ff77ff27feb7fe17fd57fc57fb17f987f787f527f237feb7ea97e5a7efe7d937d177d897ce67b2d7b5c7a71796a784577007699740e735e71866f856d5a6b03697f66cd63ec60dc5d9d5a2e579053c34fc94ba2474f43d23e2e3a643577306a2b4026fb209f1b3116b210280b9605000069fad7f44defcee960e404dfbfd995d488cf9bcad1c52dc1b0bc5db836b43cb06facd1a862a523a2139f329c8099fc96a5947a927990a18ef18c668bff89ba8895878e86a385d28419847683e8826c820182a58156811481dc80ad80878067804e803a802a801e8014800d800880058003800180018001800180018001800180",
    "new": "ff3fff3fff3fff3fff3fff3fff3ffe3ffd3ffb3ff93ff53ff03fea3fe23fd83fcc3fbc3fa93f913f753f543f2d3fff3ec93e8b3e443ef33d963d2e3db83c353ca23b003b4c3a8739af38c337c236ad3581343f33e6317630ee2e4e2d972bc829e127e425d123a721691f171db21a3b18b51520137d10cf0d180b59089405cb02000034fd6bfaa6f7e7f430f282efdfec4aeac4e74de5e8e296e058de2edc1bda1ed837d668d4b1d211d189cf19cec0cc7ecb52ca3dc93cc850c778c6b3c5ffc45dc4cac347c3d1c269c20cc2bbc174c136c100c1d2c0abc08ac06ec056c043c033c027c01dc015c00fc00ac006c004c002c001c000c000c000c000c000c000c000c0"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_coslut_halfamp.json"
 },
 {
  "id": "bf523_coslut_quarteramp",
  "titel": "Wellentabelle viertel Amplitude",
  "beschreibung": "Dieselbe Tabelle um 12 dB leiser.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0xFF803BD8",
    "old": "ff7fff7fff7fff7fff7fff7ffe7ffc7ffa7ff77ff27feb7fe17fd57fc57fb17f987f787f527f237feb7ea97e5a7efe7d937d177d897ce67b2d7b5c7a71796a784577007699740e735e71866f856d5a6b03697f66cd63ec60dc5d9d5a2e579053c34fc94ba2474f43d23e2e3a643577306a2b4026fb209f1b3116b210280b9605000069fad7f44defcee960e404dfbfd995d488cf9bcad1c52dc1b0bc5db836b43cb06facd1a862a523a2139f329c8099fc96a5947a927990a18ef18c668bff89ba8895878e86a385d28419847683e8826c820182a58156811481dc80ad80878067804e803a802a801e8014800d800880058003800180018001800180018001800180",
    "new": "ff1fff1fff1fff1fff1fff1fff1fff1ffe1ffd1ffc1ffa1ff81ff51ff11fec1fe61fde1fd41fc81fba1faa1f961f7f1f641f451f221ff91ecb1e971e5c1e1a1ed11d801d261dc31c571ce11b611bd61a401a9f19f3183b187717a716cb15e414f013f212e811d310b40f8b0e590d1d0cda0a90093e08e7068c052c04ca02650100009afe35fdd3fb73fa18f9c1f76ff625f5e2f3a6f274f14bf02cef17ee0ded0fec1beb34ea58e988e8c4e70ce760e6bfe529e59ee41ee4a8e33ce3d9e27fe22ee2e5e1a3e168e134e106e1dde0bae09be080e069e055e045e037e02be021e019e013e00ee00ae007e005e003e002e001e000e000e000e000e000e000e000e000e0"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_coslut_quarteramp.json"
 },
 {
  "id": "bf523_coslut_triangle",
  "titel": "Wellentabelle Dreieck statt Cosinus",
  "beschreibung": "Die Halbcosinus-Form wird durch eine lineare Rampe mit denselben Endpunkten ersetzt — härterer Verlauf.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0xFF803BD8",
    "old": "ff7fff7fff7fff7fff7fff7ffe7ffc7ffa7ff77ff27feb7fe17fd57fc57fb17f987f787f527f237feb7ea97e5a7efe7d937d177d897ce67b2d7b5c7a71796a784577007699740e735e71866f856d5a6b03697f66cd63ec60dc5d9d5a2e579053c34fc94ba2474f43d23e2e3a643577306a2b4026fb209f1b3116b210280b9605000069fad7f44defcee960e404dfbfd995d488cf9bcad1c52dc1b0bc5db836b43cb06facd1a862a523a2139f329c8099fc96a5947a927990a18ef18c668bff89ba8895878e86a385d28419847683e8826c820182a58156811481dc80ad80878067804e803a802a801e8014800d800880058003800180018001800180018001800180",
    "new": "ff7fff7dff7bff79ff77ff75ff73ff71ff6fff6dff6bff69ff67ff65ff63ff61ff5fff5dff5bff59ff57ff55ff53ff51ff4fff4dff4bff49ff47ff45ff43ff410040003e003c003a00380036003400320030002e002c002a00280026002400220020001e001c001a00180016001400120010000e000c000a0008000600040002000000fe00fc00fa00f800f600f400f200f000ee00ec00ea00e800e600e400e200e000de00dc00da00d800d600d400d200d000ce00cc00ca00c800c600c400c200c001be01bc01ba01b801b601b401b201b001ae01ac01aa01a801a601a401a201a0019e019c019a01980196019401920190018e018c018a01880186018401820180"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_coslut_triangle.json"
 },
 {
  "id": "bf523_coslut_zero",
  "titel": "Wellentabelle nullen (Diskriminator)",
  "beschreibung": "Die 129-Punkt-Halbcosinus-Tabelle im L1 auf Null — kein Klang, sondern der Nachweis, dass das gepatchte DSP-Abbild läuft. Nur zum Testen.",
  "status": "diskriminator",
  "edits": [
   {
    "vaddr": "0xFF803BD8",
    "old": "ff7fff7fff7fff7fff7fff7ffe7ffc7ffa7ff77ff27feb7fe17fd57fc57fb17f987f787f527f237feb7ea97e5a7efe7d937d177d897ce67b2d7b5c7a71796a784577007699740e735e71866f856d5a6b03697f66cd63ec60dc5d9d5a2e579053c34fc94ba2474f43d23e2e3a643577306a2b4026fb209f1b3116b210280b9605000069fad7f44defcee960e404dfbfd995d488cf9bcad1c52dc1b0bc5db836b43cb06facd1a862a523a2139f329c8099fc96a5947a927990a18ef18c668bff89ba8895878e86a385d28419847683e8826c820182a58156811481dc80ad80878067804e803a802a801e8014800d800880058003800180018001800180018001800180",
    "new": "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_coslut_zero.json"
 },
 {
  "id": "bf523_filter_amtcurve_inv",
  "titel": "Amount-Kurve: umgekehrt",
  "beschreibung": "Die Rampe 0,02…1,00 wird zu 1,00…0,02 — größtmögliche Änderung der Daten bei gleicher Länge.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0x99f8",
    "old": "0ad7a33c0ad7233d8fc2753d0ad7a33dcdcccc3dcdcc4c3e9a99993ecdcccc3e0000003f9a99193f3333333fcdcc4c3f6666663f0000803f",
    "new": "0000803f6666663fcdcc4c3f3333333f9a99193f0000003fcdcccc3e9a99993ecdcc4c3ecdcccc3d0ad7a33d8fc2753d0ad7233d0ad7a33c"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_filter_amtcurve_inv.json"
 },
 {
  "id": "bf523_filter_amtcurve_max",
  "titel": "Amount-Kurve: alles Maximum (A/B)",
  "beschreibung": "Alle 14 Stufen auf 1,0 — A/B-Partner zu „alles Minimum“. Klingt der Unterschied, liegt die Kurve auf einem aktiven Pfad.",
  "status": "diskriminator",
  "edits": [
   {
    "vaddr": "0x99f8",
    "old": "0ad7a33c0ad7233d8fc2753d0ad7a33dcdcccc3dcdcc4c3e9a99993ecdcccc3e0000003f9a99193f3333333fcdcc4c3f6666663f0000803f",
    "new": "0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f0000803f"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_filter_amtcurve_max.json"
 },
 {
  "id": "bf523_filter_amtcurve_min",
  "titel": "Amount-Kurve: alles Minimum (A/B)",
  "beschreibung": "Alle 14 Stufen auf 0,05 — A/B-Partner zu „alles Maximum“.",
  "status": "diskriminator",
  "edits": [
   {
    "vaddr": "0x99f8",
    "old": "0ad7a33c0ad7233d8fc2753d0ad7a33dcdcccc3dcdcc4c3e9a99993ecdcccc3e0000003f9a99193f3333333fcdcc4c3f6666663f0000803f",
    "new": "cdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3dcdcc4c3d"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_filter_amtcurve_min.json"
 },
 {
  "id": "bf523_osc007d0_fullscale",
  "titel": "Oszillator-Konstante 0x7FFF → 0x7000",
  "beschreibung": "Eine Vollausschlag-Konstante im L1-Code (LOAD R2.H) auf 0x7000 — Code-Immediate, höheres Risiko als Tabellen.",
  "status": "hoerprobe-offen",
  "edits": [
   {
    "vaddr": "0xFFA00810",
    "old": "42e1ff7f",
    "new": "42e10070"
   }
  ],
  "quelle": "Omnitribe src/firmware/patches/bf523_osc007d0_fullscale.json"
 }
] as const;

export const DSP_PATCH_REGISTER: readonly DspPatch[] = ROH.map((p) => ({
  id: p.id,
  titel: p.titel,
  beschreibung: p.beschreibung,
  quelle: p.quelle,
  status: p.status as DspPatch["status"],
  edits: p.edits.map((e) => ({ ...(e.vaddr ? { vaddr: Number(e.vaddr) } : {}), alt: hexZuBytes(e.old), neu: hexZuBytes(e.new) })),
}));
