/**
 * The script injected into a browser pane to let you click an element.
 *
 * Runs via `browser.evaluateJS`, which resolves with whatever the script
 * returns — including a promise. So this evaluates to a Promise that settles
 * when the user clicks an element or presses Escape, and one round trip covers
 * the whole interaction.
 *
 * It is deliberately DUMB. It draws the highlight, waits, and harvests plain
 * facts: the ancestor chain, some attributes, a few computed styles, the
 * markup. Every judgement call — which selector is stable, what to truncate,
 * how to present it — is made in `shared/element-picker.ts`, which is real
 * TypeScript with real tests. Nothing typechecks or unit-tests this string, so
 * the less it decides, the less can go quietly wrong.
 *
 * Self-cleaning: the overlay, the listeners and the cursor override are all
 * removed before it resolves, on every exit path. A picker that leaves a
 * transparent div over the page would look exactly like a broken browser.
 */

/** Computed properties worth reporting. The full set is ~340 and unreadable. */
const REPORTED_STYLES = [
	"display",
	"position",
	"width",
	"height",
	"margin",
	"padding",
	"color",
	"background-color",
	"font-family",
	"font-size",
	"font-weight",
	"line-height",
	"border",
	"border-radius",
	"flex-direction",
	"gap",
	"z-index",
	"opacity",
];

/** Attributes that identify an element; `class` and `style` are noise here. */
const REPORTED_ATTRIBUTES = [
	"id",
	"type",
	"name",
	"href",
	"src",
	"alt",
	"title",
	"role",
	"aria-label",
	"placeholder",
	"value",
	"data-testid",
];

export const ELEMENT_PICKER_SCRIPT = `(function () {
  // A second invocation should not stack overlays. Cancel the first.
  if (window.__gatedspacePickerCancel) {
    try { window.__gatedspacePickerCancel(); } catch (e) {}
  }

  var REPORTED_STYLES = ${JSON.stringify(REPORTED_STYLES)};
  var REPORTED_ATTRIBUTES = ${JSON.stringify(REPORTED_ATTRIBUTES)};

  return new Promise(function (resolve) {
    var box = document.createElement("div");
    box.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483647",
      "border:2px solid #e07850",
      "background:rgba(224,120,80,0.14)",
      "border-radius:2px",
      "transition:all 40ms linear",
      "display:none"
    ].join(";");

    var label = document.createElement("div");
    label.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483647",
      "background:#e07850",
      "color:#151110",
      "font:11px ui-monospace,Menlo,Consolas,monospace",
      "padding:2px 6px",
      "border-radius:3px",
      "display:none",
      "white-space:nowrap"
    ].join(";");

    document.documentElement.appendChild(box);
    document.documentElement.appendChild(label);

    var previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    var hovered = null;

    function cleanup() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      window.__gatedspacePickerCancel = null;
      document.documentElement.style.cursor = previousCursor;
      if (box.parentNode) box.parentNode.removeChild(box);
      if (label.parentNode) label.parentNode.removeChild(label);
    }

    window.__gatedspacePickerCancel = function () {
      cleanup();
      resolve(null);
    };

    function draw(el) {
      var r = el.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = r.left + "px";
      box.style.top = r.top + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";

      var name = el.tagName.toLowerCase();
      if (el.id) name += "#" + el.id;
      label.textContent = name + "  " + Math.round(r.width) + "x" + Math.round(r.height);
      label.style.display = "block";
      // Above the element, unless that would go off the top of the viewport.
      var top = r.top - 20;
      label.style.top = (top < 0 ? r.bottom + 4 : top) + "px";
      label.style.left = Math.max(0, r.left) + "px";
    }

    function onMove(event) {
      var el = event.target;
      if (!el || el === box || el === label || el === hovered) return;
      hovered = el;
      draw(el);
    }

    function onScroll() {
      if (hovered) draw(hovered);
    }

    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      resolve(null);
    }

    function onClick(event) {
      // Capture phase + preventDefault so picking a link does not navigate and
      // picking a button does not submit anything.
      event.preventDefault();
      event.stopPropagation();

      var el = event.target;
      if (!el || el.nodeType !== 1) { cleanup(); resolve(null); return; }

      var chain = [];
      var cursor = el;
      // Cap the walk: a selector built from thirty ancestors helps nobody, and
      // deeply nested app markup is common.
      while (cursor && cursor.nodeType === 1 && chain.length < 8) {
        var parent = cursor.parentElement;
        var sameTag = 0;
        var nth = 0;
        if (parent) {
          for (var i = 0; i < parent.children.length; i++) {
            var sib = parent.children[i];
            if (sib.tagName !== cursor.tagName) continue;
            sameTag++;
            if (sib === cursor) nth = sameTag;
          }
        } else {
          sameTag = 1;
          nth = 1;
        }
        chain.unshift({
          tag: cursor.tagName.toLowerCase(),
          id: cursor.id || null,
          classes: cursor.classList ? Array.prototype.slice.call(cursor.classList) : [],
          nthOfType: nth || 1,
          sameTagSiblings: sameTag || 1
        });
        if (cursor.id) break;
        cursor = parent;
      }

      var attributes = {};
      for (var a = 0; a < REPORTED_ATTRIBUTES.length; a++) {
        var attr = REPORTED_ATTRIBUTES[a];
        if (el.hasAttribute && el.hasAttribute(attr)) {
          attributes[attr] = el.getAttribute(attr);
        }
      }

      var styles = {};
      var computed = window.getComputedStyle(el);
      for (var s = 0; s < REPORTED_STYLES.length; s++) {
        var prop = REPORTED_STYLES[s];
        var value = computed.getPropertyValue(prop);
        if (value) styles[prop] = value.trim();
      }

      var rect = el.getBoundingClientRect();
      var payload = {
        chain: chain,
        attributes: attributes,
        text: (el.innerText || el.textContent || ""),
        html: el.outerHTML || "",
        styles: styles,
        rect: { width: rect.width, height: rect.height },
        url: location.href
      };

      cleanup();
      resolve(payload);
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
  });
})()`;
