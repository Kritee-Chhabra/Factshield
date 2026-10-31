/**
 * frontend/src/services/localAnalyzer.js
 *
 * Client-side analyzer engine for FactShield.
 * Ensures FactShield works 100% on the web anywhere,
 * even on static web hosts (GitHub Pages, Vercel, Netlify)
 * without needing an active localhost server.
 * Also handles direct browser-to-Sarvam-AI requests when token is provided.
 */

const ABSOLUTE_WORDS = new Set([
  'always', 'never', 'definitely', 'undoubtedly', 'proven', 'guaranteed',
  'impossible', 'unquestionably', 'indisputable', 'certainly', '100%',
  'unconditionally', 'infallible', 'undeniable', 'absolute', 'completely'
])

const HALLUCINATION_PHRASES = [
  'experts agree', 'everyone knows', 'studies show', 'research proves',
  'scientists have found', 'widely known', 'without doubt', 'it is obvious',
  'conclusively proven', 'unanimously accepted', 'it is common knowledge'
]

const EMOTIONAL_WORDS = new Set([
  'shocking', 'devastating', 'miracle', 'catastrophic', 'terrifying',
  'horrific', 'unbelievable', 'nightmare', 'disastrous', 'apocalyptic',
  'mind-blowing', 'jaw-dropping', 'sensational', 'panic', 'agony',
  'ruin', 'destroy', 'horrifying', 'frightening', 'deadly'
])

const BIAS_WORDS = new Set([
  'obviously', 'clearly', 'naturally', 'as expected', 'of course',
  'needless to say', 'undeniably', 'plainly', 'predictably', 'unquestionably',
  'patently', 'morally superior', 'corrupt', 'malicious', 'evil'
])

const STAT_REGEX = /\b(?:\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion))?|\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:percent|times|fold|people|users|patients|cases))\b/i
const CITE_REGEX = /\b(?:according to|published in|cited by|reported by|peer-reviewed|journal of|nature|lancet|reuters|who|cdc|nasa|iea|associated press|bbc|nih|world bank|stanford|mit|harvard|oxford|university of|et al\.)\b/i
const POS_FACT_REGEX = /\b(?:confirmed|verified|documented|corroborated|authenticated|peer-reviewed|official data|established by|substantiated)\b/i
const NEG_FACT_REGEX = /\b(?:false|incorrect|debunked|misleading|inaccurate|disputed|disproven|unfounded|myth|hoax|conspiracy|rumor)\b/i

