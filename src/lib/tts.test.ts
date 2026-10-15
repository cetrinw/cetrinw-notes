import { describe, it, expect } from "vitest";
import { englishVoices } from "./tts";

describe("speech helpers", () => {
  it("returns an empty voice list when speech synthesis is unavailable", () => {
    // vitest runs in node: no speechSynthesis, must not throw.
    expect(englishVoices()).toEqual([]);
  });
});
