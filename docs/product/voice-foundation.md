# Recorded voice foundation

The existing voice-message implementation now separates provider execution, operation lifecycle and message delivery. This is preparation for a voice assistant and live calling; it does not add a telephone connection, WebRTC session or streaming speech implementation.

## Boundaries

- `src/lib/voice/core.ts`: provider-independent contracts, required tenant context, input/output limits, cancellation, deadlines and typed outcomes. `createVoiceService` accepts transcriber, synthesizer and storage dependencies; adapters can be implemented for local inference without importing cloud SDKs into this core.
- `src/lib/voice/providers.ts`: existing Gemini transcription and OpenAI transcription/synthesis adapters, resolved separately for each tenant and stage. Gemini transcription does not depend on the dedicated OpenAI speech key. No platform AI key is substituted, no credentials are cached globally and an API failure does not silently switch providers.
- `src/lib/voice.ts`: compatibility facade. Existing messaging callers receive text/URL or null, preserving their fallback behaviour. Detailed results are available for callers that need to distinguish errors. The facade stores generated speech through the existing upload path.
- `src/lib/voice/delivery.ts`: delivery selection. Answers containing HTTP(S) links stay in text; an explicit audio rejection allows text fallback. Unknown delivery does not trigger an immediate second send.
- `src/lib/ssrf.ts`: shared safe URL fetch and bounded binary response reader. Remote media checks DNS and redirects, refuses private targets, limits bytes during the download and cancels the stream when a cap or cancellation is reached.

## Existing provider behaviour

Transcription continues to use `gemini-2.5-flash` for tenants configured with Gemini and `whisper-1` for OpenAI tenants. Other tenants can use their explicitly configured dedicated OpenAI voice key. Synthesis continues to use `tts-1` with the `alloy` voice. There is no automatic model migration or new paid service.

SDK retries are disabled for these interactive speech operations. Every speech operation has a 30-second maximum deadline including provider resolution and storage; an internal caller can request a shorter deadline and pass an AbortSignal. Cooperative adapters receive that signal. The service returns even if an adapter ignores cancellation, but cancellation cannot undo work already accepted by a provider or an upload already started. The current storage SDK upload path is not itself abortable through this facade.

Recorded audio is limited to 16 MiB before inference, consistent with the existing audio-upload ceiling. Generic remote media remains limited to 25 MiB because the same download function serves images and video. Remote downloads use a 15-second fetch/body deadline; hostname resolution still depends on the host resolver. These are byte limits, not decoded-duration or codec-validation guarantees.

Known audio MIME types are normalised. When a CDN provides an octet-stream, common Ogg/WAV/FLAC/ID3-MP3/M4A signatures can recover a type. Unrecognised generic bytes are refused rather than labelled Ogg. This is container identification, not a full media decoder or antivirus scan. Codec conversion is not added by this change.

Speech input longer than 4,000 characters returns `too_large`; it is never silently sliced. The message pipeline sends the full text answer instead. Gemini transcription uses a larger output allowance and refuses an explicit `MAX_TOKENS` finish rather than using an incomplete transcript as customer intent. Transcription instructions describe audio as untrusted customer content and request verbatim transcription in the original language. A prompt is not a guarantee against model errors; transcripts remain customer input for the downstream reply safeguards.

## Outcomes and diagnostics

Detailed operations return `{ ok: true, value, provider, elapsedMs }` or `{ ok: false, code, provider?, elapsedMs }`. Failure codes distinguish invalid or oversized input, unsupported format, unavailable configuration, empty audio/transcript, incomplete transcript, cancellation, timeout, rate limiting, rejected credentials, provider failure and storage failure.

The `voice_operation` log contains stage, tenant ID, provider, outcome, safe error code and elapsed milliseconds. It excludes audio, transcript, URLs, keys and raw provider error bodies. There is no database migration or persistent voice analytics dashboard in this change.

WhatsApp media downloads reject redirects while carrying a channel bearer token. Media sends have a 15-second timeout and flag unknown delivery for network failures, server errors and success responses without a message ID. The voice delivery helper does not immediately resend those as text. This does not create exactly-once delivery across the broader message queue or change its retry policy.

## Settings

The admin API retains the `off`, `mirror` and `always` modes. It validates the complete request before writing, rejects malformed types, keeps the mode on key-only updates and keeps a stored key when the submitted key is blank. DELETE explicitly removes the dedicated voice key. Only admins in the current workspace can operate the endpoint; raw keys and storage errors are not returned.

The settings card distinguishes configured transcription and speech availability, reports load/save/removal failures and prevents edits until settings load. Availability means a configured credential path exists; it is not a paid connectivity test or proof that the provider account has quota. The card accurately describes incoming notes on WhatsApp, Instagram and Messenger and outgoing AI voice replies on WhatsApp.

## Storage and future calling

Generated speech and inbound attachments still use the existing public media bucket. Random filenames reduce accidental collisions; they do not make public URLs private or enforce tenant authorisation. Do not reuse this storage path for private telephone recordings. A calling implementation needs an explicitly private recording store, authorised playback, appropriate retention and a controlled delivery mechanism for any external channel that must fetch media.

The next calling layer should introduce a genuine streaming contract with partial/final transcripts, codec/sample-rate metadata, playback acknowledgements, interruption events and tool-action lifecycle events. It should bind tenant identity from trusted channel/session configuration and pass cancellation through each turn. A cancelled response must not be treated as fully heard, and an interrupted tool action must not be repeated without checking its outcome.

A local speech adapter can replace the cloud transcriber/synthesizer dependencies. That adapter, model serving, a telecom carrier connection and a human call-transfer implementation are still separate work. Current voice-note settings continue to depend on the tenant's configured cloud speech credentials.

## Verification

Tests exercise local adapter injection, concurrent tenant isolation, missing tenant rejection, malformed/oversized audio, generic container identification, empty and truncated transcripts, provider failures, cancellation and deadlines, late-output suppression, storage failures, link preservation, delivery ambiguity, admin authorisation and secret-safe settings errors. Media tests cover private destinations, redirect credential handling, bounded binary streams and cancellation.

External speech and storage calls are mocked in automated tests; no live customer messages or paid speech requests are used for verification. Build/test results are recorded in the task handoff.

November 5, 2026 verification: the production build, including Next.js type validation, and all 3,219 tests across 265 files passed in an isolated checkout containing only this voice change over the current committed project. TypeScript also passed in the working checkout. Browser interaction and acoustic/provider quality were not tested against live services.

References checked during implementation: [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [OpenAI text to speech](https://developers.openai.com/api/docs/guides/text-to-speech), and [Supabase bucket access models](https://supabase.com/docs/guides/storage/buckets/fundamentals). SDK request options were also checked against the installed versions.
