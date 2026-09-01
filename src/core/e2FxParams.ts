/**
 * e2FxParams.ts — FX-Typen + Parameter-Namen fuer die Korg-E2/hacktribe-FX-Steuerung.
 *
 * Quelle (verifiziert): bangcorrupt/hacktribe-editor (**AGPL-3.0**)
 *   utils/ht_fx_ram_format.py + ht_fx_preset_format.py (FX-Typ-Enums, Param-Listen)
 *   utils/ht_nrpn.py (FX-Slot-Math), hacktribe wiki MIDI.md
 * Uebernommen ueber Synthstudio; Herkunft siehe NOTICE.
 *
 * Die Param-Index-Position (0-basiert) == NRPN DATA-MSB (siehe
 * `hacktribeNrpn.buildSetFxParam`). Werte sind 0..127. **Semantische
 * Min/Max/Einheiten sind im hacktribe-editor NICHT hinterlegt** (dort als TODO
 * markiert) — daher hier nur Namen; Ranges = 0..127. Was davon am Ohr vermessen
 * ist (2026-09-01, Beispiel-Presets + Sonden aus `examples/fx-presets/`), steht
 * als Kommentar direkt an der jeweiligen Definition. Der FX-**Typ** wird NICHT
 * per NRPN gesetzt, sondern im Preset/RAM-Edit-Buffer; NRPN editiert nur Params
 * des bereits geladenen FX.
 *
 * Bindeglied zum Editor: der Part traegt seinen IFX-Typ im Pattern-Body
 * (`partParams.ts`, Schluessel `ifxType`) — damit laesst sich zu einem Part die
 * passende Parameterliste benennen, statt nur nackte Indizes anzuzeigen.
 */

/**
 * ⚠ Diese Namen sind **Algorithmen**, nicht die Bezeichnungen aus dem
 * Gerätemenü. Am Gerät wählt man ein *Preset*, und das trägt einen eigenen
 * Namen; geladen wird davon ein Algorithmus mit vorgegebenen Parametern.
 *
 * Am Gerät gegengeprüft (2026-08-13) — der Nutzer nannte die Presets, der
 * FX-Edit-Puffer trug die Algorithmen:
 *
 * | Preset (Gerätemenü) | Algorithmus (diese Tabelle) |
 * |---|---|
 * | „Bit Crusher" (Slot 4)  | `0x09` Decimator   |
 * | „Sustainer"   (Slot 6)  | `0x03` Cheap Comp  |
 * | „Radio EQ"    (Slot 11) | `0x10` Acid Driver |
 *
 * Beides ist stimmig — ein Bit Crusher *ist* ein Decimator, ein Sustainer *ist*
 * ein Kompressor. Aber wer die Oberfläche mit dem Geräte-Display vergleicht,
 * hält die Abweichung fuer einen Lesefehler. Deshalb muss die UI diese Namen
 * als Algorithmus ausweisen.
 *
 * Die Preset-Namen stehen im RAM: `E2_RAM_MAP.ifxPreset`, Name als ASCII ab
 * Offset +1 des 524-B-Blobs. Im Bestand des Testgeräts waren 49 der 100 Slots
 * belegt (0..48) — bestätigt durch zwei Zähler: `maxIfxIndex` (0xC0048F80) = 48
 * und der `add_ifx`-Zähler (0xC003EFDC) = 49.
 */
export interface FxTypeDef {
  name: string;
  params: string[]; // params[k] = Name des Parameters mit DATA-MSB-Index k
}

