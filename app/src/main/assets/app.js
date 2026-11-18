// Curio Voice: free, on-device narration with Kokoro-82M (Apache-2.0) via kokoro-js.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICES = [
  ["am_onyx", "Onyx: deep male (US)"], ["am_fenrir", "Fenrir: strong male (US)"], ["am_michael", "Michael: warm male (US)"],
  ["am_adam", "Adam: male (US)"], ["am_echo", "Echo: male (US)"], ["am_eric", "Eric: male (US)"], ["am_liam", "Liam: male (US)"],
  ["am_puck", "Puck: lively male (US)"], ["bm_george", "George: deep male (UK)"], ["bm_lewis", "Lewis: male (UK)"],
  ["bm_daniel", "Daniel: male (UK)"], ["bm_fable", "Fable: male (UK)"], ["af_heart", "Heart: female (US)"],
  ["af_bella", "Bella: female (US)"], ["bf_emma", "Emma: female (UK)"],
];

const $ = (id) => document.getElementById(id);
const el = { script: $("script"), voice: $("voice"), name: $("name"), speed: $("speed"), pause: $("pause"),
  speedV: $("speedV"), pauseV: $("pauseV"), go: $("go"), preview: $("preview"), prog: $("prog"), status: $("status"),
  result: $("result"), player: $("player"), save: $("save"), share: $("share") };

for (const [id, label] of VOICES) el.voice.add(new Option(label, id));

