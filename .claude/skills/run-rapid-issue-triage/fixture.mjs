// Fixture workspace for offline runs.
//
// The Linear sync cannot succeed without a real API key, so a freshly opened
// database is empty and every screen renders "Inbox zero". This module writes
// a plausible workspace straight into the sqlite index the UI reads from.
//
// Safe against the syncer: `fetchWorkspace` fails first when the key is fake,
// so `PruneStale` never runs and these rows survive. `sync_gen` is set high
// anyway so that even a later real sync would not delete them mid-run.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const TEAM = 'team-eng';
const GEN = 1_000_000;

const iso = (daysAgo) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');

const STATES = [
  ['state-triage', 'Triage', 'triage', '#f2c94c', 0],
  ['state-backlog', 'Backlog', 'backlog', '#bec2c8', 1],
  ['state-todo', 'Todo', 'unstarted', '#e2e2e2', 2],
  ['state-progress', 'In Progress', 'started', '#f2c94c', 3],
  ['state-done', 'Done', 'completed', '#5e6ad2', 4],
  ['state-canceled', 'Canceled', 'canceled', '#95a2b3', 5],
];

const LABELS = [
  ['label-bug', 'bug', '#eb5757'],
  ['label-infra-triaged', 'infra:triaged', '#0f9960'],
  ['label-needs-info', 'needs-info', '#f2994a'],
  ['label-perf', 'performance', '#5e6ad2'],
];

const chip = (id) => {
  const l = LABELS.find((x) => x[0] === id);
  return { id: l[0], name: l[1], color: l[2] };
};

const ISSUES = [
  {
    id: 'iss-1', n: 412, title: 'Sync worker wedges on a 429 from the Linear API',
    priority: 1, labels: ['label-bug'], age: 3,
    body: `The background sync stops making progress after Linear returns a 429.\n\n### Repro\n1. Force a rate limit with a tight loop of \`issues\` queries.\n2. Watch \`sync: state=error\` in the top bar — it never recovers.\n\nThe retry uses a fixed 2s backoff and gives up after 3 tries, but never\nreschedules, so the ticker is the only thing that can revive it.`,
  },
  {
    id: 'iss-2', n: 388, title: 'Queue ordering starves issues skipped more than twice',
    priority: 2, labels: ['label-perf'], age: 9,
    body: `\`skip_count ASC, RANDOM()\` means anything skipped three times sits behind\nevery fresh issue forever. Consider decaying \`skip_count\` after a week.`,
  },
  {
    id: 'iss-3', n: 401, title: 'Undo restores labels but drops the estimate',
    priority: 1, labels: ['label-bug', 'label-needs-info'], age: 1,
    body: `Applying a macro that sets an estimate and then pressing \`U\` restores the\nlabels and state, but the estimate stays at the macro's value.\n\nSuspect \`prev_json\` omits a null estimate rather than recording it.`,
  },
  {
    id: 'iss-4', n: 297, title: 'Report page shows a streak of 0 after midnight UTC',
    priority: 3, labels: [], age: 21,
    body: 'The streak query buckets by UTC day, so anyone triaging in the evening in\nUS timezones sees their streak reset early.',
  },
  {
    id: 'iss-5', n: 355, title: 'Add a keyboard shortcut to copy the issue identifier',
    priority: 4, labels: [], age: 14,
    body: 'Small quality-of-life ask: `Y` to copy `ENG-355` to the clipboard.',
  },
  {
    id: 'iss-6', n: 208, title: 'Investigate flaky websocket reconnect in the deep enrichment log',
    priority: 2, labels: ['label-perf'], age: 45,
    body: 'The run log occasionally stops streaming events even though the run is\nstill going. Refreshing the page recovers it.',
  },
];

