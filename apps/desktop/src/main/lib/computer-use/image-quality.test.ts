import { expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { prepareComputerImages } from "./image-quality";

const png = Buffer.alloc(100_000);
png.writeUInt32BE(0x89504e47, 0);
png.writeUInt32BE(0x0d0a1a0a, 4);
png.write("IHDR", 12);
png.writeUInt32BE(400, 16);
png.writeUInt32BE(400, 20);
const image = {
	type: "image" as const,
	data: png.toString("base64"),
	mimeType: "image/png",
};
const result: CallToolResult = {
	content: [
		{ type: "text", text: "Coordinates stay in the original desktop space" },
		image,
	],
};
test("only a substantial saving replaces a PNG, with all metadata intact", () => {
	const encoded = prepareComputerImages(result, () => Buffer.alloc(60_000));
	expect(encoded.content[0]).toEqual(result.content[0]);
	expect(encoded.content[1]).toMatchObject({ mimeType: "image/jpeg" });
	expect(
		prepareComputerImages(result, () => Buffer.alloc(85_000)).content[1],
	).toBe(image);
});
test("already compact UI screenshots bypass the expensive encoder", () => {
	const compact = Buffer.from(png);
	compact.writeUInt32BE(2880, 16);
	compact.writeUInt32BE(1704, 20);
	const block = { ...image, data: compact.toString("base64") };
	let calls = 0;
	expect(
		prepareComputerImages({ content: [block] }, () => {
			calls++;
			return Buffer.alloc(1);
		}).content[0],
	).toBe(block);
	expect(calls).toBe(0);
});
test("original mode, small images and failed conversion stay lossless", () => {
	const fail = () => {
		throw new Error("codec");
	};
	expect(prepareComputerImages(result, fail, true)).toBe(result);
	expect(prepareComputerImages(result, fail).content[1]).toBe(image);
	const small = { ...image, data: "small" };
	expect(prepareComputerImages({ content: [small] }, fail).content[0]).toBe(
		small,
	);
});
