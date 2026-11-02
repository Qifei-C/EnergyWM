// Voiceover: Kokoro-82M (local, Apache-2.0, via kokoro-js) reads every caption; each clip starts just after its caption
// appears, is sped up (≤ MAX_SPEED) only if it would run into the next line, and the clips are mixed into one track,
// loudness-normalized (two-pass loudnorm, −16 LUFS) and muxed into the rendered MP4 (video stream copied).
// Clips are cached by voice + speed + text, so re-runs after a caption edit only synthesize the changed lines.
// Usage: node scripts/voiceover.js [--voice af_heart] [--speed 1] [--in out/energywm_1080p.mp4] [--out out/energywm_1080p_vo.mp4]
//        node scripts/voiceover.js --check      (print the spoken script, no synthesis)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'core.js'));
const { captionsByScene } = require('./captions.js');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const VOICE = opt('--voice', 'af_heart'), SPEED = +opt('--speed', 1);
const IN = path.resolve(ROOT, opt('--in', 'out/energywm_1080p.mp4')), OUT = path.resolve(ROOT, opt('--out', 'out/energywm_1080p_vo.mp4'));
const SR = 24000, LEAD = 0.15, GAP = 0.25, LINGER = 1.0, MAX_SPEED = 1.2, LUFS = -16;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Captions are written for reading; these rules make them sayable (order matters: specific before general).
const SPOKEN = [
  // all-caps acronyms (VLA, MPC) are spelled out by Kokoro as written; hyphenating them makes it read a word ("vella")
  [/’/g, "'"], [/π0\.5/g, 'pi zero point five'], [/, GR00T N1\.6/g, ', and Groot'], [/−∇T/g, 'minus grad T'],
  [/\bJEPA\b/g, 'Jeppa'], [/\bbest-of-N\b/g, 'best of N'], [/attract-and-repel/g, 'attract and repel'],
  [/(\d+) ms\b/g, '$1 milliseconds'], [/\bvs\. /g, 'versus '], [/^([ABC]): /, 'State $1: '],
  [/ → /g, ', then '], [/^…/, ''], [/…$/, '...'], [/ — /g, ', '], [/ – /g, ', ']
];
function toSpoken(text) {
  const s = SPOKEN.reduce((acc, [re, rep]) => acc.replace(re, rep), text.replace(/\\(.)/g, '$1'));
  if (/[^\x20-\x7E]/.test(s)) throw new Error(`no spoken form for ${JSON.stringify(s.match(/[^\x20-\x7E]/g).join(''))} in: ${text}`);
  return s;
}
// all caption lines in film order with absolute times and the latest time their speech may end
function lines() {
  const out = [];
  for (const sc of captionsByScene()) sc.caps.forEach(([a, b, text], k) => out.push({ id: `${String(sc.i + 1).padStart(2, '0')}${sc.id}.${k + 1}`, t0: sc.start + a, t1: sc.start + Math.min(b, sc.dur), text, spoken: toSpoken(text) }));
  out.forEach((l, k) => { const next = k + 1 < out.length ? out[k + 1].t0 : core.DUR; l.limit = Math.min(next - GAP, l.t1 + LINGER, core.DUR - 0.1); });
  return out;
}

// clip with leading/trailing silence trimmed (40 ms kept), so placement follows the caption timing
function trim(x) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.01, pad = Math.round(0.04 * SR);
  let a = 0, b = x.length - 1; while (a < b && Math.abs(x[a]) < th) a++; while (b > a && Math.abs(x[b]) < th) b--;
  return x.slice(Math.max(0, a - pad), Math.min(x.length, b + pad + 1));
}
async function synth(tts, dir, text, speed) {
  const file = path.join(dir, crypto.createHash('sha1').update(`${VOICE}|${speed.toFixed(3)}|${text}`).digest('hex') + '.f32');
  if (fs.existsSync(file)) { const buf = fs.readFileSync(file); return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); }
  const audio = await tts.generate(text, { voice: VOICE, speed });
  if (audio.sampling_rate !== SR) throw new Error(`unexpected sample rate ${audio.sampling_rate}`);
  const x = trim(audio.audio);
  fs.writeFileSync(file + '.tmp', Buffer.from(x.buffer, x.byteOffset, x.byteLength)); fs.renameSync(file + '.tmp', file);
  return x;
}
function writeWavF32(file, x) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + x.byteLength, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(x.byteLength, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(x.buffer, x.byteOffset, x.byteLength)]));
}
function loudnormFilter(wav) { // pass 1 measures; the returned pass-2 filter normalizes linearly to LUFS
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/); if (!m) throw new Error('loudnorm measurement failed:\n' + r.stderr.slice(-800));
  const j = JSON.parse(m[0]);
  return `loudnorm=I=${LUFS}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`;
}

async function main() {
  const L = lines();
  if (argv.includes('--check')) { for (const l of L) console.log(`${l.t0.toFixed(1).padStart(6)} ${(l.limit - l.t0 - LEAD).toFixed(1).padStart(5)}s  ${l.spoken}`); console.log(`${L.length} lines`); return; }
  if (!fs.existsSync(IN)) throw new Error(`missing input video ${IN} (render it first: scripts/render_mp4.js)`);
  const dir = path.join(ROOT, 'out', 'vo', VOICE); fs.mkdirSync(dir, { recursive: true });
  const { KokoroTTS } = require('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu' });
  const mix = new Float32Array(Math.round(core.DUR * SR)), rows = [], over = [];
  for (const l of L) {
    const room = l.limit - (l.t0 + LEAD);
    let speed = SPEED, x = await synth(tts, dir, l.spoken, speed);
    // Kokoro's speed is not exactly inverse to duration: refit from the measured length a few times
    for (let k = 0; k < 3 && x.length / SR > room && speed < MAX_SPEED; k++) {
      speed = Math.min(MAX_SPEED, Math.ceil(speed * (x.length / SR) / room * 1.02 * 100) / 100); x = await synth(tts, dir, l.spoken, speed);
    }
    const len = x.length / SR; if (len > room) over.push(`${l.id} needs ${len.toFixed(2)} s, has ${room.toFixed(2)} s`);
    const at = Math.round((l.t0 + LEAD) * SR); for (let k = 0; k < x.length && at + k < mix.length; k++) mix[at + k] += x[k];
    rows.push([l.id, (l.t0 + LEAD).toFixed(2), (l.t0 + LEAD + len).toFixed(2), room.toFixed(2), len.toFixed(2), speed.toFixed(2), l.spoken].join('\t'));
  }
  fs.writeFileSync(path.join(dir, 'report.tsv'), 'id\tstart\tend\twindow\tspeech\tspeed\tspoken\n' + rows.join('\n') + '\n');
  const wav = path.join(dir, 'mix.wav'); writeWavF32(wav, mix);
  const tmp = OUT.replace(/\.mp4$/, '.tmp.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', IN, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    '-af', loudnormFilter(wav), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, OUT);
  const sped = rows.filter(r => r.split('\t')[5] !== SPEED.toFixed(2)).length;
  console.log(`${L.length} lines · ${sped} sped up · ${over.length} overrun${over.length ? ':\n  ' + over.join('\n  ') : ''}\nwrote ${OUT}`);
}

if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });
module.exports = { toSpoken, lines };