const MACROS = [
  { name: 'Accept → triaged', key: '1', outcome: 'accepted',
    steps: [{ type: 'add_label', labelName: 'infra:triaged' }, { type: 'set_state', stateType: 'unstarted' }] },
  { name: 'Needs info', key: '2', outcome: 'needs_info',
    steps: [{ type: 'add_label', labelName: 'needs-info' }] },
  { name: 'Close as obsolete', key: '3', outcome: 'cancelled',
    steps: [{ type: 'set_state', stateType: 'canceled' }] },
];

export function seed(dbPath) {
  // The Go store owns the schema (store.Open runs the DDL at startup). Opening
  // a nonexistent path here would just create an empty file and then fail on
  // the first DELETE, so require the server to have created it.
  if (!fs.existsSync(dbPath)) {
    throw new Error(`${dbPath} does not exist — start the server once first ` +
      `(driver.mjs start) so it can create the schema`);
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  const wipe = ['issues', 'teams', 'workflow_states', 'labels', 'projects', 'cycles',
    'users', 'macros', 'activity', 'enrichments', 'enrich_runs'];
  for (const t of wipe) db.exec(`DELETE FROM ${t}`);
  // macros.id and activity.id are AUTOINCREMENT, so a plain DELETE leaves the
  // sequence where it was and a reseed hands out ids 10, 11, 12... Resetting it
  // keeps macro ids stable at 1..3, which is what `POST /api/issues/{id}/macro/1`
  // and the driver's own assertions assume.
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('macros', 'activity')");

  db.prepare('INSERT INTO teams (id, key, name) VALUES (?, ?, ?)').run(TEAM, 'ENG', 'Engineering');
  db.prepare('INSERT INTO teams (id, key, name) VALUES (?, ?, ?)').run('team-ops', 'OPS', 'Operations');

  const st = db.prepare(
    'INSERT INTO workflow_states (id, team_id, name, type, color, position) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [id, name, type, color, pos] of STATES) st.run(id, TEAM, name, type, color, pos);

  const lb = db.prepare('INSERT INTO labels (id, team_id, name, color, is_group) VALUES (?, ?, ?, ?, 0)');
  for (const [id, name, color] of LABELS) lb.run(id, TEAM, name, color);

  db.prepare('INSERT INTO projects (id, name, state) VALUES (?, ?, ?)').run('proj-rel', 'Reliability', 'started');
  db.prepare('INSERT INTO cycles (id, team_id, number, name, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cycle-24', TEAM, 24, 'Cycle 24', iso(4), iso(-10));
  db.prepare('INSERT INTO users (id, name, display_name, email, is_me) VALUES (?, ?, ?, ?, ?)')
    .run('user-me', 'Ada Lovelace', 'ada', 'ada@example.test', 1);

  const ins = db.prepare(`INSERT INTO issues
    (id, identifier, title, description, team_id, state_id, assignee_id, project_id, cycle_id,
     creator_name, priority, estimate, url, created_at, updated_at, labels_json, sync_gen,
     skip_count, snoozed_until, triaged_at)
    VALUES (?, ?, ?, ?, ?, 'state-triage', '', '', '', ?, ?, NULL, ?, ?, ?, ?, ?, 0, NULL, NULL)`);
  for (const i of ISSUES) {
    ins.run(i.id, `ENG-${i.n}`, i.title, i.body, TEAM, 'Grace Hopper', i.priority,
      `https://linear.app/example/issue/ENG-${i.n}`, iso(i.age), iso(Math.max(0, i.age - 1)),
      JSON.stringify(i.labels.map(chip)), GEN);
  }

  const mac = db.prepare(
    'INSERT INTO macros (name, key_binding, outcome, steps_json, position) VALUES (?, ?, ?, ?, ?)');
  MACROS.forEach((m, idx) => mac.run(m.name, m.key, m.outcome, JSON.stringify(m.steps), idx));

  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('sync_gen', String(GEN));
  meta.run('last_synced_at', iso(0));

  db.close();
  return { issues: ISSUES.length, macros: MACROS.length };
}
