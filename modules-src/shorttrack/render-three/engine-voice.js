// The engine sound: a cross-plane V8 made of three oscillators whose pitches are all multiples of the engine cycle
// (two crank turns, rpm / 120 Hz). The main saw sits on one bank's firing rate (rpm / 30, an octave under the whole
// engine's rpm / 15), the square under it on the crank (rpm / 60), and a quieter saw between them (rpm / 40) is the
// uneven-firing burble that makes a V8 rumble instead of whine. A soft clipper thickens the mix, a gentle low-pass
// that opens with the throttle keeps the top end from buzzing, and slow noise wobbles all three pitches together a
// few cents so the note is never a steady drone. Works on an AudioContext or an OfflineAudioContext.
export const ENGINE_PITCH=30;
export const ENGINE_IDLE_RPM=1800;
const CURVE=(()=>{const n=1024,c=new Float32Array(n),k=Math.tanh(2.4);for(let i=0;i<n;i++)c[i]=Math.tanh(2.4*(i/(n-1)*2-1))/k;return c;})();

// createEngineVoice(ctx, out, noise): `noise` is a mono white-noise AudioBuffer. Returns
//   set(rpm, throttle 0..1, volume, t, shift): where the engine is at context time t (shift scales the pitch, for Doppler)
//   fade(t): fades the voice out
export function createEngineVoice(ctx,out,noise){
  const f0=ENGINE_IDLE_RPM/ENGINE_PITCH;
  const osc=(type,f)=>{const o=ctx.createOscillator();o.type=type;o.frequency.value=f;o.start();return o;};
  const gain=v=>{const g=ctx.createGain();g.gain.value=v;return g;};
  const main=osc('sawtooth',f0),crank=osc('square',f0/2),burble=osc('sawtooth',f0*0.75);
  const mix=gain(0.5),drive=ctx.createWaveShaper(),tone=ctx.createBiquadFilter(),level=gain(0);
  drive.curve=CURVE;drive.oversample='2x';tone.type='lowpass';tone.frequency.value=500;tone.Q.value=0.9;
  main.connect(mix);crank.connect(gain(0.36)).connect(mix);burble.connect(gain(0.4)).connect(mix);
  mix.connect(drive).connect(tone).connect(level).connect(out);
  const wobble=ctx.createBufferSource(),slow=ctx.createBiquadFilter(),cents=gain(420);
  wobble.buffer=noise;wobble.loop=true;slow.type='lowpass';slow.frequency.value=22;slow.Q.value=0.5;
  wobble.connect(slow).connect(cents);for(const o of [main,crank,burble])cents.connect(o.detune);wobble.start(0,Math.random()*noise.duration);
  return {
    set(rpm,throttle,volume,t,shift=1){
      const f=rpm/ENGINE_PITCH*shift;
      main.frequency.setTargetAtTime(f,t,0.04);crank.frequency.setTargetAtTime(f/2,t,0.04);burble.frequency.setTargetAtTime(f*0.75,t,0.04);
      tone.frequency.setTargetAtTime(380+f*0.9+throttle*(470+f*1.5),t,0.08);level.gain.setTargetAtTime(volume,t,0.08);
    },
    fade(t){level.gain.setTargetAtTime(0,t,0.1);}
  };
}
