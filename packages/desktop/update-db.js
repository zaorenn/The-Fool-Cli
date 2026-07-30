import { Database } from 'bun:sqlite';
const db = new Database('C:/Users/sarhen/AppData/Roaming/TheFool-Dev/aionui/aionui-backend.db');
db.prepare('UPDATE client_preferences SET value = ? WHERE key = ?').run(
  '"tts-kokoro-en-v0_19-int8"',
  'tools.textToSpeech'
);
console.log('Updated DB');
