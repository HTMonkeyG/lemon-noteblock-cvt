// ============================================================================
//  lemon-nbs-cvt — core conversion (browser port of cli.js).
//
//  Takes an NBS file (via nbs-note.js) or a Sky Studio score (via
//  sky-studio-abc-js), normalises it into a unified "song" model, and feeds it
//  through the exact command-generation + structure-building algorithm from
//  cli.js to produce a .mcstructure (and the plain .txt command list).
// ============================================================================

import NBSModule from 'nbs-note.js';
import SkyModule from 'sky-studio-abc-js';
import MCStructure from 'mcstructure-js';
import PMR from 'project-mirror-registry';

const { NBS, INSTBE } = NBSModule;
const { SkyStudioABC } = SkyModule;

const MAX_DUP_LIMIT = 4;

// Command block types used by cli.js:
//   0 = impulse, 1 = repeating, 2 = chain.
const BLOCK_NAMES = [
  'minecraft:command_block',
  'minecraft:repeating_command_block',
  'minecraft:chain_command_block',
];

// Sky Studio exposes 15 note lanes (A1..A5, B1..B5, C1..C5), indexed 0-14.
// Map each lane onto a chromatic semitone anchored at the note block default
// (F#4 = key 45).  Lane 0 -> 45, lane 14 -> 59.  The `playsound` pitch formula
// used downstream handles this range fine (it is not a note block, so the
// 2-octave note block cap does not apply).
const SKY_BASE_KEY = 45;
const SKY_INSTRUMENT = 0; // harp (default when none selected)

// Friendly labels for the 16 vanilla Bedrock note-block instruments.
const INSTRUMENT_LABELS = {
  0: '竖琴 / 钢琴 (Harp)',
  1: '贝斯 (Bass)',
  2: '底鼓 (Basedrum)',
  3: '军鼓 (Snare)',
  4: '踩镲 (Hat)',
  5: '吉他 (Guitar)',
  6: '长笛 (Flute)',
  7: '钟琴 (Bell)',
  8: '风铃 (Chime)',
  9: '木琴 (Xylophone)',
  10: '铁木琴 (Iron Xylophone)',
  11: '牛铃 (Cow Bell)',
  12: '迪吉里杜管 (Didgeridoo)',
  13: '比特音 (Bit)',
  14: '班卓琴 (Banjo)',
  15: '拨弦 (Pling)',
};

/**
 * Selectable Sky Studio instruments — every vanilla Bedrock note-block sound
 * (`INSTBE`), in numeric order.
 */
export const SKY_INSTRUMENTS = Object.keys(INSTBE)
  .map((k) => Number(k))
  .sort((a, b) => a - b)
  .map((value) => ({
    value,
    sound: INSTBE[value],
    label: INSTRUMENT_LABELS[value] || INSTBE[value],
  }));

// ----------------------------------------------------------------------------
// Song name / helpers
// ----------------------------------------------------------------------------

/** Turn an arbitrary name into a safe fake-player / tag token. */
export function sanitizeSongName(name) {
  const cleaned = String(name || '')
    .replace(/\P{ID_Continue}/gu, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'song';
}

/** Base name of a file without its (possibly multi-part) extension. */
function baseName(fileName) {
  const base = String(fileName || 'song')
    .split(/[\\/]/)
    .pop();
  // Strip ".nbs" / ".txt" / ".json" / ".skysheet.json"
  return base.replace(/\.(skysheet\.json|json|txt|nbs)$/i, '') || 'song';
}

// ----------------------------------------------------------------------------
// Unified "song" model — mirrors the NBS surface cli.js consumes.
//
//   {
//     songName: string,
//     effectiveTicks: [{ tick: number, notes: [{ instrument, key }] }],
//     getTimeGtFor(tick): number   // tick -> game tick
//   }
// ----------------------------------------------------------------------------

/** Parse an .nbs buffer into the unified song model. */
export function parseNBS(buffer, songName) {
  const nbs = NBS.deserialize(buffer);
  const name = songName || nbs.header.songName || 'song';

  return {
    songName: name,
    effectiveTicks: nbs.effectiveTicks.map((t) => ({
      tick: t.tick,
      notes: t.notes.map((n) => ({ instrument: n.instrument, key: n.key })),
    })),
    getTimeGtFor: (tick) => nbs.getTimeGtFor(tick),
  };
}

/**
 * Parse a Sky Studio score (`.txt` or `.skysheet.json`) into one or more
 * unified songs (a `.skysheet.json` may hold several sheets).
 */
export function parseSkyStudio(text, fallbackSongName, instrument = SKY_INSTRUMENT) {
  const parsed = SkyStudioABC.deserialize(text);
  if (parsed == null) throw new Error('无法解析该 Sky Studio 文件。');
  const sheets = Array.isArray(parsed) ? parsed : [parsed];

  // Clamp to a valid vanilla instrument index (0-15).
  const inst = Number.isInteger(instrument) && instrument >= 0 && instrument <= 15
    ? instrument
    : SKY_INSTRUMENT;

  return sheets.map((sheet) => {
    let notes = sheet.notes;
    if (!Array.isArray(notes) || notes.length === 0) {
      notes = sheet.ticksToNotes();
    }

    // Group notes by their onset (ms) into game-tick buckets.
    const tickMap = new Map();
    for (const n of notes) {
      const t = Math.round(Number(n.time) || 0);
      if (!tickMap.has(t)) tickMap.set(t, []);
      tickMap.get(t).push({
        instrument: inst,
        key: SKY_BASE_KEY + (Number(n.key) || 0),
      });
    }

    const effectiveTicks = [...tickMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tick, ns]) => ({ tick, notes: ns }));

    const name = sheet.header.name || fallbackSongName || 'song';

    return {
      songName: name,
      effectiveTicks,
      // Sky Studio time is expressed in milliseconds; a game tick is 50ms.
      getTimeGtFor: (ms) => ms / 50,
    };
  });
}

