/**
 * frontend/src/services/localAnalyzer.js
 *
 * Client-side analyzer engine for FactShield.
 * Lets FactShield work on static hosts (GitHub Pages, Vercel, Netlify)
 * without a backend, and handles direct browser-to-Sarvam-AI requests.
 *
 * Mirrors services/analyzer.py — keep lexicons, patterns and scoring in sync.
 */

// ── Lexicons ─────────────────────────────────────────────────────────────────

const ABSOLUTE_TERMS = [
  'always', 'never', 'definitely', 'undoubtedly', 'proven', 'guaranteed',
  'impossible', 'unquestionably', 'indisputable', 'certainly', '100%',
  'unconditionally', 'infallible', 'undeniable', 'absolute', 'completely',
  'without doubt', 'everyone knows', "it's obvious", 'of course',
]

const HALLUCINATION_PHRASES = [
  'experts agree', 'everyone knows', 'studies show', 'research proves',
  'scientists have found', 'widely known', 'without doubt', 'it is obvious',
  'conclusively proven', 'unanimously accepted', 'it is common knowledge',
]

const EMOTIONAL_TERMS = [
  'shocking', 'devastating', 'miracle', 'catastrophic', 'terrifying',
  'horrific', 'unbelievable', 'nightmare', 'disastrous', 'apocalyptic',
  'mind-blowing', 'jaw-dropping', 'sensational', 'panic', 'agony',
  'ruin', 'destroy', 'horrifying', 'frightening', 'deadly',
]

const BIAS_TERMS = [
  'obviously', 'clearly', 'naturally', 'as expected', 'of course',
  'needless to say', 'undeniably', 'plainly', 'predictably', 'unquestionably',
  'patently', 'morally superior', 'corrupt', 'malicious', 'evil',
]

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word / multi-word / hyphenated phrase matcher (hyphens are word chars). */
function termRegex(terms) {
  const alternation = [...terms].sort((a, b) => b.length - a.length).map(escapeRegex).join('|')
  return new RegExp(`(?<![\\w-])(?:${alternation})(?![\\w-])`, 'gi')
}

const ABSOLUTE_REGEX = termRegex(ABSOLUTE_TERMS)
const HALLUCINATION_REGEX = termRegex(HALLUCINATION_PHRASES)
const EMOTIONAL_REGEX = termRegex(EMOTIONAL_TERMS)
const BIAS_REGEX = termRegex(BIAS_TERMS)

// Percentages, currency amounts and counted quantities.
const STAT_REGEX = /(?<![\w.])\d+(?:[.,]\d+)*\s?%|[$€£₹]\s?\d+(?:[.,]\d+)*(?:\s*(?:k|m|bn|billion|million|trillion|crore|lakh)\b)?|\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:percent|per cent|times|fold|people|users|patients|cases|deaths|billion|million|trillion)\b/i
const CITE_PHRASE_REGEX = /(?<!\w)(?:according to|published in|cited by|reported by|peer-reviewed|journal of|the lancet|lancet|reuters|associated press|world bank|world health organi[sz]ation|international energy agency|centers for disease control|stanford|harvard|oxford|university of|et al\.)(?!\w)/i
// Case-sensitive: these collide with ordinary words when lowercased ("who", "nature").
const CITE_ACRONYM_REGEX = /\b(?:WHO|CDC|NASA|IEA|BBC|NIH|MIT|Nature)\b/
const POS_FACT_REGEX = /\b(?:confirmed|verified|documented|corroborated|authenticated|peer-reviewed|official data|established by|substantiated)\b/i
const NEG_FACT_REGEX = /\b(?:false|incorrect|debunked|misleading|inaccurate|disputed|disproven|unfounded|myth|hoax|conspiracy|rumor)\b/i

const VALID_STATUSES = ['Verified', 'Unverified', 'Flagged']
const VALID_FLAGS = ['hallucination', 'bias', 'emotional', 'unverified_stat', 'fact_verified', 'fact_debunked']

const distinctMatches = (regex, text) => new Set([...text.matchAll(regex)].map(m => m[0].toLowerCase())).size
const hasMatch = (regex, text) => distinctMatches(regex, text) > 0
const hasCitation = text => CITE_PHRASE_REGEX.test(text) || CITE_ACRONYM_REGEX.test(text)
const round1 = n => Math.round(n * 10) / 10
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// ── Claim splitting ──────────────────────────────────────────────────────────

