import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	ensureSupersetHomeDirExists,
	SUPERSET_HOME_DIR,
	SUPERSET_SENSITIVE_FILE_MODE,
} from "../app-environment";
import {
	audienceOf,
	buildVapidAuthorization,
	generateVapidKeys,
	type VapidKeys,
} from "./vapid";

/**
 * Push notifications to the phone.
 *
 * The desktop already decides when something is worth interrupting for; this
 * rides on that same decision rather than inventing a second one, so the phone
 * and the desktop never disagree about what counts as urgent.
 *
 * The push itself carries NO PAYLOAD. That is not a limitation worked around —
 * it is the reason there is no encryption code here. A push with a body has to
 * be encrypted to the phone's own keys (ECDH plus AES-GCM, and a mistake in it
 * fails silently), whereas an empty push just wakes the service worker, which
 * then asks this bridge what happened over the connection it already trusts.
 * Nothing about the session crosses a third-party push service either way.
 */
const SUBSCRIPTIONS_FILE = join(SUPERSET_HOME_DIR, "push-subscriptions.json");
const KEYS_FILE = join(SUPERSET_HOME_DIR, "push-keys.json");

/** Long enough to survive clock skew, short enough to be worthless if leaked. */
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * Push services drop a notification that could not be delivered within the TTL.
 * An hour is the window in which "your agent is waiting" is still true; a stale
 * one arriving the next morning is noise.
 */
const PUSH_TTL_SECONDS = 60 * 60;

/**
 * There is no mailbox behind this, but the spec requires a contact so a push
 * service can reach whoever is sending. A URL identifying the app is the honest
 * answer for something that pushes only to its own owner's phone.
 */
const VAPID_SUBJECT = "https://github.com/yzgershon/GatedSpace";

export interface PushSubscription {
	endpoint: string;
	/** Which device, so re-subscribing replaces rather than duplicates. */
	keys?: { p256dh?: string; auth?: string };
}

/**
 * What the service worker asks for once a push wakes it.
 *
 * Held in memory only. It is a pointer to something happening right now; on the
 * next launch there is nothing to point at.
 */
export interface PendingPushNotice {
	title: string;
	body: string;
	sessionKey: string | null;
	at: number;
}

function readJsonFile<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function writeJsonFile(path: string, value: unknown): void {
	ensureSupersetHomeDirExists();
	writeFileSync(path, JSON.stringify(value, null, 2), {
		mode: SUPERSET_SENSITIVE_FILE_MODE,
	});
}

class PushService {
	private keys: VapidKeys | null = null;
	private subscriptions: PushSubscription[] | null = null;
	private pending: PendingPushNotice | null = null;

	/**
	 * Generated on first use and then reused forever. Rotating this key would
	 * invalidate every subscription already sitting on a phone, and the only
	 * symptom would be notifications quietly never arriving again.
	 */
	publicKey(): string {
		return this.loadKeys().publicKey;
	}

	subscribe(subscription: PushSubscription): void {
		const existing = this.loadSubscriptions().filter(
			(entry) => entry.endpoint !== subscription.endpoint,
		);
		existing.push(subscription);
		this.subscriptions = existing;
		writeJsonFile(SUBSCRIPTIONS_FILE, existing);
	}

	unsubscribe(endpoint: string): void {
		const remaining = this.loadSubscriptions().filter(
			(entry) => entry.endpoint !== endpoint,
		);
		this.subscriptions = remaining;
		writeJsonFile(SUBSCRIPTIONS_FILE, remaining);
	}

	subscriptionCount(): number {
		return this.loadSubscriptions().length;
	}

	takePending(): PendingPushNotice | null {
		return this.pending;
	}

	/**
	 * Records what happened and wakes every subscribed phone.
	 *
	 * The notice is stored BEFORE the pushes go out: the service worker can be
	 * woken and come asking within milliseconds, and finding nothing there would
	 * show a generic notification for an event we could have named.
	 */
	async notify(notice: Omit<PendingPushNotice, "at">): Promise<void> {
		this.pending = { ...notice, at: Date.now() };

		const subscriptions = this.loadSubscriptions();
		if (!subscriptions.length) return;

		await Promise.all(
			subscriptions.map((subscription) => this.send(subscription)),
		);
	}

	private async send(subscription: PushSubscription): Promise<void> {
		const audience = audienceOf(subscription.endpoint);
		if (!audience) return;

		try {
			const response = await fetch(subscription.endpoint, {
				method: "POST",
				headers: {
					TTL: String(PUSH_TTL_SECONDS),
					Authorization: buildVapidAuthorization({
						audience,
						subject: VAPID_SUBJECT,
						keys: this.loadKeys(),
						expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
					}),
					"Content-Length": "0",
				},
			});

			// 404/410 mean the phone dropped the subscription — the app was
			// uninstalled, or notification permission was revoked. Keeping it would
			// mean retrying a dead endpoint on every event forever.
			if (response.status === 404 || response.status === 410) {
				this.unsubscribe(subscription.endpoint);
			}
		} catch (error) {
			// A push that cannot be delivered is not worth breaking the desktop
			// notification it rode in on.
			console.warn("[push] delivery failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private loadKeys(): VapidKeys {
		if (this.keys) return this.keys;
		const stored = readJsonFile<VapidKeys>(KEYS_FILE);
		if (stored?.publicKey && stored.privateKey) {
			this.keys = stored;
			return stored;
		}
		const generated = generateVapidKeys();
		writeJsonFile(KEYS_FILE, generated);
		this.keys = generated;
		return generated;
	}

	private loadSubscriptions(): PushSubscription[] {
		if (this.subscriptions) return this.subscriptions;
		const stored = readJsonFile<PushSubscription[]>(SUBSCRIPTIONS_FILE);
		this.subscriptions = Array.isArray(stored) ? stored : [];
		return this.subscriptions;
	}
}

export const pushService = new PushService();
