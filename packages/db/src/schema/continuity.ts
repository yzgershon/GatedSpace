/** Dedicated sync database. Not connected to the desktop's local database. */

import type { CheckpointManifest } from "@superset/shared/continuity";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const schema = pgSchema("continuity");
const timestamps = () => ({
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});
export const user = schema.table("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	...timestamps(),
});
export const session = schema.table(
	"sessions",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		...timestamps(),
	},
	(t) => [index("continuity_sessions_user_idx").on(t.userId)],
);
export const account = schema.table(
	"accounts",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		scope: text("scope"),
		password: text("password"),
		...timestamps(),
	},
	(t) => [
		uniqueIndex("continuity_accounts_provider_idx").on(
			t.providerId,
			t.accountId,
		),
		index("continuity_accounts_user_idx").on(t.userId),
	],
);
export const verification = schema.table(
	"verifications",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		...timestamps(),
	},
	(t) => [index("continuity_verifications_identifier_idx").on(t.identifier)],
);
export const deviceCode = schema.table("device_codes", {
	id: text("id").primaryKey(),
	deviceCode: text("device_code").notNull().unique(),
	userCode: text("user_code").notNull().unique(),
	userId: text("user_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	status: text("status").notNull(),
	lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
	pollingInterval: integer("polling_interval"),
	clientId: text("client_id"),
	scope: text("scope"),
});
export const rateLimit = schema.table("rate_limits", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const devices = schema.table(
	"devices",
	{
		id: uuid("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		revoked: boolean("revoked").default(false).notNull(),
		...timestamps(),
	},
	(t) => [index("continuity_devices_owner_idx").on(t.ownerId)],
);
export const streams = schema.table(
	"streams",
	{
		id: uuid("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		revision: integer("revision").default(0).notNull(),
		checkpointId: uuid("checkpoint_id"),
		deviceId: uuid("device_id"),
		leaseHash: text("lease_hash"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		fence: integer("fence").default(0).notNull(),
		...timestamps(),
	},
	(t) => [index("continuity_streams_owner_idx").on(t.ownerId)],
);
export const checkpoints = schema.table(
	"checkpoints",
	{
		id: uuid("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		streamId: uuid("stream_id")
			.notNull()
			.references(() => streams.id, { onDelete: "cascade" }),
		deviceId: uuid("device_id").notNull(),
		revision: integer("revision").notNull(),
		fingerprint: text("fingerprint").notNull(),
		manifest: jsonb("manifest").$type<CheckpointManifest>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("continuity_checkpoints_revision_idx").on(
			t.streamId,
			t.revision,
		),
		index("continuity_checkpoints_owner_idx").on(t.ownerId),
	],
);
export const objects = schema.table(
	"objects",
	{
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		digest: text("digest").notNull(),
		bytes: integer("bytes").notNull(),
		ready: boolean("ready").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [primaryKey({ columns: [t.ownerId, t.digest] })],
);
export const quotas = schema.table("quotas", {
	ownerId: text("owner_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	bytes: integer("bytes").default(0).notNull(),
});