function tokenize(text) {
  return new Set(text.toLowerCase().match(/[\w']+/gu) || [])
}

export function splitIntoClaims(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean)

  const claims = []
  for (const line of lines) {
    const cleaned = line.replace(/^[*•\-–—>\s]+/, '').replace(/^\d+[.)]\s*/, '').trim()
    if (!cleaned) continue

    const parts = cleaned.split(/(?<=[.?!…])\s+(?=[A-Z0-9"'“‘\u0900-\u097F])/).map(p => p.trim()).filter(Boolean)
    for (const p of parts) {
      claims.push(p)
    }
  }

  if (claims.length === 0) {
    const st = text.trim()
    if (st) claims.push(st)
  }

  return claims
}

export function analyzeLocally(text) {
  const stripped = text ? text.trim() : ''
  if (!stripped) return null

  const rawClaims = splitIntoClaims(stripped)
  const claims = []
  let totalEmo = 0
  let totalBias = 0
  let hallCount = 0
  let unverifiedStats = 0
  let debunkedCount = 0

  rawClaims.forEach((claim, idx) => {
    const tokens = tokenize(claim)
    const lower = claim.toLowerCase()
    const flags = []
    const reasons = []

    // Hallucination
    const hasAbs = [...tokens].some(t => ABSOLUTE_WORDS.has(t)) || lower.includes('without doubt') || lower.includes('everyone knows')
    const hasHalluPhrase = HALLUCINATION_PHRASES.some(p => lower.includes(p))
    const hasCite = CITE_REGEX.test(claim)
    const hasStat = STAT_REGEX.test(claim)

    if (hasAbs) {
      flags.push('hallucination')
      reasons.push('Contains absolute or extreme certainty assertions typical of fabricated text.')
    }
    if (hasHalluPhrase && !hasCite) {
      if (!flags.includes('hallucination')) flags.push('hallucination')
      reasons.push("Cites vague authority ('everyone knows', 'studies show') without a named citation.")
    }

    // Stats
    if (hasStat && !hasCite) {
      flags.push('unverified_stat')
      reasons.push('Statistical metrics or percentages presented without a verifiable source.')
      unverifiedStats++
    }

    // Emotional
    const emoWords = [...tokens].filter(t => EMOTIONAL_WORDS.has(t))
    if (emoWords.length > 0) {
      flags.push('emotional')
      reasons.push(`Uses ${emoWords.length} emotionally charged or sensationalist trigger word(s).`)
      totalEmo += emoWords.length
    }

    // Bias
    const biasWords = [...tokens].filter(t => BIAS_WORDS.has(t))
    if (biasWords.length > 0) {
      flags.push('bias')
      reasons.push(`Contains ${biasWords.length} bias indicator(s) suggesting one-sided framing.`)
      totalBias += biasWords.length
    }

    // Fact Check
    const hasNeg = NEG_FACT_REGEX.test(claim)
    const hasPos = POS_FACT_REGEX.test(claim) || hasCite

    if (hasNeg) {
      flags.push('fact_debunked')
      reasons.push('Contains language identifying a debunked, disproven, or false assertion.')
      debunkedCount++
    } else if (hasPos) {
      flags.push('fact_verified')
      reasons.push('Includes verified source citation or documented evidence.')
    }

    // Status
    let status = 'Verified'
    let confidence = 0.85
    if (hasAbs) confidence -= 0.3
    if (emoWords.length) confidence -= 0.10 * Math.min(emoWords.length, 3)
    if (biasWords.length) confidence -= 0.08 * Math.min(biasWords.length, 3)
    if (hasStat && !hasCite) confidence -= 0.2
    if (hasHalluPhrase && !hasCite) confidence -= 0.25
    if (hasNeg) confidence -= 0.4
    if (hasPos) confidence += 0.15
    confidence = Math.max(0.1, Math.min(1.0, Math.round(confidence * 100) / 100))

    if (hasAbs || (hasHalluPhrase && !hasCite) || hasNeg || confidence < 0.45) {
      status = 'Flagged'
      if (!flags.includes('hallucination') && !hasNeg) flags.push('hallucination')
    } else if ((hasStat && !hasCite) || confidence < 0.75) {
      status = 'Unverified'
    } else {
      status = 'Verified'
      if (!flags.includes('fact_verified')) flags.push('fact_verified')
    }

    if (flags.includes('hallucination')) hallCount++

    const dimensions = {
      fact_check: hasNeg ? 'debunked' : (hasPos || status === 'Verified') ? 'verified' : 'unverified',
      hallucination: (flags.includes('hallucination') || status === 'Flagged') ? 'flagged' : 'clean',
      bias: flags.includes('bias') ? 'flagged' : 'clean',
      emotional: flags.includes('emotional') ? 'flagged' : 'clean',
      statistics: flags.includes('unverified_stat') ? 'unverified' : (hasStat && hasCite) ? 'cited' : 'clean',
    }

    claims.push({
      id: idx + 1,
      claim_text: claim,
      status,
      confidence,
      reason: reasons.join(' ') || 'Logical assertion supported by standard factual tone.',
      flags,
      dimensions,
    })
  })

  const total = claims.length
  const verifiedCount = claims.filter(c => c.status === 'Verified').length
  const unverifiedCount = claims.filter(c => c.status === 'Unverified').length
  const flaggedCount = claims.filter(c => c.status === 'Flagged').length

  const factScore = Math.max(0, Math.min(100, Math.round((verifiedCount / Math.max(total, 1)) * 100)))
  const hallScore = Math.max(0, Math.min(100, 100 - Math.round((hallCount / Math.max(total, 1)) * 100)))
  const biasScore = Math.max(0, Math.min(100, 100 - Math.round((totalBias / Math.max(total * 2, 1)) * 100)))
  const emoScore = Math.min(100, Math.round((totalEmo / Math.max(total * 2, 1)) * 100))
  const statScore = unverifiedStats === 0 ? 100 : Math.max(0, 100 - Math.round((unverifiedStats / Math.max(total, 1)) * 100))

  const avgConf = claims.reduce((s, c) => s + c.confidence, 0) / Math.max(total, 1)
  const penalty = (flaggedCount * 0.12 + unverifiedCount * 0.05) / Math.max(total, 1)
  const trustScore = Math.max(5, Math.min(100, Math.round(((avgConf * 0.4) + (factScore * 0.25 / 100) + (hallScore * 0.2 / 100) + (biasScore * 0.15 / 100) - penalty) * 100)))

  let verdict = 'Moderate trust. Some assertions require independent verification.'
  if (trustScore >= 75) verdict = 'High trust. The content demonstrates sound factual integrity with minimal risk.'
  else if (trustScore < 45) verdict = 'Low trust. Multiple unverified, biased, or hallucinated claims detected.'

  return {
    overall_trust_score: trustScore,
    summary: `${verdict} Analysed ${total} claim(s): ${verifiedCount} verified, ${unverifiedCount} unverified, ${flaggedCount} flagged.`,
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
        detected: totalBias > 0,
        count: totalBias,
        score: biasScore,
        level: biasScore < 50 ? 'Heavily Biased' : biasScore < 85 ? 'Slightly Slanted' : 'Neutral',
      },
      emotional: {
        score: emoScore,
        count: totalEmo,
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
      trust: trustScore,
      fact_checking: factScore,
      hallucination: hallScore,
      bias: biasScore,
      emotional: emoScore,
      statistics: statScore,
    },
    engine: {
      name: 'Client Heuristic Engine',
      model: 'browser-local',
      credits_used: false,
    },
  }
}

export async function callSarvamDirect(text, apiKey) {
  if (!apiKey) return null

  const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'api-subscription-key': apiKey,
    },
    body: JSON.stringify({
      model: 'sarvam-105b',
      messages: [
        {
          role: 'system',
          content: 'You are FactShield, an authoritative AI Hallucination & Bias Auditor. Analyze the user\'s text for truthfulness, hallucinations, bias, emotional manipulation, and statistics verification. Respond strictly in valid JSON matching FactShield schema.',
        },
        {
          role: 'user',
          content: `Audit the following text across all 6 checks:\n\n${text}`,
        },
      ],
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    throw new Error(`Sarvam API Error ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()
  let content = data.choices[0].message.content.trim()
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }

  const parsed = JSON.parse(content)
  parsed.engine = {
    name: 'Sarvam AI',
    model: 'sarvam-105b',
    credits_used: true,
  }
  return parsed
}
