/**
 * Browser media for a live session: one microphone stream shared by the PCM uplink and the
 * pitch/loudness worklet, the camera at one frame a second, and coach audio playback.
 * Video frames are only sent to the live model; nothing is recorded or stored.
 */
import { AudioRecorder, PCM24Player } from '@/utils/audioProcessor';
import { VideoProcessor } from '@/utils/videoProcessor';
import { PitchTracker } from '@/audio/pitch/PitchTracker';
import type { MediaHandle, MediaStartArgs } from './LiveSessionEngine';

export async function startBrowserMedia(args: MediaStartArgs): Promise<MediaHandle> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const tracker = new PitchTracker({ onFrame: args.onAudioFrame });
  const pitchAvailable = await tracker.start(mic, args.clockStartMs);

  const recorder = new AudioRecorder(args.onPcmChunk);
  await recorder.start(mic);

  let video: VideoProcessor | null = new VideoProcessor((base64) => args.onVideoFrame(base64));
  try {
    await video.start(args.videoElement);
  } catch (err) {
    // A session works without a camera; Vireo just can't see you.
    console.warn('[browserMedia] Camera unavailable:', err);
    video = null;
  }

  const player = new PCM24Player();

  return {
    pitchAvailable,
    pitchForWord: (startMs, endMs) => tracker.pitchForWord(startMs, endMs),
    micLevel: () => recorder.getAudioLevel(),
    playCoachAudio: (pcm) => player.playChunk(pcm),
    async stop() {
      video?.stop();
      recorder.stop();
      player.stop();
      await tracker.stop();
      mic.getTracks().forEach((t) => t.stop());
    },
  };
}
