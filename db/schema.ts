import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  mode: text('mode').notNull().default('duel'),
  questionSet: integer('question_set').notNull().default(1),
  hostHash: text('host_hash').notNull(), hostName: text('host_name').notNull(), hostAvatar: text('host_avatar').notNull(), hostSeenAt: integer('host_seen_at').notNull(),
  guestHash: text('guest_hash'), guestName: text('guest_name'), guestAvatar: text('guest_avatar'), guestSeenAt: integer('guest_seen_at').notNull().default(0),
  phase: text('phase').notNull().default('waiting'), round: integer('round').notNull().default(0),
  startAt: integer('start_at').notNull().default(0), deadline: integer('deadline').notNull().default(0), revealAt: integer('reveal_at').notNull().default(0),
  hostAnswer: integer('host_answer'), guestAnswer: integer('guest_answer'), hostReady: integer('host_ready').notNull().default(0), guestReady: integer('guest_ready').notNull().default(0),
  hostScore: integer('host_score').notNull().default(0), guestScore: integer('guest_score').notNull().default(0),
  history: text('history').notNull().default('[]'), questionIds: text('question_ids').notNull(), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [uniqueIndex('rooms_host_hash_unique').on(t.hostHash), index('rooms_expires_at_idx').on(t.expiresAt)]);
export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(), hits: integer('hits').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('rate_limits_expires_at_idx').on(t.expiresAt)]);
