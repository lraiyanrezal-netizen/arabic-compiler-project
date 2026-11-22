/**
 * Build step for the LughatDad web showcase.
 *
 *   javacc LughatDad.jj  ->  build/LughatDad.java ...  (parser + lexer)
 *   javac                ->  build/classes/            (the language)
 *   javac ArabicRunner   ->  build/runner/             (JSON wrapper used by the server)
 *
 * Runs automatically on server start when the sources are newer than the last build.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const CLASSES = path.join(BUILD, 'classes');
const RUNNER_OUT = path.join(BUILD, 'runner');
const STAMP = path.join(BUILD, '.stamp');
const TOOLS = path.join(ROOT, 'tools');
const JAR = path.join(TOOLS, 'javacc.jar');
const JAR_URL =
  'https://repo1.maven.org/maven2/net/java/dev/javacc/javacc/7.0.13/javacc-7.0.13.jar';

const SOURCES = [
  path.join(ROOT, 'LughatDad.jj'),
  path.join(__dirname, 'runtime', 'ArabicRunner.java'),
];

function log(msg) {
  process.stdout.write(`[build] ${msg}\n`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.error) throw new Error(`${cmd} not found: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed\n${r.stdout || ''}${r.stderr || ''}`);
  }
  return `${r.stdout || ''}${r.stderr || ''}`;
}

async function ensureJar() {
  if (fs.existsSync(JAR) && fs.statSync(JAR).size > 100000) return;
  fs.mkdirSync(TOOLS, { recursive: true });
  log('downloading JavaCC 7.0.13 ...');
  const res = await fetch(JAR_URL);
  if (!res.ok) throw new Error(`cannot download JavaCC: HTTP ${res.status}`);
  fs.writeFileSync(JAR, Buffer.from(await res.arrayBuffer()));
  log(`JavaCC saved (${fs.statSync(JAR).size} bytes)`);
}

function stamp() {
  return SOURCES.map((f) => {
    const s = fs.statSync(f);
    return `${path.basename(f)}:${s.size}:${Math.round(s.mtimeMs)}`;
  }).join('|');
}

function isStale() {
  if (!fs.existsSync(STAMP)) return true;
  if (!fs.existsSync(path.join(CLASSES, 'LughatDad.class'))) return true;
  if (!fs.existsSync(path.join(RUNNER_OUT, 'ArabicRunner.class'))) return true;
  return fs.readFileSync(STAMP, 'utf8').trim() !== stamp();
}

async function ensureBuild({ force = false } = {}) {
  if (!force && !isStale()) {
    log('up to date');
    return { built: false };
  }
  await ensureJar();
  fs.mkdirSync(CLASSES, { recursive: true });
  fs.mkdirSync(RUNNER_OUT, { recursive: true });

  log('javacc LughatDad.jj');
  const out = run('java', ['-cp', path.join('tools', 'javacc.jar'), 'javacc',
    '-OUTPUT_DIRECTORY=' + path.join('build'), 'LughatDad.jj']);
  if (!/Parser generated successfully/i.test(out)) {
    throw new Error(`javacc did not generate a parser:\n${out}`);
  }

  const javas = fs.readdirSync(BUILD).filter((f) => f.endsWith('.java')).map((f) => path.join('build', f));
  log(`javac ${javas.length} generated files`);
  run('javac', ['-encoding', 'UTF-8', '-nowarn', '-d', path.join('build', 'classes'), ...javas]);

  log('javac ArabicRunner.java');
  run('javac', ['-encoding', 'UTF-8', '-nowarn',
    '-cp', path.join('build', 'classes'),
    '-d', path.join('build', 'runner'),
    path.join('web', 'runtime', 'ArabicRunner.java')]);

  fs.writeFileSync(STAMP, stamp());
  log('done');
  return { built: true };
}

module.exports = { ensureBuild, ROOT, CLASSES, RUNNER_OUT };

if (require.main === module) {
  ensureBuild({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
