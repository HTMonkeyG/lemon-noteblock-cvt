// ============================================================================
//  Song models — unified interface for different music formats.
//
//  Provides a common abstraction over NBS and Sky Studio formats, normalizing
//  them into a unified representation that the converter can consume.
// ============================================================================

import NBSModule from 'nbs-note.js';
const { NBS } = NBSModule;

/**
 * Base Song class — provides a unified interface for all music formats.
 *
 * All song implementations should provide:
 *   - songName: string
 *   - effectiveTicks: array of { tick: number, notes: [{ instrument, key }] }
 *   - getTimeGtFor(tick): convert format-specific time to game ticks
 */
class Song {
  constructor(songName = "") {
    this.songName = songName;
    this.effectiveTicks = [];
  }

  /**
   * Convert a format-specific tick/time value to Minecraft game ticks.
   * Must be overridden by subclasses.
   * @param {number} tick - Format-specific time value
   * @returns {number} - Game ticks (20 ticks = 1 second)
   */
  getTimeGtFor(tick) {
    return tick;
  }

  /**
   * Get the total duration in game ticks.
   * @returns {number}
   */
  getDuration() {
    if (this.effectiveTicks.length === 0) return 0;
    const lastTick = this.effectiveTicks[this.effectiveTicks.length - 1].tick;
    return Math.round(this.getTimeGtFor(lastTick));
  }

  /**
   * Get the total number of notes in the song.
   * @returns {number}
   */
  getNoteCount() {
    return this.effectiveTicks.reduce((sum, t) => sum + t.notes.length, 0);
  }
}

/**
 * NBS (Note Block Studio) song wrapper.
 */
class SongNBS extends Song {
  constructor(nbs) {
    super();

    if (!(nbs instanceof NBS)) {
      throw new Error('SongNBS requires an NBS instance');
    }

    this.nbs = nbs;
    this.songName = nbs.header.songName || 'song';

    // Map NBS effective ticks to our unified format
    this.effectiveTicks = nbs.effectiveTicks.map((t) => ({
      tick: t.tick,
      notes: t.notes.map((n) => ({
        instrument: n.instrument,
        key: n.key
      }))
    }));
  }

  /**
   * NBS uses its own tick system based on tempo.
   * The NBS library already provides the conversion method.
   */
  getTimeGtFor(tick) {
    return this.nbs.getTimeGtFor(tick);
  }

  /**
   * Get NBS-specific metadata.
   */
  getMetadata() {
    const h = this.nbs.header;
    return {
      songName: h.songName,
      songAuthor: h.songAuthor,
      originalAuthor: h.originalAuthor,
      description: h.description,
      tempo: h.tempo,
      timeSignature: h.timeSignature,
      minutesSpent: h.minutesSpent,
      leftClicks: h.leftClicks,
      rightClicks: h.rightClicks,
      blocksAdded: h.blocksAdded,
      blocksRemoved: h.blocksRemoved,
    };
  }
}

/**
 * Sky Studio song wrapper.
 */
class SongSky extends Song {
  constructor(sheet, instrument = 0, offset = 0) {
    super();

    this.sheet = sheet;
    this.instrument = instrument;
    this.offset = offset;
    this.songName = sheet.header?.name || 'song';

    // Convert Sky Studio notes to unified format
    this._buildEffectiveTicks();
  }

  _buildEffectiveTicks() {
    let notes = this.sheet.notes;
    if (!Array.isArray(notes) || notes.length === 0) {
      notes = this.sheet.ticksToNotes ? this.sheet.ticksToNotes() : [];
    }

    // Group notes by their onset time (ms)
    const tickMap = new Map();
    for (const n of notes) {
      const t = Math.round(Number(n.time) || 0);
      if (!tickMap.has(t)) tickMap.set(t, []);
      tickMap.get(t).push({
        instrument: this.instrument,
        key: this._skyLaneToKey(Number(n.key) || 0)
      });
    }

    // Sort by time and convert to array
    this.effectiveTicks = [...tickMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tick, ns]) => ({ tick, notes: ns }));
  }

  /**
   * Convert Sky Studio lane index (0-14) to note block key.
   * Sky uses C major scale: C D E F G A B
   */
  _skyLaneToKey(lane) {
    const SKY_BASE_KEY = 39; // C4 (middle C)
    const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]; // semitones in C major
    const octave = Math.floor(lane / 7);
    const degree = lane % 7;
    return SKY_BASE_KEY + this.offset + MAJOR_SCALE[degree] + 12 * octave;
  }

  /**
   * Sky Studio time is in milliseconds.
   * One Minecraft game tick = 50ms.
   */
  getTimeGtFor(ms) {
    return ms / 50;
  }

  /**
   * Get Sky Studio specific metadata.
   */
  getMetadata() {
    return {
      songName: this.sheet.header?.name,
      author: this.sheet.header?.author,
      transcriber: this.sheet.header?.transcribedBy,
      bpm: this.sheet.header?.bpm,
      instrument: this.instrument,
      offset: this.offset,
    };
  }
}

export {
  Song,
  SongNBS,
  SongSky,
};
