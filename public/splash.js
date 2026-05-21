/* ═══════════════════════════════════════════════════════════
   YES MOCELIN · SPLASH + LOGIN LOGIC
   ══════════════════════════════════════════════════════════ */

;(function () {
  'use strict'

  /* ── CONFIG ───────────────────────────────────────────── */
  // MODE A: redirect to app.html after login
  // MODE B: swap stages without redirect (same origin)
  const MODE = 'A'
  const APP_URL = '/app.html'
  const SESSION_KEY = 'yes_splash_seen'

  // Credentials (client-side only — real auth is in app.html / Supabase)
  // Leaving as empty strings skips validation and lets app.html handle auth
  const BYPASS_SPLASH = false // set true to skip splash if already seen

  /* ── ELEMENTS ─────────────────────────────────────────── */
  const splashStage  = document.getElementById('splash-stage')
  const loginStage   = document.getElementById('login-stage')
  const ctaBtn       = document.getElementById('cta-btn')
  const pulseRing    = document.getElementById('pulse-ring')
  const canvas       = document.getElementById('particles-canvas')
  const clockTime    = document.getElementById('clock-time')
  const clockDate    = document.getElementById('clock-date')
  const loginForm    = document.getElementById('login-form')
  const loginBtn     = document.getElementById('login-btn')
  const formError    = document.getElementById('form-error')
  const fieldUser    = document.getElementById('field-user')
  const fieldPass    = document.getElementById('field-pass')

  /* ── LOGO FROM LOCALSTORAGE ───────────────────────────── */
  function tryLoadLogo () {
    const b64 = localStorage.getItem('sc_logo_base64')
    if (!b64) return

    const splashImg = document.getElementById('splash-logo-img')
    const splashSvg = document.getElementById('splash-logo-svg')
    const loginImg  = document.getElementById('login-logo-img')
    const loginSvg  = document.getElementById('login-logo-svg')

    if (splashImg && splashSvg) {
      splashImg.src = b64
      splashImg.style.display = 'block'
      splashImg.style.width   = '64px'
      splashImg.style.height  = '64px'
      splashSvg.style.display = 'none'
    }
    if (loginImg && loginSvg) {
      loginImg.src = b64
      loginImg.style.display = 'block'
      loginImg.style.width   = '48px'
      loginImg.style.height  = '48px'
      loginSvg.style.display = 'none'
    }
  }

  /* ── CLOCK ────────────────────────────────────────────── */
  function pad (n) { return String(n).padStart(2, '0') }

  function tickClock () {
    const now  = new Date()
    const h    = pad(now.getHours())
    const m    = pad(now.getMinutes())
    const s    = pad(now.getSeconds())
    const d    = pad(now.getDate())
    const mo   = pad(now.getMonth() + 1)
    const y    = now.getFullYear()

    if (clockTime) clockTime.textContent = `${h}:${m}:${s}`
    if (clockDate) clockDate.textContent = `${d}.${mo}.${y} · UTC-3`
  }

  /* ── PATH STROKE ANIMATION (JS fallback) ─────────────── */
  function animatePaths () {
    const paths = document.querySelectorAll('.network-path')
    paths.forEach(p => {
      const len = p.getTotalLength ? p.getTotalLength() : 600
      p.style.strokeDasharray  = len
      p.style.strokeDashoffset = len
    })
    // CSS animation handles the draw via keyframes defined in splash.css
  }

  /* ── PARTICLE BURST ───────────────────────────────────── */
  const ctx = canvas ? canvas.getContext('2d') : null
  let particles = []
  let rafId = null

  function resizeCanvas () {
    if (!canvas) return
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
  }

  function spawnParticles (cx, cy) {
    const count = 60
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1.5 + Math.random() * 5
      particles.push({
        x:  cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.015 + Math.random() * 0.025,
        r:  1.5 + Math.random() * 2.5,
      })
    }
  }

  function drawParticles () {
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    particles = particles.filter(p => p.life > 0)
    particles.forEach(p => {
      p.x    += p.vx
      p.y    += p.vy
      p.vx   *= 0.96
      p.vy   *= 0.96
      p.life -= p.decay

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,199,0,${p.life.toFixed(2)})`
      ctx.fill()
    })

    if (particles.length > 0) {
      rafId = requestAnimationFrame(drawParticles)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  /* ── TRANSITION: SPLASH → LOGIN ───────────────────────── */
  function doTransition () {
    if (!ctaBtn) return
    ctaBtn.disabled = true

    // 1. Pulse ring
    pulseRing.classList.add('firing')

    // 2. Particle burst from button
    const rect = ctaBtn.getBoundingClientRect()
    const cx   = rect.left + rect.width  / 2
    const cy   = rect.top  + rect.height / 2
    resizeCanvas()
    spawnParticles(cx, cy)
    if (rafId) cancelAnimationFrame(rafId)
    drawParticles()

    // 3. Fade out splash, fade in login
    setTimeout(() => {
      splashStage.classList.add('exiting')

      setTimeout(() => {
        splashStage.style.display = 'none'
        loginStage.classList.add('visible')
        if (fieldUser) fieldUser.focus()
      }, 600)
    }, 350)
  }

  /* ── LOGIN SUBMIT ─────────────────────────────────────── */
  function showError (msg) {
    formError.textContent = msg
    formError.classList.add('visible')
  }

  function clearError () {
    formError.textContent = ''
    formError.classList.remove('visible')
  }

  function setLoading (on) {
    loginBtn.disabled = on
    loginBtn.classList.toggle('loading', on)
  }

  function handleLoginSubmit (e) {
    e.preventDefault()
    clearError()

    const user = fieldUser.value.trim()
    const pass = fieldPass.value

    if (!user || !pass) {
      showError('Preencha usuário e senha.')
      return
    }

    setLoading(true)

    // Store credentials in sessionStorage so app.html can auto-fill / validate
    sessionStorage.setItem('yes_login_user', user)
    sessionStorage.setItem('yes_login_pass', pass)
    sessionStorage.setItem(SESSION_KEY, '1')

    if (MODE === 'A') {
      // Redirect to app
      setTimeout(() => { window.location.href = APP_URL }, 300)
    } else {
      // MODE B: dynamic swap (if both live on the same page / iframe)
      // This is a stub; real auth runs inside app.html
      setTimeout(() => {
        window.location.href = APP_URL
      }, 300)
    }
  }

  /* ── SKIP SPLASH IF ALREADY SEEN ─────────────────────── */
  function checkSkip () {
    if (BYPASS_SPLASH && sessionStorage.getItem(SESSION_KEY)) {
      splashStage.style.display = 'none'
      loginStage.classList.add('visible')
      if (fieldUser) fieldUser.focus()
      return true
    }
    return false
  }

  /* ── INIT ─────────────────────────────────────────────── */
  function init () {
    tryLoadLogo()

    if (checkSkip()) {
      // Start clock and bail early
      tickClock()
      setInterval(tickClock, 1000)
      return
    }

    // Clock
    tickClock()
    setInterval(tickClock, 1000)

    // Canvas resize
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Animate SVG paths (sync dasharray with getTotalLength if possible)
    animatePaths()

    // CTA button
    if (ctaBtn) {
      ctaBtn.addEventListener('click', doTransition)
      ctaBtn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          doTransition()
        }
      })
    }

    // Login form
    if (loginForm) {
      loginForm.addEventListener('submit', handleLoginSubmit)
    }

    // Clear error on typing
    if (fieldUser) fieldUser.addEventListener('input', clearError)
    if (fieldPass) fieldPass.addEventListener('input', clearError)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
