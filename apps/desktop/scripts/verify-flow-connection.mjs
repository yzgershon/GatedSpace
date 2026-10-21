// Electron uses Node. Bun's Windows named-pipe reader drops subsequent replies.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { FlowConnection } from "../src/main/lib/flow-dictation/client.ts";

const path =
	process.platform === "win32"
		? `\\\\.\\pipe\\flow-test-${process.pid}`
		: `/tmp/flow-test-${process.pid}.sock`;
const received = [];
const server = createServer((socket) => {
	let buffer = "";
	socket.on("data", (data) => {
		buffer += data;
		while (buffer.includes("\n")) {
			const newline = buffer.indexOf("\n");
			const command = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			received.push(command);
			if (command === "status") {
				socket.write('{"state":"rea');
				setTimeout(() => socket.write('dy","protocol":1}\n'), 5);
			}
			if (command === "start")
				socket.write('{"error":"Microphone unavailable"}\n');
			if (command === "stop") socket.end();
		}
	});
});
await new Promise((resolve) => server.listen(path, resolve));
const client = await FlowConnection.open(path);
try {
	assert.deepEqual(await client.request("status"), {
		state: "ready",
		protocol: 1,
	});
	await assert.rejects(client.request("start"), /Microphone unavailable/);
	await assert.rejects(client.request("stop"), /disconnected/);
	assert.deepEqual(received, ["status", "start", "stop"]);
	console.log(
		"PASS: Node named-pipe split replies, error propagation, disconnect cleanup; no microphone used.",
	);
} finally {
	client.close();
	server.close();
}
