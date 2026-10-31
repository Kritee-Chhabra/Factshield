import { useState, useRef } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const MAX_CHARS = 5000

// ── Curated Sample Test Cases for the 6 Audit Features ────────────────────────
const AUDIT_FEATURES = [
  {
    id: 'fact_check',
    name: 'Fact Checking',
    icon: '🔎',
    tag: 'Sources & Citations',
    filterKey: 'fact_check',
    sample:
      'According to the World Health Organization, regular physical activity reduces the risk of cardiovascular disease. However, viral internet posts claim that drinking boiled garlic water instantly cures all respiratory viral infections, which has been debunked as completely false by medical institutions.',
    desc: 'Verifies claims and citations against established facts and flags debunked misinformation.',
  },
  {
    id: 'hallucination',
    name: 'Hallucination Detection',
    icon: '🧠',
    tag: 'Fabrications & Absolutes',
    filterKey: 'hallucination',
    sample:
      'Scientists have always known with 100% certainty that every human brain will be connected to neural supercomputers before 2026. Everyone knows that this breakthrough is guaranteed to cure all human mortality without doubt.',
    desc: 'Detects fabricated assertions, absolute claims, and vague authority statements.',
  },
  {
    id: 'bias',
    name: 'Bias Detection',
    icon: '⚖️',
    tag: 'One-Sided Framing',
    filterKey: 'bias',
    sample:
      'Clearly, open-source technology is morally superior in every single aspect, whereas proprietary companies are universally corrupt, predatory, and completely malicious toward human civilization.',
    desc: 'Identifies slanted viewpoints, loaded adjectives, and heavily biased framing.',
  },
  {
    id: 'emotional',
    name: 'Emotional Manipulation',
    icon: '🎭',
    tag: 'Psychological Influence',
    filterKey: 'emotional',
    sample:
      'You must panic immediately before terrifying disasters and horrifying conspiracies destroy your family and plunge everyone into devastating agony forever!',
    desc: 'Highlights sensationalist, alarming, or fear-inducing psychological triggers.',
  },
  {
    id: 'unverified_stat',
    name: 'Statistics Verification',
    icon: '📊',
    tag: 'Unbacked Numbers',
    filterKey: 'unverified_stat',
    sample:
      'Over 96.8% of modern artificial intelligence outputs are proven to lose $840 billion in enterprise value, and 78% of remote workers suffer catastrophic memory loss.',
    desc: 'Flags numerical metrics and percentages presented without credible source citations.',
  },
  {
    id: 'trust_score',
    name: 'Trust Score',
    icon: '🛡️',
    tag: 'Overall Trust & Summary',
    filterKey: 'all',
    sample:
      'According to peer-reviewed research published in Nature, solar photovoltaic efficiency improved by 12.4% between 2018 and 2024. The International Energy Agency notes that renewable adoption grew steadily across 35 countries.',
    desc: 'Generates a holistic trust percentage based on all multi-dimensional audit checks.',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s >= 75) return 'var(--verified)'
  if (s >= 45) return 'var(--unverified)'
  return 'var(--flagged)'
}

function verdictMeta(s) {
  if (s >= 75) return { icon: '🛡️', text: 'High Trust', cls: 'high' }
  if (s >= 45) return { icon: '⚠️', text: 'Moderate Trust', cls: 'med' }
  return { icon: '🚨', text: 'Low Trust — Flawed / Fabricated', cls: 'low' }
}

