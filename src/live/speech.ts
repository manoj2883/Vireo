/** Speak a short nudge with the browser's own voice, in English. Silent where unsupported. */
export function speakWithBrowser(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  const voice = synth.getVoices().find((v) => v.lang.startsWith('en'));
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  synth.cancel();
  synth.speak(utterance);
}
