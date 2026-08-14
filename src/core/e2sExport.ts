/**
 * client/src/utils/e2sExport.ts
 *
 * v3.271.0 — KORG Electribe 2 Sampler export via TEMPLATE-OVERLAY.
 *
 * WHY THIS EXISTS (and why it replaces the from-scratch builder):
 *   The previous `electribePatternBuilder.ts` synthesised `.e2spat` files from
 *   zero. Byte-diffing real KORG files (in "Korg e2s files/") against that
 *   output proved it got several things wrong that the hardware rejects:
 *     - Part headers (sample-ID, filter, amp-EG, motion config) were left all
 *       zero. Real parts carry a structured 48-byte config block.
 *     - Step records used the wrong field layout (note/velocity swapped, the
 *       gate-flag byte 3 and gate-length byte 4 were never written) → even a
 *       "valid-size" file produced silent / malformed steps.
 *   Its round-trip tests passed because the builder and the parser shared the
 *   same wrong spec. Real files are the only ground truth.
 *
 * APPROACH:
 *   Start from a real, hardware-valid pattern body (factory "Init Pattern",
 *   embedded in `e2sExportAssets.ts`, with its step records normalized to the
 *   canonical inactive form). Overlay ONLY the fields whose offsets are verified
 *   against the real files; leave every opaque region (part config, motion
 *   tables, global bank settings) exactly as the hardware wrote it. The output
 *   is therefore byte-identical to a real file except where we intentionally
 *   wrote pattern content.
 *
 * VERIFIED FORMAT (all offsets little-endian; "body" = one 16384-byte PTST record):
 *
 *   .e2spat (single pattern, 16640 bytes):
 *     0x000  256B  file header: "KORG"\0… + "e2sampler"\0… + u32 ver=1 + 0xFF pad
 *     0x100  16384B PTST body
 *
 *   .e2sallpat (250-pattern bank, 4 161 792 bytes):
 *     0x00000  256B    file header (same as above; "GLST" replaces "PTST"@0x100)
 *     0x00100  256B    GLST/GLED global block (embedded verbatim)
 *     0x00200  65280B  0xFF padding → prefix ends at 0x10100
 *     0x10100  250×16384B  pattern bodies
 *
 *   PTST body (offsets relative to body start):
 *     +0x000  4B   "PTST"
 *     +0x010  16B  pattern name, ASCII, NUL-padded
 *     +0x022  2B   BPM × 10 (u16 LE)
 *     +0x025  1B   step-length code (16→0, 32→1, 64→3)
 *     +0x800  16×816B  parts
 *       part +0x15  volume (0..127)
 *       part +0x22  pan    (0..127, 64 = center)
 *       part +0x30  64×12B step records:
 *         byte 0      trigger  (1 = aktiv, 0 = aus)
 *         byte 1      Gate-Zeit (Anzeige = Byte, 0..96; 0x48 = 72 Vorgabe).
 *                     ✔ Am Geraet gemessen: 32, 47, 60 und 86 kamen jeweils
 *                     unveraendert an. Der Wert 96 ist eine regulaere Gate-Zeit
 *                     und keine Sonderform — ein AKTIVER Step mit 96 liess sich
 *                     auf 86 herunterstellen, wobei sich im ganzen Pattern nur
 *                     dieses eine Byte bewegte. Der Trigger blieb unberuehrt;
 *                     das Aendern der Gate-Zeit schaltet einen Step also nicht
 *                     ab.
 *                     TIE ist am Geraet 127 und sitzt als Sentinel darueber;
 *                     Factory-Dateien fuehren daneben sehr haeufig 255 —
 *                     siehe ELECTRIBE_REAL_GATE_TIE_ALT.
 *         byte 2      Velocity  (Anzeige = Byte; 0x60 = 96 Vorgabe)
 *         byte 3      Flag — Bedeutung offen, siehe unten
 *         bytes 4..7  bis zu VIER Noten, je MIDI+1 (0 = leer)
 *         bytes 8..11 bislang immer 0
 *
 *       ✔ Am Geraet gemessen (2026-08-14): Gate-Zeit und Velocity stehen
 *       unverschluesselt im Byte (Anzeige 60 -> 60, Anzeige 52 -> 52).
 *
 *       ⚠ Byte 3 („STEP_FLAG"): Bedeutung UNBEKANNT. Der fruehere Kommentar
 *       behauptete, das Byte muesse auf aktiven Steps 1 sein, sonst bleibe der
 *       Step stumm — das ist nicht haltbar, hoerbare Geraete-Steps tragen dort
 *       auch 0. Zwei Deutungen wurden geprueft und BEIDE widerlegt:
 *
 *         „0 heisst vier Noten" — passte zunaechst zu allen Geraetemessungen
 *         (1/2/3 Noten -> 1, 4 Noten -> 0) und scheiterte an BodyTalk1: dort
 *         tragen 105 Steps eine 0, obwohl die Datei ueberhaupt keinen Step mit
 *         mehr als einer Note enthaelt. Inzwischen widerlegt sie auch das
 *         Geraet selbst — ein neu gesetzter Step mit genau EINER Note trug 0.
 *
 *         „0 heisst Motion auf diesem Step" — passte ebenfalls zu allen
 *         Geraetemessungen, scheitert aber an der Factory-Bank: unter den
 *         Byte3=0-Steps haben 11 % eine Motion, unter den Byte3=1-Steps 6 %.
 *         Ein Zusammenhang, aber keine Regel.
 *
 *       Beide Deutungen haetten zu allen bis dahin vorliegenden Messungen
 *       gepasst — die Factory-Bank hat sie erledigt. Ein Byte, dessen Deutung
 *       an fuenf Messpunkten haelt, ist eben noch lange nicht verstanden.
 *       Der Schreibpfad setzt weiter 1 und bleibt unangetastet.
 *
 *       Auffaellig, aber nicht mehr als das: quer durch alle Messungen trugen
 *       genau die Steps eine 0, die der Nutzer im Step-Editor neu aktiviert
 *       hatte, waehrend die schon im Pattern vorhandenen Steps eine 1 trugen —
 *       unabhaengig von Notenzahl, Gate und Velocity. Eine naheliegende
 *       Nebendeutung („1 heisst eigene Gate-/Velocity-Werte") scheitert daran,
 *       dass neu gesetzte Steps mit Gate 60 / Velocity 52 trotzdem 0 tragen.
 *
 *       Das deutet auf eine Herkunfts- oder Bearbeitungsmarkierung. Als Deutung
 *       taugt es nicht: sie sagt nichts darueber, was das Geraet damit tut, und
 *       von aussen laesst sich das auch nicht pruefen. Es steht hier, damit die
 *       Beobachtung nicht verlorengeht — nach vier erledigten Deutungen ist eine
 *       fuenfte, die nur passt, keine Grundlage fuer Code.
 *
 *       Das Flag ist ausserdem bestaendig: ein Ein-/Ausschalten des Steps laesst
 *       es unberuehrt, und zwar in beiden Auspraegungen (ein Step mit 1 behielt
 *       die 1, einer mit 0 die 0). Es haengt also am Step, nicht am Zustand.
 *
 *       Ein am Geraet abgeschalteter Step behaelt Gate, Velocity und Noten;
 *       nur das Trigger-Byte faellt auf 0. Dass der Trigger bei einer frueheren
 *       Messung ueberhaupt umsprang, war eine getrennte Bedienung und keine
 *       Folge des Gate-Aenderns — eine spaetere Gate-Aenderung an einem aktiven
 *       Step bewegte nur das Gate-Byte.
 *
 *       Daran haengt auch ein Unterschied zum Schreibpfad: das Geraet laesst
 *       einem stillgelegten Step seine Werte, waehrend TekkForge ihn auf den
 *       kanonischen Leerstand 00 48 60 00 00 zuruecksetzt. Hoerbar ist das
 *       nicht — der Trigger entscheidet —, aber beim erneuten Einschalten am
 *       Geraet sind die alten Werte weg.
 *
 *       ✔ Alle vier Notenplaetze werden geschrieben und gelesen. Die
 *       Factory-Bank belegt sie ebenfalls alle (53202 / 5065 / 4096 / 3719
 *       Vorkommen).
 *
 * Pure TypeScript, isomorphic (no Electron/DOM deps) — safe in Node test ctx.
 *
 * LIMITATION: samples are NOT transferred by this path (that is the separate
 * `.all` sample-bank builder). Exported patterns trigger whatever samples the
 * destination Electribe has loaded in the matching part slots.
 */

