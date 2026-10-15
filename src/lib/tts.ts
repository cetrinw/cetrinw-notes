import { useCallback, useEffect, useRef, useState } from "react";

/** English system voices for read-along; empty when the platform has none. */
export function englishVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
}

/**
 * Sentence-by-sentence read-along on top of the system speech synthesis
 * (offline on macOS). `index` is the sentence being spoken; `pause` keeps it
 * so the UI can resume from the same sentence, `stop` clears it.
 */
export function useSpeechQueue(texts: string[]) {
  const [index, setIndex] = useState(-1);
  const [reading, setReading] = useState(false);
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const rateRef = useRef(1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const loopRef = useRef(false);
  const speakRef = useRef<(i: number, oneShot: boolean) => void>(() => {});

  const cancel = useCallback(() => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    (i: number, oneShot: boolean) => {
      const list = textsRef.current;
      if (typeof speechSynthesis === "undefined" || i < 0 || i >= list.length) {
        setReading(false);
        setIndex(-1);
        return;
      }
      cancel();
      setIndex(i);
      setReading(!oneShot);
      const utterance = new SpeechSynthesisUtterance(list[i]);
      utterance.lang = voiceRef.current?.lang || "en-US";
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = rateRef.current;
      utterance.onend = () => {
        if (oneShot) {
          setIndex(-1);
          return;
        }
        if (loopRef.current) speakRef.current(i, false);
        else speakRef.current(i + 1, false);
      };
      utterance.onerror = () => {
        setReading(false);
        setIndex(-1);
      };
      speechSynthesis.speak(utterance);
    },
    [cancel],
  );
  speakRef.current = speak;

  const start = useCallback(
    (from = 0) => {
      speak(from, false);
    },
    [speak],
  );
  const pause = useCallback(() => {
    cancel();
    setReading(false);
  }, [cancel]);
  const stop = useCallback(() => {
    cancel();
    setReading(false);
    setIndex(-1);
  }, [cancel]);
  const speakOnly = useCallback(
    (i: number) => {
      speak(i, true);
    },
    [speak],
  );

  useEffect(() => {
    return () => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, []);

  return {
    index,
    reading,
    start,
    pause,
    stop,
    speakOnly,
    setRate: (rate: number) => {
      rateRef.current = rate;
    },
    setVoice: (voice: SpeechSynthesisVoice | null) => {
      voiceRef.current = voice;
    },
    setLoop: (loop: boolean) => {
      loopRef.current = loop;
    },
  };
}
