import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => {
    let params = [];
    const stmt = {
      bind(...p) { params = p; return stmt; },
      async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async first() { return db.prepare(sql).get(...params) ?? null; },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
    sqlite: db,
  };
}