import {
  E2_STEP_NOTE_SLOTS,
  midiNoteToE2StepByte,
  resolveStepNotes,
} from "./e2StepNote";
import { E2S_INIT_BODY_B64, E2S_GLST_BLOCK_B64 } from "./e2sExportAssets";
import type { E2PatternInput } from "./electribePatternBuilder";
import {
  ELECTRIBE_MOTION_DATA_TABLE_OFFSET,
  ELECTRIBE_MOTION_PARAM_TABLE_OFFSET,
  ELECTRIBE_MOTION_SLOTS_PER_PATTERN,
  ELECTRIBE_MOTION_SLOT_STRIDE,
  ELECTRIBE_MOTION_TARGET_TABLE_OFFSET,
  ELECTRIBE_MOTION_VALUES_PER_SLOT,
} from "./electribeImport";
import { writePartParamsToBody } from "./partParams";

// ─── Layout constants (verified against real KORG files) ─────────────────────

/** One PTST pattern body. */
export const E2S_BODY_SIZE = 0x4000; // 16384
/** Standalone .e2spat file header. */
export const E2S_FILE_HEADER_SIZE = 0x100; // 256
/** Standalone .e2spat total size. */
export const E2S_SINGLE_FILE_SIZE = E2S_FILE_HEADER_SIZE + E2S_BODY_SIZE; // 16640
/** .e2sallpat prefix (header + GLST block + 0xFF pad). */
export const E2S_ALLPAT_PREFIX_SIZE = 0x10100; // 65792
/** Pattern slots in a bank (hardware-fixed). */
export const E2S_ALLPAT_SLOT_COUNT = 250;
/** .e2sallpat total size. */
export const E2S_ALLPAT_FILE_SIZE =
  E2S_ALLPAT_PREFIX_SIZE + E2S_ALLPAT_SLOT_COUNT * E2S_BODY_SIZE; // 4_161_792

const GLST_OFFSET = 0x100;

// body-relative field offsets
const NAME_OFF = 0x10;
// ✔ Ein drittes Mal bestaetigt (2026-08-14): Tempo 100 -> Bytes 0xE8 0x03 =
// LE 1000. Der Global-Block blieb dabei erneut unveraendert; sein Byte +0x18
// steht seit 26 Lesevorgaengen konstant auf 100 und ist NICHT das Tempo.
// ✔ Am Geraet bestaetigt (2026-08-14): Tempo von 120 auf 135 geaendert — im
// gesamten 2-KB-Pattern-Kopf bewegten sich GENAU diese zwei Bytes
// (176,4 -> 70,5 = LE 1200 -> 1350). Der Global-Block blieb unveraendert,
// Tempo gehoert also zum Pattern.
const BPM_OFF = 0x22;