// ----------------------------------------------------------------------------
// Command generation (verbatim port of cli.js `toCommands`).
// ----------------------------------------------------------------------------

function buildHash(note, sameCount) {
  return note.instrument + '/' + note.key + '/' + sameCount;
}

function expandHash(hash) {
  const s = hash.split('/');
  return { instrument: Number(s[0]), key: Number(s[1]) };
}

function toPlaySound(note) {
  const sound = INSTBE[note.instrument] || 'note.harp';
  return `playsound ${sound} @s ~~~ 1.0 ${Math.pow(2, (note.key - 45) / 12)}`;
}

export function toCommands(song, maxLen = 2000) {
  // Coerce & clamp the per-command length limit to a sane positive integer.
  maxLen = Math.floor(Number(maxLen));
  if (!Number.isFinite(maxLen) || maxLen <= 0) maxLen = 2000;

  const name = sanitizeSongName(song.songName);
  const exeTarget = `@a[tag=song.${name}]`;
  const exeTmr = `tick.${name} generic.song`;

  const commandBegin = () => `execute as ${exeTarget} `;
  const commandSegment = (range) => `unless score ${exeTmr} matches ${range} `;
  const commandEnd = (payload) => `at @s run ${payload}`;

  function buildRange(min, max) {
    let result = '';
    if (typeof min === 'number') result += min;
    result += '..';
    if (typeof max === 'number') result += max;
    return result;
  }

  const notes = new Map();
  const commands = [];

  for (const a of song.effectiveTicks) {
    const gametick = Math.round(song.getTimeGtFor(a.tick));
    const tickNoteDup = {};

    for (const b of a.notes) {
      let hash = buildHash(b, 1);
      let dupCount;

      if (tickNoteDup[hash]) {
        if (tickNoteDup[hash] >= MAX_DUP_LIMIT) continue;
        dupCount = tickNoteDup[hash] + 1;
        tickNoteDup[hash] = dupCount;
        hash = buildHash(b, dupCount);
      } else {
        tickNoteDup[hash] = 1;
      }

      if (!notes.has(hash)) notes.set(hash, []);
      notes.get(hash).push(gametick);
    }
  }

  for (const [hash, ticks] of notes.entries()) {
    const note = expandHash(hash);
    let command = commandBegin();
    let time = -1;

    for (const tick of ticks) {
      if (tick === 0 || (tick !== time + 1 && tick !== time)) {
        command += commandSegment(buildRange(time === -1 || time + 1, tick - 1));
      }
      time = tick;

      if (command.length > maxLen) {
        command += commandSegment(buildRange(time + 1));
        command += commandEnd(toPlaySound(note));
        commands.push(command);

        command = commandBegin();
        time = -1;
      }
    }

    command += commandSegment(buildRange(time + 1));
    command += commandEnd(toPlaySound(note));
    commands.push(command);
  }

  return commands;
}

// ----------------------------------------------------------------------------
// Structure building (verbatim port of cli.js `createCommandBlock` / `toMCS`).
// ----------------------------------------------------------------------------

