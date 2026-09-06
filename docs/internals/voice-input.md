# Voice input

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. Mobile transcribes locally on supported iOS devices. Desktop uses bundled Whisper.cpp;
web clients use their environment’s authenticated transcription route when available,
or a credential-free build-configured endpoint.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.

Desktop and server Whisper processes bind randomized loopback endpoints and stop after
15 idle minutes or shutdown. Environment transcription is advertised only when staged
resources exist; older servers without the capability remain unsupported. Web clients
prefer the desktop bridge, then the connected environment, then the build endpoint.
Recordings are temporary input, separate from durable chat attachments.

Whisper’s model and executable ship as external desktop resources, outside `app.asar`.
The [artifact builder](../../scripts/lib/desktop-whisper.ts) verifies pinned checksums
before staging them. Source server deployments use `vp run stage:server-whisper` to stage
host resources under `.t3/runtime/whisper`; `T3CODE_WHISPER_RESOURCE_DIR` selects them.
Building JavaScript alone does not supply these resources.

`T3CODE_WHISPER_TRANSCRIPTION_URL` is visible in client bundles and must not contain
credentials. Environment requests use the existing bearer, cookie, or managed-relay DPoP
authorization boundary. Selecting a transcription backend does not select an agent provider.