// ─── Weitere Pattern-Kopf-Felder, am Geraet bestaetigt ───────────────────────
//
// Aus derselben Messreihe. Alle drei speichern 0-basiert, waehrend das Geraet
// 1-basiert anzeigt — dieselbe Verschiebung wie bei modType und grooveType.
//
//   +0x27  Key        G# eingestellt -> 8   (Halbton ab C: C=0 … G#=8)
//   +0x28  Scale      70 angezeigt   -> 69
//   +0x3D  MFX-Typ    32 angezeigt   -> 31  (Tube Drive)
//
// TekkForge schreibt diese Felder derzeit NICHT — sie sind hier nur
// dokumentiert, damit die naechste Erweiterung nicht wieder suchen muss.
export const PATTERN_KEY_OFF = 0x27;

/**
 * Last Step eines Parts — **pro Part**, nicht pattern-weit.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Eingestellt wurden Parts 9-16 auf
 * 14/16/2/5/7/9/13/15, gelesen wurde bei Part-Offset 0x00:
 *
 *     0 0 0 0 0 0 0 0  14  0  2  5  7  9  13  15
 *
 * Sieben der acht Werte stimmen exakt. Der achte ist der interessante: Part 10
 * war auf **16** gestellt und steht als **0** im Speicher.
 *
 * ⇒ Gespeichert wird `Anzeige mod 16`. Die 16 ist die 0. Dazu passt die
 * Bedienung: am Geraet schlaegt der Wert von 1 nach unten auf 16 um.
 *
 * ### Das widerlegt einen Schluss in der Omnitribe-Doku
 *
 * `docs/hwtest/sitzung_2026-08-10.md` liest dort ueber alle 16 Parts eine 0 und
 * folgert: „LastStep 0 bei 64 Steps ist Unsinn ⇒ der RAM-Block hat am Part-Kopf
 * ein anderes Layout als der Sysex-Body."
 *
 * Das Layout ist NICHT anders. Die 0 war kein Widerspruch, sondern der
 * Normalfall: alle Parts standen auf 16 Steps. Der Fehler lag in der Annahme,
 * ein Feld muesse seinen Anzeigewert speichern — hier ist die Obergrenze auf
 * die Null abgebildet.
 */
export const PART_LAST_STEP_OFF = 0x00;

/**
 * Chain-Einstellungen — im Schwanz HINTER dem Part-Block.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Chain To 4 -> 6 und Chain Repeat
 * 11 -> 64 (Maximum) geaendert; im gesamten 16-KB-PTST bewegten sich genau
 * diese zwei Bytes:
 *
 *     +0x3B00  4 -> 6     Chain To
 *     +0x3B02  11 -> 64   Chain Repeat
 *
 * `0x3B00` ist das erste Byte hinter den Parts (`0x800 + 16 * 816`). Damit ist
 * der PTST-Aufbau komplett:
 *
 * ```
 * 0x0000 … 0x07FF   Pattern-Kopf (BPM, Key, Scale, MFX-Typ …)
 * 0x0800 … 0x3AFF   16 Part-Bloecke a 816 B
 * 0x3B00 … 0x3FFF   Schwanz — hier stehen die Chain-Werte
 * ```
 *
 * ### Dritte Kodierungsregel
 *
 * Beide Felder speichern den **Anzeigewert direkt**: die 64 steht als 64, nicht
 * als 0. Damit sind in diesem Format drei verschiedene Konventionen belegt:
 *
 * | Regel                  | Felder                                        |
 * |------------------------|-----------------------------------------------|
 * | 0-basiert (Anzeige −1) | modType, grooveType, Key, Scale, MFX-Typ      |
 * | Modulo (16 → 0)        | Last Step                                     |
 * | direkt                 | Chain To, Chain Repeat                        |
 * | invertiert (127 − x)   | Pattern-Level                                 |
 * | signed, direkt         | Swing, egInt, oscPitch                        |
 *
 * Eine 0 in diesem Format kann also „aus", „erster Eintrag" ODER „Maximum"
 * bedeuten. Wer ein neues Feld deutet, muss die Regel mitmessen — sie laesst
 * sich nicht aus dem Wert allein ablesen.
 */
/**
 * Pattern-Level — als **Daempfung** gespeichert, nicht als Pegel.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung: Level 101 -> 103.
 * Im gesamten Pattern-Kopf bewegte sich GENAU EIN Byte, und zwar gegenlaeufig:
 *
 *     Level 101  ->  +0x2A = 26      101 + 26 = 127
 *     Level 103  ->  +0x2A = 24      103 + 24 = 127
 *
 * ⇒ `Byte = 127 - Level`. Die 0 ist volle Lautstaerke, 127 ist still.
 *
 * Das erklaert, warum die fruehere Suche nach der Zahl 101 im Kopf ins Leere
 * lief: der eingestellte Wert steht dort gar nicht. Wer ein Feld ueber seinen
 * Anzeigewert sucht, findet nur die Felder, die ihn auch speichern — und das
 * ist in diesem Format eher die Ausnahme.
 *
 * (Zwei Messpunkte legen die Gerade fest; Steigung -1 und Achsenabschnitt 127
 * sind damit belegt, nicht geraten.)
 */
/**
 * Swing — **pro Pattern**, vorzeichenbehaftet, direkt in Prozent.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung auf -45 %. Im
 * gesamten Pattern-Kopf bewegte sich genau ein Byte:
 *
 *     +0x24  48 -> 211     als i8:  +48 -> -45
 *
 * Der Bereich ist -50 … +50 %, gespeichert als signed byte ohne Umrechnung —
 * dieselbe Konvention wie `egInt` und `oscPitch` im Part-Block.
 *
 * (Swing ist NICHT pro Part, auch wenn das Geraet ihn im Part-Kontext anbietet.)
 */
