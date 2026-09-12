import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
export function openDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const name of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) {
    if (sqlite.prepare('SELECT 1 FROM local_migrations WHERE name = ?').get(name)) continue;
    sqlite.exec(fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO local_migrations(name) VALUES (?)').run(name);
  }
  const prepare = sql => {
    let args = [];
    const statement = { bind(...values) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      runNow() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) }, success: true }; },
      async run() { return statement.runNow(); },
    }; return statement;
  };
  return { prepare, async batch(statements) { sqlite.exec('BEGIN IMMEDIATE'); try { const results = statements.map(s => s.runNow()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }, close: () => sqlite.close(), raw: sqlite };
}
