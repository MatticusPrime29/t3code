import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopWhisperServer from "../../voice/DesktopWhisperServer.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const prepareBundledVoiceTranscription = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PREPARE_BUNDLED_VOICE_TRANSCRIPTION_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.voiceTranscription.prepare")(function* () {
    const whisper = yield* DesktopWhisperServer.DesktopWhisperServer;
    return Option.getOrNull(yield* whisper.prepare);
  }),
});
