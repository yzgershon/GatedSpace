// The socket is not a boundary on Windows (named pipes admit every process in
// the user's session), so the token check in the handshake is what stands
// between a random local process and spawning shells. These tests drive a real
// Server over a real socket to prove the gate actually closes.

import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	type ClientMessage,
	encodeFrame,
	FrameDecoder,
	type ServerMessage,
} from "../protocol/index.ts";
import { Server } from "./Server.ts";

const TOKEN = "a".repeat(64);

let active: Server | null = null;

afterEach(async () => {
	await active?.close();
	active = null;
});

function socketPathFor(name: string): string {
	return process.platform === "win32"
		? `\\\\.\\pipe\\ptyd-authtest-${process.pid}-${name}`
		: path.join(os.tmpdir(), `ptyd-authtest-${process.pid}-${name}.sock`);
}

async function startServer(name: string, authToken?: string): Promise<string> {
	const socketPath = socketPathFor(name);
	const server = new Server({
		socketPath,
		daemonVersion: "0.0.0-test",
		authToken,
		// No scrollbackDir: keep the test off the real log directory.
	});
	await server.listen();
	active = server;
	return socketPath;
}

/** Sends one hello and resolves with the daemon's first reply. */
function helloReply(
	socketPath: string,
	hello: ClientMessage,
): Promise<ServerMessage> {
	return new Promise((resolve, reject) => {
		const decoder = new FrameDecoder();
		const sock = net.createConnection({ path: socketPath });
		const timer = setTimeout(() => {
			sock.destroy();
			reject(new Error("no reply within 5s"));
		}, 5_000);
		const finish = (msg: ServerMessage) => {
			clearTimeout(timer);
			sock.destroy();
			resolve(msg);
		};
		sock.on("connect", () => sock.write(encodeFrame(hello)));
		sock.on("data", (chunk) => {
			decoder.push(chunk);
			for (const frame of decoder.drain()) {
				finish(frame.message as ServerMessage);
				return;
			}
		});
		sock.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

describe("handshake auth", () => {
	test("rejects a hello with no token", async () => {
		const socketPath = await startServer("no-token", TOKEN);
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [2],
		});
		expect(reply.type).toBe("error");
		expect(reply).toMatchObject({ code: "EAUTH" });
	});

	test("rejects a hello with the wrong token", async () => {
		const socketPath = await startServer("wrong-token", TOKEN);
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [2],
			token: "b".repeat(64),
		});
		expect(reply.type).toBe("error");
		expect(reply).toMatchObject({ code: "EAUTH" });
	});

	test("rejects a token that is a prefix of the real one", async () => {
		const socketPath = await startServer("prefix-token", TOKEN);
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [2],
			token: TOKEN.slice(0, 32),
		});
		expect(reply.type).toBe("error");
		expect(reply).toMatchObject({ code: "EAUTH" });
	});

	test("accepts the correct token", async () => {
		const socketPath = await startServer("good-token", TOKEN);
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [2],
			token: TOKEN,
		});
		expect(reply.type).toBe("hello-ack");
	});

	test("a version mismatch is reported as EVERSION, not EAUTH", async () => {
		// Ordering check: negotiating first keeps the upgrade path debuggable
		// instead of reporting every skewed client as an auth failure.
		const socketPath = await startServer("bad-version", TOKEN);
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [99],
			token: TOKEN,
		});
		expect(reply).toMatchObject({ code: "EVERSION" });
	});

	test("no configured token leaves the socket open (test/in-process mode)", async () => {
		const socketPath = await startServer("unauthed");
		const reply = await helloReply(socketPath, {
			type: "hello",
			protocols: [2],
		});
		expect(reply.type).toBe("hello-ack");
	});
});
