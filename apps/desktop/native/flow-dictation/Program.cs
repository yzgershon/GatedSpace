using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using GatedSpace.Flow;

// This helper has no UI, hotkeys, clipboard access, account, or network client.
// A fresh process/pipe belongs to one composer capture. Nothing runs when idle.
try
{
    // Whisper's native loader searches its own runtime folder and System32.
    // Preload our app-local CRT first so a clean PC needs no VC++ installation.
    foreach (string library in new[] { "vcruntime140.dll", "msvcp140.dll", "vcomp140.dll" })
        NativeLibrary.Load(Path.Combine(AppContext.BaseDirectory, library), Assembly.GetExecutingAssembly(),
            DllImportSearchPath.UseDllDirectoryForDependencies | DllImportSearchPath.System32);
    string model = Path.Combine(AppContext.BaseDirectory, "ggml-base.en-q5_1.bin");
    using var lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(5));
    if (args.Length == 2 && args[0] == "--transcribe")
    {
        using var transcriber = new Transcriber(model);
        Console.WriteLine(JsonSerializer.Serialize(new { text = await transcriber.TranscribeAsync(Transcriber.ReadTestWave(args[1]), lifetime.Token) }));
        return 0;
    }
    if (args.Length != 2 || args[0] != "--pipe" || !args[1].StartsWith("GatedSpace.Flow.")) return 2;
    // Parent crash/exit closes stdin. Exit also releases a microphone during native inference.
    _ = Task.Run(async () => { await Console.In.ReadToEndAsync(); Environment.Exit(0); });
    using var pipe = new NamedPipeServerStream(args[1], PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
    await pipe.WaitForConnectionAsync(lifetime.Token);
    using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 1024, leaveOpen: true);
    using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
    using var engine = new Transcriber(model);
    AudioRecorder? recorder = null;
    try
    {
        while (pipe.IsConnected && !lifetime.IsCancellationRequested)
        {
            string? command = await reader.ReadLineAsync(lifetime.Token);
            if (command == null || command.Length > 128) break;
            object reply;
            try
            {
                switch (command)
                {
                    case "status": reply = new { state = recorder == null ? "ready" : "recording", protocol = 1 }; break;
                    case "start":
                        if (recorder != null) throw new InvalidOperationException("Dictation is already recording.");
                        recorder = new AudioRecorder(); recorder.Start(); reply = new { state = "recording" }; break;
                    case "stop":
                        if (recorder == null) throw new InvalidOperationException("No active microphone recording.");
                        byte[] pcm = await recorder.StopAsync(lifetime.Token);
                        recorder.Dispose(); recorder = null;
                        reply = new { state = "ready", text = await engine.TranscribeAsync(pcm, lifetime.Token) }; break;
                    case "cancel": recorder?.Dispose(); recorder = null; reply = new { state = "ready" }; break;
                    default: throw new InvalidOperationException("Unknown dictation command.");
                }
            }
            catch (Exception error) { recorder?.Dispose(); recorder = null; reply = new { state = "error", error = error.Message }; }
            await writer.WriteLineAsync(JsonSerializer.Serialize(reply));
        }
    }
    finally { recorder?.Dispose(); }
    return 0;
}
catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
