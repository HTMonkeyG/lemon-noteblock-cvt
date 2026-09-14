import { useCallback, useRef, useState } from 'react';
import { convertFile, sanitizeSongName } from './lib/Converter.js';
import ConvertConfig from './components/ConvertConfig.jsx';
import ConvertResults from './components/ConvertResults.jsx';

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

export default function App() {
  const [file, setFile] = useState(null); // { name, size, data }
  const [songName, setSongName] = useState('');
  const [maxLen, setMaxLen] = useState('2000');
  const [instrument, setInstrument] = useState(0);
  const [offset, setOffset] = useState('0');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback((f) => {
    if (!f) return;
    f.arrayBuffer()
      .then((data) => {
        setFile({ name: f.name, size: f.size, data });
        setResults([]);
        setError('');
        setSongName(sanitizeSongName(baseName(f.name)));
      })
      .catch((e) => {
        setFile(null);
        setError(`读取文件失败：${e && e.message ? e.message : e}`);
      });
  }, []);

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

  const onConvert = useCallback(() => {
    if (!file) return;
    setBusy(true);
    setError('');
    // Yield so the busy spinner paints before the (possibly heavy) conversion.
    setTimeout(() => {
      try {
        setResults(convertFile(file.name, file.data, songName, instrument, maxLen, offset));
      } catch (e) {
        setResults([]);
        setError(e && e.message ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 30);
  }, [file, songName, instrument, maxLen, offset]);

  const isSkyFile = file ? /\.(txt|json)$/i.test(file.name) : false;

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
        <ConvertConfig
          songName={songName}
          onSongNameChange={setSongName}
          maxLen={maxLen}
          onMaxLenChange={setMaxLen}
          instrument={instrument}
          onInstrumentChange={setInstrument}
          offset={offset}
          onOffsetChange={setOffset}
          isSkyFile={isSkyFile}
          busy={busy}
          onConvert={onConvert}
        />
      )}

      {busy && <p className="status">正在转换，请稍候…</p>}

      {error && <p className="error">{error}</p>}

      {!busy && <ConvertResults results={results} />}

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