/**
 * Beat (Aufloesung des Patterns) — pro Pattern, als Listenindex.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung auf „32": im
 * gesamten Pattern-Kopf bewegte sich genau ein Byte, `+0x26` von 3 auf 1.
 *
 * Die Werteliste ist der Listenindex in der Reihenfolge des Geraets:
 *
 * | Anzeige | Byte |                          |
 * |---------|------|--------------------------|
 * | 16      | 0    | gemessen                 |
 * | 32      | 1    | gemessen                 |
 * | 8 Tri   | 2    | aus der Reihenfolge      |
 * | 16 Tri  | 3    | gemessen (Ausgangsstand) |
 *
 * Drei der vier Werte sind direkt gemessen. Die 2 folgt aus der vom Nutzer
 * genannten Reihenfolge und ist die einzige Luecke — sie liegt zwischen zwei
 * gemessenen Punkten, kann also nicht gross danebenliegen.
 *
 * Der letzte Schritt war eine Gegenprobe mit Vorhersage: nach „Beat 32 -> 1"
 * stand fest, dass „16" eine 0 ergeben muss. Genau das kam heraus.
 */
/**
 * Alternate — **ein Byte pro Part-Paar**, nicht eine Bitmaske.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Paar 13-14 auf „an" und 15-16 auf „aus"
 * gestellt; im Pattern-Kopf bewegten sich genau zwei Bytes, je um ein Bit und
 * gegenlaeufig:
 *
 *     +0x44  0 -> 1     Paar 13-14
 *     +0x45  1 -> 0     Paar 15-16
 *
 * Das widerlegt die naheliegende Erwartung einer Bitmaske: acht Paare in einem
 * Byte haetten EIN Byte mit zwei gekippten Bits ergeben, nicht zwei Bytes mit
 * je einem.
 *
 * Diese beiden Offsets sind die VOLLSTAENDIGE Menge: das Geraet kennt nur die
 * Paare 13-14 und 15-16, kein Alternate fuer die uebrigen Parts. Meine
 * Ueberlegung, hier koennte ein Array von acht Paar-Bytes liegen, war damit
 * gegenstandslos — sie stuetzte sich auf die Annahme, alle 16 Parts haetten
 * Alternate-Partner.
 */
/**
 * Gate Arp — pro Pattern, 0-basiert gespeichert.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14): auf den Maximalwert 50 gestellt, `0x31`
 * las danach 49. Bereich am Geraet 1..50, im Speicher also 0..49.
 *
 * Der Wert stand die ganze Messreihe ueber sichtbar im Kopf (als 19 = Anzeige
 * 20) — er liess sich nur keiner Einstellung zuordnen, weil er nie allein
 * geaendert wurde. Das loest den frueheren Negativbefund auf: die Suche nach
 * den Gate-Arp-Werten 1/50/40/30/20 schlug fehl, weil ich sie als PER-PART-
 * Werte gesucht habe. Gate Arp ist ein Pattern-Wert.
 */
export const PATTERN_GATE_ARP_OFF = 0x31;

/**
 * Scale Mode — **pro Part**, Schalter.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14): eingeschaltet, woraufhin im gesamten
 * 16-KB-PTST genau ein Part-Byte reagierte — Part 2 bei `+0x05`, 0 -> 1.
 * (Part 2 war der am Geraet gewaehlte.)
 */
export const PART_SCALE_MODE_OFF = 0x05;

/**
 * Motion Sequence — pro Part, 0-basierter Listenindex.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Parts 1-4 auf off / smooth / trigger
 * hold / off gestellt, `+0x03` las danach:
 *
 *     0 1 2 0 | 1 1 1 1 1 1 1 1 1 1 1 1
 *
 * | Anzeige      | Byte |
 * |--------------|------|
 * | off          | 0    |
 * | smooth       | 1    |
 * | trigger hold | 2    |
 *
 * Alle drei Werte in EINEM Durchgang belegt, weil drei verschiedene gesetzt
 * wurden. Die unveraenderten Parts 5-16 stehen auf 1 — „smooth" ist also der
 * Vorgabewert, was vorher nicht zu erkennen war: eine Spalte aus lauter Einsen
 * sieht wie ein Fuellwert aus.
 */
export const PART_MOTION_SEQ_OFF = 0x03;

/**
 * „Trigger Part Velocity" — pro Part, Schalter.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14): nur bei Part 3 eingeschaltet, `+0x04`
 * las danach `0 0 1 0 …` — genau ein gesetztes Byte an genau der richtigen
 * Stelle.
 */
export const PART_TRG_VELOCITY_OFF = 0x04;

/**
 * Part-Priority — Schalter, 0 = normal, 1 = high.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Parts 1-5 auf normal/high/high/normal/
 * high gestellt, `+0x06` las danach `0 1 1 0 1 0 0 …` — Muster und Stellen
 * decken sich exakt.
 */
export const PART_PRIORITY_OFF = 0x06;

export const PATTERN_ALT_13_14_OFF = 0x44;
export const PATTERN_ALT_15_16_OFF = 0x45;

/**
 * Pattern-Laenge (Takte) — 0-basiert gespeichert.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14): Laenge von 3 auf 2 gestellt, `0x25` ging
 * von 2 auf 1. Also Byte = Anzeige − 1, dieselbe Regel wie bei Key, Scale,
 * modType und grooveType.
 *
 * Anmerkung zur Methode: nach der Sammelmessung stand hier eine 2 bei Laenge 3,
 * und ich hatte „0x25 koennte die Laenge sein" als Vermutung notiert — aber
 * bewusst NICHT ins Repo geschrieben, weil ungetestet. Die Einzelmessung hat
 * sie jetzt bestaetigt. Haette sie das Gegenteil ergeben, waere nichts zu
 * widerrufen gewesen.
 */
