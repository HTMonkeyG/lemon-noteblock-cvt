// ============================================================================
//  Converter.1.js — Object-oriented conversion system.
//
//  A refactored version of converter.js that uses the CommandBuilder and Song
//  classes for a more structured, maintainable approach to command generation.
// ============================================================================

import NBSModule from 'nbs-note.js';
import SkyModule from 'sky-studio-abc-js';
import MCStructure from 'mcstructure-js';
import PMR from 'project-mirror-registry';
import { Song, SongNBS, SongSky } from './Song.js';
import {
  ExecuteCommandBuilder,
  ExecuteScoreSubcommand,
  ExecuteAsSubcommand,
  ExecuteAtSubcommand,
  SelectorBuilder,
  ScoreRange,
  ScoreboardRef,
  TellrawCommandBuilder,
} from './CommandBuilder.js';

const { NBS, INSTBE } = NBSModule;
const { SkyStudioABC } = SkyModule;

// Constants
const MAX_DUP_LIMIT = 4;
const BLOCK_NAMES = [
  'minecraft:command_block',
  'minecraft:repeating_command_block',
  'minecraft:chain_command_block',
];

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

/**
 * Sanitize a song name for use as a tag/scoreboard identifier.
 */
function sanitizeSongName(name) {
  const cleaned = String(name || '')
    .replace(/\P{ID_Continue}/gu, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'song';
}

/**
 * Extract base name from a file path.
 */
function baseName(fileName) {
  const base = String(fileName || 'song')
    .split(/[\\/]/)
    .pop();
  return base.replace(/\.(skysheet\.json|json|txt|nbs)$/i, '') || 'song';
}

// ============================================================================
// Command Generator — builds Minecraft commands from a Song
// ============================================================================

class CommandGenerator {
  constructor(song, options = {}) {
    if (!(song instanceof Song)) {
      throw new Error('CommandGenerator requires a Song instance');
    }

    this.song = song;
    this.maxCommandLength = options.maxCommandLength || 2000;
    this.showProgressBar = options.showProgressBar !== false;

    this.name = sanitizeSongName(song.songName);
    this.exeTarget = `@a[tag=song.${this.name}]`;
    this.exeTmr = `tick.${this.name} generic.song`;
  }

  /**
   * Generate all commands for this song.
   */
  generate() {
    const noteCommands = this._generateNoteCommands();
    const progressCommands = this.showProgressBar
      ? this._generateProgressBar()
      : [];

    return [...progressCommands, ...noteCommands];
  }

  /**
   * Build hash key for note deduplication.
   */
  _buildHash(note, dupCount) {
    return `${note.instrument}/${note.key}/${dupCount}`;
  }

  /**
   * Parse hash back to note data.
   */
  _expandHash(hash) {
    const [instrument, key] = hash.split('/');
    return { instrument: Number(instrument), key: Number(key) };
  }

  /**
   * Generate playsound command for a note.
   */
  _toPlaySound(note) {
    const sound = INSTBE[note.instrument] || 'note.harp';
    const pitch = Math.pow(2, (note.key - 45) / 12);
    return `playsound ${sound} @s ~~~ 1.0 ${pitch}`;
  }

  /**
   * Generate the main note playback commands using CommandBuilder abstractions.
   */
  _generateNoteCommands() {
    const notes = new Map();
    const commands = [];

    // Collect all notes grouped by (instrument, key, dupCount)
    for (const tick of this.song.effectiveTicks) {
      const gametick = Math.round(this.song.getTimeGtFor(tick.tick));
      const tickNoteDup = {};

      for (const note of tick.notes) {
        let hash = this._buildHash(note, 1);
        let dupCount = 1;

        if (tickNoteDup[hash]) {
          if (tickNoteDup[hash] >= MAX_DUP_LIMIT) continue;
          dupCount = tickNoteDup[hash] + 1;
          tickNoteDup[hash] = dupCount;
          hash = this._buildHash(note, dupCount);
        } else {
          tickNoteDup[hash] = 1;
        }

        if (!notes.has(hash)) notes.set(hash, []);
        notes.get(hash).push(gametick);
      }
    }

    // Generate commands for each unique note using ExecuteCommandBuilder
    for (const [hash, ticks] of notes.entries()) {
      const note = this._expandHash(hash);
      let builder = this._createExecuteBuilder();
      let time = -1;

      for (const tick of ticks) {
        if (tick === 0 || (tick !== time + 1 && tick !== time)) {
          const range = new ScoreRange(
            time === -1 ? ScoreRange.kScoreMin : time + 1,
            tick - 1
          );
          builder.addSubcommand(this._createScoreCondition(range, true));
        }
        time = tick;

        const estimatedLength = builder.estimate() + 100; // +100 for final payload
        if (estimatedLength > this.maxCommandLength) {
          const finalRange = new ScoreRange(time + 1, ScoreRange.kScoreMax);
          builder.addSubcommand(this._createScoreCondition(finalRange, true));
          builder.setRunCommand(this._toPlaySound(note));
          commands.push(builder.finalize());

          builder = this._createExecuteBuilder();
          time = -1;
        }
      }

      const finalRange = new ScoreRange(time + 1, ScoreRange.kScoreMax);
      builder.addSubcommand(this._createScoreCondition(finalRange, true));
      builder.setRunCommand(this._toPlaySound(note));
      commands.push(builder.finalize());
    }

    return commands;
  }

  /**
   * Create a base execute builder with target selector.
   */
  _createExecuteBuilder() {
    const selector = new SelectorBuilder();
    selector.setBase("@a");
    selector.addSimpleCondition("tag", `song.${this.name}`);

    const builder = new ExecuteCommandBuilder();

    // Add "as <selector>" subcommand
    builder.addSubcommand(new ExecuteAsSubcommand(selector));

    // Add "at @s" subcommand
    builder.addSubcommand(new ExecuteAtSubcommand("@s"));

    return builder;
  }

  /**
   * Create a score condition subcommand.
   */
  _createScoreCondition(range, unless = false) {
    const condition = new ExecuteScoreSubcommand(unless);
    condition.setRange(range);

    // Create proper ScoreboardRef
    const scoreboard = new ScoreboardRef("generic.song", `tick.${this.name}`);
    condition.setScoreboard(scoreboard);

    return condition;
  }

  /**
   * Generate progress bar display commands using TellrawCommandBuilder.
   */
  _generateProgressBar() {
    const maxTicks = this.song.getDuration();
    const tempEntityName = `"progress.${this.name}"`;
    const tempEntitySelector = `@e[type=armor_stand,name=${tempEntityName}]`;

    // Build the progress bar using TellrawCommandBuilder
    const buildRawText = (numSegments = 8) => {
      const interval = maxTicks / numSegments;
      const selectors = [];
      const segments = [];

      for (let i = 0; i <= numSegments; i++) {
        if (i > 0) {
          const selector = new SelectorBuilder();
          selector.setBase("@e");
          selector.addSimpleCondition("type", "armor_stand");
          selector.addSimpleCondition("name", tempEntityName.slice(1, -1)); // Remove quotes
          selector.addScoreRange("generic.song", new ScoreRange(
            ScoreRange.kScoreMin,
            Math.floor(interval * i)
          ));
          selectors.push({ selector: selector.finalize() });
        }
        segments.push({
          text: `${"§a".padEnd(i + 2, "=")}${"§f".padEnd(numSegments - i + 2, "=")}`
        });
      }

      return {
        rawtext: [
          { text: `§f${this.name} [` },
          {
            translate: `%%${numSegments + 1}`,
            with: { rawtext: [...selectors, ...segments] }
          },
          { text: `]§f ` },
          { score: { objective: "generic.song", name: `tick.${this.name}` } },
          { text: `/${maxTicks}` },
        ]
      };
    };

    return [
      `summon armor_stand ${tempEntityName}`,
      `scoreboard players operation ${tempEntitySelector} generic.song = ${this.exeTmr}`,
      `titleraw ${this.exeTarget} actionbar ${JSON.stringify(buildRawText())}`,
      `kill ${tempEntitySelector}`
    ];
  }
}

// ============================================================================
// Structure Builder — creates .mcstructure from commands
// ============================================================================

class StructureBuilder {
  constructor(commands) {
    this.commands = commands;
    this.side = Math.max(1, Math.ceil(Math.cbrt(commands.length)));
    this.planeSize = this.side * this.side;
  }

  /**
   * Map linear index to 3D position on a serpentine curve.
   */
  _positionAt(i) {
    const x = Math.floor(i / this.planeSize);
    let p = i % this.planeSize;
    if (x % 2 === 1) p = this.planeSize - 1 - p;
    const y = Math.floor(p / this.side);
    const r = p % this.side;
    const z = y % 2 === 0 ? r : this.side - 1 - r;
    return { x, y, z };
  }

  /**
   * Calculate facing direction between two positions.
   */
  _facingBetween(a, b) {
    if (b.x !== a.x) return b.x > a.x ? 5 : 4;
    if (b.y !== a.y) return b.y > a.y ? 1 : 0;
    return b.z > a.z ? 3 : 2;
  }

  /**
   * Create a command block with the given properties.
   */
  _createCommandBlock(command, type, direction) {
    const block = PMR.createUniversalTag('block');
    const blockEntity = PMR.createBlockEntity(BLOCK_NAMES[type]);

    block.name = BLOCK_NAMES[type];
    block.states['i32>facing_direction'] = direction;

    blockEntity.Command = command;
    blockEntity.auto = type === 2 ? 1 : 0;
    blockEntity.conditionalMode = 0;
    blockEntity.conditionMet = 1;
    blockEntity['i8>LPConditionalMode'] = 0;
    blockEntity.LPRedstoneMode = type === 2 ? 0 : 1;

    return { block, blockEntity };
  }

  /**
   * Build the MCStructure.
   */
  build() {
    const structure = new MCStructure(this.side, this.side, this.side);

    for (let i = 0; i < this.commands.length; i++) {
      const cur = this._positionAt(i);
      const facing = this._facingBetween(cur, this._positionAt(i + 1));
      const block = this._createCommandBlock(
        this.commands[i],
        i === 0 ? 1 : 2, // First block = repeating, rest = chain
        facing
      );

      structure.setBlock(cur, block.block);
      structure.setBlockData(cur, block.blockEntity);
    }

    return {
      structure,
      size: { x: this.side, y: this.side, z: this.side }
    };
  }
}

// ============================================================================
// Converter — high-level conversion API
// ============================================================================

class Converter {
  constructor(options = {}) {
    this.maxCommandLength = options.maxCommandLength || 2000;
    this.showProgressBar = options.showProgressBar !== false;
  }

  /**
   * Convert a Song instance to commands and structure.
   */
  convertSong(song) {
    const generator = new CommandGenerator(song, {
      maxCommandLength: this.maxCommandLength,
      showProgressBar: this.showProgressBar,
    });

    const commands = generator.generate();
    const builder = new StructureBuilder(commands);
    const { structure, size } = builder.build();

    return {
      songName: sanitizeSongName(song.songName),
      noteCount: song.getNoteCount(),
      commandCount: commands.length,
      size,
      mcstructure: structure.serialize(),
      txt: commands.join('\n'),
    };
  }

  /**
   * Parse and convert an NBS file.
   */
  convertNBS(buffer, songName) {
    const nbs = NBS.deserialize(buffer);
    const song = new SongNBS(nbs);
    if (songName) song.songName = songName;
    return this.convertSong(song);
  }

  /**
   * Parse and convert Sky Studio file(s).
   */
  convertSkyStudio(text, fallbackName, instrument = 0, offset = 0) {
    const parsed = SkyStudioABC.deserialize(text);
    if (parsed == null) {
      throw new Error('无法解析该 Sky Studio 文件。');
    }

    const sheets = Array.isArray(parsed) ? parsed : [parsed];
    const results = [];

    for (const sheet of sheets) {
      const song = new SongSky(sheet, instrument, offset);
      if (!song.songName) song.songName = fallbackName || 'song';
      results.push(this.convertSong(song));
    }

    return results;
  }

  /**
   * Auto-detect format and convert.
   */
  convertFile(fileName, data, nameOverride, instrument, offset) {
    const lower = String(fileName || '').toLowerCase();
    const fallback = nameOverride
      ? sanitizeSongName(nameOverride)
      : sanitizeSongName(baseName(fileName));

    if (lower.endsWith('.nbs')) {
      return [this.convertNBS(data, fallback)];
    } else if (lower.endsWith('.txt') || lower.endsWith('.json')) {
      const text = new TextDecoder().decode(data);
      return this.convertSkyStudio(text, fallback, instrument, offset);
    } else {
      throw new Error('不支持的文件类型。请选择 .nbs / .txt / .skysheet.json 文件。');
    }
  }
}

// ============================================================================
// Legacy API wrapper for backwards compatibility
// ============================================================================

/**
 * Convenience function that matches the old converter.js API.
 * @param {string} fileName - Name of the file
 * @param {ArrayBuffer} data - File data
 * @param {string} nameOverride - Optional song name override
 * @param {number} instrument - Sky Studio instrument index
 * @param {string|number} maxLen - Maximum command length
 * @param {string|number} offset - Sky Studio pitch offset
 * @returns {Array} Array of conversion results
 */
export function convertFile(fileName, data, nameOverride, instrument, maxLen, offset) {
  const converter = new Converter(Number(maxLen) || 2000);
  return converter.convertFile(
    fileName,
    data,
    nameOverride,
    Number(instrument) || 0,
    Number(offset) || 0
  );
}

// ============================================================================
// Exports
// ============================================================================

export {
  Converter,
  CommandGenerator,
  StructureBuilder,
  sanitizeSongName,
  baseName,
};

export default Converter;
