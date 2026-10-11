// Run with:  node test.js
// Loads the exact question-generating code from index.html and checks 200 random questions.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const match = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!match) { console.error('Could not find the core script in index.html'); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(match[1], ctx);
const Core = ctx.Core;

const IDS = Core.INTERVALS.map(i => i.id);
const N = 200;
const failures = [];
const counts = {};
let checks = 0;
let doubles = 0;

function fail(i, msg, q, s) {
  failures.push(`#${i}: ${msg} | settings ${JSON.stringify(s)} | notes ${q.notes.map(Core.noteName).join(' ')} | ${q.intervals.join(', ')}`);
}

for (let i = 0; i < N; i++) {
  // Random settings: a random subset of intervals and a random range (sometimes narrow).
  let enabled = IDS.filter(() => Math.random() < 0.6);
  if (!enabled.length) enabled = [IDS[Math.floor(Math.random() * IDS.length)]];
  let low, high;
  if (i < 50) { low = 40; high = 76; }                         // default E2–E5
  else {
    low = 36 + Math.floor(Math.random() * 30);
    high = low + 2 + Math.floor(Math.random() * 40);
  }
  const s = { enabled, low, high };
  const q = Core.generateQuestion(s);
  if (!q) {
    // Only allowed if truly no pair fits.
    const smallest = Math.min(...enabled.map(id => Core.BY_ID[id].semis));
    checks++;
    if (2 * smallest <= high - low) failures.push(`#${i}: returned no question although a pair fits ${JSON.stringify(s)}`);
    i--;                                                        // try again so we test 200 real questions
    continue;
  }

  const m = q.midis;
  for (let k = 0; k < 2; k++) {
    const iv = Core.BY_ID[q.intervals[k]];
    counts[iv.id] = (counts[iv.id] || 0) + 1;
    const diff = m[k + 1] - m[k];
    // 1. label matches semitone distance
    checks++; if (diff !== iv.semis) fail(i, `interval ${k + 1} labelled ${iv.id} (${iv.semis}) but is ${diff} semitones`, q, s);
    // 2. goes up
    checks++; if (!(diff > 0)) fail(i, `interval ${k + 1} does not go up`, q, s);
    // extra: letter names agree with the interval number (e.g. a 3rd spans 3 letter names)
    const letterSteps = Core.staffPos(q.notes[k + 1]) - Core.staffPos(q.notes[k]) + 1;
    checks++; if (iv.nums.indexOf(letterSteps) < 0) fail(i, `interval ${k + 1} ${iv.id} spelled as a ${letterSteps}th`, q, s);
  }
  // 3. every note in range, and the spelled names really are those pitches
  q.notes.forEach((n, k) => {
    checks++; if (m[k] < low || m[k] > high) fail(i, `note ${k + 1} (${Core.noteName(n)}) outside range ${low}-${high}`, q, s);
    checks++; if (Core.midiOf(n) !== m[k]) fail(i, `note ${k + 1} spelling does not match its pitch`, q, s);
  });
  // extra: double sharps/flats only when no correct spelling without them exists
  if (q.notes.some(n => Math.abs(n.acc) > 1)) {
    checks++;
    const [a, b] = q.intervals.map(id => Core.BY_ID[id]);
    const avoidable = Core.spellingsOf(m[0]).some(st => a.nums.some(na => b.nums.some(nb => {
      const n2 = Core.spellUp(st, na, a.semis), n3 = Core.spellUp(n2, nb, b.semis);
      return Math.abs(n2.acc) <= 1 && Math.abs(n3.acc) <= 1;
    })));
    if (avoidable) fail(i, 'used a double sharp/flat that could have been avoided', q, s);
    doubles++;
  }
}

// Fixed staff checks for guitar notation: E2 sits 3 ledger lines below, E5 on the 3rd ledger line above.
const E2 = { letter: 2, acc: 0, octave: 2 }, E5 = { letter: 2, acc: 0, octave: 5 }, E3 = { letter: 2, acc: 0, octave: 3 };
checks++; if (Core.staffPos(E2) !== -7) failures.push('staff: E2 should be at position -7');
checks++; if (Core.staffPos(E3) !== 0) failures.push('staff: E3 should sit on the bottom line');
checks++; if (Core.staffPos(E5) !== 14) failures.push('staff: E5 should be at position 14');

console.log(`Generated ${N} questions, ran ${checks} checks.`);
console.log(`Questions needing a double sharp/flat (unavoidable, all verified): ${doubles}`);
console.log('Intervals asked:', IDS.map(id => `${id}:${counts[id] || 0}`).join('  '));
console.log('Sample questions:');
for (let j = 0; j < 5; j++) {
  const q = Core.generateQuestion({ enabled: IDS, low: 40, high: 76 });
  const n = q.notes.map(Core.noteName);
  console.log(`  ${n[0]} → ${n[1]} = ${q.intervals[0]},  ${n[1]} → ${n[2]} = ${q.intervals[1]}`);
}
if (failures.length) {
  console.log(`\nFAILED: ${failures.length} problem(s)`);
  failures.slice(0, 20).forEach(f => console.log('  ' + f));
  process.exit(1);
}
console.log('\nPASSED: every label matches its semitone distance, both intervals go up, and every note is in range.');
