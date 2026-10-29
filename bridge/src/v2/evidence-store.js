// Stage 5B.3 evidence store: every final event (accepted or rejected), command and status change is
// appended to a JSONL file with the server receipt time. Accepted dedupe keys are reloaded at start-up,
// so a replayed final is rejected even after a restart.
import fs from 'node:fs';
import path from 'node:path';

// One file per chain and escrow: trade ids restart at 1 on every new deployment.
export function openEvidenceStore(dir, name = 'evidence') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  const accepted = new Set();
  const past = []; // every entry, for rebuilding trade records after a restart
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.kind === 'final' && e.accepted && e.key) accepted.add(e.key);
        past.push(e);
      } catch { /* a torn last line after a crash: skip it */ }
    }
  }
  const append = (entry) => fs.appendFileSync(file, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...entry })}\n`);
  return {
    file,
    past: () => past,
    has: (key) => accepted.has(key),
    final(topic, payload, { key = null, accepted: ok, reason, tradeId = null }) {
      if (ok && key) accepted.add(key);
      append({ kind: 'final', topic, key, accepted: ok, reason, tradeId, payload });
    },
    command(topic, payload) { append({ kind: 'command', topic, payload }); },
    status(tradeId, status, detail = {}) { append({ kind: 'status', tradeId, status, ...detail }); },
  };
}
