# TekkForge

**KORG ESX-1 → Electribe 2 Sampler Converter** — eigenständige Software, extrahiert aus dem
hardware-verifizierten Converter-Kern von Synthstudio (v3.271+).

Aus einem ESX-1-All-Backup (`.esx`) entstehen importfertige Dateien für die
Electribe 2 Sampler (inkl. Hacktribe):

| Datei | Inhalt |
|---|---|
| `<name>.e2sallpat` | Pattern-Bank, 250 Slots (4 161 792 Bytes), Parts bereits auf User-Sample-Nummern repointet |
| `<name>-samples.all` | Sample-Bank (`e2sSample.all`-Format), User-Samples ab Nr. 501 |
| `<name>-mapping.md` | Report: Sample-Zuordnung Geräte-Nr. ↔ Name ↔ ESX-Index + Import-Anleitung |

Alles läuft **lokal** — GUI im Browser (keine Uploads), CLI in Node.

## Schnellstart

```bash
pnpm install
pnpm build          # baut CLI (dist/cli.mjs) + GUI (dist/index.html)
```

**GUI:** `dist/index.html` doppelklicken (Single-File, kein Server nötig) — oder `pnpm dev` für den Dev-Server.
ESX-Datei reinziehen → Patterns auswählen → Konvertieren → 3 Downloads.

**CLI:**

```bash
node dist/cli.mjs convert BOTTROP.ESX -o out/
node dist/cli.mjs inspect BOTTROP.ESX          # Pattern-/Sample-Liste
node dist/cli.mjs inspect out/BOTTROP.e2sallpat
```

Optionen für `convert`:

- `-o, --out <dir>` — Ausgabe-Verzeichnis (Default: neben der Eingabe)
- `--base <n>` — erste User-Sample-Nummer (Default 501)
- `--cap <sek>` — Sample-RAM-Deckel in Mono-Sekunden (Default 260, Hardware ≈ 270)
- `--only <regex>` — nur Patterns, deren Name matcht

## Import am Gerät

1. Beide Dateien auf die SD-Karte (`KORG/…`).
2. Am Gerät zuerst die `.all`-**Sample-Bank** importieren (User-Samples ab 501).
3. Dann die `.e2sallpat`-**Pattern-Bank** importieren — die Parts zeigen bereits auf die richtigen Nummern.

Überschreitet das Quell-Backup das Sample-RAM (~270 s mono), werden überzählige Samples
weggelassen und im Mapping-Report ausgewiesen — so schlägt der Geräte-Import nicht fehl.

## Entwicklung

```bash
pnpm check          # TypeScript
pnpm test           # Vitest (Golden-File- + Round-Trip-Tests)
```

Tests gegen echte Dateien werden automatisch übersprungen, wenn die Fixtures fehlen:

- `E:/esx/BOTTROP.ESX` — reales ESX-1-Backup (End-to-End-Konvertierung)
- `examples/e2s/` — von der Hardware akzeptierte Golden Files (Round-Trip)

## Architektur

```
src/core/   reine Domain-Library (kein DOM, kein Node) — isomorph
  esxParser.ts             ESX-1 All-Backup Parser (Patterns, Samples, Songs; Big-Endian)
  esxToE2sBank.ts          Kern-Converter ESX → .e2sallpat + .all
  e2sBankBuilder.ts        e2sSample.all Writer (esli-Container, OSC_0index, UFix)
  e2sBankReader.ts         e2sSample.all Parser
  electribePatternBuilder.ts  .e2spat/.e2sallpat Pattern-Serializer (PTST/PTED)
  electribeImport.ts       .e2sallpat Parser + Format-Konstanten
  e2sExport.ts             250-Slot-Bank-Assembly (Template-Overlay, byte-exakt)
  audioProcessor.ts        Resampling + Float→i16 (defensive Sanitization)
  bankDetect.ts            Format-Erkennung (.esx vs .all)
src/cli.ts   Node-CLI (esbuild-Bundle → dist/cli.mjs)
src/gui/     Browser-GUI (Vite + vite-plugin-singlefile → dist/index.html)
tests/       Vitest — portierte Feature-Tests aus Synthstudio
```

Format-Referenzen: Korg-Forum t=95368, bangcorrupt/hacktribe, rafamj/elecmidi,
untergeekDE/electribe2-docs. Byte-Offsets hardware-verifiziert (siehe Kommentare in `src/core/`).

## Roadmap (aus dem TekkForge-Briefing)

- **M1 (MVP, dieses Repo):** ESX→E2-Konvertierung mit Pattern-Auswahl, CLI + GUI ✅
- **M2:** Pattern-Grid-Editor (16×64), Part-Parameter, `.e2spat`-Einzel-Export
- **M3:** Bank-Manager (umsortieren/ersetzen), Layout-Templates, Motion read-only, SysEx-Transfer
