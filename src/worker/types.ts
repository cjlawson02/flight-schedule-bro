import { z } from "zod";
import type {
  APIEmbed,
  APIEmbedAuthor,
  APIEmbedField,
  APIEmbedFooter,
  RESTPostAPIWebhookWithTokenJSONBody,
} from "discord-api-types/v10";
import { BookableAvailabilityKvSchema } from "../shared/dao/availability.js";
import {
  FspMetadataSchema,
  type FspMetadata,
} from "../shared/blo/fspMetadata.js";

/**
 * Metadata schema for tracking snapshot state
 */
export const MetadataSchema = z.object({
  lastSearchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastUpdate: z.iso.datetime(),
  daysAhead: z.number().int().positive(),
});

export { FspMetadataSchema, type FspMetadata };

/**
 * Complete snapshot schema for KV storage
 */
export const SnapshotSchema = z.object({
  slots: z.array(BookableAvailabilityKvSchema),
  metadata: MetadataSchema,
});

/**
 * Discord embed field schema (aligned with Discord API)
 * @see https://discord.com/developers/docs/resources/channel#embed-object-embed-field-structure
 */
const DiscordEmbedFieldSchema = z.object({
  name: z.string().max(256), // Discord limit: 256 characters
  value: z.string().max(1024), // Discord limit: 1024 characters
  inline: z.boolean().optional(),
}) satisfies z.ZodType<APIEmbedField>;

/**
 * Discord embed footer schema (aligned with Discord API)
 * @see https://discord.com/developers/docs/resources/channel#embed-object-embed-footer-structure
 */
const DiscordEmbedFooterSchema = z.object({
  text: z.string().max(2048), // Discord limit: 2048 characters
  icon_url: z.url().optional(),
  proxy_icon_url: z.url().optional(),
}) satisfies z.ZodType<APIEmbedFooter>;

const DiscordEmbedAuthorSchema = z.object({
  name: z.string().max(256),
  url: z.url().optional(),
  icon_url: z.url().optional(),
  proxy_icon_url: z.url().optional(),
}) satisfies z.ZodType<APIEmbedAuthor>;

/**
 * Discord embed schema (aligned with Discord API)
 * @see https://discord.com/developers/docs/resources/channel#embed-object
 */
export const DiscordEmbedSchema = z.object({
  author: DiscordEmbedAuthorSchema.optional(),
  title: z.string().max(256).optional(), // Discord limit: 256 characters
  description: z.string().max(4096).optional(), // Discord limit: 4096 characters
  color: z.number().int().min(0).max(0xffffff).optional(), // Discord: 0x000000 to 0xFFFFFF
  fields: z.array(DiscordEmbedFieldSchema).max(25).optional(), // Discord limit: 25 fields
  timestamp: z.iso.datetime().optional(),
  footer: DiscordEmbedFooterSchema.optional(),
  url: z.url().optional(),
  image: z
    .object({
      url: z.url(),
    })
    .optional(),
  thumbnail: z
    .object({
      url: z.url(),
    })
    .optional(),
}) satisfies z.ZodType<Partial<APIEmbed>>;

/**
 * Discord webhook payload schema (aligned with Discord API)
 * @see https://discord.com/developers/docs/resources/webhook#execute-webhook
 */
export const DiscordPayloadSchema = z.object({
  content: z.string().max(2000).optional(), // Discord limit: 2000 characters
  embeds: z.array(DiscordEmbedSchema).max(10).optional(), // Discord limit: 10 embeds
  username: z.string().max(80).optional(), // Discord limit: 80 characters
  avatar_url: z.url().optional(),
  tts: z.boolean().optional(),
  allowed_mentions: z.any().optional(),
}) satisfies z.ZodType<Partial<RESTPostAPIWebhookWithTokenJSONBody>>;

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // KV namespace binding
  FSP_AVAILABILITY_KV: KVNamespace;

  // Secrets
  FSP_EMAIL: string;
  FSP_PASSWORD: string;
  DISCORD_WEBHOOK_URL: string;

  // Configuration variables
  DAYS_AHEAD: string;
  AIRCRAFT_REGEX: string;
  WEEKDAY_MIN_HOUR?: string;
  MAX_HOUR?: string;
  TIMEZONE?: string;
  NOTIFICATION_AIRCRAFT?: string; // Comma-separated aircraft tail numbers for Discord notifications
  RESERVATION_TYPE_ID?: string;
}

/**
 * TypeScript types inferred from Zod schemas
 */
export type Metadata = z.infer<typeof MetadataSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type DiscordEmbed = z.infer<typeof DiscordEmbedSchema>;
export type DiscordPayload = z.infer<typeof DiscordPayloadSchema>;