function createCommandBlock(command, type, direction) {
  const block = PMR.createUniversalTag('block');
  const blockEntity = PMR.createBlockEntity(BLOCK_NAMES[type]);

  block.name = BLOCK_NAMES[type];
  block.states['i32>facing_direction'] = direction;

  blockEntity.Command = command;
  blockEntity.auto = type === 2 ? 1 : 0;
  blockEntity.conditionalMode = 0;
  blockEntity.conditionMet = 1;
  // Note: project-mirror-registry spells this "LPCondionalMode" (typo); the
  // field the game reads is "LPConditionalMode", so write it via its typed key.
  blockEntity['i8>LPConditionalMode'] = 0;
  blockEntity.LPRedstoneMode = type === 2 ? 0 : 1;

  return { block, blockEntity };
}

// Bedrock `facing_direction` values, and the step each one activates:
//   0 = y- (down), 1 = y+ (up), 2 = z- (north), 3 = z+ (south),
//   4 = x- (west), 5 = x+ (east).
function facingBetween(a, b) {
  if (b.x !== a.x) return b.x > a.x ? 5 : 4;
  if (b.y !== a.y) return b.y > a.y ? 1 : 0;
  return b.z > a.z ? 3 : 2;
}

export function toMCStructure(commands) {
  // Cube side length = ceil(cube root of the command count).
  const side = Math.max(1, Math.ceil(Math.cbrt(commands.length)));
  const planeSize = side * side;

  // Map a linear index to a cell on a single S-shaped (serpentine) curve that
  // fills the whole cube.  Consecutive indices land on face-adjacent cells, so
  // the command blocks form one continuous chain.
  //
  //   x: slow axis, one (side x side) plane per layer.
  //   y, z: 2D serpentine within the plane; odd x-layers run the plane in
  //         reverse so each layer starts exactly where the previous one ended.
  const positionAt = (i) => {
    const x = Math.floor(i / planeSize);
    let p = i % planeSize;
    if (x % 2 === 1) p = planeSize - 1 - p;
    const y = Math.floor(p / side);
    const r = p % side;
    const z = y % 2 === 0 ? r : side - 1 - r;
    return { x, y, z };
  };

  const structure = new MCStructure(side, side, side);

  for (let i = 0; i < commands.length; i++) {
    const cur = positionAt(i);
    // Every block faces forward along the S-curve.  The final block points at
    // the (empty) cell where a next block would sit, so the chain simply ends
    // there — its facing matches the path's natural continuation.
    const facing = facingBetween(cur, positionAt(i + 1));

    // First block = repeating (needs redstone), the rest = chain (always active).
    const block = createCommandBlock(commands[i], i === 0 ? 1 : 2, facing);

    structure.setBlock(cur, block.block);
    structure.setBlockData(cur, block.blockEntity);
  }

  return { structure, size: { x: side, y: side, z: side } };
}

// ----------------------------------------------------------------------------
// High-level conversion entry point.
// ----------------------------------------------------------------------------

/**
 * Convert a file's contents into one or more conversion results.
 *
 * @param {string} fileName   File name (used to detect the format).
 * @param {ArrayBuffer} data  Raw bytes; text formats are decoded here.
 * @param {string} [nameOverride] Optional song name, overriding the default.
 * @param {number} [instrument] Instrument index (0-15) for Sky Studio scores.
 *   Ignored for .nbs, whose notes carry their own instrument.
 * @param {number} [maxLen] Max length of a single generated command before it
 *   is split across multiple command blocks (applies to both formats).
 * @returns {Array<{ songName, noteCount, commands, size, mcstructure, txt }>}
 */
export function convertFile(fileName, data, nameOverride, instrument, maxLen) {
  const lower = String(fileName || '').toLowerCase();
  const fallback = nameOverride
    ? sanitizeSongName(nameOverride)
    : sanitizeSongName(baseName(fileName));

  let songs;

  if (lower.endsWith('.nbs')) {
    songs = [parseNBS(data, fallback)];
  } else if (lower.endsWith('.txt') || lower.endsWith('.json')) {
    const text = new TextDecoder().decode(data);
    songs = parseSkyStudio(text, fallback, instrument);
  } else {
    throw new Error('不支持的文件类型。请选择 .nbs / .txt / .skysheet.json 文件。');
  }

  return songs.map((song) => {
    const commands = toCommands(song, maxLen);
    const { structure, size } = toMCStructure(commands);

    // Total note events (before de-duplication), for display only.
    const noteCount = song.effectiveTicks.reduce((sum, t) => sum + t.notes.length, 0);

    return {
      songName: sanitizeSongName(song.songName),
      noteCount,
      commandCount: commands.length,
      size,
      mcstructure: structure.serialize(),
      txt: commands.join('\n'),
    };
  });
}