export const PATTERN_LENGTH_OFF = 0x25;

export const PATTERN_BEAT_OFF = 0x26;

export const PATTERN_SWING_OFF = 0x24;

export const PATTERN_LEVEL_OFF = 0x2a;

/**
 * ## Motion-Spuren
 *
 * Die Tabellen im Pattern-Kopf (Ziel, Parameter, Werte je Step) sind in
 * `electribeImport.ts` beschrieben — dort stehen die Offsets, die Slot-Anzahl
 * und der am Geraet gemessene Beleg dafuer, welche Tabelle welche ist.
 *
 * Hier steht nur, was die Motion-WERTE bedeuten, denn das haengt am Parameter.
 * Bislang ist genau einer gemessen: Osc Edit (Kennung 4).
 */

/**
 * ## Werteleiter der Osc-Edit-Motion
 *
 * Die Anzeige laeuft `Off`, dann `0 % … 98 % FWD`, dann `98 % … 0 % REV` —
 * eine durchlaufende Leiter, die in der Mitte umklappt:
 *
 *     Off        0
 *     FWD    1..64    Prozent = round((v - 1)   * 98 / 63)
 *     REV   65..128   Prozent = round((128 - v) * 98 / 63)
 *
 * Zwei gleich grosse Haelften zu je 64 Werten.
 *
 * ✔ Am Geraet gemessen (2026-08-14):
 *
 *     Anzeige      Byte
 *     23 % REV     113
 *     90 % FWD      59
 *     98 % FWD      64   <- vorhergesagt, dann gemessen
 *     98 % REV      65   <- vorhergesagt, dann gemessen
 *     12 % FWD       9   <- vorhergesagt, dann gemessen
 *
 * Drei der fuenf Werte wurden aus der Leiter BERECHNET und erst danach am
 * Geraet abgelesen. Zwei davon (64 und 65) liegen unmittelbar beidseits des
 * Umklapppunkts, also genau dort, wo eine falsch herum gedachte oder anders
 * skalierte Leiter zwangslaeufig auffliegen muesste.
 *
 * Der Wert 64 ist zusaetzlich gegengeprueft: er tauchte spaeter unerwartet
 * wieder auf, ohne dass Step 1 absichtlich angefasst worden waere. Die Nachfrage
 * am Geraet ergab, dass dort tatsaechlich `98 % FWD` stand — die Einstellung war
 * beim Navigieren mitbedient worden, und das Byte war ihr korrekt gefolgt.
 *
 * Das ist der dritte solche Fall (nach Chain Mode und dem MIDI-Send-Filter), und
 * jedes Mal stimmte die Zuordnung. Das Nachfragen bleibt trotzdem richtig: es
 * kostet eine Rueckfrage, waehrend die stille Alternative eine falsche Zuordnung
 * waere, die niemand mehr findet. Dass es dreimal gutging, sagt etwas ueber die
 * Zuverlaessigkeit der Zuordnungen — nichts darueber, ob man haette raten duerfen.
 *
 * Das obere Ende (128 = 0 % REV) ist nicht direkt gemessen, folgt aber aus den
 * beiden REV-Punkten: 65 -> 98 % und 113 -> 23 % ergeben eine Steigung von
 * 1,5625 je Schritt und damit den Nullpunkt bei 127,7 — gerundet 128. Die
 * naheliegende Alternative, REV ende bei 127, ist ausgeschlossen: sie wuerde
 * fuer Byte 113 eine Anzeige von 22 % verlangen, gemessen sind aber 23 %.
 */
/** Byte-Wert fuer „Motion aus". */
export const OSC_EDIT_MOTION_OFF_VALUE = 0;
/** Hoechstes Byte der Leiter (= 0 % REV). */
export const OSC_EDIT_MOTION_MAX_VALUE = 128;

/** Richtung der OSC-Edit-Motion. */
export type OscEditMotionDirection = "fwd" | "rev";

/** Byte → Anzeige. `null` = „Off". */
export function decodeOscEditMotion(
  byte: number,
): { percent: number; direction: OscEditMotionDirection } | null {
  if (!Number.isFinite(byte) || byte <= 0 || byte > OSC_EDIT_MOTION_MAX_VALUE) return null;
  const v = Math.round(byte);
  return v <= 64
    ? { percent: Math.round(((v - 1) * 98) / 63), direction: "fwd" }
    : { percent: Math.round(((128 - v) * 98) / 63), direction: "rev" };
}

/** Anzeige → Byte. Prozent ausserhalb 0..98 wird begrenzt. */
export function encodeOscEditMotion(
  percent: number,
  direction: OscEditMotionDirection,
): number {
  if (!Number.isFinite(percent)) return OSC_EDIT_MOTION_OFF_VALUE;
  const p = Math.max(0, Math.min(98, percent));
  const d = Math.round((p * 63) / 98);
  return direction === "fwd" ? 1 + d : 128 - d;
}

export const PATTERN_CHAIN_TO_OFF = 0x3b00;
export const PATTERN_CHAIN_REPEAT_OFF = 0x3b02;
export const PATTERN_SCALE_OFF = 0x28;
export const PATTERN_MFX_TYPE_OFF = 0x3d;
const STEPLEN_OFF = 0x25;
const PARTS_OFF = 0x800;
const PART_STRIDE = 816; // 0x330
/** Per-part sample reference (u16 LE). Verified against 4000 real-bank parts:
 *  values span 1..~500 (factory sample numbers), 0 = no/empty sample.
 *  (The read-side parser historically guessed +0x04, which is almost always 0.) */
