import { throwIfVoiceTranscriptionAborted } from "@t3tools/client-runtime/voice-input";

const WHISPER_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      WAV_HEADER_BYTES + index * 2,
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
      true,
    );
  }
  return bytes;
}

/** Decode Chromium's recorder format and let Web Audio downmix/resample it for whisper.cpp. */
export async function convertBrowserRecordingToWhisperWav(
  recording: Blob,
  signal: AbortSignal,
): Promise<Blob> {
  throwIfVoiceTranscriptionAborted(signal);
  const decodingContext = new AudioContext();
  try {
    const decoded = await decodingContext.decodeAudioData(await recording.arrayBuffer());
    throwIfVoiceTranscriptionAborted(signal);
    const frameCount = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
    const renderingContext = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
    const source = renderingContext.createBufferSource();
    source.buffer = decoded;
    source.connect(renderingContext.destination);
    source.start();
    const rendered = await renderingContext.startRendering();
    throwIfVoiceTranscriptionAborted(signal);
    const wav = encodeMonoPcm16Wav(rendered.getChannelData(0), WHISPER_SAMPLE_RATE);
    return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
  } finally {
    await decodingContext.close().catch(() => undefined);
  }
}
