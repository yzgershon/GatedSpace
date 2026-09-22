import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	agentBrowserService,
	browserInput,
	browserTools,
} from "./agent-browser-service";

/** Loopback-only, per-process credentials. Nothing is written to a user's global MCP config. */
class AgentBrowserMcp {
	private server?: Server;
	private starting?: Promise<string>;
	private tokens = new Map<string, string>();
	private async url() {
		if (!this.starting)
			this.starting = new Promise<string>((resolve, reject) => {
				const server = createServer((req, res) => {
					const scope = this.tokens.get(
						(req.headers.authorization ?? "").replace(/^Bearer /, ""),
					);
					const address = server.address();
					const host =
						address && typeof address === "object"
							? `127.0.0.1:${address.port}`
							: "";
					if (req.headers.origin || req.headers.host !== host || !scope) {
						res.writeHead(403).end();
						return;
					}
					if (req.url !== "/mcp") {
						res.writeHead(404).end();
						return;
					}
					if (req.method !== "POST") {
						res.writeHead(405).end();
						return;
					}
					let body = "";
					req.setEncoding("utf8");
					req.on("data", (chunk: string) => {
						body += chunk;
						if (body.length > 1_000_000) {
							res.writeHead(413).end();
							req.destroy();
						}
					});
					req.on("end", () => {
						void (async () => {
							let parsed: unknown;
							try {
								parsed = JSON.parse(body);
							} catch {
								res.writeHead(400).end();
								return;
							}
							const mcp = new McpServer(
								{ name: "gatedspace-browser", version: "1.0.0" },
								{ capabilities: { tools: {} } },
							);
							mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
								tools: browserTools.map(([name, description]) => ({
									name,
									description,
									inputSchema: z.toJSONSchema(browserInput) as {
										type: "object";
									},
									annotations: {
										readOnlyHint: [
											"browser_snapshot",
											"browser_screenshot",
											"browser_console",
										].includes(name),
										openWorldHint: true,
									},
								})),
							}));
							mcp.setRequestHandler(CallToolRequestSchema, async (request) =>
								agentBrowserService.run(
									scope,
									request.params.name,
									request.params.arguments ?? {},
								),
							);
							const transport = new StreamableHTTPServerTransport({
								sessionIdGenerator: undefined,
								enableJsonResponse: true,
							});
							res.on("close", () => {
								void transport.close();
								void mcp.close();
							});
							await mcp.connect(transport);
							await transport.handleRequest(req, res, parsed);
						})().catch(() => {
							if (!res.headersSent) res.writeHead(500).end();
							else res.end();
						});
					});
				});
				this.server = server;
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => {
					const address = server.address();
					if (!address || typeof address === "string") {
						reject(new Error("Cannot start browser bridge"));
						return;
					}
					server.unref();
					resolve(`http://127.0.0.1:${address.port}/mcp`);
				});
			}).catch((error) => {
				this.starting = undefined;
				throw error;
			});
		return this.starting;
	}
	async connect(scope: string) {
		const url = await this.url();
		const token = randomBytes(32).toString("hex");
		this.tokens.set(token, scope);
		return {
			url,
			token,
			dispose: () => {
				this.tokens.delete(token);
			},
		};
	}
	dispose() {
		this.tokens.clear();
		this.server?.closeAllConnections();
		this.server?.close();
		this.starting = undefined;
	}
}
export const agentBrowserMcp = new AgentBrowserMcp();
