import { describe, expect, it } from "vite-plus/test";

import { encodeMonoPcm16Wav } from "./browserRecordingWav";

describe("encodeMonoPcm16Wav", () => {
  it("writes a mono 16-bit PCM WAV and clamps samples", () => {
    const bytes = encodeMonoPcm16Wav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 16_000);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10);
    expect([
      view.getInt16(44, true),
      view.getInt16(46, true),
      view.getInt16(48, true),
      view.getInt16(50, true),
      view.getInt16(52, true),
    ]).toEqual([-32_768, -16_384, 0, 16_384, 32_767]);
  });
});
