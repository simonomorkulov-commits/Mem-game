import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class LocalDB {
  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.queue = Promise.resolve();
    this.db.exec(readFileSync(new URL('../drizzle/0000_accounts_levels.sql', import.meta.url), 'utf8').replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS '));
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
