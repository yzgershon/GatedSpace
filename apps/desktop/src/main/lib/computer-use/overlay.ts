import { join } from "node:path";
import { BrowserWindow, type Display, type Rectangle, screen } from "electron";
import type { ComputerUseState } from "../../../shared/computer-use";
import { type ComputerUseService, computerUseService } from "./service";

export function computerOverlayBounds(
	display: Pick<Display, "workArea">,
): Rectangle {
	const area = display.workArea;
	const width = Math.min(472, Math.max(240, area.width - 24));
	return {
		x: Math.round(area.x + (area.width - width) / 2),
		y: area.y + 12,
		width,
		height: 64,
	};
}

/** Separate click-through borders and a small, non-activating Stop window. */
export class ComputerUseOverlay {
	private borders = new Map<number, BrowserWindow>();
	private toolbar?: BrowserWindow;
	private toolbarDisplay?: number;
	private closing = false;
	private disposed = false;
	private failed = false;
	constructor(
		private readonly attach: (window: BrowserWindow) => void,
		private readonly service: ComputerUseService = computerUseService,
		private readonly paths = {
			preload: join(__dirname, "../preload/computer-overlay.js"),
			html: join(__dirname, "../renderer/computer-overlay.html"),
			devUrl: process.env.ELECTRON_RENDERER_URL,
		},
	) {
		service.on("change", this.update);
		screen.on("display-added", this.relayout);
		screen.on("display-removed", this.relayout);
		screen.on("display-metrics-changed", this.relayout);
		this.update(service.get());
	}
	private active() {
		return ["connecting", "ready", "stopping"].includes(
			this.service.get().phase,
		);
	}
	private fail = () => {
		if (!this.closing && !this.disposed && !this.failed) {
			this.failed = true;
			this.closeWindows();
			void this.service.stop(
				"The desktop control indicator closed. Enable computer control again.",
			);
		}
	};
	private create(kind: "border" | "toolbar", bounds: Rectangle) {
		const window = new BrowserWindow({
			...bounds,
			title:
				kind === "border"
					? "GatedSpace control border"
					: "GatedSpace computer control",
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			focusable: false,
			resizable: false,
			movable: kind === "toolbar",
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			hasShadow: false,
			webPreferences: {
				preload: this.paths.preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: true,
				zoomFactor: 1,
			},
		});
		window.setMenu(null);
		window.setAlwaysOnTop(true, "screen-saver");
		if (kind === "border") window.setIgnoreMouseEvents(true);
		this.attach(window);
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		window.webContents.on("render-process-gone", this.fail);
		window.on("closed", this.fail);
		window.once("ready-to-show", () => {
			if (!window.isDestroyed() && this.active()) {
				window.showInactive();
				// Windows can initially constrain a large window to the work area.
				if (kind === "border") window.setBounds(bounds);
			}
		});
		const loaded = this.paths.devUrl
			? window.loadURL(
					`${this.paths.devUrl}/computer-overlay.html?kind=${kind}`,
				)
			: window.loadFile(this.paths.html, { query: { kind } });
		void loaded.catch(this.fail);
		return window;
	}
	private update = (_state: ComputerUseState) => {
		if (this.disposed) return;
		if (!this.active()) {
			this.failed = false;
			this.closeWindows();
			return;
		}
		if (!this.toolbar) this.relayout();
	};
	private relayout = () => {
		if (this.disposed || this.failed || !this.active()) return;
		try {
			this.layout();
		} catch {
			this.fail();
		}
	};
	private layout() {
		const displays = screen.getAllDisplays();
		this.closing = true;
		for (const [id, window] of this.borders) {
			if (!displays.some((display) => display.id === id)) {
				if (!window.isDestroyed()) window.destroy();
				this.borders.delete(id);
			}
		}
		this.closing = false;
		for (const display of displays) {
			const existing = this.borders.get(display.id);
			if (existing && !existing.isDestroyed())
				existing.setBounds(display.bounds);
			else this.borders.set(display.id, this.create("border", display.bounds));
		}
		const display =
			displays.find((d) => d.id === this.toolbarDisplay) ??
			screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
		this.toolbarDisplay = display.id;
		if (!this.toolbar || this.toolbar.isDestroyed())
			this.toolbar = this.create("toolbar", computerOverlayBounds(display));
		else {
			// Keep a user-dragged toolbar in place unless monitor geometry changed.
			const bounds = this.toolbar.getBounds();
			const area = display.workArea;
			if (
				bounds.x < area.x ||
				bounds.y < area.y ||
				bounds.x + bounds.width > area.x + area.width ||
				bounds.y + bounds.height > area.y + area.height
			)
				this.toolbar.setBounds(computerOverlayBounds(display));
		}
	}
	private closeWindows() {
		this.closing = true;
		for (const window of [...this.borders.values(), this.toolbar])
			if (window && !window.isDestroyed()) window.destroy();
		this.borders.clear();
		this.toolbar = undefined;
		this.toolbarDisplay = undefined;
		this.closing = false;
	}
	dispose() {
		this.disposed = true;
		this.service.off("change", this.update);
		screen.off("display-added", this.relayout);
		screen.off("display-removed", this.relayout);
		screen.off("display-metrics-changed", this.relayout);
		this.closeWindows();
	}
}
