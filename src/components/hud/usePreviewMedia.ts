import { useEffect, useRef, useState } from 'react';

export type PreviewState =
  | { status: 'starting' }
  | { status: 'ready'; dark: boolean }
  | { status: 'error'; message: string };

const BARS = 18;

/**
 * Camera and microphone preview for the warm-up: a live mic meter and a lighting check.
 * Everything stays in the browser and stops when the component unmounts.
 */
export function usePreviewMedia(videoRef: React.RefObject<HTMLVideoElement>) {
  const [state, setState] = useState<PreviewState>({ status: 'starting' });
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lightTimer: ReturnType<typeof setInterval> | null = null;
    let ctx: AudioContext | null = null;

    async function run() {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (!cancelled)
          setState({
            status: 'error',
            message:
              name === 'NotAllowedError'
                ? 'Camera and microphone are blocked. Allow them in your browser’s site settings.'
                : 'No camera or microphone found. Check they’re connected and not in use by another app.',
          });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        if (t - last > 120) {
          last = t;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 8);
          setLevels((prev) => [...prev.slice(1), level]);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 24;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const checkLight = () => {
        const v = videoRef.current;
        if (!g || !v || v.readyState < 2) return setState({ status: 'ready', dark: false });
        g.drawImage(v, 0, 0, canvas.width, canvas.height);
        const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let lum = 0;
        for (let i = 0; i < px.length; i += 4) lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        setState({ status: 'ready', dark: lum / (px.length / 4) < 60 });
      };
      checkLight();
      lightTimer = setInterval(checkLight, 1500);
    }

    void run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (lightTimer) clearInterval(lightTimer);
      void ctx?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [videoRef]);

  return { state, levels };
}
