CREATE SCHEMA "continuity";
--> statement-breakpoint
CREATE TABLE "continuity"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity"."checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"stream_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity"."device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "continuity"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity"."objects" (
	"owner_id" text NOT NULL,
	"digest" text NOT NULL,
	"bytes" integer NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objects_owner_id_digest_pk" PRIMARY KEY("owner_id","digest")
);
--> statement-breakpoint
CREATE TABLE "continuity"."quotas" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity"."rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "continuity"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "continuity"."streams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"checkpoint_id" uuid,
	"device_id" uuid,
	"lease_hash" text,
	"lease_expires_at" timestamp with time zone,
	"fence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuity"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "continuity"."verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "continuity"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."checkpoints" ADD CONSTRAINT "checkpoints_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."checkpoints" ADD CONSTRAINT "checkpoints_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "continuity"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."devices" ADD CONSTRAINT "devices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."objects" ADD CONSTRAINT "objects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."quotas" ADD CONSTRAINT "quotas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity"."streams" ADD CONSTRAINT "streams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "continuity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_accounts_provider_idx" ON "continuity"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "continuity_accounts_user_idx" ON "continuity"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_checkpoints_revision_idx" ON "continuity"."checkpoints" USING btree ("stream_id","revision");--> statement-breakpoint
CREATE INDEX "continuity_checkpoints_owner_idx" ON "continuity"."checkpoints" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "continuity_devices_owner_idx" ON "continuity"."devices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "continuity_sessions_user_idx" ON "continuity"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "continuity_streams_owner_idx" ON "continuity"."streams" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "continuity_verifications_identifier_idx" ON "continuity"."verifications" USING btree ("identifier");