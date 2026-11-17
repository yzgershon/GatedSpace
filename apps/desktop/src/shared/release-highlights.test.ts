import { expect, test } from "bun:test";
import { releaseHighlightsFor } from "./release-highlights";

test("only shipped notes appear and an acknowledged update stays dismissed", () => {
	expect(releaseHighlightsFor("1.18.56")).toEqual([]);
	expect(releaseHighlightsFor("1.18.57", "1.18.56")).toHaveLength(1);
	expect(releaseHighlightsFor("1.18.57", "1.18.57")).toEqual([]);
	expect(releaseHighlightsFor("1.18.57", "1.18.58")).toEqual([]);
	expect(releaseHighlightsFor("1.18.58", "1.18.56")).toHaveLength(2);
	expect(releaseHighlightsFor("1.18.58", "1.18.57")).toHaveLength(1);
	expect(releaseHighlightsFor("1.18.58", "1.18.58")).toEqual([]);
	expect(releaseHighlightsFor("1.18.58")[0]?.version).toBe("1.18.58");
	expect(releaseHighlightsFor("dev")).toEqual([]);
	expect(releaseHighlightsFor("1.18.57", "broken")).toHaveLength(1);
});
