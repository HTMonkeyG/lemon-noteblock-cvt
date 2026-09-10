import { useState } from 'react';

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

export default function ConvertResults({ results }) {
  if (!results || results.length === 0) return null;

  return (
    <section className="results">
      <h2>转换结果</h2>
      {results.map((r, i) => (
        <ResultCard key={i} result={r} />
      ))}
    </section>
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
