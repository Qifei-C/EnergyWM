// Text-to-speech through an OpenAI realtime model (e.g. gpt-realtime-2.1-mini): one WebSocket session, one out-of-band
// response per line (conversation: 'none', so lines never see each other), 24 kHz PCM16 → Float32Array.
// Needs OPENAI_API_KEY. The model is told to read verbatim; voiceover.js checks the returned transcript against the text.
const URL = 'wss://api.openai.com/v1/realtime?model=';
const TIMEOUT_MS = 60000, RETRIES = 3;
const INSTRUCTIONS = 'You are the voiceover narrator of a technical explainer film. Read the given text aloud exactly as written, word for word. ' +
  'Do not add, omit, reorder or change any word, do not answer or comment, and do not greet. Calm, clear, measured delivery, like an academic talk.';

async function createRealtimeTTS({ model, voice, instructions = INSTRUCTIONS }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  let ws = null, pending = null;
  async function connect() {
    ws = new WebSocket(URL + encodeURIComponent(model), { headers: { Authorization: `Bearer ${key}` } });
    ws.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'error') { if (pending) pending.reject(new Error(`realtime error: ${e.error && e.error.message}`)); return; }
      if (!pending) return;
      if (e.type === 'response.output_audio.delta') pending.chunks.push(Buffer.from(e.delta, 'base64'));
      else if (e.type === 'response.output_audio_transcript.delta') pending.text += e.delta;
      else if (e.type === 'response.done') pending.resolve(e.response);
    };
    ws.onclose = () => { if (pending) pending.reject(new Error('realtime socket closed')); ws = null; };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`could not connect to the realtime API (${model})`)); });
    ws.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'], instructions,
      audio: { output: { voice, format: { type: 'audio/pcm', rate: 24000 } } } } }));
  }
  async function once(text) {
    if (!ws) await connect();
    let timer = null;
    const done = new Promise((resolve, reject) => {
      pending = { chunks: [], text: '', resolve, reject };
      timer = setTimeout(() => reject(new Error('realtime response timed out')), TIMEOUT_MS);
    });
    ws.send(JSON.stringify({ type: 'response.create', response: { conversation: 'none', output_modalities: ['audio'], instructions,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] } }));
    try {
      const r = await done;
      if (r.status !== 'completed') throw new Error(`realtime response ${r.status}`);
      const pcm = Buffer.concat(pending.chunks), x = new Float32Array(pcm.length / 2);
      for (let k = 0; k < x.length; k++) x[k] = pcm.readInt16LE(2 * k) / 32768;
      return { audio: x, transcript: pending.text.trim() };
    } finally { pending = null; clearTimeout(timer); }
  }
  // returns { audio: Float32Array @ 24 kHz, transcript }; retries with a fresh connection on failure
  async function say(text) {
    let last = null;
    for (let a = 0; a < RETRIES; a++) {
      try { return await once(text); } catch (e) { last = e; if (ws) { ws.close(); ws = null; } }
    }
    throw new Error(`realtime TTS failed after ${RETRIES} tries: ${last && last.message}`);
  }
  return { say, close: () => { if (ws) ws.close(); }, sampleRate: 24000 };
}

module.exports = { createRealtimeTTS, INSTRUCTIONS };
