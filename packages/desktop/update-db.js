import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// The data folder was renamed off the upstream name, and an installation that
// has not been launched since still carries the old one. Try both rather than
// hardcoding either, so this keeps working on both sides of that migration.
// The database file itself is named by the backend binary, not by us.
const root = path.join(homedir(), 'AppData', 'Roaming', 'TheFool-Dev');
const candidates = ['fool-core', 'aionui'].map((dir) => path.join(root, dir, 'aionui-backend.db'));
const databasePath = candidates.find((candidate) => existsSync(candidate));

if (!databasePath) {
  console.error(`No database found. Looked in:\n${candidates.map((candidate) => `  ${candidate}`).join('\n')}`);
  process.exit(1);
}

const db = new Database(databasePath);
db.prepare('UPDATE client_preferences SET value = ? WHERE key = ?').run(
  '"tts-kokoro-en-v0_19-int8"',
  'tools.textToSpeech'
);
console.log(`Updated ${databasePath}`);