/** IFX-Geräte (gültig für IFX-A und IFX-B). Device-ID → Definition. */
export const IFX_TYPES: Record<number, FxTypeDef> = {
  0x00: { name: "Thru", params: [] },
  0x01: {
    name: "MKP2 Comp",
    params: [
      "dry_wet",
      "envelope_select",
      "sensitivity",
      "attack",
      "output_level",
      "trim",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
    ],
  },
  0x02: {
    name: "SR1 Comp",
    params: [
      "dry_wet",
      "envelope_select",
      "threshold",
      "ratio",
      "knee",
      "attack",
      "release",
      "hold_time",
      "tube_sat",
      "output_gain",
    ],
  },
  0x03: {
    name: "Cheap Comp",
    params: [
      "hpf_b1",
      "peak_hold_b1",
      "env_lpf_a0",
      "env_bit_shift",
      "sens",
      "output_level",
    ],
  },
  0x04: { name: "Punch", params: [] },
  0x05: {
    name: "Limiter",
    params: [
      "dry_wet",
      "envelope_select",
      "threshold",
      "attack",
      "release",
      "hold_time",
      "tubesat",
      "output_gain",
    ],
  },
  // Gains: 36 = neutral, hoeher = lauter — am Ohr bestaetigt (Sonde Two Band
  // Smile/Mid, 2026-09-01). Gilt genauso fuer EQ 4-Band (IFX und MFX).
  0x06: {
    name: "EQ 2-Band",
    params: [
      "trim",
      "b1_type",
      "b2_type",
      "b1_frequency",
      "b1_q",
      "b1_gain",
      "b2_frequency",
      "b2_q",
      "b2_gain",
    ],
  },
  0x07: {
    name: "EQ 4-Band",
    params: [
      "trim",
      "b1_type",
      "b2_type",
      "b3_type",
      "b4_type",
      "b1_frequency",
      "b1_q",
      "b1_gain",
      "b2_frequency",
      "b2_q",
      "b2_gain",
      "b3_frequency",
      "b3_q",
      "b3_gain",
      "b4_frequency",
      "b4_q",
      "b4_gain",
    ],
  },
  0x08: {
    name: "Exciter",
    params: [
      "dry_wet",
      "blend",
      "input_trim",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
      "emphatic_point",
      "emphatic_lag",
    ],
  },
  0x09: {
    name: "Decimator",
    params: [
      "dry_wet",
      "pre_lpf_sw",
      "pre_lpf",
      "hi_damp",
      "sample_freq",
      // runter = rauschig-kratziger; am unteren Anschlag wird das Signal zum
      // Vollpegel-Rechteck — Dynamik weg, Level regelt nichts mehr (Ohr, 2026-09-01)
      "bit_depth",
      "output_level",
      "mask_type",
    ],
  },
  0x0a: {
    name: "Filter",
    // output_select 0/1/2 klingen klar verschieden (Ohr, 2026-09-01) — welcher
    // Wert welcher Ausgang ist (LP/HP/BP?), ist noch unbenannt.
    params: ["dry_wet", "output_select", "frequency", "resonance"],
  },
  0x0f: {
    name: "Distortion",
    params: [
      "dry_wet",
      "gain",
      "pre_eq_frequency",
      "pre_eq_q",
      "pre_eq_gain",
      "post_eq1_frequency",
      "post_eq1_q",
      "post_eq1_gain",
      "post_eq2_frequency",
      "post_eq2_q",
      "post_eq2_gain",
      "post_eq3_frequency",
      "post_eq3_q",
      "post_eq3_gain",
      "output_level",
    ],
  },
  0x10: { name: "Acid Driver", params: ["drive", "output_level"] },
  0x11: {
    name: "Chorus",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
      "l_delay",
      "r_delay",
      "lodamp",
      "hidamp",
      "spread",
    ],
  },
  0x12: {
    name: "Flanger",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_shape",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
      "manual",
      "delay",
      "lodamp",
      "hidamp",
      "feedback",
      "fb_hicut",
    ],
  },
  0x13: {
    name: "Phaser",
    params: [
      "dry_wet",
      "type",
      "manual",
      "modint",
      "resonance",
      "phase",
      "high_damp",
      "mod_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
    ],
  },
  0x14: {
    name: "Tremolo",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_squ_dur",
      "lfo_squ_lag",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_shape",
      "do_nothing",
      "lfo_reset",
      "lfo_reset_phase",
    ],
  },
  0x15: {
    name: "Level Mod",
    params: [
      "amp_level",
      "output_gain",
      "level_mod_source",
      "level_mod_int",
      "level_mod_type",
      "saturation",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_reset",
      "lfo_reset_phase",
    ],
  },
  0x16: {
    name: "Ring Mod",
    params: [
      "dry_wet",
      "osc_freq",
      "mod_int",
      "lfo_sync",
      "lfo_speed",
      "lfo_syncnote",
      "lfo_reset",
      "lfo_reset_phase",
      "input_level",
      "delay",
      "hi_damp",
      "feedback",
      "delay_lag",
    ],
  },
  0x18: {
    name: "Short Delay",
    params: [
      "dry_level",
      "wet_level",
      "input_trim",
      "tempo_sync",
      "off_time_ratio",
      "off_delay_time",
      "on_time_ratio",
      "on_syncnote",
      "fb_depth",
      "high_damp",
      "low_damp",
      "delay_lag",
    ],
  },
  // `fader` ist hoerbar weder Pegel noch Daempfung: Mute macht zu, sobald er im
  // Insert haengt — fader 0/64/127 gespeichert wie live gedreht, immer still;
  // erst Part-IFX Off gibt den Ton frei (Ohr, 2026-09-01). Verdacht Blendzeit,
  // ungeklaert. Ein gespeichertes Mute-Preset ist damit praktisch nutzlos.
  0x27: { name: "Mute", params: ["fader"] },
};

