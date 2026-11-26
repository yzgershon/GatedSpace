import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Preserve pixels/coordinate geometry; keep PNG unless high-quality JPEG is
 * substantially smaller. The caller can always request original lossless data. */
export function prepareComputerImages(
	result: CallToolResult,
	encode: (png: Buffer) => Buffer,
	original = false,
): CallToolResult {
	if (original) return result;
	return {
		...result,
		content: result.content.map((block) => {
			if (
				block.type !== "image" ||
				block.mimeType !== "image/png" ||
				block.data.length < 128_000
			)
				return block;
			try {
				// Flat UI/text already compresses well as PNG. Reading only IHDR
				// avoids a full decode/encode on that common path (and preserves text).
				const header = Buffer.from(block.data.slice(0, 44), "base64");
				if (
					header.length < 24 ||
					header.readUInt32BE(0) !== 0x89504e47 ||
					header.readUInt32BE(4) !== 0x0d0a1a0a ||
					header.toString("ascii", 12, 16) !== "IHDR"
				)
					return block;
				const pixels = header.readUInt32BE(16) * header.readUInt32BE(20);
				if (!pixels || block.data.length * 0.75 < pixels * 0.3) return block;
				const png = Buffer.from(block.data, "base64");
				const jpeg = encode(png);
				if (!jpeg.length || jpeg.length > png.length * 0.8) return block;
				return {
					...block,
					data: jpeg.toString("base64"),
					mimeType: "image/jpeg",
				};
			} catch {
				return block;
			}
		}),
	};
}