const PART_SAMPLE_OFF = 0x08;
// TekkForge-Korrektur (2026-07-19, verifiziert per Histogramm über die
// e2s-2016-Factory-Bank + elecmidi-C-Struct + Briefing §4.1):
//   +0x01 = Mute (0/1) · +0x18 = ampLevel (0..127, Top-Werte 127/85/100)
//   +0x19 = ampPan SIGNED (0 = Mitte, ±63; als Two's-Complement-Byte)
// Die früheren Offsets 0x15/0x22 waren EGDecay bzw. IFXEdit (deren Defaults
// 127 bzw. 64 die Histogramme täuschend ähnlich aussehen ließen).
const PART_MUTE_OFF = 0x01;
// ✔ Am Geraet bestaetigt (2026-08-14): Testpattern mit aufsteigendem Level
// ueber die Parts 1-10 las hier exakt 0 10 20 30 40 50 60 70 80 90, Parts
// 11-16 unberuehrt. Der Offset stammte bis dahin nur aus der Format-Doku.
const PART_VOLUME_OFF = 0x18;
const PART_PAN_OFF = 0x19;
const PART_STEPS_OFF = 0x30;
const STEP_RECORD_SIZE = 12;
const STEPS_PER_PART = 64;
const PARTS_PER_PATTERN = 16;

// step-record byte positions — TekkForge-Korrektur (2026-07-18), verifiziert
// per Byte-Histogramm gegen Factory-Files (BodyTalk1, Advi$ory1, e2s-2016) und
// die hardware-getesteten Hardtekk-Patterns: b1=Gate, b2=Velocity, b4=Note.
// (Vorher waren Note/Gate vertauscht: Note landete im Gate-Byte und der
// vermeintliche "GateLen"-Default 0x3d im Note-Byte — Melodien gingen verloren.)
const STEP_TRIGGER = 0;
const STEP_GATE = 1;
const STEP_VELOCITY = 2;
const STEP_FLAG = 3;
const STEP_NOTE = 4;

// step-record defaults (match the Init-181 template / observed real files)
const DEFAULT_GATE = 0x48; // 72 — häufigster Gate-Wert realer Files
const DEFAULT_VELOCITY = 0x60; // 96
const DEFAULT_NOTE = 0x3c; // C4 = 60 = Originaltonhöhe (Briefing §4.1 + Hardtekk)
/**
 * Gate-Sentinel fuer „Tie".
 *
 * ✔ Am Geraet gemessen (2026-08-14): ein Pattern mit Gate 0xFF wurde gesendet
 * und aus dem Geraetespeicher zurueckgelesen — dort stand 96, nicht 0xFF. Das
 * Geraet uebernimmt die 255 also NICHT als Tie, sondern begrenzt sie auf die
 * hoechste regulaere Gate-Zeit. Ein so geschriebenes Tie war schlicht keins.
 *
 * Der Wert, den das Geraet selbst fuer Tie ablegt, ist 127 (im Step-Editor
 * gemessen). Geschrieben wird deshalb 127.
 *
 * ⚠ ABER: auch mit 127 kommt kein Tie an. Ein Pattern mit Gate 127 wurde
 * gesendet und zurueckgelesen — im Geraetespeicher stand wieder 96. Beide
 * Werte, 255 und 127, werden beim Laden ueber SysEx auf 96 begrenzt.
 *
 * Zur Belastbarkeit dieser Messung: sie entstand bei laufendem Sequencer, und
 * unter dieser Bedingung kommen Pattern-Dumps gelegentlich beschaedigt zurueck.
 * Der Wert 96 stammt aber aus zwei byteweise uebereinstimmenden Lesungen und
 * trat auf allen zwoelf betroffenen Steps gleich auf — eine Verfaelschung
 * saehe anders aus. Eine Wiederholung bei gestopptem Sequencer steht dennoch
 * aus.
 *
 * Daraus folgt: **ein Tie laesst sich derzeit nicht per Pattern-Uebertragung
 * setzen.** Das Geraet legt zwar 127 ab, wenn man Tie im Step-Editor waehlt —
 * es uebernimmt diesen Wert aber nicht aus einem eingehenden Pattern. Beide
 * Beobachtungen stehen nebeneinander und widersprechen sich nicht: die eine
 * betrifft den Editor, die andere den Ladeweg.
 *
 * Geschrieben wird trotzdem 127, weil das der einzige Wert ist, dem eine
 * gemessene Bedeutung („Tie") zukommt. Ob der Ladeweg ueber SD-Karte sich
 * anders verhaelt als der ueber SysEx, ist NICHT geprueft — das waere die
 * naechste Messung, und sie wuerde auch erklaeren, warum Factory-Dateien an
 * dieser Stelle so haeufig 255 fuehren.
 *
 * Auf der Lesesite gelten weiter beide Werte als Tie
 * (siehe ELECTRIBE_REAL_GATE_TIE_ALT).
 */
const GATE_TIE_DEVICE = 127;
/** Wird als Eingabe weiterhin als „Tie" akzeptiert (aeltere Aufrufer, Factory-Dateien). */
const GATE_TIE_LEGACY = 0xff;
const isTie = (g: unknown): boolean => g === GATE_TIE_DEVICE || g === GATE_TIE_LEGACY;
const GATE_MAX = 96;

const STEP_LENGTH_CODE: Record<number, number> = { 16: 0, 32: 1, 64: 3 };

