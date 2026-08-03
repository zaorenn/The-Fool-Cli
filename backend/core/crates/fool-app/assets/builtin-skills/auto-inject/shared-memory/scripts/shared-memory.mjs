import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_ENTRIES = 200;
const MAX_TEXT_LENGTH = 1000;
const memoryPath = process.env.FOOL_SHARED_MEMORY_PATH ?? join(homedir(), '.the-fool', 'shared-memory.json');
const secretPattern = /(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|password|secret)\s*[:=]|\bsk-[a-z0-9_-]{8,}/i;

const readStore = () => {
  try {
    const parsed = JSON.parse(readFileSync(memoryPath, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed : { entries: [] };
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [] };
    throw error;
  }
};

const writeStore = (store) => {
  mkdirSync(dirname(memoryPath), { recursive: true });
  const temporaryPath = `${memoryPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, memoryPath);
};

const readInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const command = process.argv[2];

if (command === 'remember') {
  const input = await readInput();
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > MAX_TEXT_LENGTH) throw new Error('Memory text is empty or too long');
  if (secretPattern.test(text)) throw new Error('Refusing to store secret-like memory');
  const tags = Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === 'string').slice(0, 10) : [];
  const store = readStore();
  store.entries.push({ id: crypto.randomUUID(), text, tags, createdAt: new Date().toISOString() });
  store.entries = store.entries.slice(-MAX_ENTRIES);
  writeStore(store);
  process.stdout.write(`${JSON.stringify({ stored: true })}\n`);
} else if (command === 'search') {
  const query = process.argv.slice(3).join(' ').trim().toLocaleLowerCase();
  const entries = readStore()
    .entries.filter((entry) => `${entry.text} ${entry.tags.join(' ')}`.toLocaleLowerCase().includes(query))
    .slice(-20)
    .reverse();
  process.stdout.write(`${JSON.stringify({ entries })}\n`);
} else if (command === 'list') {
  process.stdout.write(`${JSON.stringify({ entries: readStore().entries.slice(-20).reverse() })}\n`);
} else {
  throw new Error('Usage: shared-memory.mjs <remember|search|list>');
}
