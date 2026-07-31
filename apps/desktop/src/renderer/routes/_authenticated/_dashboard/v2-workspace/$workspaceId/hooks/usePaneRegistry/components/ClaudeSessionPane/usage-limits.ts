/**
 * The subscription windows for the account a session is spending, as rendered
 * by the strip in the session header.
 *
 * Lives here rather than beside a component because the warning banner that
 * used to own this type is gone — it interrupted the composer to repeat a number
 * the header already shows continuously.
 */
export interface UsageLimits {
	label?: string;
	fiveHourPercent: number | null;
	fiveHourResets?: string | null;
	weeklyPercent: number | null;
	weeklyResets?: string | null;
}
