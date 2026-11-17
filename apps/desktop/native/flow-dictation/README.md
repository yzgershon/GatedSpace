# GatedSpace Flow engine

The built-in Windows microphone helper uses the recording and Whisper pipeline
from [GatedVoice/Flow](https://github.com/yzgershon/GatedVoice) at `71b7d06`
(MIT, copyright Yishai Gershon). It deliberately has no standalone dashboard,
system hotkey, clipboard injection, account, or network client.

`bun run bundle:flow` builds a self-contained .NET 8 helper for `TARGET_ARCH`
(`arm64` or `x64`) and bundles Flow's English base Q5 model. Build machines fetch
the pinned SDK and model with checksum verification. NuGet versions and content
hashes are locked. No SDK, .NET installation, model download, or Flow installation
is needed on the user's computer. Licenses ship beside the helper.

The desktop launches a private process only for a user-initiated recording. The
pipe is restricted to the current Windows user. Closing the owning connection,
closing the parent's stdin, cancelling the composer, or quitting the app ends
the process. Audio remains in memory and is discarded after the capture. The
composer finishes after three minutes; the backend has a four-minute watchdog.

The `--transcribe <16kHz-mono-16bit.wav>` diagnostic mode is for offline fixture
verification; it does not access a microphone. Do not treat fixture transcription
as physical-device or clean-PC verification.