/** MFX-Geräte (Master-FX). Device-ID → Definition. */
export const MFX_TYPES: Record<number, FxTypeDef> = {
  0x00: { name: "Thru", params: [] },
  0x27: { name: "Mute", params: ["fader"] },
  0x28: {
    name: "MKP2 Comp",
    params: [
      "dry_wet",
      "envelope_select",
      "sensitivity",
      "attack",
      "output_level",
      "trim",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
    ],
  },
  0x29: {
    name: "SR1 Comp",
    params: [
      "dry_wet",
      "envelope_select",
      "threshold",
      "ratio",
      "knee",
      "attack",
      "release",
      "hold_time",
      "tube_sat",
      "output_gain",
    ],
  },
  0x2a: {
    name: "Limiter",
    params: [
      "dry_wet",
      "envelope_select",
      "threshold",
      "attack",
      "release",
      "hold_time",
      "tube_sat",
      "output_gain",
    ],
  },
  0x2b: {
    name: "EQ 4-Band",
    params: [
      "dry_wet",
      "trim",
      "b1_type",
      "b2_type",
      "b3_type",
      "b4_type",
      "b1_frequency",
      "b1_q",
      "b1_gain",
      "b2_frequency",
      "b2_q",
      "b2_gain",
      "b3_frequency",
      "b3_q",
      "b3_gain",
      "b4_frequency",
      "b4_q",
      "b4_gain",
    ],
  },
  0x2c: {
    name: "Wah",
    params: [
      "dry_wet",
      "wah_type",
      "mod_src",
      "mod_int",
      "control",
      "env_select",
      "env_response",
      "env_sens",
      "lfo_step",
      "lfo_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_syncnote",
      "lfo_rch_degree",
      "lfo_reset",
      "lfo_resetphase",
      "manual",
    ],
  },
  0x2d: {
    name: "Multimode Filter",
    params: [
      "dry_wet",
      "trim",
      "frequency",
      "resonance",
      "mod_source",
      "mod_lag",
      "lfo_sync",
      "lfo_speed",
      "lfo_syncnote",
      "lfo_reset",
      "lfo_resetphase",
      "freq_mod_int",
      "drive",
      "drive_mod_int",
      "drive_tone",
      "hpf_level",
      "bpf_level",
      "lpf_level",
      "lpf24_level",
    ],
  },
  0x2e: {
    name: "Distortion",
    params: [
      "dry_wet",
      "gain",
      "pre_eq_frequency",
      "pre_eq_q",
      "pre_eq_gain",
      "post_eq1_frequency",
      "post_eq1_q",
      "post_eq1_gain",
      "post_eq2_frequency",
      "post_eq2_q",
      "post_eq2_gain",
      "post_eq3_frequency",
      "post_eq3_q",
      "post_eq3_gain",
      "output_level",
    ],
  },
  0x2f: {
    name: "Tube Pre",
    params: [
      "dry_wet",
      "tube1_gain",
      "tube1_sat",
      "tube2_gain",
      "tube2_sat",
      "lo_cut1",
      "hi_cut1",
      "lo_cut2",
      "hi_cut2",
      "tube1_bias",
      "tube1_phase",
      "tube2_bias",
      "output_level",
    ],
  },
  0x31: {
    name: "Chorus",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
      "l_delay",
      "r_delay",
      "lo_damp",
      "hi_damp",
      "spread",
    ],
  },
  0x32: {
    name: "Flanger",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_syncnote",
      "lfo_shape",
      "lfo_phase",
      "lfo_reset",
      "lfo_resetphase",
      "manual",
      "delay",
      "lo_damp",
      "hi_damp",
      "feedback",
      "fb_hicut",
    ],
  },
  0x33: {
    name: "Phaser",
    params: [
      "dry_wet",
      "type",
      "manual",
      "mod_int",
      "resonance",
      "phase",
      "high_damp",
      "mod_wave",
      "lfo_sync",
      "lfo_speed",
      "lfo_syncnote",
      "lfo_phase",
      "lfo_reset",
      "lfo_resetphase",
    ],
  },
  0x34: {
    name: "Tremolo",
    params: [
      "dry_wet",
      "mod_src",
      "mod_int",
      "lfo_wave",
      "lfo_squdur",
      "lfo_squlag",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_shape",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
    ],
  },
  0x35: {
    name: "Level Mod",
    params: [
      "amp_level",
      "output_gain_adjust",
      "level_mod_source",
      "level_mod_int",
      "level_mod_type",
      "saturation",
      "lfo_sync",
      "lfo_speed",
      "lfo_sync_note",
      "lfo_phase",
      "lfo_reset",
      "lfo_reset_phase",
    ],
  },
  // Die vier Reverbs auf identischen Werten verglichen (Ohr, 2026-09-01,
  // m20–m23): Hall Reverb klingt am groessten; Wet und Dry Plate sind so kaum
  // auseinanderzuhalten.
  0x36: {
    name: "Hall Reverb",
    params: [
      "dry_wet",
      "time",
      "hi_damp",
      "pre_delay",
      "trim",
      "trim2",
      "lo_eq",
      "hi_eq",
      "pd_thru",
    ],
  },
  0x37: {
    name: "Smooth Hall",
    params: [
      "dry_wet",
      "time",
      "hi_damp",
      "pre_delay",
      "trim",
      "trim2",
      "lo_eq",
      "hi_eq",
      "pd_thru",
    ],
  },
  0x38: {
    name: "Wet Plate Reverb",
    params: [
      "dry_wet",
      "time",
      "hi_damp",
      "pre_delay",
      "trim",
      "trim2",
      "lo_eq",
      "hi_eq",
      "pd_thru",
    ],
  },
  0x39: {
    name: "Dry Plate Reverb",
    params: [
      "dry_wet",
      "time",
      "hi_damp",
      "pre_delay",
      "trim",
      "trim2",
      "lo_eq",
      "hi_eq",
      "pd_thru",
    ],
  },
  0x3a: {
    name: "Room Reverb",
    params: [
      "dry_wet",
      "time",
      "hi_damp",
      "pre_delay",
      "trim",
      "trim2",
      "lo_eq",
      "hi_eq",
      "pd_thru",
      "rev_level",
      "er_level",
    ],
  },
  0x3b: {
    name: "Mod Delay",
    params: [
      "dry_wet",
      "wet_spread",
      "input_trim",
      "pre_leq_gain",
      "pre_leq_frequency",
      "pre_heq_gain",
      "pre_heq_frequency",
      "delay_time_tempo_sync",
      "off_time_ratio",
      "off_l_delay_time",
      "off_r_delay_time",
      "on_time_ratio",
      "on_l_syncnote",
      "on_r_syncnote",
      "fb_type",
      "fb_depth",
      "high_damp",
      "low_damp",
      "mod_depth",
      "mod_wave",
      "mod_freq",
      "mod_rch_degree",
      "delay_lag",
    ],
  },
  0x3c: {
    name: "Tape Echo",
    params: [
      "dry_wet",
      "time_ratio",
      "sync_on",
      "s_note1",
      "s_note2",
      "time1",
      "time2",
      "delay_lag",
      "output_level",
      "tap1_level",
      "tap2_level",
      "feedback",
      "hi_damp",
      "lo_damp",
      "trim",
      "saturation",
      "gain",
      "gainshift",
      "lfo_wave",
      "lfo_depth",
      "lfo_speed",
      "lfo_reset",
      "pre_lpf",
      "spread",
    ],
  },
  0x3d: {
    name: "Grain Shifter",
    params: [
      "dry_wet",
      "duration_bpm_sync",
      "off_time_ratio",
      // woertlich die Laenge der Aus-Phase zwischen den Schnipseln: hoch =
      // loechriger/stotternder, nicht groebere Schnipsel (Ohr, 2026-09-01)
      "off_duration",
      "on_time_ratio",
      "on_duration",
      "lfo_bpm_sync",
      "off_lfo_freq",
      "on_sync_note",
      "lfo_reset",
      "duration_lag",
    ],
  },
  0x3e: {
    name: "Decimator",
    params: [
      "dry_wet",
      "pre_lpf_sw",
      "pre_lpf",
      "hi_damp",
      "sample_freq",
      "bit_depth",
      "output_level",
      "mask_type",
      "mod_src",
      "mod_int",
      "wave",
      "squ_dur",
      "lfo_reset",
      "reset_phase",
      "sync_on",
      "off_freq",
      "on_sync_note",
    ],
  },
  0x3f: {
    name: "KPQ Looper",
    params: [
      "loopswitch",
      "loop_length",
      "loop_type",
      "loop_trigger",
      "reset",
      "step",
      "fine",
      "pitch_lag",
    ],
  },
  0x40: {
    name: "Vinyl Break",
    params: [
      "dry_wet",
      "pad_on",
      "delta_pitch",
      "scratch",
      "scratch_width",
      "scratch_lag",
      "asobi",
    ],
  },
};

