/**
 * Joining what a speech recogniser says now to what it already said.
 *
 * Every previous attempt at the dictation bug assumed one of two behaviours and
 * broke under the other:
 *
 *  - restart gives a CLEAN transcript, so previous text must be banked and the
 *    new text appended;
 *  - restart gives the WHOLE transcript again, so appending duplicates it.
 *
 * Android Chrome does the second — even with a brand new SpeechRecognition
 * object, because the recognition itself is performed by the system speech
 * service, which keeps its own accumulated result. Banking "hello", then being
 * handed "hello this" and appending it, produced "hellohello this"; another
 * round produced "hellohello thishello this is", and so on. That is exactly the
 * shape of the reported output.
 *
 * So stop assuming. This looks at the text and decides:
 *
 *  - if what just arrived already CONTAINS what we had, it supersedes it;
 *  - if it merely overlaps at the seam, only the new tail is added;
 *  - otherwise it is genuinely new and is appended.
 *
 * Every one of those is correct under both behaviours, so the merge no longer
 * depends on which one the browser happens to implement.
 *
 * Kept as source text rather than a TS function because it ships inside the
 * phone page, which has no build step. The test compiles THIS string and
 * exercises it, so what is tested is what runs.
 */
export const SPEECH_MERGE_JS = `
function mergeSpeech(prev, cur) {
  var p = (prev || "").trim();
  var c = (cur || "").trim();
  if (!p) return c;
  if (!c) return p;

  // WORDS, not characters. A character-level overlap happily joins "commit"
  // to "the changes" on the shared "t" and yields "commithe changes" — a new
  // kind of mangling in place of the old one.
  var pw = p.split(/\\s+/);
  var cw = c.split(/\\s+/);
  var lpw = p.toLowerCase().split(/\\s+/);
  var lcw = c.toLowerCase().split(/\\s+/);

  function startsWith(haystack, needle) {
    if (needle.length > haystack.length) return false;
    for (var i = 0; i < needle.length; i++) {
      if (haystack[i] !== needle[i]) return false;
    }
    return true;
  }

  // The recogniser handed back everything it has heard, including what we
  // already hold. Its version wins — it is a superset, not a repeat. This is
  // the case that produced "hellohello this".
  if (startsWith(lcw, lpw)) return c;

  // The reverse: a late event from a discarded recogniser carrying less than
  // we have. Keeping ours stops the box rolling backwards.
  if (startsWith(lpw, lcw)) return p;

  // Partial overlap at the seam ("hello this is" + "this is a test"). Longest
  // first, so the join lands on the most specific match rather than on a
  // single incidental word.
  var max = Math.min(pw.length, cw.length);
  for (var k = max; k > 0; k--) {
    var tailMatches = true;
    for (var j = 0; j < k; j++) {
      if (lpw[lpw.length - k + j] !== lcw[j]) { tailMatches = false; break; }
    }
    if (tailMatches) {
      var rest = cw.slice(k).join(" ");
      return rest ? p + " " + rest : p;
    }
  }

  // Genuinely new words.
  return p + " " + c;
}
`;