function confidenceColor(c) {
  if (c >= 0.7) return 'var(--verified)'
  if (c >= 0.45) return 'var(--unverified)'
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

function ScoreRing({ score }) {
  const R = 64
  const C = 2 * Math.PI * R
  const offset = C - (score / 100) * C
  const color = scoreColor(score)

  return (
    <div className="score-ring">
      <svg width="156" height="156" viewBox="0 0 156 156">
        <circle className="track" cx="78" cy="78" r={R} />
        <circle
          className="fill"
          cx="78"
          cy="78"
          r={R}
          stroke={color}
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-center">
        <span className="score-num" style={{ color }}>{score}</span>
        <span className="score-unit">Trust Score</span>
      </div>
    </div>
  )
}

// ── Feature Metric Card ────────────────────────────────────────────────────────

function FeatureCard({ icon, name, value, desc, colorClass, isActive, onClick }) {
  return (
    <div
      className={`feat-card ${colorClass} ${isActive ? 'is-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      title="Click to filter claims for this check"
    >
      <div className="feat-header">
        <span className="feat-icon">{icon}</span>
        {isActive && <span className="active-tag">Active Filter</span>}
      </div>
      <div className="feat-name">{name}</div>
      <div className="feat-val">{value}</div>
      <div className="feat-desc">{desc}</div>
    </div>
  )
}

// ── Claim Row Component ────────────────────────────────────────────────────────

function ClaimRow({ claim, index }) {
  const sk = claim.status.toLowerCase()
  return (
    <div
      className={`claim-row ${sk}`}
      style={{ animationDelay: `${index * 0.04}s` }}
      role="listitem"
    >
      <div className="claim-head">
        <span className="cnum">Claim #{claim.id}</span>
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
          <span className="reason-icon">Audit Reason:</span> {claim.reason}
        </p>

        {claim.flags && claim.flags.length > 0 && (
          <div className="cflags">
            {claim.flags.map(f => {
              const cfg = FLAG_CONFIG[f] || { label: f, cls: 'flag-default' }
              return (
                <span key={f} className={`cflag ${cfg.cls}`}>
                  {cfg.label}
                </span>
              )
            })}
          </div>
        )}

        <div className="conf-wrap">
          <span className="conf-lbl">{Math.round(claim.confidence * 100)}% confidence</span>
          <div className="conf-track">
            <div
              className="conf-fill"
              style={{
                width: `${claim.confidence * 100}%`,
                background: confidenceColor(claim.confidence),
              }}
            />
          </div>
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
  const [activeFeature, setActiveFeature] = useState(null)
  const [statusFilter, setStatusFilter] = useState('All')
  const [sampleNotice, setSampleNotice] = useState(null)

  const resultRef = useRef(null)
  const claimsRef = useRef(null)

  const charLen = text.length
  const charClass = charLen > MAX_CHARS ? 'over' : charLen > MAX_CHARS * 0.8 ? 'warn' : ''

  // ── Core API Runner
  async function executeAnalysis(inputPayload) {
    const textToRun = inputPayload ?? text
    if (!textToRun.trim() || loading) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToRun }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Server responded with HTTP ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
      setStatusFilter('All')

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (e) {
      setError(e.message || 'Could not connect to FactShield backend. Ensure uvicorn is running on port 8000.')
    } finally {
      setLoading(false)
    }
  }

  // ── Handling clicks on the 6 Feature Buttons in the Hero
  function handleFeatureButtonClick(feature) {
    // If we have an active analysis result, the button acts as an instant feature filter
    if (result && result.claims?.length > 0) {
      if (activeFeature === feature.id) {
        // Toggle off
        setActiveFeature(null)
      } else {
        setActiveFeature(feature.id)
        setStatusFilter('All')
        // Scroll to claims or score
        if (feature.id === 'trust_score') {
          resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          claimsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
      return
    }

    // If no result yet or text is empty: Load sample and trigger immediate analysis
    setText(feature.sample)
    setActiveFeature(feature.id)
    setSampleNotice(`Loaded test sample for ${feature.name}. Analyzing...`)
    executeAnalysis(feature.sample)
  }

  // ── Load sample explicitly (when user wants to test via prompt)
  function loadFeatureSampleExplicitly(feature, e) {
    e.stopPropagation()
    setText(feature.sample)
    setActiveFeature(feature.id)
    setSampleNotice(`Loaded test sample for ${feature.name}. Analyzing...`)
    executeAnalysis(feature.sample)
  }

  function clearAll() {
    setText('')
    setResult(null)
    setError(null)
    setActiveFeature(null)
    setStatusFilter('All')
    setSampleNotice(null)
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      executeAnalysis()
    }
  }

  // ── Filtering Logic
  const allClaims = result?.claims ?? []

  // 1. Feature filter
  let featureFiltered = allClaims
  if (activeFeature) {
    if (activeFeature === 'fact_check') {
      featureFiltered = allClaims.filter(c =>
        c.flags?.includes('fact_verified') ||
        c.flags?.includes('fact_debunked') ||
        c.status === 'Verified'
      )
    } else if (activeFeature === 'hallucination') {
      featureFiltered = allClaims.filter(c => c.flags?.includes('hallucination'))
    } else if (activeFeature === 'bias') {
      featureFiltered = allClaims.filter(c => c.flags?.includes('bias'))
    } else if (activeFeature === 'emotional') {
      featureFiltered = allClaims.filter(c => c.flags?.includes('emotional'))
    } else if (activeFeature === 'unverified_stat') {
      featureFiltered = allClaims.filter(c => c.flags?.includes('unverified_stat'))
    } else if (activeFeature === 'trust_score') {
      featureFiltered = allClaims
    }
  }

  // 2. Status filter
  const displayedClaims =
    statusFilter === 'All'
      ? featureFiltered
      : featureFiltered.filter(c => c.status === statusFilter)

  // Counts for status pills
  const statusCounts = featureFiltered.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1
    return acc
  }, {})

  // Metrics helper
  const m = result?.metrics
  const vd = result ? verdictMeta(result.overall_trust_score) : null

  // Calculate live matching count for each of the 6 features
  function getFeatureCount(fId) {
    if (!result) return null
    if (fId === 'fact_check') {
      return (m?.fact_check?.verified_count ?? 0) + (m?.fact_check?.debunked_count ?? 0)
    }
    if (fId === 'hallucination') return m?.hallucination_count ?? 0
    if (fId === 'bias') return m?.bias_count ?? 0
    if (fId === 'emotional') return m?.emotional_count ?? 0
    if (fId === 'unverified_stat') return m?.unverified_stats_count ?? 0
    if (fId === 'trust_score') return `${result.overall_trust_score}%`
    return null
  }

  return (
    <div className="app">
      {/* ── Top Navigation Header ── */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🛡️</div>
          <div className="logo-text">
            <span className="logo-name">Fact<span className="logo-highlight">Shield</span></span>
            <span className="logo-sub">AI Truth &amp; Trust Auditor</span>
          </div>
        </div>

        <div className="header-right">
          <a
            className="nav-btn"
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            title="Open OpenAPI specification"
          >
            REST API
          </a>
          <span className="system-status">
            <span className="status-indicator" /> System Online
          </span>
        </div>
      </header>

      {/* ── Hero Section with 6 Interactive Feature Buttons ── */}
      <section className="hero">
        <div className="hero-pill">
          <span className="pill-pulse" />
          <span>Multi-Layer AI Verification Pipeline</span>
        </div>

        <h1 className="hero-title">
          Audit AI Text for <span className="title-gradient">Hallucinations, Bias &amp; Facts</span>
        </h1>

        <p className="hero-desc">
          Paste text generated by ChatGPT, Gemini, or Claude. FactShield runs six rigorous,
          independent verification algorithms to deliver deep fact audits and trust metrics.
        </p>

        {/* ── The 6 Interactive Feature Buttons ── */}
        <div className="feature-buttons-wrapper">
          <div className="feature-action-hint">
            <span>⚡ Interactive Checks — Click any check to test with live AI sample or filter claims:</span>
          </div>

          <div className="feature-pills" role="toolbar" aria-label="Audit Features">
            {AUDIT_FEATURES.map(feat => {
              const count = getFeatureCount(feat.id)
              const isSelected = activeFeature === feat.id

              return (
                <button
                  key={feat.id}
                  id={`btn-${feat.id}`}
                  className={`fpill ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleFeatureButtonClick(feat)}
                  title={`${feat.desc} (Click to ${result ? 'filter claims' : 'test with sample'})`}
                  type="button"
                >
                  <span className="pill-icon">{feat.icon}</span>
                  <span className="pill-name">{feat.name}</span>

                  {count !== null && (
                    <span className="pill-badge" title="Matching items in audit">
                      {count}
                    </span>
                  )}

                  {result && (
                    <span
                      className="pill-test-icon"
                      onClick={(e) => loadFeatureSampleExplicitly(feat, e)}
                      title="Load and run this feature's test sample"
                    >
                      ↻
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

        {/* Text Input Panel */}
        <div className="input-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="bar" />
              <span>Input AI Text to Audit</span>
            </div>
            <div className="panel-hints">
              <span>Supports up to {MAX_CHARS.toLocaleString()} characters</span>
            </div>
          </div>

          <textarea
            id="text-input"
            className="textarea"
            placeholder="Paste text generated by ChatGPT, Gemini, or any AI model here, or click any feature button above to load a targeted test case..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
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
                    <span className="btn-keyhint">Ctrl+Enter</span>
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
              <strong>Audit Processing Failed</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ── Audit Results Section ── */}
        {result && (
          <div className="results-container" ref={resultRef}>
            {/* Top Trust Score Card */}
            <div className="score-banner">
              <div className="ring-container">
                <ScoreRing score={result.overall_trust_score} />
              </div>

              <div className="score-details">
                <div className="details-header">
                  <span className="details-eyebrow">Audit Evaluation Result</span>
                  <div className={`verdict-tag ${vd.cls}`}>
                    <span>{vd.icon}</span>
                    <span>{vd.text}</span>
                  </div>
                </div>

                <p className="summary-paragraph">{result.summary}</p>

                <div className="quick-stats-row">
                  <div className="quick-stat">
                    <span className="stat-label">Total Claims</span>
                    <span className="stat-value">{allClaims.length}</span>
                  </div>
                  <div className="quick-stat">
                    <span className="stat-label">Verified</span>
                    <span className="stat-value verified">{allClaims.filter(c => c.status === 'Verified').length}</span>
                  </div>
                  <div className="quick-stat">
                    <span className="stat-label">Unverified</span>
                    <span className="stat-value unverified">{allClaims.filter(c => c.status === 'Unverified').length}</span>
                  </div>
                  <div className="quick-stat">
                    <span className="stat-label">Flagged / Fabricated</span>
                    <span className="stat-value flagged">{allClaims.filter(c => c.status === 'Flagged').length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 6 Feature Metric Cards */}
            <div className="metric-cards-grid">
              <FeatureCard
                icon="🔎"
                name="Fact Checking"
                value={`${(m?.fact_check?.verified_count ?? 0) + (m?.fact_check?.debunked_count ?? 0)} / ${allClaims.length}`}
                desc={`${m?.fact_check?.verified_count ?? 0} confirmed · ${m?.fact_check?.debunked_count ?? 0} debunked`}
                colorClass={m?.fact_check?.debunked_count > 0 ? 'card-flagged' : 'card-verified'}
                isActive={activeFeature === 'fact_check'}
                onClick={() => setActiveFeature(activeFeature === 'fact_check' ? null : 'fact_check')}
              />

              <FeatureCard
                icon="🧠"
                name="Hallucination Detection"
                value={m?.hallucination_count ?? 0}
                desc={m?.hallucination_count === 0 ? 'No absolute or fabricated assertions' : `${m?.hallucination_count} suspicious assertion(s)`}
                colorClass={m?.hallucination_count > 0 ? 'card-flagged' : 'card-verified'}
                isActive={activeFeature === 'hallucination'}
                onClick={() => setActiveFeature(activeFeature === 'hallucination' ? null : 'hallucination')}
              />

              <FeatureCard
                icon="⚖️"
                name="Bias Detection"
                value={m?.bias_detected ? `${m?.bias_count}` : '0'}
                desc={m?.bias_detected ? `${m?.bias_count} one-sided / loaded statements` : 'Neutral, balanced phrasing'}
                colorClass={m?.bias_detected ? 'card-bias' : 'card-verified'}
                isActive={activeFeature === 'bias'}
                onClick={() => setActiveFeature(activeFeature === 'bias' ? null : 'bias')}
              />

              <FeatureCard
                icon="🎭"
                name="Emotional Manipulation"
                value={`${m?.emotional_manipulation_score ?? 0}%`}
                desc={`${m?.emotional_count ?? 0} psychological trigger word(s)`}
                colorClass={(m?.emotional_manipulation_score ?? 0) > 40 ? 'card-flagged' : (m?.emotional_manipulation_score ?? 0) > 15 ? 'card-unverified' : 'card-verified'}
                isActive={activeFeature === 'emotional'}
                onClick={() => setActiveFeature(activeFeature === 'emotional' ? null : 'emotional')}
              />

              <FeatureCard
                icon="📊"
                name="Statistics Verification"
                value={m?.unverified_stats_count ?? 0}
                desc={m?.unverified_stats_count === 0 ? 'All metrics accompanied by sources' : 'Statistics lack authoritative citations'}
                colorClass={m?.unverified_stats_count > 0 ? 'card-stat' : 'card-verified'}
                isActive={activeFeature === 'unverified_stat'}
                onClick={() => setActiveFeature(activeFeature === 'unverified_stat' ? null : 'unverified_stat')}
              />

              <FeatureCard
                icon="🛡️"
                name="Trust Percentage"
                value={`${result.overall_trust_score}%`}
                desc={vd.text}
                colorClass={result.overall_trust_score >= 75 ? 'card-verified' : result.overall_trust_score >= 45 ? 'card-unverified' : 'card-flagged'}
                isActive={activeFeature === 'trust_score'}
                onClick={() => setActiveFeature(activeFeature === 'trust_score' ? null : 'trust_score')}
              />
            </div>

            {/* Claims Breakdown Table / List */}
            <div className="claims-panel" ref={claimsRef}>
              <div className="claims-panel-header">
                <div className="claims-panel-title">
                  <h3>Claims Breakdown</h3>
                  <span className="claims-total-badge">
                    {displayedClaims.length} of {allClaims.length} claims
                  </span>

                  {activeFeature && (
                    <span className="active-filter-indicator">
                      Filtered by:{' '}
                      <strong>{AUDIT_FEATURES.find(f => f.id === activeFeature)?.name}</strong>
                      <button
                        className="clear-feature-filter"
                        onClick={() => setActiveFeature(null)}
                        title="Show all claims"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>

                <div className="status-tabs" role="tablist" aria-label="Status filters">
                  {['All', 'Verified', 'Unverified', 'Flagged'].map(status => (
                    <button
                      key={status}
                      id={`tab-${status.toLowerCase()}`}
                      className={`status-tab ${statusFilter === status ? 'active' : ''}`}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status}
                      <span className="tab-count">
                        {status === 'All' ? featureFiltered.length : (statusCounts[status] || 0)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Claims List View */}
              <div className="claims-list-body" role="list">
                {displayedClaims.length === 0 ? (
                  <div className="empty-claims">
                    <span className="empty-icon">🔎</span>
                    <p className="empty-text">
                      No claims match the selected {activeFeature ? `"${AUDIT_FEATURES.find(f => f.id === activeFeature)?.name}"` : ''} filter.
                    </p>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => { setActiveFeature(null); setStatusFilter('All') }}
                    >
                      Show All Claims
                    </button>
                  </div>
                ) : (
                  displayedClaims.map((claim, idx) => (
                    <ClaimRow key={claim.id} claim={claim} index={idx} />
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
          <span>FactShield © {new Date().getFullYear()} — Advanced Multi-Check AI Trust &amp; Fact Platform</span>
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