/** Nachschlag: FX-Definition per Device-ID (isMfx wählt die Tabelle). */
export function fxTypeDef(
  device: number,
  isMfx: boolean
): FxTypeDef | undefined {
  return (isMfx ? MFX_TYPES : IFX_TYPES)[device];
}

// ─── Live-FX-Edit-Buffer (RAM, 0x72 Bytes) ───────────────────────────────────
// Quelle: ht_fx_ram_format.py (ifx_buffer/mfx_buffer) + ht_sysex.py.
export const FX_EDIT_BUFFER_BASE = 0xc03478a8;
export const FX_EDIT_BUFFER_STRIDE = 0x72;
export const FX_EDIT_BUFFER_COUNT = 0x21; // 33 (0..0x1F IFX + 0x20 MFX)
const FX_BUF_PARAM_OFFSET = 0x03; // param k @ 0x03 + 2*k
const FX_BUF_INPUT_LEVEL = 0x33;
const FX_BUF_OUTPUT_LEVEL = 0x35;

/** RAM-Adresse des Live-Edit-Buffers für einen FX-Slot (0..0x20). */
export function fxEditBufferAddr(fxSlot: number): number {
  return FX_EDIT_BUFFER_BASE + FX_EDIT_BUFFER_STRIDE * fxSlot;
}

