import type { PoolEffects } from '../src/lib/pool-effects.js'
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { Message, SongSettings, StudioMode } from '../src/lib/studio-types.js'

export const accountResets = pgTable('account_resets', {
  id: text('id').primaryKey(),
  cutoff: timestamp('cutoff', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const creations = pgTable('creations', {
  id: uuid('id').primaryKey().defaultRandom(),
  owner: text('owner').notNull(),
  kind: text('kind').$type<StudioMode>().notNull(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  content: text('content').notNull(),
  messages: jsonb('messages').$type<Message[]>().notNull().default([]),
  settings: jsonb('settings').$type<SongSettings>(),
  imageMime: text('image_mime'),
  parentId: uuid('parent_id'),
  tuning: jsonb('tuning').$type<string[]>().notNull().default([]),
  research: jsonb('research').$type<{ subject: string; notes: string }>(),
  stylePrompt: text('style_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('creations_owner_date_idx').on(table.owner, table.createdAt)])

export const lyricCorrections = pgTable('lyric_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  owner: text('owner').notNull(),
  original: text('original').notNull(),
  replacement: text('replacement').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('lyric_corrections_owner_date_idx').on(table.owner, table.createdAt)])

export const poolPreferences = pgTable('pool_preferences', {
  owner: text('owner').primaryKey(),
  appearance: jsonb('appearance').$type<{ theme: string; frameColor: string; felt: string; railColor?: string; imageColor?: string; roomColor?: string; cueShaftColor?: string; cueButtColor?: string; cuePreset?: string; reducedMotion?: boolean; effects: Record<string, Partial<PoolEffects> & { fade: boolean; electric: boolean }> }>().notNull(),
})

export const racingProfiles = pgTable('racing_profiles', {
  owner: text('owner').primaryKey(),
  scheme: jsonb('scheme').$type<{ name: string; body: string; stripe: string; asset?: string }>().notNull(),
})

export const racingTickets = pgTable('racing_tickets', {
  hash: text('hash').primaryKey(),
  owner: text('owner').notNull(),
  username: text('username').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const racingLaps = pgTable('racing_laps', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  username: text('username').notNull(),
  milliseconds: integer('milliseconds').notNull(),
  mode: text('mode').notNull(),
  track: text('track').default('circuit').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('racing_laps_time_idx').on(table.milliseconds, table.createdAt), index('racing_laps_track_mode_idx').on(table.track, table.mode, table.milliseconds)])

export const poolPracticeRecords = pgTable('pool_practice_records', {
  id: uuid('id').primaryKey(),
  owner: text('owner').notNull(),
  username: text('username').notNull(),
  mode: text('mode').$type<'practice' | 'nine-practice'>().notNull(),
  milliseconds: integer('milliseconds').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('pool_practice_records_mode_time_idx').on(table.mode, table.milliseconds, table.createdAt)])
