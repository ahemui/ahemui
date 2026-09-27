// Dictation for the prompt box, using the browser's built-in speech recognition (Chromium: webkitSpeechRecognition).

export function voiceSupported(): boolean {
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

/** Starts listening; `onText` gets the full transcript so far. Returns a stop function. */
export function dictate(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = document.documentElement.lang || navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = "";
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText((finalText + interim).trim(), !interim);
  };
  rec.onerror = (e: any) => onEnd(e.error === "not-allowed" ? "Microphone access was blocked" : e.error);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}
