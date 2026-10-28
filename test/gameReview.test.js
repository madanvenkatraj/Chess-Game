// test/gameReview.test.js — Smart Game Review classification tests.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../client/chess-core.js');
const GR = require('../client/src/ui/game-review.js');

// Scholar's mate: 1.e4 e5 2.Bc4 Bc5 3.Qh5 Nf6?? 4.Qxf7#
const METAS = [
  { from: { r: 6, c: 4 }, to: { r: 4, c: 4 } }, // e4
  { from: { r: 1, c: 4 }, to: { r: 3, c: 4 } }, // e5
  { from: { r: 7, c: 5 }, to: { r: 4, c: 2 } }, // Bc4
  { from: { r: 0, c: 5 }, to: { r: 3, c: 2 } }, // Bc5
  { from: { r: 7, c: 3 }, to: { r: 4, c: 7 } }, // Qh5
  { from: { r: 0, c: 6 }, to: { r: 2, c: 5 } }, // Nf6??
  { from: { r: 4, c: 7 }, to: { r: 1, c: 5 } }  // Qxf7#
];
const SANS = ['e4', 'e5', 'Bc4', 'Bc5', 'Qh5', 'Nf6', 'Qxf7#'];

test('flags the losing move (Nf6) as a missed opportunity with an alternative', () => {
  const res = GR.reviewGame({ moves: SANS, moveMeta: METAS }, C);
  const nf6 = res.entries[5];
  assert.strictEqual(nf6.cls, 'missed');
  assert.ok(nf6.alternative, 'alternative move should be provided');
  assert.ok(nf6.explanation.length > 10);
});

test('checkmate delivery classifies as excellent with a mate explanation', () => {
  const res = GR.reviewGame({ moves: SANS, moveMeta: METAS }, C);
  const mate = res.entries[6];
  assert.strictEqual(mate.cls, 'excellent');
  assert.strictEqual(mate.mate, true);
  assert.match(mate.explanation, /Checkmate/);
});

test('opening moves classify as excellent', () => {
  const res = GR.reviewGame({ moves: SANS, moveMeta: METAS }, C);
  for (let i = 0; i < 5; i++) assert.strictEqual(res.entries[i].cls, 'excellent');
});

test('summary counts add up and accuracy is 0-100', () => {
  const res = GR.reviewGame({ moves: SANS, moveMeta: METAS }, C);
  const s = res.summary;
  const total = s.excellent + s.good + s.mistake + s.blunder + s.missed;
  assert.strictEqual(total, SANS.length);
  assert.ok(s.accuracy >= 0 && s.accuracy <= 100);
});

test('empty game returns empty entries and 100% accuracy', () => {
  const res = GR.reviewGame({ moves: [], moveMeta: [] }, C);
  assert.strictEqual(res.entries.length, 0);
  assert.strictEqual(res.summary.accuracy, 100);
});
