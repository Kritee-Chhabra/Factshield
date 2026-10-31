// Run with: npm test  (uses Node's built-in test runner — no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeLocally, normalizeLlmReport, splitIntoClaims } from './localAnalyzer.js'

// Shared with tests/test_analyzer.py so the browser and Python engines cannot drift apart.
const cases = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/engine_parity.json', import.meta.url), 'utf8'),
)

for (const [i, { text, expected }] of cases.entries()) {
  test(`parity with Python engine: case ${i + 1}`, () => {
    const report = analyzeLocally(text)
    const claims = report.claims.map(({ claim_text, status, confidence, flags, dimensions }) => ({
      claim_text, status, confidence, flags, dimensions,
    }))
    assert.deepEqual(claims, expected.claims)
    assert.deepEqual(report.scores, expected.scores)
  })
}

test('detects percentages and currency followed by spaces', () => {
  const report = analyzeLocally('Over 50% of users lost $840 billion last year.')
  assert.ok(report.claims[0].flags.includes('unverified_stat'))
})

test('pronoun "who" is not treated as a WHO citation', () => {
  const report = analyzeLocally('People who exercise sleep better.')
  assert.ok(!report.claims[0].reason.includes('citation'))
  assert.equal(report.claims[0].confidence, 0.85) // no +0.15 citation boost
})

test('empty input returns null', () => {
  assert.equal(analyzeLocally('   '), null)
})

test('splitIntoClaims strips bullets and splits sentences', () => {
  assert.deepEqual(splitIntoClaims('- One. Two!\n3) Three'), ['One.', 'Two!', 'Three'])
})

test('normalizeLlmReport coerces loose LLM output', () => {
  const report = normalizeLlmReport(
    {
      overall_trust_score: 0.62,
      claims: [
        { claim_text: 'A', status: 'flagged', confidence: 40, flags: ['bias', 'bogus', 'bias'] },
        { claim_text: 'B', status: 'weird', confidence: 'n/a' },
        { claim_text: '  ' },
      ],
      metrics: { emotional_manipulation_score: 150, bias_count: 1 },
    },
    { name: 'Sarvam AI', model: 'm', credits_used: true },
  )
  const [a, b] = report.claims
  assert.deepEqual([a.status, a.confidence, a.flags], ['Flagged', 0.4, ['bias']])
  assert.deepEqual([b.status, b.confidence], ['Unverified', 0.5])
  assert.equal(report.overall_trust_score, 62)
  assert.equal(report.scores.emotional, 100)
  assert.equal(report.metrics.total_claims, 2)
})

test('normalizeLlmReport rejects reports without claims', () => {
  assert.throws(() => normalizeLlmReport({ claims: [] }, {}))
})
