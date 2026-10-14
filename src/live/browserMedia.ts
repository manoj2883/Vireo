/**
 * Browser media for a live session: one microphone stream shared by the PCM uplink (to the
 * transcriber) and the pitch/loudness worklet, plus a camera preview. Video never leaves the
 * device and nothing is recorded.
 */
import { AudioRecorder } from '@/utils/audioProcessor';
import { PitchTracker } from '@/audio/pitch/PitchTracker';
import type { MediaHandle, MediaStartArgs } from './LiveSessionEngine';

async function startCamera(video: HTMLVideoElement | undefined): Promise<MediaStream | null> {
  if (!video) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    return stream;
  } catch (err) {
    // A session works without a camera.
    console.warn('[browserMedia] Camera unavailable:', err);
    return null;
  }
}

export async function startBrowserMedia(args: MediaStartArgs): Promise<MediaHandle> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const tracker = new PitchTracker({ onFrame: args.onAudioFrame });
  const pitchAvailable = await tracker.start(mic, args.clockStartMs);

  const recorder = new AudioRecorder(args.onPcmChunk);
  await recorder.start(mic);

  const camera = await startCamera(args.videoElement);

  return {
    pitchAvailable,
    pitchForWord: (startMs, endMs) => tracker.pitchForWord(startMs, endMs),
    micLevel: () => recorder.getAudioLevel(),
    async stop() {
      recorder.stop();
      await tracker.stop();
      mic.getTracks().forEach((t) => t.stop());
      camera?.getTracks().forEach((t) => t.stop());
      if (args.videoElement) args.videoElement.srcObject = null;
    },
  };
}
