// Plays a short two-note chime (no audio file needed), then closes this offscreen document.
const ctx = new AudioContext();
[[880, 0], [1320, 0.18]].forEach(([freq, at]) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + at;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.5);
});
setTimeout(() => window.close(), 1200);