// ─── FX-Control-Map (im Live-Edit-Buffer, @0x36) ─────────────────────────────
// Quelle: ht_fx_ram_format.py — ifx_buffer/mfx_buffer: nach Seek(50)=0x32,
// input_level@0x33, output_level@0x35, dann control_map[10]. Jeder fx_control
// ist 6 B: source_control, target_param, pad, min_value, pad, max_value.
// 0x36 + 10*6 = 0x72 → füllt den Buffer exakt.
export const FX_CONTROL_MAP_OFFSET = 0x36;
export const FX_CONTROL_SLOT_SIZE = 6;
export const FX_CONTROL_MAP_SLOTS = 10;

/** FX-Control-Map Source-Controls (source_control-Enum, ht_fx_ram_format.py). */
export const FX_SOURCE_CONTROLS: Record<number, string> = {
  0x00: "none",
  0x01: "FX On",
  0x02: "FX Edit X",
  0x03: "FX Edit Y",
  0x04: "FX Edit X Hi",
  0x05: "FX Edit X Lo",
  0x06: "FX Edit Y Hi",
  0x07: "FX Edit Y Lo",
  0x0a: "Play/Start",
};

// Die NRPN-Parameter-Indizes der Control-Map (map_slot/source/target/min/max)
// liegen kanonisch in e2Nrpn.ts (FX_MAP_PARAM) — dort werden sie zum Bauen der
// NRPN-Sequenz benutzt.