export function splitIntoClaims(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean)

  const claims = []
  for (const line of lines) {
    const cleaned = line.replace(/^[*•\-–—>\s]+/, '').replace(/^\d+[.)]\s*/, '').trim()
    if (!cleaned) continue

    const parts = cleaned
      .split(/(?<=[.?!…])\s+(?=[A-Z0-9"'“‘ऄ-ॿ])/)
      .map(p => p.trim())
      .filter(Boolean)
    claims.push(...parts)
  }

  if (claims.length === 0 && text.trim()) claims.push(text.trim())
  return claims
}

// ── Per-claim classification ─────────────────────────────────────────────────

function dimensionsFor(status, flags, hasStat = false, hasCite = false) {
  let factCheck = 'unverified'
  if (flags.includes('fact_debunked')) factCheck = 'debunked'
  else if (flags.includes('fact_verified') || status === 'Verified') factCheck = 'verified'

  let statistics = 'clean'
  if (flags.includes('unverified_stat')) statistics = 'unverified'
  else if (hasStat && hasCite) statistics = 'cited'

  return {
    fact_check: factCheck,
    hallucination: flags.includes('hallucination') || status === 'Flagged' ? 'flagged' : 'clean',
    bias: flags.includes('bias') ? 'flagged' : 'clean',
    emotional: flags.includes('emotional') ? 'flagged' : 'clean',
    statistics,
  }
}

function classifyClaim(claim, id) {
  const flags = []
  const reasons = []

  const hasCite = hasCitation(claim)
  const hasAbs = hasMatch(ABSOLUTE_REGEX, claim)
  const hasHallu = hasMatch(HALLUCINATION_REGEX, claim) && !hasCite
  const hasStat = STAT_REGEX.test(claim)
  const emoCount = distinctMatches(EMOTIONAL_REGEX, claim)
  const biasCount = distinctMatches(BIAS_REGEX, claim)
  const hasNeg = NEG_FACT_REGEX.test(claim)
  const hasPos = !hasNeg && (POS_FACT_REGEX.test(claim) || hasCite)

  // Confidence (identical weights to the Python engine)
  let confidence = 0.85
  if (hasAbs) confidence -= 0.3
  if (emoCount) confidence -= 0.1 * Math.min(emoCount, 3)
  if (biasCount) confidence -= 0.08 * Math.min(biasCount, 3)
  if (hasStat && !hasCite) confidence -= 0.2
  if (hasHallu) confidence -= 0.25
  if (hasNeg) confidence -= 0.4
  if (hasCite) confidence += 0.15
  if (POS_FACT_REGEX.test(claim)) confidence += 0.1
  confidence = Math.round(clamp(confidence, 0.1, 1) * 100) / 100

  if (hasAbs) {
    flags.push('hallucination')
    reasons.push('Contains absolute or extreme certainty assertions typical of fabricated text.')
  }
  if (hasHallu) {
    if (!flags.includes('hallucination')) flags.push('hallucination')
    reasons.push("Cites vague authority ('everyone knows', 'studies show') without a named citation.")
  }
  if (hasStat && !hasCite) {
    flags.push('unverified_stat')
    reasons.push('Statistical metrics or percentages presented without a verifiable source.')
  }
  if (emoCount) {
    flags.push('emotional')
    reasons.push(`Uses ${emoCount} emotionally charged or sensationalist trigger word(s).`)
  }
  if (biasCount) {
    flags.push('bias')
    reasons.push(`Contains ${biasCount} bias indicator(s) suggesting one-sided framing.`)
  }
  if (hasNeg) {
    flags.push('fact_debunked')
    reasons.push('Contains language identifying a debunked, disproven, or false assertion.')
  } else if (hasPos) {
    flags.push('fact_verified')
    reasons.push('Includes verified source citation or documented evidence.')
  }

  let status
  if (hasAbs || hasHallu || hasNeg || confidence < 0.45) {
    status = 'Flagged'
    if (flags.length === 0) flags.push('hallucination')
  } else if ((hasStat && !hasCite) || confidence < 0.75) {
    status = 'Unverified'
  } else {
    status = 'Verified'
    if (!flags.includes('fact_verified')) flags.push('fact_verified')
  }

  return {
    claim: {
      id,
      claim_text: claim,
      status,
      confidence,
      reason: reasons.join(' ') || 'Logical assertion supported by standard factual tone.',
      flags,
      dimensions: dimensionsFor(status, flags, hasStat, hasCite),
    },
    emoCount,
    biasCount,
  }
}

// ── Report aggregation (shared by every engine) ─────────────────────────────

function verdictFor(score) {
  if (score >= 75) return 'High trust. The content demonstrates sound factual integrity with minimal risk.'
  if (score >= 45) return 'Moderate trust. Some assertions require independent verification.'
  return 'Low trust. Multiple unverified, biased, or hallucinated claims detected.'
}

export function buildReport(claims, { emotionalTerms, biasTerms, engine, trustOverride = null, emotionalOverride = null, summary = null }) {
  const total = claims.length
  const denom = Math.max(total, 1)
  const count = pred => claims.filter(pred).length

  const verifiedCount = count(c => c.status === 'Verified')
  const unverifiedCount = count(c => c.status === 'Unverified')
  const flaggedCount = count(c => c.status === 'Flagged')
  const hallCount = count(c => c.flags.includes('hallucination'))
  const unverifiedStats = count(c => c.flags.includes('unverified_stat'))
  const debunkedCount = count(c => c.flags.includes('fact_debunked'))

  const factScore = total ? round1(clamp((verifiedCount / denom) * 100 - (debunkedCount / denom) * 40, 0, 100)) : 0
  const hallScore = round1(Math.max(0, 100 - (hallCount / denom) * 100))
  const biasScore = round1(Math.max(0, 100 - (biasTerms / Math.max(total * 2, 1)) * 100))
  const emoScore = emotionalOverride != null
    ? round1(clamp(emotionalOverride, 0, 100))
    : round1(Math.min((emotionalTerms / Math.max(total * 2, 1)) * 100, 100))
  const statScore = round1(Math.max(0, 100 - (unverifiedStats / denom) * 100))

  let trust = 0
  if (trustOverride != null) {
    trust = round1(clamp(trustOverride, 0, 100))
  } else if (total) {
    const avgConf = claims.reduce((s, c) => s + c.confidence, 0) / total
    const composite = avgConf * 0.4 + (factScore / 100) * 0.25 + (hallScore / 100) * 0.2 + (biasScore / 100) * 0.15
    const penalty = (flaggedCount * 0.12 + unverifiedCount * 0.05) / total
    trust = round1(clamp(composite - penalty, 0.05, 1) * 100)
  }

  const finalSummary = summary || (total
    ? `${verdictFor(trust)} Analysed ${total} claim(s): ${verifiedCount} verified, ${unverifiedCount} unverified, ${flaggedCount} flagged.`
    : 'No text provided for analysis. Please enter text to audit.')

  return {
    overall_trust_score: trust,
    summary: finalSummary,
    claims,
    metrics: {
      fact_check: {
        verified_count: verifiedCount,
        debunked_count: debunkedCount,
        neutral_count: Math.max(0, total - verifiedCount - debunkedCount),
        score: factScore,
      },
      hallucination: {
        count: hallCount,
        score: hallScore,
        risk: hallScore < 40 ? 'Severe' : hallScore < 75 ? 'Caution' : 'Clean',
      },
      bias: {
        detected: biasTerms > 0,
        count: biasTerms,
        score: biasScore,
        level: biasScore < 50 ? 'Heavily Biased' : biasScore < 85 ? 'Slightly Slanted' : 'Neutral',
      },
      emotional: {
        score: emoScore,
        count: emotionalTerms,
        intensity: emoScore > 50 ? 'High Manipulation' : emoScore > 20 ? 'Moderate Urgency' : 'Calm / Objective',
      },
      statistics: {
        unverified_count: unverifiedStats,
        score: statScore,
        status: unverifiedStats > 0 ? 'Unverified Statistics' : 'All Cited',
      },
      total_claims: total,
    },
    scores: {
      trust,
      fact_checking: factScore,
      hallucination: hallScore,
      bias: biasScore,
      emotional: emoScore,
      statistics: statScore,
    },
    engine,
  }
}

export function analyzeLocally(text) {
  const stripped = text ? text.trim() : ''
  if (!stripped) return null

  let emotionalTerms = 0
  let biasTerms = 0
  const claims = splitIntoClaims(stripped).map((c, idx) => {
    const { claim, emoCount, biasCount } = classifyClaim(c, idx + 1)
    emotionalTerms += emoCount
    biasTerms += biasCount
    return claim
  })

  return buildReport(claims, {
    emotionalTerms,
    biasTerms,
    engine: { name: 'Client Heuristic Engine', model: 'browser-local', credits_used: false },
  })
}

// ── LLM response normalisation ───────────────────────────────────────────────

const toNumber = v => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Coerce a loosely-structured LLM audit into the canonical report shape.
 * Throws if it has no usable claims.
 */
export function normalizeLlmReport(raw, engine) {
  if (!raw || !Array.isArray(raw.claims)) throw new Error('LLM response has no claims list')

  const claims = []
  for (const item of raw.claims) {
    if (!item || typeof item !== 'object') continue
    const text = String(item.claim_text ?? '').trim()
    if (!text) continue

    const s = String(item.status ?? '').trim()
    const capitalized = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
    const status = VALID_STATUSES.includes(capitalized) ? capitalized : 'Unverified'

    let confidence = toNumber(item.confidence)
    if (confidence == null) confidence = 0.5
    else if (confidence > 1) confidence /= 100
    confidence = Math.round(clamp(confidence, 0, 1) * 100) / 100

    const flags = [...new Set((Array.isArray(item.flags) ? item.flags : [])
      .map(f => String(f).trim().toLowerCase())
      .filter(f => VALID_FLAGS.includes(f)))]

    claims.push({
      id: claims.length + 1,
      claim_text: text,
      status,
      confidence,
      reason: String(item.reason || 'Assessed by language model.'),
      flags,
      dimensions: dimensionsFor(status, flags),
    })
  }
  if (claims.length === 0) throw new Error('LLM response contained no usable claims')

  const metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {}
  const termCount = (key, flag) => {
    const reported = toNumber(metrics[key])
    return reported != null ? Math.max(0, Math.trunc(reported)) : claims.filter(c => c.flags.includes(flag)).length
  }
  let trust = toNumber(raw.overall_trust_score)
  if (trust != null && trust > 0 && trust <= 1) trust *= 100

  return buildReport(claims, {
    emotionalTerms: termCount('emotional_count', 'emotional'),
    biasTerms: termCount('bias_count', 'bias'),
    emotionalOverride: toNumber(metrics.emotional_manipulation_score),
    trustOverride: trust,
    summary: raw.summary ? String(raw.summary) : null,
    engine,
  })
}

// ── Direct Sarvam AI call (static hosting only) ──────────────────────────────

const SARVAM_MODEL = 'sarvam-105b-conversations'

// Keep in sync with SYSTEM_PROMPT in services/sarvam_client.py
const SARVAM_SYSTEM_PROMPT = `You are FactShield, an authoritative AI Hallucination & Bias Auditor.
Analyze the user's text for truthfulness, hallucinations, bias, emotional manipulation, and statistics verification.

You MUST respond ONLY with a single valid JSON object, without markdown formatting or code blocks, strictly adhering to this JSON schema:
{
  "overall_trust_score": <float between 0.0 and 100.0>,
  "summary": "<2-3 sentence executive audit verdict>",
  "claims": [
    {
      "id": <integer starting at 1>,
      "claim_text": "<exact sentence or assertion>",
      "status": "<Verified | Unverified | Flagged>",
      "confidence": <float between 0.0 and 1.0>,
      "reason": "<clear explanation for this assessment>",
      "flags": ["<any of: hallucination, bias, emotional, unverified_stat, fact_verified, fact_debunked>"]
    }
  ],
  "metrics": {
    "fact_check": {
      "verified_count": <integer>,
      "debunked_count": <integer>,
      "neutral_count": <integer>
    },
    "hallucination_count": <integer>,
    "bias_detected": <boolean>,
    "bias_count": <integer>,
    "emotional_manipulation_score": <float between 0.0 and 100.0>,
    "emotional_count": <integer>,
    "unverified_stats_count": <integer>,
    "total_claims": <integer>
  }
}
`

function extractJsonObject(content) {
  let c = content.trim()
  if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(c)
  } catch {
    const start = c.indexOf('{')
    const end = c.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('Sarvam AI reply did not contain JSON')
    return JSON.parse(c.slice(start, end + 1))
  }
}

export async function callSarvamDirect(text, apiKey, { timeoutMs = 45000 } = {}) {
  if (!apiKey) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'api-subscription-key': apiKey,
      },
      body: JSON.stringify({
        model: SARVAM_MODEL,
        messages: [
          { role: 'system', content: SARVAM_SYSTEM_PROMPT },
          { role: 'user', content: `Audit the following text across all 6 checks:\n\n${text}` },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      }),
    })

    if (!response.ok) {
      throw new Error(`Sarvam API Error ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('Unexpected Sarvam AI response format')

    return normalizeLlmReport(extractJsonObject(content), {
      name: 'Sarvam AI',
      model: data.model || SARVAM_MODEL,
      credits_used: true,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
