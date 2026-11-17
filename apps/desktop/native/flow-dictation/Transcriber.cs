// Adapted from Flow/GatedVoice 71b7d06, Copyright (c) 2026 Yishai Gershon (MIT).
using System.Text;
using System.Text.RegularExpressions;
using NAudio.Wave;
using Whisper.net;

namespace GatedSpace.Flow;

internal sealed class Transcriber(string modelPath) : IDisposable
{
    private readonly WhisperFactory factory = WhisperFactory.FromPath(modelPath);

    public async Task<string> TranscribeAsync(byte[] pcm, CancellationToken token)
    {
        if (pcm.Length < 3200) return "";
        // Silence should not become Whisper's common "thank you" hallucination.
        double energy = 0;
        for (int i = 0; i + 1 < pcm.Length; i += 2) { double sample = BitConverter.ToInt16(pcm, i); energy += sample * sample; }
        if (Math.Sqrt(energy / (pcm.Length / 2)) < 50) return "";

        // In-memory WAV: dictation never writes microphone audio or history to disk.
        using var wav = new MemoryStream();
        var writer = new BinaryWriter(wav, Encoding.UTF8, leaveOpen: true);
        writer.Write("RIFF"u8); writer.Write(pcm.Length + 36); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(pcm.Length); writer.Write(pcm); wav.Position = 0;

        var builder = factory.CreateBuilder().WithLanguage("en").WithThreads(Math.Min(3, Environment.ProcessorCount)).WithNoContext();
        double seconds = pcm.Length / 32000d;
        if (seconds <= 16) builder = builder.WithAudioContextSize(seconds <= 8 ? 512 : 1024).WithSingleSegment();
        await using var processor = builder.Build();
        var text = new StringBuilder();
        await foreach (var segment in processor.ProcessAsync(wav, token)) text.Append(segment.Text);
        return Regex.Replace(text.ToString(), @"\[[^\]]*\]|<\|[^|]*\|>", "").Trim();
    }

    public static byte[] ReadTestWave(string path)
    {
        using var reader = new WaveFileReader(path);
        if (reader.WaveFormat.SampleRate != 16000 || reader.WaveFormat.Channels != 1 || reader.WaveFormat.BitsPerSample != 16)
            throw new InvalidOperationException("Test audio must be 16 kHz, 16-bit mono WAV.");
        using var pcm = new MemoryStream(); reader.CopyTo(pcm); return pcm.ToArray();
    }

    public void Dispose() => factory.Dispose();
}
