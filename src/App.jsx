import { useCallback, useRef, useState } from 'react';
import { convertFile, sanitizeSongName, SKY_INSTRUMENTS } from './lib/converter.js';

const ACCEPT = '.nbs,.txt,.json,.skysheet.json,application/json,text/plain';

function baseName(fileName) {
  const base = String(fileName || 'song').split(/[\\/]/).pop();
  return base.replace(/\.(skysheet\.json|json|txt|nbs)$/i, '') || 'song';
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [file, setFile] = useState(null); // { name, size, data }
  const [songName, setSongName] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [instrument, setInstrument] = useState(0);
  const [maxLen, setMaxLen] = useState('2000');
  const [offset, setOffset] = useState('0');
  const inputRef = useRef(null);

  const runConvert = useCallback((f, nameOverride, inst, mlen, off) => {
    setBusy(true);
    setError('');
    // Yield so the busy spinner paints before the (possibly heavy) conversion.
    setTimeout(() => {
      try {
        const converted = convertFile(f.name, f.data, nameOverride, inst, mlen, off);
        setResults(converted);
      } catch (e) {
        setResults([]);
        setError(e && e.message ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 30);
  }, []);

  const handleFile = useCallback((f) => {
    if (!f) return;
    f.arrayBuffer()
      .then((data) => {
        const parsed = { name: f.name, size: f.size, data };
        setFile(parsed);
        setResults([]);
        setError('');
        const fallback = sanitizeSongName(baseName(f.name));
        setSongName(fallback);
        runConvert(parsed, undefined, instrument, maxLen, offset);
      })
      .catch((e) => {
        setFile(null);
        setError(`读取文件失败：${e && e.message ? e.message : e}`);
      });
  }, [runConvert, instrument, maxLen, offset]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInput = useCallback((e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    e.target.value = '';
  }, [handleFile]);

  const convertWithName = useCallback(() => {
    if (!file) return;
    runConvert(file, songName, instrument, maxLen, offset);
  }, [file, songName, instrument, maxLen, offset, runConvert]);

  const isSkyFile = file ? /\.(txt|json)$/i.test(file.name) : false;

  const onInstrumentChange = useCallback((e) => {
    const v = Number(e.target.value);
    setInstrument(v);
    if (file) runConvert(file, songName, v, maxLen, offset);
  }, [file, songName, maxLen, offset, runConvert]);

  return (
    <div className="app">
      <header className="hero">
        <div className="logo" aria-hidden="true">♫</div>
        <h1>Lemon&apos;s Noteblock Converter</h1>
        <p className="subtitle">
          将 <code>.nbs</code> 与 <code>.txt</code> / <code>.skysheet.json</code> 乐谱
          转换为 Minecraft 基岩版 <code>.mcstructure</code> 结构文件。
        </p>
      </header>

      <section
        className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current && inputRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current && inputRef.current.click(); }}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={onInput} hidden />
        <div className="dropzone-icon" aria-hidden="true">♫</div>
        {file ? (
          <div className="file-chip">
            <span className="file-name">{file.name}</span>
            <span className="file-size">{formatBytes(file.size)}</span>
            <span className="file-hint">点击或拖入以更换文件</span>
          </div>
        ) : (
          <div>
            <p className="dropzone-title">拖入乐谱文件，或点击选择</p>
            <p className="dropzone-hint">支持 .nbs / .txt / .skysheet.json</p>
          </div>
        )}
      </section>

      {file && (
        <section className="controls">
          <label className="field">
            <span className="field-label">歌曲名（用于 scoreboard 与 tag）</span>
            <input
              className="field-input"
              value={songName}
              onChange={(e) => setSongName(e.target.value)}
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
              onChange={(e) => setMaxLen(e.target.value)}
              spellCheck={false}
            />
          </label>
          {isSkyFile && (
            <label className="field">
              <span className="field-label">音色（乐器）</span>
              <select
                className="field-input select"
                value={instrument}
                onChange={onInstrumentChange}
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
                onChange={(e) => setOffset(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <button className="btn" onClick={convertWithName} disabled={busy}>
            {busy ? '转换中…' : '重新转换'}
          </button>
        </section>
      )}

      {busy && <p className="status">正在转换，请稍候…</p>}

      {error && <p className="error">{error}</p>}

      {!busy && results.length > 0 && (
        <section className="results">
          <h2>转换结果</h2>
          {results.map((r, i) => (
            <ResultCard key={i} result={r} />
          ))}
        </section>
      )}

      {!busy && !error && !file && (
        <section className="howto">
          <h2>工作原理</h2>
          <p>
            压缩相同的音符至一条 <code>execute ... playsound</code> 指令，并通过
            <code>scoreboard tick.歌曲名 generic.song</code>计时。
            生成的命令方块按链排布，导出为可直接用结构方块加载的<code>.mcstructure</code>。
            目标玩家需携带 <code>song.歌曲名</code> 标签。
          </p>
        </section>
      )}

      <footer className="footer">
        <span>
          基于 <a href="http://npmjs.com/package/nbs-note.js">nbs-note.js</a> · <a href="http://npmjs.com/package/sky-studio-abc-js">sky-studio-abc-js</a> · <a href="http://npmjs.com/package/mcstructure-js">mcstructure-js</a>
        </span><br />
        <span>Compression by HTMonkeyG</span><br />
        <span>UI by DeepSeek</span><br />
        <span>Developed only for OxygenLemon</span><br />
      </footer>
    </div>
  );
}

function ResultCard({ result }) {
  const [showCommands, setShowCommands] = useState(false);

  const onSaveMC = () => {
    downloadBlob(
      new Blob([result.mcstructure], { type: 'application/octet-stream' }),
      `${result.songName}.mcstructure`,
    );
  };
  const onSaveTxt = () => {
    downloadBlob(
      new Blob([result.txt], { type: 'text/plain;charset=utf-8' }),
      `${result.songName}.txt`,
    );
  };

  const sizeText = `${result.size.x}×${result.size.y}×${result.size.z}`;
  const preview = result.txt.split('\n').slice(0, 20);

  return (
    <article className="card">
      <div className="card-head">
        <h3 className="card-title">{result.songName}</h3>
        <div className="card-actions">
          <button className="btn primary" onClick={onSaveMC}>下载 .mcstructure</button>
          <button className="btn" onClick={onSaveTxt}>下载 .txt</button>
        </div>
      </div>

      <dl className="stats">
        <div className="stat">
          <dt>音符事件</dt>
          <dd>{result.noteCount}</dd>
        </div>
        <div className="stat">
          <dt>命令方块</dt>
          <dd>{result.commandCount}</dd>
        </div>
        <div className="stat">
          <dt>结构尺寸</dt>
          <dd>{sizeText}</dd>
        </div>
      </dl>

      <button
        className="toggle"
        onClick={() => setShowCommands((v) => !v)}
      >
        {showCommands ? '收起指令预览' : '展开指令预览'}
      </button>

      {showCommands && (
        <pre className="commands">
          <code>{preview.join('\n')}{result.commandCount > 20 ? `\n… 共 ${result.commandCount} 条` : ''}</code>
        </pre>
      )}
    </article>
  );
}
