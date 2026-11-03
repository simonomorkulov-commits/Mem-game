import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class LocalDB {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.queue = Promise.resolve();
    this.db.exec('CREATE TABLE IF NOT EXISTS __local_migrations (tag TEXT PRIMARY KEY NOT NULL)');
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    for (const entry of journal.entries) {
      const sql = readFileSync(new URL('../drizzle/' + entry.tag + '.sql', import.meta.url), 'utf8')
        .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ');
      this.db.exec('BEGIN IMMEDIATE');
      try { if (!this.db.prepare('SELECT tag FROM __local_migrations WHERE tag = ?').get(entry.tag)) { this.db.exec(sql); this.db.prepare('INSERT INTO __local_migrations (tag) VALUES (?)').run(entry.tag); } this.db.exec('COMMIT'); }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    const wrapper = args => ({
      bind: (...values) => wrapper(values),
      first: async () => statement.get(...args) || null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => { const result = statement.run(...args); return { success: true, meta: { changes: Number(result.changes) } }; }
    });
    return wrapper([]);
  }
  batch(statements) {
    const task = this.queue.then(async () => {
      this.db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.exec('COMMIT'); return results; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
    this.queue = task.catch(() => {}); return task;
  }
  close() { this.db.close(); }
}
export function openLocalDB() {
  const directory = new URL('../.local-data/', import.meta.url); mkdirSync(directory, { recursive: true });
  return new LocalDB(fileURLToPath(new URL('game.sqlite', directory)));
}