export interface FxControlSlot {
  sourceControl: number; // source_control-Enum-Wert
  targetParam: number; // Index eines Params im FX-Preset
  minValue: number;
  maxValue: number;
}

/** Dekodiert die 10 Control-Map-Slots aus einem 0x72-Buffer (@0x36, 6 B/Slot). */
export function decodeFxControlMap(bytes: Uint8Array): FxControlSlot[] {
  const slots: FxControlSlot[] = [];
  for (let i = 0; i < FX_CONTROL_MAP_SLOTS; i++) {
    const o = FX_CONTROL_MAP_OFFSET + i * FX_CONTROL_SLOT_SIZE;
    slots.push({
      sourceControl: bytes[o] ?? 0,
      targetParam: bytes[o + 1] ?? 0,
      minValue: bytes[o + 3] ?? 0,
      maxValue: bytes[o + 5] ?? 0,
    });
  }
  return slots;
}

export interface FxEditBuffer {
  device: number; // FX-Typ-ID @ +0x00
  params: number[]; // roh 0..127, an param-Index-Positionen
  inputLevel: number;
  outputLevel: number;
  controlMap: FxControlSlot[]; // 10 Slots @0x36
}

/**
 * Dekodiert den 0x72-Byte Live-Edit-Buffer. `isMfx` bestimmt die Typ-Tabelle;
 * die Param-Anzahl ergibt sich aus der FX-Definition (unbekannter Typ → 0 Params).
 */
export function decodeFxEditBuffer(
  bytes: Uint8Array,
  isMfx: boolean
): FxEditBuffer {
  const device = bytes[0] ?? 0;
  const def = fxTypeDef(device, isMfx);
  const count = def ? def.params.length : 0;
  const params: number[] = [];
  for (let k = 0; k < count; k++) {
    params.push(bytes[FX_BUF_PARAM_OFFSET + 2 * k] ?? 0);
  }
  return {
    device,
    params,
    inputLevel: bytes[FX_BUF_INPUT_LEVEL] ?? 0,
    outputLevel: bytes[FX_BUF_OUTPUT_LEVEL] ?? 0,
    controlMap: decodeFxControlMap(bytes),
  };
}
