import { useState, useRef } from 'react'
import { analyzeLocally, callSarvamDirect } from './services/localAnalyzer'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const MAX_CHARS = 5000

// ── Curated Sample Test Cases for the 6 Audit Features ────────────────────────
const AUDIT_FEATURES = [
  {
    id: 'fact_check',
    name: 'Fact Checking',
    icon: '🔎',
    tag: 'Citations & Verification',
    sample:
      'According to the World Health Organization, regular physical activity reduces the risk of cardiovascular disease. However, viral internet posts claim that drinking boiled garlic water instantly cures all respiratory viral infections, which has been debunked as false by medical institutions.',
    desc: 'Verifies claims and citations against established domain sources and flags debunked misinformation.',
  },
  {
    id: 'hallucination',
    name: 'Hallucination Detection',
    icon: '🧠',
    tag: 'Fabrications & Absolutes',
    sample:
      'Scientists have always known with 100% certainty that every human brain will be connected to neural supercomputers before 2026. Everyone knows that this breakthrough is guaranteed to cure all human mortality without doubt.',
    desc: 'Detects fabricated assertions, absolute claims, and vague authority statements.',
  },
  {
    id: 'bias',
    name: 'Bias Detection',
    icon: '⚖️',
    tag: 'One-Sided Framing',
    sample:
      'Clearly, open-source technology is morally superior in every single aspect, whereas proprietary companies are universally corrupt, predatory, and completely malicious toward human civilization.',
    desc: 'Identifies slanted viewpoints, loaded adjectives, and heavily biased framing.',
  },
  {
    id: 'emotional',
    name: 'Emotional Manipulation',
    icon: '🎭',
    tag: 'Psychological Influence',
    sample:
      'You must panic immediately before terrifying disasters and horrifying conspiracies destroy your family and plunge everyone into devastating agony forever!',
    desc: 'Highlights sensationalist, alarming, or fear-inducing psychological triggers.',
  },
  {
    id: 'unverified_stat',
    name: 'Statistics Verification',
    icon: '📊',
    tag: 'Unbacked Numbers',
    sample:
      'Over 96.8% of modern artificial intelligence outputs are proven to lose $840 billion in enterprise value, and 78% of remote workers suffer catastrophic memory loss.',
    desc: 'Flags numerical metrics and percentages presented without credible source citations.',
  },
  {
    id: 'trust_score',
    name: 'Trust Score',
    icon: '🛡️',
    tag: 'Overall Holistic Credibility',
    sample:
      'According to peer-reviewed research published in Nature, solar photovoltaic efficiency improved by 12.4% between 2018 and 2024. The International Energy Agency notes that renewable adoption grew steadily across 35 countries.',
    desc: 'Generates a holistic trust percentage synthesized from all multi-dimensional audit checks.',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getVerdictInfo(score) {
  if (score >= 75) {
    return { label: 'High Trust', icon: '🛡️', cls: 'verdict-high', desc: 'Sound factual integrity with minimal risk flags.' }
  }
  if (score >= 45) {
    return { label: 'Moderate Trust', icon: '⚠️', cls: 'verdict-med', desc: 'Some claims require independent verification.' }
  }
  return { label: 'Low Trust', icon: '🚨', cls: 'verdict-low', desc: 'Multiple unverified, biased, or hallucinated claims detected.' }
}

function getRingColor(score, inverted = false) {
  const s = inverted ? 100 - score : score
  if (s >= 75) return 'var(--verified)'
  if (s >= 45) return 'var(--unverified)'
  return 'var(--flagged)'
}

const FLAG_CONFIG = {
  hallucination:   { label: '🧠 Hallucination', cls: 'flag-hallucination' },
  emotional:       { label: '🎭 Emotional Manipulation', cls: 'flag-emotional' },
  bias:            { label: '⚖️ Biased Framing', cls: 'flag-bias' },
  unverified_stat: { label: '📊 Unverified Stat', cls: 'flag-stat' },
  fact_verified:   { label: '✅ Fact Verified', cls: 'flag-verified' },
  fact_debunked:   { label: '❌ Fact Debunked', cls: 'flag-debunked' },
}

// ── Score Ring Component ───────────────────────────────────────────────────────

function ScoreRing({ score, label = 'Score', inverted = false, size = 156 }) {
  const R = size * 0.41
  const C = 2 * Math.PI * R
  const offset = C - (Math.min(100, Math.max(0, score)) / 100) * C
  const color = getRingColor(score, inverted)

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="track" cx={size / 2} cy={size / 2} r={R} />
        <circle
          className="fill"
          cx={size / 2}
          cy={size / 2}
          r={R}
          stroke={color}
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-center">
        <span className="score-num" style={{ color }}>{Math.round(score)}%</span>
        <span className="score-unit">{label}</span>
      </div>
    </div>
  )
}

// ── Claim Row Component ────────────────────────────────────────────────────────

function ClaimRow({ claim, index, activeTab }) {
  const sk = claim.status.toLowerCase()
  const dim = claim.dimensions || {}

  // Determine dimension-specific badge for the current view
  let dimBadge = null
  if (activeTab === 'bias') {
    dimBadge = dim.bias === 'flagged' || claim.flags?.includes('bias')
      ? { label: '⚖️ Biased Framing', cls: 'flag-bias' }
      : { label: '✓ Objective Framing', cls: 'flag-verified' }
  } else if (activeTab === 'emotional') {
    dimBadge = dim.emotional === 'flagged' || claim.flags?.includes('emotional')
      ? { label: '🎭 Emotional Trigger', cls: 'flag-emotional' }
      : { label: '✓ Calm & Rational', cls: 'flag-verified' }
  } else if (activeTab === 'hallucination') {
    dimBadge = dim.hallucination === 'flagged' || claim.flags?.includes('hallucination')
      ? { label: '🧠 Hallucination / Absolute', cls: 'flag-hallucination' }
      : { label: '✓ Clean Assertion', cls: 'flag-verified' }
  } else if (activeTab === 'unverified_stat') {
    dimBadge = dim.statistics === 'unverified' || claim.flags?.includes('unverified_stat')
      ? { label: '📊 Unverified Stat', cls: 'flag-stat' }
      : dim.statistics === 'cited'
      ? { label: '✓ Verified Citation Data', cls: 'flag-verified' }
      : { label: '✓ Clean (No Phantom Stats)', cls: 'flag-verified' }
  } else if (activeTab === 'fact_check') {
    dimBadge = dim.fact_check === 'debunked' || claim.flags?.includes('fact_debunked')
      ? { label: '❌ Fact Debunked / False', cls: 'flag-debunked' }
      : dim.fact_check === 'verified' || claim.flags?.includes('fact_verified')
      ? { label: '✓ Verified / Documented', cls: 'flag-verified' }
      : { label: '⚡ Factual Baseline', cls: 'flag-default' }
  }

  return (
    <div
      className={`claim-row ${sk}`}
      style={{ animationDelay: `${index * 0.04}s` }}
      role="listitem"
    >
      <div className="claim-head">
        <span className="cnum">#{claim.id}</span>
        <p className="ctext">{claim.claim_text}</p>
        <span className={`cstatus ${sk}`}>
          {claim.status === 'Verified' && '✓ '}
          {claim.status === 'Unverified' && '⚡ '}
          {claim.status === 'Flagged' && '✕ '}
          {claim.status}
        </span>
      </div>

      <div className="claim-foot">
        <p className="creason">
          <span className="reason-label">Evaluation:</span> {claim.reason}
        </p>

        <div className="cflags">
          {dimBadge && (
            <span className={`cflag ${dimBadge.cls}`} title="Dimension check result">
              {dimBadge.label}
            </span>
          )}

          {claim.flags && claim.flags.length > 0 && claim.flags.map(f => {
            const cfg = FLAG_CONFIG[f] || { label: f, cls: 'flag-default' }
            return (
              <span key={f} className={`cflag ${cfg.cls}`}>
                {cfg.label}
              </span>
            )
          })}
        </div>

        <div className="conf-pill">
          <span>Confidence:</span>
          <strong>{Math.round(claim.confidence * 100)}%</strong>
        </div>
      </div>
    </div>
  )
}

// ── Main App Component ────────────────────────────────────────────────────────

export default function App() {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('trust_score')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sampleNotice, setSampleNotice] = useState(null)

  // Sarvam AI Token State
  const [sarvamToken, setSarvamToken] = useState(() => localStorage.getItem('factshield_sarvam_token') || '')
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false)
  const [tempToken, setTempToken] = useState('')

  const resultRef = useRef(null)
  const claimsRef = useRef(null)

  const charLen = text.length
  const charClass = charLen > MAX_CHARS ? 'over' : charLen > MAX_CHARS * 0.8 ? 'warn' : ''

  // Sync token to localStorage
  const saveSarvamToken = (token) => {
    const trimmed = token.trim()
    setSarvamToken(trimmed)
    if (trimmed) {
      localStorage.setItem('factshield_sarvam_token', trimmed)
    } else {
      localStorage.removeItem('factshield_sarvam_token')
    }
    setIsTokenModalOpen(false)
  }

  // ── Core Multi-Tier Truth Auditor
  async function executeAnalysis(inputPayload, specificFeature = null) {
    const textToRun = inputPayload ?? text
    if (!textToRun.trim() || loading) return

    setLoading(true)
    setError(null)

    try {
      let data = null

      // Tier 1: If user provided Sarvam AI token, attempt direct Sarvam AI call or backend with token
      if (sarvamToken) {
        try {
          data = await callSarvamDirect(textToRun, sarvamToken)
        } catch (sarvamErr) {
          console.warn('Direct Sarvam call failed, trying backend...', sarvamErr)
        }
      }

      // Tier 2: Try Backend API (/analyze)
      if (!data) {
        const isStaticHost = window.location.hostname.endsWith('github.io') && !API_BASE
        if (!isStaticHost) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            const res = await fetch(`${API_BASE}/analyze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                text: textToRun,
                sarvam_api_key: sarvamToken || undefined
              }),
            })
            clearTimeout(timeoutId)

            if (res.ok) {
              data = await res.json()
            }
          } catch (apiErr) {
            console.warn('Backend server not reachable on localhost/remote. Using resilient client-side web engine.', apiErr)
          }
        }
      }

      // Tier 3: Resilient Client-Side Fallback (guarantees web app NEVER fails on web/localhost)
      if (!data) {
        data = analyzeLocally(textToRun)
      }

      setResult(data)
      setStatusFilter('All')
      if (specificFeature) {
        setActiveTab(specificFeature)
      } else if (!result) {
        setActiveTab('trust_score')
      }

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 120)
    } catch (e) {
      setError(e.message || 'Analysis could not be completed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Handling clicks on the 6 Feature Buttons in the Hero
  function handleFeatureButtonClick(feature) {
    if (result) {
      // If results already exist, switch immediately to that button's dedicated view!
      setActiveTab(feature.id)
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    // If user already typed their OWN text: NEVER overwrite it! Audit their text!
    if (text.trim()) {
      setActiveTab(feature.id)
      executeAnalysis(text, feature.id)
      return
    }

    // If no text yet: load sample and run audit
    loadSample(feature.sample, feature.id, feature.name)
  }

  // ── Load Sample Helper
  function loadSample(sampleText, featureId, featureName) {
    setText(sampleText)
    setActiveTab(featureId)
    setSampleNotice(`Loaded test sample for ${featureName}. Auditing...`)
    executeAnalysis(sampleText, featureId)
  }

  function clearAll() {
    setText('')
    setResult(null)
    setError(null)
    setActiveTab('trust_score')
    setStatusFilter('All')
    setSampleNotice(null)
  }

  // ── Claims and Dimensional Breakdowns
  const allClaims = result?.claims ?? []

  // Check specific issues for the selected tab
  let flaggedInTab = []
  let tabTitle = 'All Claims Breakdown'

  if (activeTab === 'fact_check') {
    tabTitle = 'Fact Checking & Citations'
    flaggedInTab = allClaims.filter(c => c.flags?.includes('fact_debunked') || c.status === 'Flagged')
  } else if (activeTab === 'hallucination') {
    tabTitle = 'Hallucinations & Fabrications'
    flaggedInTab = allClaims.filter(c => c.flags?.includes('hallucination') || c.status === 'Flagged')
  } else if (activeTab === 'bias') {
    tabTitle = 'Biased Framing & Loaded Rhetoric'
    flaggedInTab = allClaims.filter(c => c.flags?.includes('bias'))
  } else if (activeTab === 'emotional') {
    tabTitle = 'Emotional Manipulation Triggers'
    flaggedInTab = allClaims.filter(c => c.flags?.includes('emotional'))
  } else if (activeTab === 'unverified_stat') {
    tabTitle = 'Statistics Verification'
    flaggedInTab = allClaims.filter(c => c.flags?.includes('unverified_stat'))
  }

  // Apply Status Filter across allClaims
  const displayedClaims = statusFilter === 'All'
    ? allClaims
    : allClaims.filter(c => c.status === statusFilter)

  // Scores and Metrics
  const scores = result?.scores || {
    trust: result?.overall_trust_score || 0,
    fact_checking: result?.metrics?.fact_check?.score || (result?.metrics?.fact_check?.verified_count ? Math.round((result.metrics.fact_check.verified_count / Math.max(allClaims.length, 1)) * 100) : 0),
    hallucination: result?.metrics?.hallucination?.score || Math.max(0, 100 - (result?.metrics?.hallucination?.count || result?.metrics?.hallucination_count || 0) * 30),
    bias: result?.metrics?.bias?.score || ((result?.metrics?.bias?.detected || result?.metrics?.bias_detected) ? 40 : 100),
    emotional: result?.metrics?.emotional?.score || result?.metrics?.emotional_manipulation_score || 0,
    statistics: result?.metrics?.statistics?.score || ((result?.metrics?.statistics?.unverified_count || result?.metrics?.unverified_stats_count || 0) > 0 ? 30 : 100),
  }

  const m = result?.metrics
  const vd = result ? getVerdictInfo(result.overall_trust_score) : null

  return (
    <div className="app">
      {/* ── Top Header ── */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🛡️</div>
          <div className="logo-text">
            <span className="logo-name">Fact<span className="logo-highlight">Shield</span></span>
            <span className="logo-sub">AI Truth &amp; Trust Auditor</span>
          </div>
        </div>

        <div className="header-right">
          {/* Sarvam AI Token / Credit Button */}
          <button
            className={`token-btn ${sarvamToken ? 'active' : ''}`}
            onClick={() => {
              setTempToken(sarvamToken)
              setIsTokenModalOpen(true)
            }}
            type="button"
            title="Configure Sarvam AI API Token"
          >
            <span className="token-icon">⚡</span>
            <span>{sarvamToken ? 'Sarvam Credits Active' : 'Connect Sarvam AI'}</span>
          </button>

          <a
            className="nav-btn"
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            title="View Interactive REST API"
          >
            REST API
          </a>

          <div className="system-status">
            <span className="status-indicator" />
            <span>Web Online</span>
          </div>
        </div>
      </header>

      {/* ── Sarvam AI Token Modal ── */}
      {isTokenModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTokenModalOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <span>⚡ Connect Sarvam AI (Credits &amp; Tokens)</span>
              </div>
              <button className="modal-close" onClick={() => setIsTokenModalOpen(false)}>✕</button>
            </div>
            <p className="modal-desc">
              Enter your <strong>Sarvam AI API Key</strong> from <a href="https://dashboard.sarvam.ai" target="_blank" rel="noreferrer">dashboard.sarvam.ai</a> to power FactShield with Sarvam's flagship <strong>sarvam-105b</strong> LLM for deep Indian languages and global truth analysis.
            </p>
            <div className="modal-input-group">
              <label htmlFor="sarvam-input">Sarvam API Key / Subscription Token:</label>
              <input
                id="sarvam-input"
                type="password"
                className="modal-input"
                placeholder="sk_... or api-subscription-key"
                value={tempToken}
                onChange={e => setTempToken(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              {sarvamToken && (
                <button
                  className="btn-danger-outline"
                  onClick={() => saveSarvamToken('')}
                  type="button"
                >
                  Disconnect Token
                </button>
              )}
              <button
                className="btn-primary"
                onClick={() => saveSarvamToken(tempToken)}
                type="button"
              >
                Save &amp; Activate Credits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero Section with 6 Feature Buttons ── */}
      <section className="hero">
        <div className="hero-pill">
          <span className="pill-pulse" />
          <span>Multi-Layer AI Verification Pipeline</span>
        </div>

        <h1 className="hero-title">
          Audit AI Text for <span className="title-gradient">Hallucinations, Bias &amp; Facts</span>
        </h1>

        <p className="hero-desc">
          Paste any text generated by ChatGPT, Gemini, Claude, or written by yourself. FactShield executes six rigorous,
          independent verification algorithms to deliver an actionable Trust Score and granular claim-level breakdown.
        </p>

        {/* ── The 6 Interactive Hero Buttons ── */}
        <div className="feature-buttons-wrapper">
          <div className="feature-action-hint">
            <span>🛡️ 6-Dimension Verification Suite — Click any check to audit your text or inspect its report:</span>
          </div>

          <div className="feature-pills" role="toolbar" aria-label="Audit Features">
            {AUDIT_FEATURES.map(feat => {
              const isSelected = activeTab === feat.id

              return (
                <button
                  key={feat.id}
                  id={`btn-${feat.id}`}
                  className={`fpill ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleFeatureButtonClick(feat)}
                  title={`Run audit or view ${feat.name} report`}
                  type="button"
                >
                  <span className="pill-icon">{feat.icon}</span>
                  <span className="pill-name">{feat.name}</span>
                  {result && (
                    <span className="pill-badge">
                      {feat.id === 'trust_score' && `${scores.trust}%`}
                      {feat.id === 'fact_check' && `${scores.fact_checking}%`}
                      {feat.id === 'hallucination' && `${scores.hallucination}% clean`}
                      {feat.id === 'bias' && `${scores.bias}% neutral`}
                      {feat.id === 'emotional' && `${scores.emotional}% manip.`}
                      {feat.id === 'unverified_stat' && `${scores.statistics}% cited`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Main Work Area ── */}
      <main className="main">
        {/* Sample notification */}
        {sampleNotice && (
          <div className="sample-banner">
            <span>✨ {sampleNotice}</span>
            <button className="sample-banner-close" onClick={() => setSampleNotice(null)}>✕</button>
          </div>
        )}

        {/* Quick Sample Prompts Bar */}
        <div className="sample-prompts-bar">
          <span className="sample-prompts-label">✨ Or test with a sample:</span>
          <div className="sample-chips">
            {AUDIT_FEATURES.map(feat => (
              <button
                key={feat.id}
                className="sample-chip"
                onClick={() => loadSample(feat.sample, feat.id, feat.name)}
                type="button"
                title={`Load sample prompt testing ${feat.name}`}
              >
                <span>{feat.icon}</span>
                <span>{feat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input Panel */}
        <div className="input-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="bar" />
              <span>Input AI Text to Audit (Works for Any Text)</span>
            </div>
            {result?.engine && (
              <span className="engine-badge">
                {result.engine.credits_used ? '⚡ Powered by Sarvam AI (sarvam-105b)' : '🛡️ Engine: Multi-Layer Heuristic'}
              </span>
            )}
          </div>

          <textarea
            id="text-input"
            className="textarea"
            placeholder="Paste text generated by ChatGPT, Gemini, Claude, or write your own custom text here to audit..."
            value={text}
            onChange={e => setText(e.target.value)}
            rows={7}
          />

          <div className="panel-footer">
            <div className={`char-counter ${charClass}`}>
              {charLen.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
            </div>

            <div className="action-row">
              {(text || result) && (
                <button
                  id="clear-btn"
                  className="btn-secondary"
                  onClick={clearAll}
                  type="button"
                >
                  ✕ Clear All
                </button>
              )}

              <button
                id="analyze-btn"
                className="btn-primary"
                onClick={() => executeAnalysis()}
                disabled={loading || !text.trim() || charLen > MAX_CHARS}
                type="button"
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    <span>Auditing Text...</span>
                  </>
                ) : (
                  <>
                    <span>🛡️ Run Truth Audit</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Error Alert Box */}
        {error && (
          <div className="error-alert" role="alert">
            <span className="error-icon">⚠️</span>
            <div className="error-body">
              <strong>Audit Notice</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ── Audit Results Section ── */}
        {result && (
          <div className="results-container" ref={resultRef}>

            {/* ── 6-Button Dedicated Metric Navigation Bar ── */}
            <div className="tab-navigation-bar">
              <div className="tab-nav-label">Select Report View:</div>
              <div className="tab-nav-buttons">
                {AUDIT_FEATURES.map(f => (
                  <button
                    key={f.id}
                    className={`tab-nav-btn ${activeTab === f.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(f.id)}
                    type="button"
                  >
                    <span>{f.icon}</span>
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Dedicated View 1: Overall Trust Score ── */}
            {activeTab === 'trust_score' && (
              <div className="view-card trust-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.trust} label="Trust Score" />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">Comprehensive AI Credibility Audit</span>
                      <div className={`verdict-tag ${vd?.cls || 'verdict-med'}`}>
                        <span>{vd?.icon || '🛡️'}</span>
                        <span>{vd?.label || 'Trust Score'}</span>
                      </div>
                    </div>
                    <p className="summary-paragraph">{result.summary}</p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Total Claims</span>
                        <span className="stat-mini-val">{allClaims.length}</span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Verified</span>
                        <span className="stat-mini-val verified">{allClaims.filter(c => c.status === 'Verified').length}</span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Unverified</span>
                        <span className="stat-mini-val unverified">{allClaims.filter(c => c.status === 'Unverified').length}</span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Flagged / Fabricated</span>
                        <span className="stat-mini-val flagged">{allClaims.filter(c => c.status === 'Flagged').length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dedicated View 2: Fact Checking ── */}
            {activeTab === 'fact_check' && (
              <div className="view-card fact-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.fact_checking} label="Fact Accuracy" />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">🔎 Fact Checking &amp; Source Verification Report</span>
                      <div className={`verdict-tag ${scores.fact_checking >= 75 ? 'verdict-high' : scores.fact_checking >= 45 ? 'verdict-med' : 'verdict-low'}`}>
                        {scores.fact_checking >= 75 ? '✅ High Factual Integrity' : scores.fact_checking >= 45 ? '⚡ Needs Citations' : '❌ Unsubstantiated Facts'}
                      </div>
                    </div>
                    <p className="summary-paragraph">
                      Evaluates assertions against documented evidence, peer-reviewed databases, and authority citations.
                      {m?.fact_check?.debunked_count > 0 && ` Flags ${m.fact_check.debunked_count} debunked assertion(s) requiring immediate retraction.`}
                    </p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Confirmed Facts</span>
                        <span className="stat-mini-val verified">{m?.fact_check?.verified_count ?? allClaims.filter(c => c.status === 'Verified').length}</span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Debunked / False</span>
                        <span className="stat-mini-val flagged">{m?.fact_check?.debunked_count ?? 0}</span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Unsubstantiated</span>
                        <span className="stat-mini-val unverified">{allClaims.filter(c => c.status === 'Unverified').length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dedicated View 3: Hallucination Detection ── */}
            {activeTab === 'hallucination' && (
              <div className="view-card hallucination-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.hallucination} label="Cleanliness" />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">🧠 Hallucination &amp; Fabrication Audit</span>
                      <div className={`verdict-tag ${scores.hallucination >= 80 ? 'verdict-high' : scores.hallucination >= 50 ? 'verdict-med' : 'verdict-low'}`}>
                        {scores.hallucination >= 80 ? '🛡️ Low Hallucination Risk' : scores.hallucination >= 50 ? '⚠️ Moderate Hallucination Risk' : '🚨 Severe Hallucinations'}
                      </div>
                    </div>
                    <p className="summary-paragraph">
                      Scans for common AI generative failure modes: absolute certainty words ("always", "never", "guaranteed"), fabricated consensus ("everyone knows"), and citations of unnamed studies.
                    </p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Hallucinations Flagged</span>
                        <span className={`stat-mini-val ${(m?.hallucination?.count || m?.hallucination_count) > 0 ? 'flagged' : 'verified'}`}>
                          {m?.hallucination?.count ?? m?.hallucination_count ?? 0}
                        </span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Risk Classification</span>
                        <span className="stat-mini-val">{scores.hallucination >= 80 ? 'Clean' : scores.hallucination >= 50 ? 'Caution' : 'Severe'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dedicated View 4: Bias Detection ── */}
            {activeTab === 'bias' && (
              <div className="view-card bias-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.bias} label="Neutrality" />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">⚖️ Bias &amp; Slanted Framing Analysis</span>
                      <div className={`verdict-tag ${scores.bias >= 80 ? 'verdict-high' : 'verdict-med'}`}>
                        {scores.bias >= 80 ? '⚖️ Neutral & Balanced' : '⚠️ Slanted Tone Detected'}
                      </div>
                    </div>
                    <p className="summary-paragraph">
                      Highlights loaded rhetoric, subjective assertions disguised as facts ("obviously", "clearly"), and moralistic or one-sided arguments.
                    </p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Bias Indicators</span>
                        <span className={`stat-mini-val ${(m?.bias?.count || m?.bias_count) > 0 ? 'unverified' : 'verified'}`}>
                          {m?.bias?.count ?? m?.bias_count ?? 0}
                        </span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Framing Balance</span>
                        <span className="stat-mini-val">{scores.bias >= 80 ? 'Objective' : 'One-Sided'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dedicated View 5: Emotional Manipulation ── */}
            {activeTab === 'emotional' && (
              <div className="view-card emotional-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.emotional} label="Manipulation" inverted={true} />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">🎭 Emotional Manipulation &amp; Clickbait Audit</span>
                      <div className={`verdict-tag ${scores.emotional <= 20 ? 'verdict-high' : scores.emotional <= 50 ? 'verdict-med' : 'verdict-low'}`}>
                        {scores.emotional <= 20 ? '🌿 Calm & Rational Tone' : scores.emotional <= 50 ? '⚡ Sensationalist Urgency' : '🚨 High Psychological Manipulation'}
                      </div>
                    </div>
                    <p className="summary-paragraph">
                      Measures fear triggers, panic words, and exaggerated urgency ("shocking", "catastrophic", "agony") intended to bypass rational critical thinking.
                    </p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Trigger Words Found</span>
                        <span className={`stat-mini-val ${(m?.emotional?.count || m?.emotional_count) > 0 ? 'flagged' : 'verified'}`}>
                          {m?.emotional?.count ?? m?.emotional_count ?? 0}
                        </span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Manipulation Index</span>
                        <span className="stat-mini-val">{scores.emotional}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dedicated View 6: Statistics Verification ── */}
            {activeTab === 'unverified_stat' && (
              <div className="view-card stat-view">
                <div className="view-header">
                  <div className="ring-container">
                    <ScoreRing score={scores.statistics} label="Data Backing" />
                  </div>
                  <div className="view-content">
                    <div className="view-eyebrow-row">
                      <span className="view-eyebrow">📊 Numerical &amp; Statistical Verification</span>
                      <div className={`verdict-tag ${scores.statistics >= 80 ? 'verdict-high' : 'verdict-med'}`}>
                        {scores.statistics >= 80 ? '📊 Validated Citations' : '⚠️ Unverified Metrics'}
                      </div>
                    </div>
                    <p className="summary-paragraph">
                      Validates numerical percentages, currency metrics, and sample sizes to prevent hallucinated data and phantom statistics from circulating.
                    </p>
                    <div className="stat-cards-row">
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Uncited Statistics</span>
                        <span className={`stat-mini-val ${(m?.statistics?.unverified_count || m?.unverified_stats_count) > 0 ? 'unverified' : 'verified'}`}>
                          {m?.statistics?.unverified_count ?? m?.unverified_stats_count ?? 0}
                        </span>
                      </div>
                      <div className="stat-mini-card">
                        <span className="stat-mini-label">Citation Status</span>
                        <span className="stat-mini-val">{scores.statistics >= 80 ? 'Verified' : 'Needs Source'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── 6 Feature Quick-Switch Grid ── */}
            <div className="metric-cards-grid">
              <div
                className={`feat-card ${activeTab === 'fact_check' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('fact_check')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">🔎</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Fact Checking</div>
                <div className="feat-val verified">{scores.fact_checking}%</div>
                <div className="feat-desc">{m?.fact_check?.verified_count ?? allClaims.filter(c => c.status === 'Verified').length} confirmed · {m?.fact_check?.debunked_count ?? 0} debunked</div>
              </div>

              <div
                className={`feat-card ${activeTab === 'hallucination' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('hallucination')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">🧠</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Hallucination Detection</div>
                <div className={`feat-val ${(m?.hallucination?.count || m?.hallucination_count) > 0 ? 'flagged' : 'verified'}`}>
                  {m?.hallucination?.count ?? m?.hallucination_count ?? 0}
                </div>
                <div className="feat-desc">{(m?.hallucination?.count || m?.hallucination_count) > 0 ? 'Assertions flagged' : 'No fabrications found'}</div>
              </div>

              <div
                className={`feat-card ${activeTab === 'bias' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('bias')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">⚖️</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Bias Detection</div>
                <div className={`feat-val ${(m?.bias?.count || m?.bias_count) > 0 ? 'unverified' : 'verified'}`}>
                  {m?.bias?.count ?? m?.bias_count ?? 0}
                </div>
                <div className="feat-desc">{(m?.bias?.count || m?.bias_count) > 0 ? 'Slanted phrasing detected' : 'Objective & neutral'}</div>
              </div>

              <div
                className={`feat-card ${activeTab === 'emotional' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('emotional')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">🎭</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Emotional Manipulation</div>
                <div className={`feat-val ${scores.emotional > 30 ? 'flagged' : 'verified'}`}>
                  {scores.emotional}%
                </div>
                <div className="feat-desc">{m?.emotional?.count ?? m?.emotional_count ?? 0} manipulation trigger(s)</div>
              </div>

              <div
                className={`feat-card ${activeTab === 'unverified_stat' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('unverified_stat')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">📊</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Statistics Verification</div>
                <div className={`feat-val ${(m?.statistics?.unverified_count || m?.unverified_stats_count) > 0 ? 'unverified' : 'verified'}`}>
                  {m?.statistics?.unverified_count ?? m?.unverified_stats_count ?? 0}
                </div>
                <div className="feat-desc">{(m?.statistics?.unverified_count || m?.unverified_stats_count) > 0 ? 'Unverified statistics' : 'All numbers substantiated'}</div>
              </div>

              <div
                className={`feat-card ${activeTab === 'trust_score' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('trust_score')}
                role="button"
                tabIndex={0}
              >
                <div className="feat-header">
                  <span className="feat-icon">🛡️</span>
                  <span className="feat-tab-badge">View Report</span>
                </div>
                <div className="feat-name">Overall Trust Score</div>
                <div className="feat-val verified">{scores.trust}%</div>
                <div className="feat-desc">{vd?.label || 'Composite Score'}</div>
              </div>
            </div>

            {/* ── Claims Breakdown for the Selected View ── */}
            <div className="claims-panel" ref={claimsRef}>
              <div className="claims-panel-header">
                <div className="claims-panel-title">
                  <h3>{tabTitle}</h3>
                  <span className="claims-total-badge">
                    {displayedClaims.length} claim(s) analysed
                  </span>
                </div>

                <div className="status-tabs" role="tablist">
                  {['All', 'Verified', 'Unverified', 'Flagged'].map(status => (
                    <button
                      key={status}
                      className={`status-tab ${statusFilter === status ? 'active' : ''}`}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status}
                      <span className="tab-count">
                        {status === 'All' ? allClaims.length : allClaims.filter(c => c.status === status).length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Dimension Success Banner if zero issues detected in this dimension ── */}
              {activeTab === 'bias' && (m?.bias?.count || m?.bias_count || 0) === 0 && (
                <div className="dimension-success-banner">
                  <span className="dim-banner-icon">✨</span>
                  <div className="dim-banner-content">
                    <div className="dim-banner-title">Zero Biased Framing Detected</div>
                    <p className="dim-banner-desc">
                      Every statement in your submitted text maintains an objective, neutral tone with no loaded adjectives or one-sided assertions.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'emotional' && (scores.emotional <= 10) && (
                <div className="dimension-success-banner">
                  <span className="dim-banner-icon">🌿</span>
                  <div className="dim-banner-content">
                    <div className="dim-banner-title">Rational &amp; Calm Phrasing</div>
                    <p className="dim-banner-desc">
                      No psychological triggers, fear-mongering, or urgency traps detected. Your text delivers information calmly and rationally.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'hallucination' && (m?.hallucination?.count || m?.hallucination_count || 0) === 0 && (
                <div className="dimension-success-banner">
                  <span className="dim-banner-icon">🧠</span>
                  <div className="dim-banner-content">
                    <div className="dim-banner-title">Zero Hallucinations or False Absolutes</div>
                    <p className="dim-banner-desc">
                      No extreme certainty language ("always", "never", "guaranteed") or vague authority appeals ("studies prove") were found in your text.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'unverified_stat' && (m?.statistics?.unverified_count || m?.unverified_stats_count || 0) === 0 && (
                <div className="dimension-success-banner">
                  <span className="dim-banner-icon">📊</span>
                  <div className="dim-banner-content">
                    <div className="dim-banner-title">Clean Statistical Integrity</div>
                    <p className="dim-banner-desc">
                      No unsupported percentages, fabricated currency figures, or phantom numbers were detected.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'fact_check' && (m?.fact_check?.debunked_count || 0) === 0 && (
                <div className="dimension-success-banner">
                  <span className="dim-banner-icon">✅</span>
                  <div className="dim-banner-content">
                    <div className="dim-banner-title">Sound Factual Delivery</div>
                    <p className="dim-banner-desc">
                      No debunked viral myths or falsified claims identified in this submission.
                    </p>
                  </div>
                </div>
              )}

              {/* Claims List View */}
              <div className="claims-list-body" role="list">
                {displayedClaims.length === 0 ? (
                  <div className="empty-claims">
                    <span className="empty-icon">🔎</span>
                    <p className="empty-text">
                      No claims found matching the '{statusFilter}' status filter.
                    </p>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => setStatusFilter('All')}
                      type="button"
                    >
                      Show All {allClaims.length} Claims
                    </button>
                  </div>
                ) : (
                  displayedClaims.map((claim, idx) => (
                    <ClaimRow key={claim.id} claim={claim} index={idx} activeTab={activeTab} />
                  ))
                )}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-content">
          <span>FactShield © {new Date().getFullYear()} — Multi-Layer AI Truth &amp; Bias Platform</span>
          <div className="footer-links">
            <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">Interactive API Docs</a>
            <span>•</span>
            <a href={`${API_BASE}/redoc`} target="_blank" rel="noreferrer">ReDoc Specification</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