const BPM_MIN_X10 = 200; // 20.0 BPM
const BPM_MAX_X10 = 3000; // 300.0 BPM

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Isomorphic base64 → bytes (browser/Electron `atob`, Node `Buffer`). */
function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node / SSR
  return new Uint8Array((globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer!.from(b64, "base64"));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Write `value` as printable ASCII into `bytes[offset..offset+length)`,
 *  NUL-padded after the content. Non-printable chars become '?'. */
function writeAsciiNul(bytes: Uint8Array, offset: number, value: string, length: number): void {
  const safe = typeof value === "string" ? value : "";
  for (let i = 0; i < length; i++) {
    if (i < safe.length) {
      const ch = safe.charCodeAt(i);
      bytes[offset + i] = ch >= 32 && ch <= 126 ? ch : 0x3f;
    } else {
      bytes[offset + i] = 0x00;
    }
  }
}

/** Writes the 256-byte KORG file header (shared by .e2spat and .e2sallpat). */
function writeFileHeader(bytes: Uint8Array): void {
  // "KORG" @ 0x00
  bytes[0] = 0x4b;
  bytes[1] = 0x4f;
  bytes[2] = 0x52;
  bytes[3] = 0x47;
  // "e2sampler" @ 0x10
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) bytes[0x10 + i] = id.charCodeAt(i);
  // version u32 LE = 1 @ 0x20
  bytes[0x20] = 0x01;
  // 0xFF padding 0x24..0x100
  for (let i = 0x24; i < 0x100; i++) bytes[i] = 0xff;
}

// ─── Body overlay ─────────────────────────────────────────────────────────────

/**
 * Builds one 16384-byte PTST pattern body by overlaying `input` onto a fresh
 * copy of the real init-pattern template. Returns a new `Uint8Array`.
 */
export function buildE2PatternBody(input: E2PatternInput): Uint8Array {
  // Basis: importierter/Geräte-Body (bewahrt Filter/Amp/IFX/Motion) oder das
  // Init-Template bei Neu-Patterns. Beide sind 0x4000 Bytes.
  const base =
    input.baseBody && input.baseBody.length === E2S_BODY_SIZE
      ? input.baseBody
      : b64ToBytes(E2S_INIT_BODY_B64);
  const body = Uint8Array.from(base); // frische 16384-Byte-Kopie
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  // Name @ +0x10
  writeAsciiNul(body, NAME_OFF, input.name ?? "", 16);

  // BPM × 10 @ +0x22 (u16 LE)
  const bpmX10 = clampInt(
    Math.round((typeof input.bpm === "number" && Number.isFinite(input.bpm) ? input.bpm : 120) * 10),
    BPM_MIN_X10,
    BPM_MAX_X10,
    1200,
  );
  view.setUint16(BPM_OFF, bpmX10, true);

  // Step-length code @ +0x25
  body[STEPLEN_OFF] = STEP_LENGTH_CODE[input.stepLength] ?? 0;

  // Parts
  const parts = Array.isArray(input.parts) ? input.parts : [];
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const part = parts[p];
    if (!part) continue; // leave template part untouched (inactive + valid config)

    const partStart = PARTS_OFF + p * PART_STRIDE;
    if (typeof part.volume === "number") {
      body[partStart + PART_VOLUME_OFF] = clampInt(part.volume, 0, 127, 127);
    }
    if (typeof part.pan === "number") {
      // Editor-Pan 0..127 (64 = Mitte) → Geräte-Pan signed (0 = Mitte, ±63).
      const signed = clampInt(part.pan, 0, 127, 64) - 64;
      body[partStart + PART_PAN_OFF] = signed & 0xff;
    }
    // Mute @ +0x01 (0/1) — Editor-Mutes werden mit aufs Gerät übertragen.
    if (typeof part.muted === "boolean") {
      body[partStart + PART_MUTE_OFF] = part.muted ? 1 : 0;
    }
    // Per-part sample reference @ +0x08 (u16 LE). Only written when the caller
    // provides one (e.g. repointing parts to imported user samples at 501+);
    // otherwise the template's factory sample assignment is preserved.
    if (typeof part.sampleId === "number" && Number.isFinite(part.sampleId)) {
      view.setUint16(partStart + PART_SAMPLE_OFF, clampInt(part.sampleId, 0, 0xffff, 0), true);
    }
    // EXPERIMENTELL: Klangparameter (Filter/Amp/IFX…) an ihre Part-Offsets.
    if (part.params) writePartParamsToBody(body, p, part.params);

    const steps = Array.isArray(part.steps) ? part.steps : [];
    for (let s = 0; s < STEPS_PER_PART; s++) {
      const so = partStart + PART_STEPS_OFF + s * STEP_RECORD_SIZE;
      const step = steps[s];
      if (step && step.active) {
        body[so + STEP_TRIGGER] = 0x01;
        body[so + STEP_GATE] =
          isTie(step.gate) ? GATE_TIE_DEVICE : clampInt(step.gate, 0, GATE_MAX, DEFAULT_GATE);
        body[so + STEP_VELOCITY] = clampInt(step.velocity, 0, 127, DEFAULT_VELOCITY);
        body[so + STEP_FLAG] = 0x01; // Factory-Konvention für aktive Steps
        // Bis zu vier Noten, je MIDI+1 (0 = leer) — siehe e2StepNote.ts. Freie
        // Plaetze werden ausdruecklich genullt: die Vorlage koennte an dieser
        // Stelle noch Noten eines frueheren Akkords tragen.
        const midi = resolveStepNotes(step.notes, clampInt(step.note, 0, 127, DEFAULT_NOTE));
        for (let i = 0; i < E2_STEP_NOTE_SLOTS; i++) {
          body[so + STEP_NOTE + i] = i < midi.length ? midiNoteToE2StepByte(midi[i]) : 0x00;
        }
      } else {
        // canonical inactive record — exakt wie Init-181: 00 48 60 00 00
        body[so + STEP_TRIGGER] = 0x00;
        body[so + STEP_GATE] = DEFAULT_GATE;
        body[so + STEP_VELOCITY] = DEFAULT_VELOCITY;
        body[so + STEP_FLAG] = 0x00;
        for (let i = 0; i < E2_STEP_NOTE_SLOTS; i++) body[so + STEP_NOTE + i] = 0x00;
      }
      // bytes 8..11 remain as the template (zero) — never touched.
    }
  }

  writeMotionSlots(body, input.motionSlots);

  return body;
}

