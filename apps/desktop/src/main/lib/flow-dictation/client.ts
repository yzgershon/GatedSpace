import { connect, type Socket } from "node:net";
import { userInfo } from "node:os";

export const flowPipe = () =>
	`\\\\.\\pipe\\GatedSpace.Flow.${userInfo().username.toLowerCase()}`;

export class FlowConnection {
	private socket: Socket;
	private buffer = "";
	private pending?: {
		resolve: (value: {
			state: string;
			text?: string;
			protocol?: number;
		}) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	};
	private constructor(socket: Socket) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			this.buffer += chunk;
			if (this.buffer.length > 1_000_000) return this.close();
			const newline = this.buffer.indexOf("\n");
			if (newline < 0 || !this.pending) return;
			const pending = this.pending;
			this.pending = undefined;
			clearTimeout(pending.timer);
			try {
				const value = JSON.parse(this.buffer.slice(0, newline));
				this.buffer = this.buffer.slice(newline + 1);
				if (value.error) throw new Error(String(value.error));
				if (
					typeof value.state !== "string" ||
					(value.text !== undefined && typeof value.text !== "string")
				)
					throw new Error("Invalid reply from Flow");
				pending.resolve(value);
			} catch (error) {
				pending.reject(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});
		socket.on("error", () => this.close());
		socket.on("close", () => this.close());
	}
	static open(path = flowPipe()): Promise<FlowConnection> {
		return new Promise((resolve, reject) => {
			const socket = connect(path);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("Flow did not respond"));
			}, 1500);
			const failed = (error: Error) => {
				clearTimeout(timer);
				socket.destroy();
				reject(error);
			};
			socket.once("error", failed);
			socket.once("connect", () => {
				clearTimeout(timer);
				socket.removeListener("error", failed);
				resolve(new FlowConnection(socket));
			});
		});
	}
	request(command: "status" | "start" | "stop" | "cancel", timeout = 10_000) {
		return new Promise<{ state: string; text?: string; protocol?: number }>(
			(resolve, reject) => {
				if (this.pending || this.socket.destroyed)
					return reject(new Error("Flow connection is unavailable"));
				const timer = setTimeout(() => this.close(), timeout);
				this.pending = { resolve, reject, timer };
				this.socket.write(`${command}\n`);
			},
		);
	}
	close() {
		const pending = this.pending;
		this.pending = undefined;
		if (pending) {
			clearTimeout(pending.timer);
			pending.reject(
				new Error("Flow disconnected or timed out. Your draft is unchanged."),
			);
		}
		if (!this.socket.destroyed) this.socket.destroy();
	}
}
