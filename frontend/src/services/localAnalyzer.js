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
  return new Set((text.toLowerCase().match(/[a-z']+/g) || []))
}

export function analyzeLocally(text) {
  const stripped = text.trim()
  if (!stripped) return null

  const rawClaims = stripped.split(/(?<=[.?!])\s+/).filter(c => c.trim())
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
      reasons.push('Contains absolute language typical of fabricated text.')
    }
    if (hasHalluPhrase && !hasCite) {
      if (!flags.includes('hallucination')) flags.push('hallucination')
      reasons.push('Cites vague authority without a verifiable citation.')
    }

    // Stats
    if (hasStat && !hasCite) {
      flags.push('unverified_stat')
      reasons.push('Statistical metric without a verifiable source citation.')
      unverifiedStats++
    }

    // Emotional
    const emoWords = [...tokens].filter(t => EMOTIONAL_WORDS.has(t))
    if (emoWords.length > 0) {
      flags.push('emotional')
      reasons.push(`Uses ${emoWords.length} emotional trigger word(s).`)
      totalEmo += emoWords.length
    }

    // Bias
    const biasWords = [...tokens].filter(t => BIAS_WORDS.has(t))
    if (biasWords.length > 0) {
      flags.push('bias')
      reasons.push(`Contains ${biasWords.length} one-sided framing indicator(s).`)
      totalBias += biasWords.length
    }

    // Fact Check
    const hasNeg = NEG_FACT_REGEX.test(claim)
    const hasPos = POS_FACT_REGEX.test(claim) || hasCite

    if (hasNeg) {
      flags.push('fact_debunked')
      reasons.push('Language indicates a debunked or false claim.')
      debunkedCount++
    } else if (hasPos) {
      flags.push('fact_verified')
      reasons.push('Includes credible citation or verified language.')
    }

    // Status
    let status = 'Verified'
    let confidence = 0.85
    if (hasAbs) confidence -= 0.3
    if (emoWords.length) confidence -= 0.15
    if (biasWords.length) confidence -= 0.12
    if (hasStat && !hasCite) confidence -= 0.2
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

    claims.push({
      id: idx + 1,
      claim_text: claim,
      status,
      confidence,
      reason: reasons.join(' ') || 'Standard factual assertion with consistent logical flow.',
      flags,
    })
  })

  const total = claims.length
  const verifiedCount = claims.filter(c => c.status === 'Verified').length
  const unverifiedCount = claims.filter(c => c.status === 'Unverified').length
  const flaggedCount = claims.filter(c => c.status === 'Flagged').length

  const factScore = Math.max(0, Math.min(100, Math.round((verifiedCount / total) * 100)))
  const hallScore = Math.max(0, Math.min(100, 100 - Math.round((hallCount / total) * 100)))
  const biasScore = Math.max(0, Math.min(100, 100 - Math.round((totalBias / Math.max(total * 2, 1)) * 100)))
  const emoScore = Math.min(100, Math.round((totalEmo / Math.max(total * 2, 1)) * 100))
  const statScore = unverifiedStats === 0 ? 100 : Math.max(0, 100 - Math.round((unverifiedStats / total) * 100))

  const avgConf = claims.reduce((s, c) => s + c.confidence, 0) / total
  const penalty = (flaggedCount * 0.12 + unverifiedCount * 0.05) / total
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
      name: 'Client-Side Web Engine',
      model: 'browser',
      credits_used: false,
    },
  }
}

/**
 * Call Sarvam AI directly from the browser if user provides token
 */
export async function callSarvamDirect(text, apiKey) {
  const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'api-subscription-key': apiKey,
    },
    body: JSON.stringify({
      model: 'sarvam-105b',
      messages: [
        {
          role: 'system',
          content: `You are FactShield, an authoritative AI Hallucination & Bias Auditor.
Analyze the user's text for truthfulness, hallucinations, bias, emotional manipulation, and statistics verification.
Respond ONLY with a valid JSON object matching this schema:
{
  "overall_trust_score": float (0-100),
  "summary": string,
  "claims": [{"id": int, "claim_text": string, "status": "Verified"|"Unverified"|"Flagged", "confidence": float, "reason": string, "flags": ["hallucination"|"bias"|"emotional"|"unverified_stat"|"fact_verified"|"fact_debunked"]}],
  "metrics": {
    "fact_check": {"verified_count": int, "debunked_count": int, "neutral_count": int, "score": float},
    "hallucination": {"count": int, "score": float, "risk": string},
    "bias": {"detected": bool, "count": int, "score": float, "level": string},
    "emotional": {"score": float, "count": int, "intensity": string},
    "statistics": {"unverified_count": int, "score": float, "status": string},
    "total_claims": int
  },
  "scores": {
    "trust": float,
    "fact_checking": float,
    "hallucination": float,
    "bias": float,
    "emotional": float,
    "statistics": float
  }
}`
        },
        {
          role: 'user',
          content: `Audit this text across all 6 checks:\n\n${text}`
        }
      ],
      temperature: 0.1
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Sarvam AI responded with HTTP ${res.status}`)
  }

  const data = await res.json()
  let content = data.choices[0].message.content.trim()
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  const parsed = JSON.parse(content)
  parsed.engine = {
    name: 'Sarvam AI (sarvam-105b)',
    model: 'sarvam-105b',
    credits_used: true
  }
  return parsed
}