/**
 * Schreibt die Motion-Spuren in den Pattern-Kopf.
 *
 * Vorher nahm `buildE2PatternBody` das Feld `motionSlots` zwar entgegen, warf es
 * aber weg — ein erzeugtes Pattern kam ohne Motion am Geraet an, ohne dass
 * irgendwo ein Hinweis darauf aufgetaucht waere. Aufgefallen ist es erst, als
 * ein Testpattern nach dem Senden zurueckgelesen wurde: die Tabellen im Kopf
 * waren durchgehend null.
 *
 * Layout und Beleg dafuer, welche Tabelle welche ist, stehen in
 * `electribeImport.ts`. Die Werte gehen 0..128 (siehe Osc-Edit-Werteleiter).
 */
function writeMotionSlots(body: Uint8Array, slots: E2PatternInput["motionSlots"]): void {
  if (!Array.isArray(slots)) return;
  for (let i = 0; i < Math.min(slots.length, ELECTRIBE_MOTION_SLOTS_PER_PATTERN); i++) {
    const slot = slots[i];
    if (!slot || !slot.paramId) continue;
    // Ziel-Byte ist 1-basiert; 0 heisst „kein Part".
    const ziel =
      typeof slot.targetPart === "number" && slot.targetPart >= 0 ? slot.targetPart + 1 : 0;
    body[ELECTRIBE_MOTION_TARGET_TABLE_OFFSET + i] = ziel & 0xff;
    body[ELECTRIBE_MOTION_PARAM_TABLE_OFFSET + i] = slot.paramId & 0xff;
    const werte = Array.isArray(slot.values) ? slot.values : [];
    const basis = ELECTRIBE_MOTION_DATA_TABLE_OFFSET + i * ELECTRIBE_MOTION_SLOT_STRIDE;
    for (let s = 0; s < ELECTRIBE_MOTION_VALUES_PER_SLOT; s++) {
      body[basis + s] = clampInt(werte[s], 0, 128, 0);
    }
  }
}

// ─── Single pattern (.e2spat) ──────────────────────────────────────────────────

/**
 * Builds a complete 16640-byte `.e2spat` file from an `E2PatternInput`.
 * Always exactly `E2S_SINGLE_FILE_SIZE` bytes.
 */
export function buildE2PatternFileV2(input: E2PatternInput): ArrayBuffer {
  const out = new Uint8Array(E2S_SINGLE_FILE_SIZE);
  writeFileHeader(out);
  out.set(buildE2PatternBody(input), E2S_FILE_HEADER_SIZE);
  return out.buffer;
}

// ─── All patterns (.e2sallpat) ─────────────────────────────────────────────────

/**
 * Builds a complete `.e2sallpat` bank (250 slots) from a list of patterns.
 * Patterns fill slots 0..N-1 (max 250 — extras are dropped); the remaining
 * slots are filled with the real factory init-pattern body (NOT zeros — empty
 * bank slots are valid init patterns on real hardware).
 *
 * Always exactly `E2S_ALLPAT_FILE_SIZE` bytes.
 */
export function buildE2AllPatFile(patterns: E2PatternInput[]): ArrayBuffer {
  const out = new Uint8Array(E2S_ALLPAT_FILE_SIZE);

  // Header (0x00..0x100). "GLST" then overwrites 0x100.
  writeFileHeader(out);
  // GLST/GLED global block @ 0x100 (verbatim from a real bank).
  out.set(b64ToBytes(E2S_GLST_BLOCK_B64), GLST_OFFSET);
  // 0xFF padding 0x200..0x10100.
  out.fill(0xff, 0x200, E2S_ALLPAT_PREFIX_SIZE);

  const initBody = b64ToBytes(E2S_INIT_BODY_B64);
  const list = Array.isArray(patterns) ? patterns : [];
  for (let i = 0; i < E2S_ALLPAT_SLOT_COUNT; i++) {
    const slotOff = E2S_ALLPAT_PREFIX_SIZE + i * E2S_BODY_SIZE;
    const pat = list[i];
    out.set(pat ? buildE2PatternBody(pat) : initBody, slotOff);
  }

  return out.buffer;
}

// ─── Structural validators (mirror the IPC-side checks) ─────────────────────────

/** Quick structural sanity-check for a built `.e2sallpat` buffer. */
export function looksLikeE2AllPatFile(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.byteLength !== E2S_ALLPAT_FILE_SIZE) return false;
    // "KORG" @ 0x00
    if (u8[0] !== 0x4b || u8[1] !== 0x4f || u8[2] !== 0x52 || u8[3] !== 0x47) return false;
    // "e2sa" @ 0x10
    if (u8[0x10] !== 0x65 || u8[0x11] !== 0x32 || u8[0x12] !== 0x73 || u8[0x13] !== 0x61) {
      return false;
    }
    // "GLST" @ 0x100
    if (u8[0x100] !== 0x47 || u8[0x101] !== 0x4c || u8[0x102] !== 0x53 || u8[0x103] !== 0x54) {
      return false;
    }
    // "PTST" @ first pattern slot (0x10100)
    if (
      u8[0x10100] !== 0x50 ||
      u8[0x10101] !== 0x54 ||
      u8[0x10102] !== 0x53 ||
      u8[0x10103] !== 0x54
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
