// Adapted from Flow/GatedVoice 71b7d06, Copyright (c) 2026 Yishai Gershon (MIT).
using NAudio.Wave;

namespace GatedSpace.Flow;

internal sealed class AudioRecorder : IDisposable
{
    private readonly WaveInEvent input = new() { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 30, DeviceNumber = -1 };
    private readonly MemoryStream audio = new();
    private readonly TaskCompletionSource<byte[]> stopped = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object gate = new();
    private bool disposed;

    public AudioRecorder()
    {
        input.DataAvailable += (_, e) => {
            lock (gate) {
                if (!disposed && audio.Length + e.BytesRecorded <= 16000 * 2 * 240)
                    audio.Write(e.Buffer, 0, e.BytesRecorded);
            }
        };
        input.RecordingStopped += (_, e) => {
            lock (gate) {
                if (e.Exception != null) stopped.TrySetException(e.Exception);
                else stopped.TrySetResult(disposed ? [] : audio.ToArray());
            }
        };
    }

    public void Start()
    {
        if (WaveInEvent.DeviceCount == 0) throw new InvalidOperationException("No microphone found. Connect a microphone and try again.");
        input.StartRecording();
    }

    public async Task<byte[]> StopAsync(CancellationToken token)
    {
        input.StopRecording();
        return await stopped.Task.WaitAsync(TimeSpan.FromSeconds(5), token);
    }

    public void Dispose()
    {
        lock (gate) { disposed = true; }
        input.Dispose();
        lock (gate) { audio.Dispose(); }
    }
}