// ---- remember settings + draft on this phone
const store = {
  get(k, d) { try { const v = localStorage.getItem("cv_" + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cv_" + k, v); } catch {} },
};
el.script.value = store.get("script", "");
el.voice.value = store.get("voice", "am_onyx");
el.speed.value = store.get("speed", "0.95");
el.pause.value = store.get("pause", "0.9");
el.name.value = store.get("name", "narration");
const showVals = () => { el.speedV.textContent = (+el.speed.value).toFixed(2) + "×"; el.pauseV.textContent = (+el.pause.value).toFixed(1) + " s"; };
showVals();
for (const k of ["script", "voice", "speed", "pause", "name"]) el[k].addEventListener("input", () => { store.set(k, el[k].value); showVals(); });

// ---- text handling (same rules as the desktop Curio Voice Studio)
const clean = (t) => t.replace(/\[[^\]]*\]/g, " ").replace(/…/g, "...").replace(/[—–]/g, ", ").replace(/[ \t]+/g, " ").trim();
const paragraphs = (s) => s.trim().split(/\n\s*\n/).map(clean).filter(Boolean);
function chunks(p, max = 240) {
  const sents = p.split(/(?<=[.!?])\s+/); const out = []; let cur = "";
  for (let s of sents) {
    if (!s) continue;
    if ((cur + " " + s).trim().length <= max) { cur = (cur + " " + s).trim(); continue; }
    if (cur) out.push(cur);
    while (s.length > max) { let c = s.lastIndexOf(",", max); if (c < 40) c = max; out.push(s.slice(0, c + 1).trim()); s = s.slice(c + 1).trim(); }
    cur = s;
  }
  if (cur) out.push(cur);
  return out;
}

// ---- model (downloaded once, then cached by the browser)
let tts = null;
async function loadModel() {
  if (tts) return tts;
  setStatus("Loading the voice model... (first time: ~90 MB download)");
  const files = {};
  const progress_callback = (e) => {
    if (e.status === "progress" && e.total) {
      files[e.file] = [e.loaded, e.total];
      const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
      setProg(l / t); setStatus(`Downloading voice model: ${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
    }
  };
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback });
  setProg(0);
  return tts;
}

// ---- audio helpers
function toWav(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
function join(parts, sr, gaps) {
  let n = Math.round(sr * 0.3) + Math.round(sr * 0.5);
  parts.forEach((p, i) => { n += p.length + (i ? Math.round(sr * gaps[i]) : 0); });
  const out = new Float32Array(n); let o = Math.round(sr * 0.3), peak = 1e-6;
  parts.forEach((p, i) => { if (i) o += Math.round(sr * gaps[i]); out.set(p, o); o += p.length; });
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  const g = 0.9 / peak; for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

// ---- UI helpers
const setStatus = (t) => { el.status.textContent = t; };
const setProg = (f) => { el.prog.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; };
let wakeLock = null;
async function keepAwake(on) {
  try { if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); else if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {}
}
let lastBlob = null, lastUrl = null, busy = false;
function busyUI(b) { busy = b; el.go.disabled = b; el.preview.disabled = b; }

async function speak(text) {
  const out = await tts.generate(text, { voice: el.voice.value, speed: +el.speed.value });
  return { audio: out.audio, sr: out.sampling_rate };
}

el.preview.addEventListener("click", async () => {
  if (busy) return; busyUI(true);
  try {
    await loadModel(); setStatus("Making a preview...");
    const { audio, sr } = await speak("What if the Moon disappeared tonight? Here's what would happen.");
    showResult(toWav(join([audio], sr, [0]), sr), "preview");
    setStatus("Preview ready. Press play.");
  } catch (e) { setStatus("Error: " + (e.message || e)); console.error(e); }
  busyUI(false);
});

el.go.addEventListener("click", async () => {
  if (busy) return;
  const paras = paragraphs(el.script.value);
  if (!paras.length) { setStatus("Paste a script first."); return; }
  busyUI(true); await keepAwake(true);
  const t0 = performance.now();
  try {
    await loadModel();
    const jobs = []; paras.forEach((p, pi) => chunks(p).forEach((c) => jobs.push([pi, c])));
    const parts = [], gaps = []; let sr = 24000, lastP = -1;
    for (let k = 0; k < jobs.length; k++) {
      const [pi, text] = jobs[k];
      setStatus(`Speaking paragraph ${pi + 1} of ${paras.length}... (part ${k + 1}/${jobs.length})`); setProg(k / jobs.length);
      const r = await speak(text); sr = r.sr;
      gaps.push(lastP === -1 ? 0 : pi !== lastP ? +el.pause.value : 0.25);
      parts.push(r.audio); lastP = pi;
      await new Promise((res) => setTimeout(res, 0));
    }
    setProg(1);
    const blob = toWav(join(parts, sr, gaps), sr);
    showResult(blob, el.name.value || "narration");
    const mins = ((performance.now() - t0) / 60000).toFixed(1);
    setStatus(`Done: ${paras.length} paragraphs in ${mins} min. Tap Save audio.`);
  } catch (e) { setStatus("Error: " + (e.message || e)); console.error(e); }
  await keepAwake(false); busyUI(false);
});

function showResult(blob, name) {
  lastBlob = blob; if (lastUrl) URL.revokeObjectURL(lastUrl); lastUrl = URL.createObjectURL(blob);
  el.player.src = lastUrl; el.result.classList.remove("hidden");
  el.save.dataset.name = (name || "narration").replace(/[^\w-]+/g, "_") + ".wav";
}

// Inside the Android app: hand the file to Android in ~768 KB pieces (works for long narrations).
async function viaAndroid(share) {
  const A = window.Android, name = el.save.dataset.name, CH = 786432;
  let r = A.begin(name); if (r !== "ok") throw new Error(r);
  for (let i = 0; i < lastBlob.size; i += CH) {
    const b64 = await new Promise((res, rej) => { const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(lastBlob.slice(i, i + CH)); });
    r = A.chunk(b64); if (r !== "ok") throw new Error(r);
    setStatus(`Saving... ${Math.min(100, Math.round(((i + CH) / lastBlob.size) * 100))}%`);
  }
  setStatus(A.finish(share));
}

el.save.addEventListener("click", async () => {
  if (!lastBlob) return;
  if (window.Android) { try { await viaAndroid(false); } catch (e) { setStatus("Error: " + (e.message || e)); } return; }
  const a = document.createElement("a"); a.href = lastUrl; a.download = el.save.dataset.name; document.body.appendChild(a); a.click(); a.remove();
});
el.share.addEventListener("click", async () => {
  if (!lastBlob) return;
  if (window.Android) { try { await viaAndroid(true); } catch (e) { setStatus("Error: " + (e.message || e)); } return; }
  const file = new File([lastBlob], el.save.dataset.name, { type: "audio/wav" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "Curio narration" });
    else setStatus("Sharing isn't supported here. Use Save audio instead.");
  } catch {}
});
