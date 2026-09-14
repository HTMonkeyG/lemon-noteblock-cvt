import { SKY_INSTRUMENTS } from '../lib/Converter.js';

export default function ConvertConfig({
  songName,
  onSongNameChange,
  maxLen,
  onMaxLenChange,
  instrument,
  onInstrumentChange,
  offset,
  onOffsetChange,
  isSkyFile,
  busy,
  onConvert,
}) {
  return (
    <section className="controls">
      <label className="field">
        <span className="field-label">歌曲名（用于 scoreboard 与 tag）</span>
        <input
          className="field-input"
          value={songName}
          onChange={(e) => onSongNameChange(e.target.value)}
          placeholder="song"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field-label">指令最大长度（字符）</span>
        <input
          className="field-input"
          type="number"
          min="1"
          step="50"
          value={maxLen}
          onChange={(e) => onMaxLenChange(e.target.value)}
          spellCheck={false}
        />
      </label>

      {isSkyFile && (
        <label className="field">
          <span className="field-label">音色（乐器）</span>
          <select
            className="field-input select"
            value={instrument}
            onChange={(e) => onInstrumentChange(Number(e.target.value))}
            disabled={busy}
          >
            {SKY_INSTRUMENTS.map((ins) => (
              <option key={ins.value} value={ins.value}>{ins.label}</option>
            ))}
          </select>
        </label>
      )}

      {isSkyFile && (
        <label className="field">
          <span className="field-label">基准偏移（半音）</span>
          <input
            className="field-input"
            type="number"
            min="-24"
            max="24"
            step="1"
            value={offset}
            onChange={(e) => onOffsetChange(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}

      <button className="btn" onClick={onConvert} disabled={busy}>
        {busy ? '转换中…' : '转换'}
      </button>
    </section>
  );
}
