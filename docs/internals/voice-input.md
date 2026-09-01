# Voice input

> For maintainers. Using T3 Code? See [voice input on iPhone](../user/composer.md#voice-input-on-iphone).

Voice input produces editable composer text. Mobile records on the client and transcribes locally
with Apple's `SpeechAnalyzer` and `SpeechTranscriber` on supported iOS 26+ devices. Packaged desktop
builds record with `MediaRecorder` and transcribe through their bundled Whisper.cpp service. A
server started with staged Whisper resources exposes an authenticated transcription route to its web
clients. A standalone web build can otherwise send its temporary recording to a build-configured,
OpenAI-compatible transcription endpoint.

## Current boundaries

The shared [`VoiceInputController`][controller] in `packages/client-runtime` owns preparation,
recording, transcription, cancellation, temporary-file cleanup, and insertion into the captured
draft selection. Applications import it through the [voice-input entry point][voice-input] as
`@t3tools/client-runtime/voice-input`. Its dependencies separate capture from transcription; the
controller imports neither React Native nor an Apple transcription API.

The shared [transcription contract][transcription] defines `VoiceTranscriber`,
`PreparedVoiceTranscription`, and transcription errors. The controller calls `getTranscriber()` once
at the start of an operation, before asking for microphone permission. Preparation returns a resolved
locale and a bound `transcribe` function. The controller retains that result for the recording, so a
selection change cannot prepare with one implementation and transcribe with another.

[`useVoiceInputController`][hook] supplies Expo audio capture, microphone permissions, audio-session
management, waveform samples, and app and navigation lifecycle handling. It normalizes Expo's
`mediaServicesDidReset` into a generic recorder error. [`voiceTranscription.ios.ts`][ios] adapts
`@react-native-ai/apple` through `getLocalVoiceTranscriber()`, capturing the requested device locale
and binding the prepared transcriber to Apple's resolved locale. The other-platform binding returns
no local transcriber. That result describes the local implementation, not whether a client could use
an environment's transcription service. Web's [`useBrowserVoiceInput`][web-hook] supplies the same
controller with browser microphone capture and the [`Speaches` adapter][web-transcriber]. Browsers
choose Opus WebM, MP4, or Opus Ogg in that order according to `MediaRecorder` support. In Electron,
the preload bridge starts the bundled Whisper.cpp server on demand, refreshes its idle deadline for
each transcription, and returns a randomized loopback-only request URL. The renderer decodes the
browser recording and converts it to mono 16 kHz PCM WAV before upload. The desktop process stops the
server after 15 minutes without use and when the application exits.

The server uses the same process boundary when `T3CODE_WHISPER_RESOURCE_DIR` names a directory with
the host's `whisper-server` executable and `ggml-base.bin`. It advertises the optional
`voiceTranscription` environment capability only after both files are present. Web clients prefer
the desktop bridge when available, then the connected environment's authenticated
`/api/voice/transcriptions` route, then the credential-free build endpoint. The environment route
accepts one recording up to 16 MB, launches a randomized loopback-only Whisper endpoint on demand,
and stops it after 15 idle minutes or server shutdown. Bearer, cookie, and managed-relay DPoP
connections use the same authorization preparation as other environment requests.

The [desktop artifact builder][desktop-whisper-build] reads the pinned
[Whisper manifest][whisper-manifest], verifies the source, model, and license checksums, and compiles
a static Whisper.cpp server for the artifact's platform and architecture. The model and executable
ship once as external Electron resources rather than being duplicated in `app.asar`. Release jobs
cache those verified build inputs and outputs by platform, architecture, and manifest hash. macOS
artifacts also declare their microphone purpose in the packaged `Info.plist`; building only the
desktop JavaScript bundles neither stages Whisper nor replaces an already installed application.
Source production launchers can run `vp run stage:server-whisper`, which stages the same verified
host executable, model, and licenses under `.t3/runtime/whisper` without duplicating the model in the
web or server JavaScript bundles.

Mobile's [`voiceInputPresentation.ts`][presentation] maps shared state to toolbar labels and actions.
Waveform and toolbar rendering stay in mobile. The composer edits draft text without selecting a
speech vendor.
Recording captures the draft owner, revision, text, and selection. A late transcript cannot overwrite
a different or edited draft. Only normal message submission sends the resulting text to an agent.

Each operation passes one `AbortSignal` through preparation and transcription. Cancellation
invalidates the operation and aborts that signal immediately. Implementations settle their promises
only after their underlying work stops. The Apple binding checks cancellation between asynchronous
steps but cannot interrupt an in-flight native request. The controller retains its session until
that work settles, ignores its result, and cleans up the recording.

## Ownership decisions

The extension boundary distinguishes transcription on the client device from transcription through
the composer's environment. A standalone web build may also opt into one credential-free endpoint
through `T3CODE_WHISPER_TRANSCRIPTION_URL`; the build system projects it to
`VITE_WHISPER_TRANSCRIPTION_URL` and `EXPO_PUBLIC_WHISPER_TRANSCRIPTION_URL`. Because that URL is
visible in the client bundle, it must never contain credentials. These constraints apply when adding
selectable transcription services:

- Local means the client device, regardless of which machine hosts the environment. A device's lack
  of local recognition does not prevent it from recording audio for an environment service.
- Remote service configuration and API keys belong to the environment. The environment calls the
  external service. Clients receive service identifiers, labels, and availability information, never
  credential values. A credential-free web endpoint is the narrow exception above: the browser calls
  it directly, and its server must enforce its own network boundary and CORS policy. Transcription
  services are independent of coding-agent `providerInstances`; selecting OpenAI for transcription
  does not select Codex for the thread.
- The client owns its transcription preference, scoped by stable `environmentId`. Its choices are
  supported local recognition and the services exposed by the composer's environment. A service ID
  is meaningful only within that environment. Different clients can make different choices.
- Resolve and capture the environment, selected service, and locale when an operation starts.
  Preparation and transcription use the same selection; preference changes affect the next
  recording. Capture environment identity explicitly rather than recovering it from a draft key.
  Keep the existing draft-owner and revision checks before inserting text.
- If the selected option is unavailable, report that state and let the user choose another option.
  A local failure must not silently upload audio, and a disconnected environment must not redirect
  a recording to another environment or service.
- Transcription audio is temporary input, separate from durable chat attachments and messages.
  Remote adapters need cancellation of upload and transcription where supported, cleanup after
  success, failure, or cancellation, and the same protection against late results as local transcription.

## Existing integration points

[`ServerSettingsService`][settings] and [`ServerSecretStore`][secrets] provide environment-owned
configuration and secret persistence. Existing settings redaction handles coding-provider environment
variables only. Any transcription credential fields need their own explicit separation and redaction
before settings responses or subscriptions reach client caches.

[`ExecutionEnvironmentCapabilities`][capabilities] handles version skew. Remote transcription must be
opt-in: a missing transcription capability means unsupported. The authenticated server-config
subscription and [shared environment state][server-state] already distribute configuration per
environment. A transcription service catalog belongs behind that capability and authenticated
boundary. Older servers expose no remote transcription choices.

The [attachment upload contracts][uploads] and [shared upload operations][attachment-state] provide a
pattern for authorized binary uploads through an environment, including remote connections. Their
existing chat-attachment retention is not a transcription cleanup policy.

Future service selection and environment requests belong alongside the controller in
`packages/client-runtime`, with wire contracts in `packages/contracts`. Capture and native local
recognition remain client-specific. An environment-backed transcriber implements the same shared
contract, with its environment and service bound when selected. The controller does not own service
credentials, provider SDKs, or transport selection.

[controller]: ../../packages/client-runtime/src/voice-input/controller.ts
[voice-input]: ../../packages/client-runtime/src/voice-input/index.ts
[transcription]: ../../packages/client-runtime/src/voice-input/transcription.ts
[hook]: ../../apps/mobile/src/features/voice-input/useVoiceInputController.ts
[presentation]: ../../apps/mobile/src/features/voice-input/voiceInputPresentation.ts
[ios]: ../../apps/mobile/src/native/voiceTranscription.ios.ts
[web-hook]: ../../apps/web/src/voice-input/useBrowserVoiceInput.ts
[web-transcriber]: ../../apps/web/src/voice-input/speachesTranscriber.ts
[desktop-whisper-build]: ../../scripts/lib/desktop-whisper.ts
[whisper-manifest]: ../../native/whisper/manifest.json
[settings]: ../../apps/server/src/serverSettings.ts
[secrets]: ../../apps/server/src/auth/ServerSecretStore.ts
[capabilities]: ../../packages/contracts/src/environment.ts
[server-state]: ../../packages/client-runtime/src/state/server.ts
[uploads]: ../../packages/contracts/src/assets.ts
[attachment-state]: ../../packages/client-runtime/src/state/attachments.ts
