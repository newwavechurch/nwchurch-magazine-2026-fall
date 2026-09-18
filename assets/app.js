/* 더이웃 SNS 가을호 — 정적 플립북 뷰어
   의존: vendor/page-flip.browser.js (StPageFlip 2.0.7, MIT) */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SPREAD_MIN = 900;          // 이 너비부터 두 쪽 펼침
  var PRELOAD_BACK = 3;
  var PRELOAD_FWD = 4;
  var BGM_KEY = 'nwc-fall-bgm';
  var VOL_KEY = 'nwc-fall-bgm-vol';
  var SFX_KEY = 'nwc-fall-flipsound';
  var SFX_VOLUME = 0.6;         // 원본이 작게 녹음돼 있어 조금 높게 잡는다
  var FLIP_MS = 300;            // 여름호 flippingTime 0.3초
  var TURN_RATIO = 0.22;        // 폭의 22% 미만에서 놓으면 제자리로
  var FLICK_V = 0.3;            // px/ms — 이보다 빠르면 짧게 당겨도 넘긴다
  var HINT_KEY = 'nwc-fall-immersive-hint';

  function prefGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function prefSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 저장 불가 */ }
  }

  var el = {
    app: $('app'), stage: $('stage'), stageInner: $('stage-inner'),
    boot: $('boot'), bootMsg: $('boot-msg'),
    prev: $('btn-prev'), next: $('btn-next'),
    mhTitle: $('mh-title'), mhIssue: $('mh-issue'),
    scrim: $('scrim'), toast: $('toast'),
    bgm: $('bgm'),
    mtop: $('mtop'), mtopTitle: $('mtop-title'),
    mbar: $('mbar'), mSlider: $('m-slider'), mKnob: $('m-knob'),
    mFirst: $('m-first'), mPrev: $('m-prev'), mNext: $('m-next'), mLast: $('m-last'),
    mPageLabel: $('m-pagelabel'), mPageInput: $('m-pageinput'), mPageGo: $('m-pagego'),
    mToc: $('m-toc'), mThumbs: $('m-thumbs'), mMore: $('m-more'),
    sheet: $('sheet'), sheetMore: $('sheet-more'), soundSheet: $('sound-modal'),
    fab: $('music-fab'),
    zoom: $('zoom'), zoomView: $('zoom-view'), zoomCanvas: $('zoom-canvas'),
    zoomLevel: $('zoom-level'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'),
    zoomRange: $('zoom-range'),
    volRange: $('volume-range'), volVal: $('volume-val'),
    deskMore: $('db-more'), deskMenu: $('desk-menu'),
    dbCur: $('db-cur'), dbTotal: $('db-total'),
    slider: $('db-slider'), sliderWrap: $('db-slider-wrap'),
    preview: $('db-preview'), previewImg: $('db-preview-img'), previewNo: $('db-preview-no'),
    first: $('btn-first'), last: $('btn-last')
  };
  var sfxItems = document.querySelectorAll('.js-sfx');
  var musicItems = document.querySelectorAll('.js-music');
  var musicBtns = document.querySelectorAll('.js-music-btn');   // 툴바의 소리 버튼(모달 열기)

  var book = null;
  var pageEls = [];
  var attic = document.createElement('div');
  var pf = null;
  var layout = { spread: true, pw: 0, ph: 0 };
  var current = 0;               // 0-based
  var total = 0;
  var openPanelId = null;
  var searchIndex = [];
  var tocData = [];
  var thumbsBuilt = {};
  var mobileMode = false;

  /* ── 경로 ─────────────────────────────────────────── */
  function fromTemplate(tpl, n) {
    return String(tpl).replace(/\{(N+)\}/g, function (_, m) {
      return String(n).padStart(m.length, '0');
    });
  }
  function pageSrc(i) { return fromTemplate(book.pages, i + 1); }
  function thumbSrc(i) { return fromTemplate(book.thumbs, i + 1); }

  /* ── 쪽 묶음 계산 ─────────────────────────────────── */
  // 표지 단독 → 2·3 → 4·5 … → 뒤표지 단독
  function spreadOf(i) {
    if (!layout.spread) return [i];
    if (i <= 0) return [0];
    if (i >= total - 1 && (total - 1) % 2 === 1) return [total - 1];
    var start = (i % 2 === 1) ? i : i - 1;
    if (start + 1 > total - 1) return [start];
    return [start, start + 1];
  }
  function pagerText(i) {
    var s = spreadOf(i);
    return s.length === 2 ? (s[0] + 1) + '-' + (s[1] + 1) : String(s[0] + 1);
  }

  /* ── 쪽 요소 ──────────────────────────────────────── */
  function buildPages() {
    for (var i = 0; i < total; i++) {
      var d = document.createElement('div');
      d.className = 'page is-loading';
      // 여름호는 HardPageEnable=No — 표지·뒤표지도 일반 종이처럼 넘어간다.
      // 그래서 data-density="hard" 를 주지 않는다 (아래 softenCovers 참고)
      var img = document.createElement('img');
      img.alt = (i + 1) + '쪽';
      img.decoding = 'async';
      img.draggable = false;
      d._img = img;
      d._loaded = false;
      d.appendChild(img);
      pageEls.push(d);
    }
  }

  function loadPage(i) {
    if (i < 0 || i >= total) return;
    var d = pageEls[i];
    if (d._img.getAttribute('src')) return;
    d._img.addEventListener('load', function () {
      d._loaded = true;
      d.classList.remove('is-loading');
    }, { once: true });
    d._img.addEventListener('error', function () {
      d.classList.remove('is-loading');
    }, { once: true });
    d._img.src = pageSrc(i);
  }

  function preloadAround(i) {
    loadPage(0);
    var s = spreadOf(i);
    for (var k = s[0] - PRELOAD_BACK; k <= s[s.length - 1] + PRELOAD_FWD; k++) loadPage(k);
  }

  function resetPageEl(d) {
    d.removeAttribute('style');
    d.className = 'page' + (d._loaded ? '' : ' is-loading');
  }

  /* ── 레이아웃 ─────────────────────────────────────── */
  function computeLayout() {
    var W = el.stage.clientWidth;
    var H = el.stage.clientHeight;
    var ratio = book.pageWidth / book.pageHeight;
    var spread = window.innerWidth >= SPREAD_MIN;
    var pw = Math.min(spread ? W / 2 : W, H * ratio);
    pw = Math.max(80, Math.floor(pw));
    var ph = Math.floor(pw / ratio);
    return { spread: spread, pw: pw, ph: ph };
  }

  function destroyPF() {
    if (!pf) return;
    for (var i = 0; i < pageEls.length; i++) attic.appendChild(pageEls[i]);
    try { pf.destroy(); } catch (e) { /* 이미 정리됨 */ }
    pf = null;
  }

  function buildFlip(startIdx) {
    mobileMode = !layout.spread;
    destroyPF();
    if (mobileMode) {
      buildMobileFlip(startIdx);
      return;
    }
    pageEls.forEach(resetPageEl);

    var host = document.createElement('div');
    // 명시적 width/height 필수: .stf__block 의 height:100% 가 min-height 만으로는 0 으로 풀린다
    host.style.width = (layout.spread ? layout.pw * 2 : layout.pw) + 'px';
    host.style.height = layout.ph + 'px';
    el.stageInner.textContent = '';
    el.stageInner.appendChild(host);

    pf = new St.PageFlip(host, {
      width: layout.pw,
      height: layout.ph,
      size: 'fixed',
      autoSize: false,
      startPage: startIdx,
      showCover: true,
      usePortrait: !layout.spread,
      drawShadow: true,
      maxShadowOpacity: 0.5,
      flippingTime: 330,           // 여름호(FlipHTML5) flippingTime 0.3초에 맞춤
      swipeDistance: 24,
      showPageCorners: layout.spread,
      mobileScrollSupport: true,
      useMouseEvents: true,
      startZIndex: 0
    });
    pf.loadFromHTML(pageEls);
    softenCovers();
    pf.on('flip', function (e) { onPageChange(e.data, true); });
    // 넘김 애니메이션이 시작될 때 효과음을 낸다 (드래그·클릭·키보드·휠 모두 여기를 지난다)
    var lastState = 'read';
    pf.on('changeState', function (e) {
      if (e.data === 'flipping' && lastState !== 'flipping') playFlip();
      lastState = e.data;
    });
    onPageChange(pf.getCurrentPageIndex(), false);
  }

  // showCover:true 는 표지·뒤표지를 강제로 HARD(딱딱한 판)로 만든다.
  // 여름호는 종이 재질이므로 로드 직후 SOFT 로 되돌린다.
  function softenCovers() {
    try {
      var pages = pf.getPageCollection().getPages();
      if (!pages || !pages.length) return;
      pages[0].setDensity('soft');
      pages[pages.length - 1].setDensity('soft');
    } catch (e) { /* 라이브러리 내부 구조가 바뀌면 그냥 기본값 사용 */ }
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!pf && !mf.root) return;
      var next = computeLayout();
      if (next.spread === layout.spread && next.pw === layout.pw && next.ph === layout.ph) return;
      layout = next;
      buildFlip(current);
      if (isZoomOpen()) fitZoom(true);
    }, 180);
  }

  /* ── 쪽 이동 ──────────────────────────────────────── */
  // 표지·뒤표지는 한 쪽만 놓이므로 무대를 반 쪽만큼 밀어 가운데를 맞춘다
  function centerStage(idx) {
    var shift = 0;
    if (layout.spread) {
      var s = spreadOf(idx);
      if (s.length === 1) shift = (s[0] === 0 ? -1 : 1) * layout.pw / 2;
    }
    el.stageInner.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
  }

  function paintPager() {
    var label = pagerText(current);
    if (el.dbCur) el.dbCur.textContent = label;
    if (el.mPageLabel) el.mPageLabel.textContent = label + '/' + total;
  }

  function onPageChange(idx, fromUser) {
    current = idx;
    preloadAround(idx);
    centerStage(idx);
    paintPager();
    if (!sliderDragging) el.slider.value = String(spreadOf(idx)[0]);
    if (!mSliderDrag) paintMSlider(spreadOf(idx)[0]);
    // 끝에서도 버튼은 살려 둔다 — 눌렀을 때 "첫/마지막 페이지입니다" 를 알려주기 위해
    var first = idx <= 0, last = spreadOf(idx).indexOf(total - 1) !== -1;
    el.prev.classList.toggle('is-end', first);
    el.next.classList.toggle('is-end', last);
    el.first.classList.toggle('is-end', first);
    el.last.classList.toggle('is-end', last);
    el.mFirst.classList.toggle('is-end', first);
    el.mPrev.classList.toggle('is-end', first);
    el.mNext.classList.toggle('is-end', last);
    el.mLast.classList.toggle('is-end', last);
    markThumb(idx);
    markToc(idx);
    setHash(idx);
    positionFab();
    if (fromUser && isZoomOpen()) fillZoom();
  }

  function goTo(idx, animate) {
    idx = Math.max(0, Math.min(total - 1, idx));
    if (mobileMode) {
      if (!mf.root || idx === current || mf.animating) return;
      if (animate && Math.abs(idx - current) === 1) { mfGo(idx > current ? 1 : -1); return; }
      playFlip();
      mfIdle(idx);
      onPageChange(idx, true);
      return;
    }
    if (!pf) return;
    // 썸네일·목차·검색에서 건너뛸 때는 애니메이션이 없어 changeState 가 안 오므로 직접 울린다
    var moved = spreadOf(idx)[0] !== spreadOf(current)[0];
    if (animate) pf.flip(idx);
    else { if (moved) playFlip(); pf.turnToPage(idx); }
    onPageChange(pf.getCurrentPageIndex(), true);
  }
  function atFirst() { return current <= 0; }
  function atLast() { return spreadOf(current).indexOf(total - 1) !== -1; }

  var edgeAt = 0;
  function edgeToast(last) {
    var now = Date.now();
    if (now - edgeAt < 1200) return;
    edgeAt = now;
    toast(last ? '마지막 페이지입니다' : '첫 페이지입니다', 1600);
  }

  function flipNext() {
    if (atLast()) { edgeToast(true); return; }
    if (mobileMode) { mfGo(1); return; }
    if (!pf) return;
    pf.flipNext();
  }
  function flipPrev() {
    if (atFirst()) { edgeToast(false); return; }
    if (mobileMode) { mfGo(-1); return; }
    if (!pf) return;
    pf.flipPrev();
  }


  /* ── 모바일 한 장 넘김 엔진 ────────────────────────────
     StPageFlip 은 (1) 터치 시작 위치로 방향을 정하고 — 왼쪽 절반에서 시작하면
     왼쪽으로 밀어도 뒤로 간다 — (2) 한 장 모드의 뒤로 넘김을 좁은 쐐기로 그린다.
     둘 다 라이브러리 내부 렌더러 문제라 모바일만 직접 그린다. 데스크톱 펼침
     모드는 StPageFlip 그대로다.

     모양 규칙(여름호 프레임을 재서 맞춘 값):
       진행도 p(0~1) → 접힘선 c = W(1-p), 접힌 자락 길이 L = W-c,
       자락은 왼쪽 모서리를 축으로 -180p 도 회전.
       p<0.5 면 자락의 앞면(펼쳐진 쪽), p>0.5 면 뒷면(거울상)이 보인다.
     방향 규칙: 손가락이 왼쪽으로 가면 다음, 오른쪽으로 가면 이전. 시작 위치 무관. */
  var mf = {
    root: null, under: null, base: null, shade: null,
    flat: null, flatImg: null, flap: null, fImg: null, bImg: null,
    W: 0, H: 0, dir: 0, dest: -1, p: 0, raf: 0, animating: false
  };

  function mfCreate() {
    var d = document.createElement('div');
    d.className = 'mf';
    d.innerHTML =
      '<img class="mf__img mf__under" alt="" decoding="async">' +
      '<img class="mf__img mf__base" alt="" decoding="async">' +
      '<span class="mf__shade"></span>' +
      '<div class="mf__flat"><img alt="" decoding="async"></div>' +
      '<div class="mf__flap">' +
        '<div class="mf__face mf__face--f"><img alt="" decoding="async"></div>' +
        '<div class="mf__face mf__face--b"><img alt="" decoding="async"><span class="mf__paper"></span></div>' +
      '</div>';
    mf.root = d;
    mf.under = d.querySelector('.mf__under');
    mf.base = d.querySelector('.mf__base');
    mf.shade = d.querySelector('.mf__shade');
    mf.flat = d.querySelector('.mf__flat');
    mf.flatImg = mf.flat.querySelector('img');
    mf.flap = d.querySelector('.mf__flap');
    mf.fImg = d.querySelector('.mf__face--f img');
    mf.bImg = d.querySelector('.mf__face--b img');
    mfWire();
  }

  function buildMobileFlip(startIdx) {
    if (!mf.root) mfCreate();
    mf.W = layout.pw; mf.H = layout.ph;
    mf.root.style.width = mf.W + 'px';
    mf.root.style.height = mf.H + 'px';
    [mf.flatImg, mf.fImg, mf.bImg].forEach(function (i) { i.style.width = mf.W + 'px'; });
    el.stageInner.textContent = '';
    el.stageInner.appendChild(mf.root);
    mfIdle(Math.max(0, Math.min(total - 1, startIdx)));
    onPageChange(current, false);
  }

  function mfIdle(idx) {
    cancelAnimationFrame(mf.raf);
    mf.animating = false;
    current = idx;
    mf.base.src = pageSrc(idx);
    mf.base.hidden = false;
    mf.under.hidden = true;
    mf.flat.hidden = true;
    mf.flap.hidden = true;
    mf.shade.hidden = true;
    mf.dir = 0; mf.dest = -1; mf.p = 0;
    mf.root.style.setProperty('--mf-sh', '0');
  }

  // dir: 1 = 다음 쪽, -1 = 이전 쪽
  function mfPrepare(dir) {
    if (dir > 0 && current >= total - 1) return false;
    if (dir < 0 && current <= 0) return false;
    var moving = dir > 0 ? current : current - 1;
    var under = dir > 0 ? current + 1 : current;
    mf.dir = dir;
    mf.dest = dir > 0 ? current + 1 : current - 1;
    mf.under.src = pageSrc(under);
    var src = pageSrc(moving);
    if (mf.flatImg.getAttribute('src') !== src) {
      mf.flatImg.src = src; mf.fImg.src = src; mf.bImg.src = src;
    }
    mf.under.hidden = false;
    mf.base.hidden = true;
    mf.flat.hidden = false;
    mf.flap.hidden = false;
    mf.shade.hidden = false;
    return true;
  }

  function mfRender(p) {
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    mf.p = p;
    var W = mf.W;
    var c = W * (1 - p);
    var L = W - c;
    mf.flat.style.width = c + 'px';
    mf.flat.style.visibility = c < 0.5 ? 'hidden' : '';
    mf.flap.style.left = c + 'px';
    mf.flap.style.width = L + 'px';
    mf.flap.style.transform = 'rotateY(' + (-180 * p) + 'deg)';
    mf.flap.style.visibility = L < 0.5 ? 'hidden' : '';
    mf.fImg.style.left = (-c) + 'px';
    mf.bImg.style.left = (-c) + 'px';
    mf.shade.style.left = c + 'px';
    mf.root.style.setProperty('--mf-sh', (Math.sin(Math.PI * p) * 0.85).toFixed(3));
  }

  function mfAnimate(toP, ms, done) {
    cancelAnimationFrame(mf.raf);
    var fromP = mf.p, t0 = 0, dur = ms;
    mf.animating = true;
    mf.raf = requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / dur);
      mfRender(fromP + (toP - fromP) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) mf.raf = requestAnimationFrame(step);
      else { mf.animating = false; done(); }
    });
  }

  function mfFinish() { var d = mf.dest; mfIdle(d); onPageChange(d, true); }
  function mfBack() { mfIdle(current); }

  function mfGo(dir) {
    if (mf.animating || !mf.root) return false;
    if (!mfPrepare(dir)) return false;
    mfRender(dir > 0 ? 0 : 1);
    playFlip();
    mfAnimate(dir > 0 ? 1 : 0, FLIP_MS, mfFinish);
    return true;
  }

  function mfTap(clientX) {
    var r = mf.root.getBoundingClientRect();
    var rel = (clientX - r.left) / Math.max(1, r.width);
    if (rel < 0.22) { flipPrev(); return; }
    if (rel > 0.78) { flipNext(); return; }
    toggleImmersive();
  }

  // 좌우 넘김 단추는 무대의 형제라 책 위에만 귀를 달면 그 위에서 시작한
  // 드래그를 놓친다. 그래서 문서에서 받고 책 영역인지 좌표로 가린다.
  var MF_SKIP = '.mbar,.mtop,.sheet,.sound,.zoom,.share,.scrim,.mfab,.panel,.deskbar';

  function mfInside(e) {
    if (!mobileMode || !mf.root || mf.animating) return false;
    if (isZoomOpen() || sheetIsOpen() || isShareOpen() || isSoundOpen() || openPanelId) return false;
    if (e.target && e.target.closest && e.target.closest(MF_SKIP)) return false;
    var r = mf.root.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function mfWire() {
    var st = null;

    document.addEventListener('pointerdown', function (e) {
      if (!mfInside(e)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      st = {
        id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(),
        lx: e.clientX, lt: Date.now(), vx: 0, dir: 0, blocked: false,
        onBtn: !!(e.target && e.target.closest && e.target.closest('button'))
      };
    }, true);

    document.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id || st.blocked) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.dir) {
        // 방향은 손가락이 간 쪽으로 정한다 (시작 위치는 보지 않는다)
        if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
        var dir = dx < 0 ? 1 : -1;
        if (!mfPrepare(dir)) {
          st.blocked = true;
          edgeToast(dir > 0);
          return;
        }
        st.dir = dir;
      }
      var now = Date.now();
      if (now > st.lt) {
        st.vx = (e.clientX - st.lx) / (now - st.lt);
        st.lx = e.clientX; st.lt = now;
      }
      mfRender(st.dir > 0 ? (-dx / mf.W) : (1 - dx / mf.W));
      e.preventDefault();
    }, { passive: false, capture: true });

    // 단추 위에서 시작한 드래그가 끝난 뒤 클릭까지 겹쳐 두 장 넘어가지 않게 막는다
    function swallowClick() {
      document.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
      }, { capture: true, once: true });
    }

    function release(e) {
      if (!st || e.pointerId !== st.id) return;
      var g = st; st = null;
      if (g.blocked) return;
      var dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.dir) {
        if (!g.onBtn && Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - g.t < 500) mfTap(e.clientX);
        return;
      }
      if (g.onBtn) swallowClick();
      var flick = g.dir > 0 ? g.vx < -FLICK_V : g.vx > FLICK_V;
      var pulled = g.dir > 0 ? mf.p : 1 - mf.p;      // 얼마나 당겼나
      if (flick || pulled >= TURN_RATIO) {
        playFlip();
        mfAnimate(g.dir > 0 ? 1 : 0, Math.round(FLIP_MS * (1 - pulled) + 60), mfFinish);
      } else {
        mfAnimate(g.dir > 0 ? 0 : 1, 240, mfBack);   // 덜 당겼으면 제자리로
      }
    }
    document.addEventListener('pointerup', release, true);
    // 화면 맨 끝에서 시작한 스와이프는 브라우저가 앞/뒤로 가기 제스처로 가로채며
    // pointercancel 을 던진다. 그때도 놓은 것과 같게 판정해 넘김이 먹통이 되지 않게 한다.
    document.addEventListener('pointercancel', release, true);
  }

  /* ── 모바일 진행 슬라이더 ─────────────────────────── */
  var mSliderDrag = false;

  function paintMSlider(idx) {
    if (!el.mSlider) return;
    var w = el.mSlider.clientWidth;
    var frac = total > 1 ? idx / (total - 1) : 0;
    el.mKnob.style.left = (frac * w) + 'px';
    el.mSlider.setAttribute('aria-valuenow', String(idx + 1));
  }

  function wireMSlider() {
    el.mSlider.setAttribute('aria-valuemax', String(total));
    function pick(e) {
      var r = el.mSlider.getBoundingClientRect();
      var frac = (e.clientX - r.left) / Math.max(1, r.width);
      return Math.round(Math.max(0, Math.min(1, frac)) * (total - 1));
    }
    function preview(i) {
      paintMSlider(i);
      if (el.mPageLabel) el.mPageLabel.textContent = (i + 1) + '/' + total;
    }
    el.mSlider.addEventListener('pointerdown', function (e) {
      mSliderDrag = true;
      try { el.mSlider.setPointerCapture(e.pointerId); } catch (err) { /* 미지원 */ }
      preview(pick(e));
      e.preventDefault();
    });
    el.mSlider.addEventListener('pointermove', function (e) {
      if (mSliderDrag) preview(pick(e));
    });
    function done(e) {
      if (!mSliderDrag) return;
      mSliderDrag = false;
      goTo(pick(e), false);
    }
    el.mSlider.addEventListener('pointerup', done);
    el.mSlider.addEventListener('pointercancel', function () { mSliderDrag = false; paintMSlider(current); });
    el.mSlider.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { flipNext(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { flipPrev(); e.preventDefault(); }
    });
  }

  /* ── 쪽 번호 직접 입력 ────────────────────────────── */
  function wirePageInput() {
    function open() {
      el.mPageLabel.hidden = true;
      el.mPageInput.hidden = false;
      el.mPageGo.hidden = false;
      el.mPageInput.value = String(current + 1);
      el.mPageInput.focus();
      el.mPageInput.select();
    }
    function close(commit) {
      if (el.mPageInput.hidden) return;
      var n = parseInt(el.mPageInput.value, 10);
      el.mPageInput.hidden = true;
      el.mPageGo.hidden = true;
      el.mPageLabel.hidden = false;
      paintPager();
      if (commit && isFinite(n) && n >= 1) goTo(Math.min(total, n) - 1, false);
    }
    el.mPageLabel.addEventListener('click', open);
    // 눌렀을 때 입력칸이 먼저 blur 되지 않도록 기본 동작을 막는다
    el.mPageGo.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    el.mPageGo.addEventListener('click', function () { close(true); });
    el.mPageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    });
    el.mPageInput.addEventListener('blur', function () {
      setTimeout(function () { close(false); }, 120);
    });
    el.mPageInput.addEventListener('input', function () {
      el.mPageInput.value = el.mPageInput.value.replace(/[^0-9]/g, '').slice(0, 4);
    });
  }

  /* ── 몰입 모드 ────────────────────────────────────── */
  var immersive = false;

  function tryFullscreen(on) {
    var d = document, r = d.documentElement;
    try {
      if (on) {
        if (!d.fullscreenElement && !d.webkitFullscreenElement) {
          var f = r.requestFullscreen || r.webkitRequestFullscreen;
          if (f) { var p = f.call(r); if (p && p.catch) p.catch(function () {}); }
        }
      } else if (d.fullscreenElement || d.webkitFullscreenElement) {
        var x = d.exitFullscreen || d.webkitExitFullscreen;
        if (x) { var q = x.call(d); if (q && q.catch) q.catch(function () {}); }
      }
    } catch (e) { /* 정책상 막힘 — 무시 */ }
  }

  function setImmersive(on) {
    if (immersive === on) return;
    immersive = on;
    document.body.classList.toggle('immersive', on);
    tryFullscreen(on);
  }

  function toggleImmersive() {
    setImmersive(!immersive);
    if (immersive) toast('나가려면 화면을 탭하세요', 2200);
  }

  /* ── 배경음악 단추 자리 ───────────────────────────── */
  function positionFab() {
    if (!el.fab || !mobileMode || !mf.root) return;
    var r = mf.root.getBoundingClientRect();
    el.fab.style.left = (r.right - 52) + 'px';
    el.fab.style.top = (r.top + 12) + 'px';
  }

  /* ── 바텀시트 ─────────────────────────────────────── */
  var openSheetEl = null;
  function sheetIsOpen() { return !!openSheetEl; }

  function showSheet(node) {
    if (openSheetEl === node) { hideSheet(); return; }
    if (openSheetEl) hideSheet(true);
    closePanel();
    node.hidden = false;
    node.style.transform = '';
    el.scrim.hidden = false;
    document.body.classList.add('sheet-open');
    openSheetEl = node;
    requestAnimationFrame(function () {
      node.classList.add('is-open');
      el.scrim.classList.add('is-on');
    });
    if (node === el.sheet) pressSheetBtns();
  }

  function hideSheet(quiet) {
    if (!openSheetEl) return;
    var n = openSheetEl;
    openSheetEl = null;
    n.classList.remove('is-open');
    n.style.transform = '';
    document.body.classList.remove('sheet-open');
    pressSheetBtns();
    if (!quiet) dropScrim();
    setTimeout(function () { if (!n.classList.contains('is-open')) n.hidden = true; }, 300);
  }

  function pressSheetBtns() {
    var tab = openSheetEl === el.sheet ? sheetTab : null;
    el.mToc.setAttribute('aria-pressed', tab === 'toc' ? 'true' : 'false');
    el.mThumbs.setAttribute('aria-pressed', tab === 'thumbs' ? 'true' : 'false');
    el.mMore.setAttribute('aria-pressed', openSheetEl === el.sheetMore ? 'true' : 'false');
  }

  // 손잡이를 아래로 끌어 닫기
  function wireSheetDrag(node, grip) {
    var st = null;
    grip.addEventListener('pointerdown', function (e) {
      st = { id: e.pointerId, y: e.clientY, h: node.getBoundingClientRect().height };
      node.classList.add('is-dragging');
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* 미지원 */ }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      node.style.transform = 'translateY(' + Math.max(0, e.clientY - st.y) + 'px)';
    });
    function up(e) {
      if (!st || e.pointerId !== st.id) return;
      var dy = Math.max(0, e.clientY - st.y), h = st.h;
      st = null;
      node.classList.remove('is-dragging');
      node.style.transform = '';
      if (dy > Math.min(110, h * 0.28)) hideSheet();
    }
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /* ── 시트 탭 ──────────────────────────────────────── */
  var sheetTab = 'toc';
  function selectTab(name) {
    sheetTab = name;
    var tabs = el.sheet.querySelectorAll('.stab');
    var i, hit = 0;
    for (i = 0; i < tabs.length; i++) {
      var on = tabs[i].dataset.tab === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) hit = i;
    }
    var ind = $('stabs-ind');
    ind.style.width = (100 / tabs.length) + '%';
    ind.style.transform = 'translateX(' + (hit * 100) + '%)';
    $('spane-search').hidden = name !== 'search';
    $('spane-toc').hidden = name !== 'toc';
    $('spane-thumbs').hidden = name !== 'thumbs';
    if (name === 'thumbs') { buildThumbs($('s-thumb-grid'), 'sthumb'); scrollThumbIntoView(); }
    if (name === 'search') setTimeout(function () { $('s-search-input').focus(); }, 260);
    pressSheetBtns();
  }

  function openSheetTab(name) {
    selectTab(name);
    if (openSheetEl !== el.sheet) showSheet(el.sheet);
    else if (name !== 'search') hideSheet();
  }

  function wireSheets() {
    wireSheetDrag(el.sheet, $('sheet-grip'));
    wireSheetDrag(el.sheetMore, $('sheet-more-grip'));
    wireSheetDrag(el.soundSheet, $('sound-grip'));

    el.sheet.querySelectorAll('.stab').forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.dataset.tab); });
    });
    el.mToc.addEventListener('click', function () {
      if (openSheetEl === el.sheet && sheetTab === 'toc') hideSheet();
      else { selectTab('toc'); showSheetIfNeeded(); }
    });
    el.mThumbs.addEventListener('click', function () {
      if (openSheetEl === el.sheet && sheetTab === 'thumbs') hideSheet();
      else { selectTab('thumbs'); showSheetIfNeeded(); }
    });
    el.mMore.addEventListener('click', function () { showSheet(el.sheetMore); });

    function showSheetIfNeeded() {
      if (openSheetEl !== el.sheet) showSheet(el.sheet);
    }

    el.sheetMore.querySelectorAll('[data-more]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.more;
        hideSheet();
        setTimeout(function () {
          if (act === 'search') { selectTab('search'); showSheet(el.sheet); }
          else if (act === 'sound') showSound();
          else if (act === 'zoom') openZoom();
          else if (act === 'share') doShare();
          else if (act === 'home') goTo(0, false);
        }, act === 'search' ? 300 : 40);
      });
    });
  }

  /* ── 진행 슬라이더 (데스크톱) ─────────────────────── */
  var sliderDragging = false;

  function sliderPageAt(v) {
    return spreadOf(Math.max(0, Math.min(total - 1, v | 0)))[0];
  }

  function showPreview(v) {
    var p = sliderPageAt(v);
    el.previewImg.src = thumbSrc(p);
    el.previewNo.textContent = pagerText(p);
    el.preview.hidden = false;
    // 노브 위치에 맞춰 팝업을 옮긴다
    var min = 0, max = total - 1;
    var r = el.slider.getBoundingClientRect();
    var wrapR = el.sliderWrap.getBoundingClientRect();
    var frac = max > min ? (v - min) / (max - min) : 0;
    var knob = 14;    // 노브 지름 근사치
    var x = r.left - wrapR.left + knob / 2 + frac * (r.width - knob);
    el.preview.style.left = x + 'px';
  }
  function hidePreview() { el.preview.hidden = true; }

  function wireSlider() {
    el.slider.min = '0';
    el.slider.max = String(total - 1);
    el.slider.addEventListener('input', function () {
      sliderDragging = true;
      showPreview(parseInt(el.slider.value, 10));
    });
    el.slider.addEventListener('change', function () {
      sliderDragging = false;
      goTo(sliderPageAt(parseInt(el.slider.value, 10)), false);
    });
    el.slider.addEventListener('pointerdown', function () { sliderDragging = true; });
    el.slider.addEventListener('pointerup', function () { sliderDragging = false; });
    el.sliderWrap.addEventListener('pointermove', function (e) {
      var r = el.slider.getBoundingClientRect();
      if (e.clientX < r.left - 6 || e.clientX > r.right + 6) { hidePreview(); return; }
      var frac = (e.clientX - r.left) / Math.max(1, r.width);
      showPreview(Math.round(frac * (total - 1)));
    });
    el.sliderWrap.addEventListener('pointerleave', function () {
      if (!sliderDragging) hidePreview();
    });
    document.addEventListener('pointerup', function () {
      sliderDragging = false;
      setTimeout(hidePreview, 350);
    });
  }

  /* ── 해시 딥링크 ──────────────────────────────────── */
  var hashByUs = false;
  function setHash(idx) {
    var want = '#p=' + (spreadOf(idx)[0] + 1);
    if (location.hash === want) return;
    hashByUs = true;
    history.replaceState(null, '', location.pathname + location.search + want);
    setTimeout(function () { hashByUs = false; }, 0);
  }
  function hashPage() {
    var m = /[#&]p=(\d+)/.exec(location.hash);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 1) return null;
    return Math.min(n, total) - 1;
  }
  window.addEventListener('hashchange', function () {
    if (hashByUs) return;
    var p = hashPage();
    if (p !== null && p !== current) goTo(p, false);
  });

  /* ── 패널 ─────────────────────────────────────────── */
  // 왼쪽에서 밀려 나오는 패널은 데스크톱(>=900px) 전용이다.
  // 모바일은 같은 내용을 바텀시트로 보여 준다.
  var panels = {
    thumbs: { panel: $('panel-thumbs'), btns: [$('db-thumbs')] },
    toc: { panel: $('panel-toc'), btns: [$('db-toc')] },
    search: { panel: $('panel-search'), btns: [$('db-search')] }
  };
  function pressPanelBtns(p, on) {
    p.btns.forEach(function (b) { if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }

  function openPanel(name) {
    if (openPanelId === name) { closePanel(); return; }
    closePanel();
    var p = panels[name];
    if (!p) return;
    if (name === 'thumbs') buildThumbs($('thumb-grid'), 'thumb');
    p.panel.hidden = false;
    pressPanelBtns(p, true);
    el.scrim.hidden = false;
    // 트랜지션이 걸리도록 한 프레임 뒤에 열기
    requestAnimationFrame(function () {
      p.panel.classList.add('is-open');
      el.scrim.classList.add('is-on');
    });
    openPanelId = name;
    if (name === 'search') setTimeout(function () { $('search-input').focus(); }, 260);
    if (name === 'thumbs') scrollThumbIntoView();
  }

  function closePanel() {
    if (!openPanelId) return;
    var p = panels[openPanelId];
    p.panel.classList.remove('is-open');
    pressPanelBtns(p, false);
    el.scrim.classList.remove('is-on');
    var panelEl = p.panel;
    openPanelId = null;
    setTimeout(function () {
      if (!panelEl.classList.contains('is-open')) panelEl.hidden = true;
      if (!openPanelId && !isShareOpen() && !isSoundOpen() && !sheetIsOpen()) el.scrim.hidden = true;
    }, 280);
  }

  Object.keys(panels).forEach(function (name) {
    panels[name].btns.forEach(function (b) {
      if (b) b.addEventListener('click', function () { openPanel(name); });
    });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', closePanel);
  });
  el.scrim.addEventListener('click', function () { hideSheet(); closeShare(); closePanel(); });

  function jumpFromPanel(idx) {
    goTo(idx, false);
    if (window.innerWidth < SPREAD_MIN) { closePanel(); hideSheet(); }
  }

  /* ── 썸네일 ───────────────────────────────────────── */
  function buildThumbs(grid, cls) {
    if (thumbsBuilt[cls]) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < total; i++) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.dataset.page = String(i);
      b.setAttribute('aria-label', (i + 1) + '쪽으로 이동');
      var frame = document.createElement('span');
      frame.className = cls + '__frame';
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = thumbSrc(i);
      frame.appendChild(img);
      var no = document.createElement('span');
      no.className = cls + '__no';
      no.textContent = String(i + 1);
      b.appendChild(frame);
      b.appendChild(no);
      li.appendChild(b);
      frag.appendChild(li);
    }
    grid.appendChild(frag);
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.' + cls);
      if (b) jumpFromPanel(parseInt(b.dataset.page, 10));
    });
    thumbsBuilt[cls] = true;
    markThumb(current);
  }

  function markThumb(idx) {
    var s = spreadOf(idx);
    var all = document.querySelectorAll('.thumb[data-page],.sthumb[data-page]');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('is-current', s.indexOf(parseInt(all[i].dataset.page, 10)) !== -1);
    }
  }
  function scrollThumbIntoView() {
    var box = mobileMode ? $('s-thumb-grid') : $('thumb-grid');
    var cur = box && box.querySelector('.is-current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  /* ── 목차 ─────────────────────────────────────────── */
  function buildTocInto(list, cls, numbered) {
    list.textContent = '';
    tocData.forEach(function (item, n) {
      var li = document.createElement('li');
      li.className = cls + '__item';
      li.dataset.idx = String(n);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls + '__btn';
      b.dataset.page = String(Math.max(1, item.page) - 1);
      var t = document.createElement('span');
      t.className = cls + '__title';
      t.textContent = numbered ? (n + 1) + '. ' + item.title : item.title;
      var p = document.createElement('span');
      p.className = cls + '__page';
      p.textContent = numbered ? String(item.page) : item.page + '쪽';
      b.appendChild(t); b.appendChild(p);
      li.appendChild(b);
      list.appendChild(li);
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('.' + cls + '__btn');
      if (b) jumpFromPanel(parseInt(b.dataset.page, 10));
    });
  }

  function buildToc() {
    buildTocInto($('toc-list'), 'toc', false);
    buildTocInto($('s-toc-list'), 'stoc', true);
    $('toc-filter').addEventListener('input', function () {
      filterToc($('toc-filter').value, $('toc-list'), 'toc', $('toc-empty'));
    });
    $('s-toc-filter').addEventListener('input', function () {
      filterToc($('s-toc-filter').value, $('s-toc-list'), 'stoc', $('s-toc-empty'));
    });
  }

  function filterToc(raw, list, cls, empty) {
    var q = norm(raw);
    var items = list.querySelectorAll('.' + cls + '__item');
    var shown = 0;
    for (var i = 0; i < items.length; i++) {
      var hit = !q || norm(tocData[i].title).indexOf(q) !== -1;
      items[i].hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = shown > 0;
  }

  function markToc(idx) {
    if (!tocData.length) return;
    var page = spreadOf(idx)[spreadOf(idx).length - 1] + 1;
    var best = -1;
    for (var i = 0; i < tocData.length; i++) if (tocData[i].page <= page) best = i;
    var items = document.querySelectorAll('.toc__item,.stoc__item');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('is-current', parseInt(items[j].dataset.idx, 10) === best);
    }
  }

  /* ── 검색 ─────────────────────────────────────────── */
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function runSearch(ctx) {
    var raw = ctx.input.value;
    var q = norm(raw);
    var out = ctx.out;
    var empty = ctx.empty;
    var count = ctx.count;
    out.textContent = '';
    if (!q) { empty.hidden = true; count.hidden = true; return; }

    var hits = 0;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < searchIndex.length; i++) {
      var rec = searchIndex[i];
      var at = rec.norm.indexOf(q);
      if (at === -1) continue;
      hits++;
      frag.appendChild(resultRow(rec.page, rec.norm, at, q));
    }
    out.appendChild(frag);
    empty.hidden = hits > 0;
    count.hidden = hits === 0;
    count.textContent = hits + '개 쪽에서 찾았습니다';
  }

  function resultRow(page, text, at, q) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'result';
    b.dataset.page = String(page - 1);

    var head = document.createElement('span');
    head.className = 'result__page';
    head.textContent = '페이지: ' + page;

    var start = Math.max(0, at - 40);
    var end = Math.min(text.length, at + q.length + 40);
    var snip = text.slice(start, end);
    var body = document.createElement('span');
    body.className = 'result__snip';
    if (start > 0) body.appendChild(document.createTextNode('…'));

    var low = snip.toLowerCase();
    var pos = 0, found;
    while ((found = low.indexOf(q, pos)) !== -1) {
      if (found > pos) body.appendChild(document.createTextNode(snip.slice(pos, found)));
      var mk = document.createElement('mark');
      mk.textContent = snip.slice(found, found + q.length);
      body.appendChild(mk);
      pos = found + q.length;
    }
    if (pos < snip.length) body.appendChild(document.createTextNode(snip.slice(pos)));
    if (end < text.length) body.appendChild(document.createTextNode('…'));

    b.appendChild(head);
    b.appendChild(body);
    li.appendChild(b);
    return li;
  }

  function wireSearchPair(form, input, out, empty, count) {
    var ctx = { input: input, out: out, empty: empty, count: count };
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { runSearch(ctx); }, 160);
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); input.blur(); runSearch(ctx); });
    out.addEventListener('click', function (e) {
      var b = e.target.closest('.result');
      if (b) jumpFromPanel(parseInt(b.dataset.page, 10));
    });
  }

  function wireSearch() {
    wireSearchPair($('search-form'), $('search-input'), $('search-results'), $('search-empty'), $('search-count'));
    wireSearchPair($('s-search-form'), $('s-search-input'), $('s-search-results'), $('s-search-empty'), $('s-search-count'));
  }

  /* ── 확대 ─────────────────────────────────────────── */
  var zoom = { scale: 2, tx: 0, ty: 0, baseW: 0, baseH: 0, min: 1, max: 4 };
  function isZoomOpen() { return !el.zoom.hidden; }

  function fillZoom() {
    var s = spreadOf(current);
    el.zoomCanvas.textContent = '';
    for (var i = 0; i < s.length; i++) {
      var img = document.createElement('img');
      img.src = pageSrc(s[i]);
      img.alt = (s[i] + 1) + '쪽';
      img.draggable = false;
      el.zoomCanvas.appendChild(img);
    }
    fitZoom(true);
  }

  function fitZoom(reset, scale) {
    var VW = el.zoomView.clientWidth, VH = el.zoomView.clientHeight;
    var n = el.zoomCanvas.children.length || 1;
    var ratio = book.pageWidth / book.pageHeight;
    var w = Math.min(VW, VH * ratio * n);
    var h = w / (ratio * n);
    if (h > VH) { h = VH; w = h * ratio * n; }
    zoom.baseW = w; zoom.baseH = h;
    el.zoomCanvas.style.width = w + 'px';
    el.zoomCanvas.style.height = h + 'px';
    if (reset || scale) {
      zoom.scale = scale || 2;
      zoom.tx = (VW - w * zoom.scale) / 2;
      zoom.ty = (VH - h * zoom.scale) / 2;
    }
    applyZoom();
  }

  function clampZoom() {
    var VW = el.zoomView.clientWidth, VH = el.zoomView.clientHeight;
    var w = zoom.baseW * zoom.scale, h = zoom.baseH * zoom.scale;
    zoom.tx = w <= VW ? (VW - w) / 2 : Math.min(0, Math.max(VW - w, zoom.tx));
    zoom.ty = h <= VH ? (VH - h) / 2 : Math.min(0, Math.max(VH - h, zoom.ty));
  }

  function applyZoom() {
    clampZoom();
    el.zoomCanvas.style.transform =
      'translate(' + zoom.tx + 'px,' + zoom.ty + 'px) scale(' + zoom.scale + ')';
    el.zoomLevel.textContent = Math.round(zoom.scale * 100) + '%';
    el.zoomRange.value = String(Math.round(zoom.scale * 100));
    el.zoomOut.disabled = zoom.scale <= zoom.min + 0.01;
    el.zoomIn.disabled = zoom.scale >= zoom.max - 0.01;
    $('zm-in').disabled = el.zoomIn.disabled;
  }

  function zoomAt(nextScale, cx, cy) {
    nextScale = Math.max(zoom.min, Math.min(zoom.max, nextScale));
    var k = nextScale / zoom.scale;
    zoom.tx = cx - (cx - zoom.tx) * k;
    zoom.ty = cy - (cy - zoom.ty) * k;
    zoom.scale = nextScale;
    applyZoom();
  }

  var zoomBtns = [$('db-zoom')];
  function pressZoomBtns(on) {
    zoomBtns.forEach(function (b) { if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }

  function openZoom() {
    el.zoom.hidden = false;
    pressZoomBtns(true);
    closePanel();
    fillZoom();
  }
  function closeZoom() {
    el.zoom.hidden = true;
    el.zoomCanvas.textContent = '';
    pressZoomBtns(false);
  }
  function toggleZoom() { isZoomOpen() ? closeZoom() : openZoom(); }

  function wireZoom() {
    zoomBtns.forEach(function (b) { if (b) b.addEventListener('click', toggleZoom); });
    $('zoom-close').addEventListener('click', closeZoom);
    $('zm-exit').addEventListener('click', closeZoom);
    $('zm-in').addEventListener('click', function () {
      zoomAt(zoom.scale + 0.5, el.zoomView.clientWidth / 2, el.zoomView.clientHeight / 2);
    });
    $('zm-out').addEventListener('click', function () {
      zoomAt(Math.max(zoom.min, zoom.scale - 0.5), el.zoomView.clientWidth / 2, el.zoomView.clientHeight / 2);
    });
    $('zoom-reset').addEventListener('click', function () { fitZoom(false, 1); });
    el.zoomRange.addEventListener('input', function () {
      zoomAt(parseInt(el.zoomRange.value, 10) / 100, el.zoomView.clientWidth / 2, el.zoomView.clientHeight / 2);
    });
    el.zoomIn.addEventListener('click', function () {
      zoomAt(zoom.scale + 0.5, el.zoomView.clientWidth / 2, el.zoomView.clientHeight / 2);
    });
    el.zoomOut.addEventListener('click', function () {
      if (zoom.scale - 0.5 <= zoom.min + 0.01) { closeZoom(); return; }
      zoomAt(zoom.scale - 0.5, el.zoomView.clientWidth / 2, el.zoomView.clientHeight / 2);
    });

    var pts = new Map();
    var last = null, pinch = null;

    el.zoomView.addEventListener('pointerdown', function (e) {
      el.zoomView.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; el.zoomView.classList.add('is-panning'); }
      if (pts.size === 2) pinch = pinchState();
    });
    el.zoomView.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && pinch) {
        var now = pinchState();
        if (pinch.dist > 0) {
          var r = el.zoomView.getBoundingClientRect();
          zoomAt(pinch.scale * (now.dist / pinch.dist), now.cx - r.left, now.cy - r.top);
        }
      } else if (last) {
        zoom.tx += e.clientX - last.x;
        zoom.ty += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        applyZoom();
      }
    });
    function release(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { last = null; el.zoomView.classList.remove('is-panning'); }
      else { var f = pts.values().next().value; last = { x: f.x, y: f.y }; }
    }
    el.zoomView.addEventListener('pointerup', release);
    el.zoomView.addEventListener('pointercancel', release);

    function pinchState() {
      var a = Array.from(pts.values());
      var dx = a[0].x - a[1].x, dy = a[0].y - a[1].y;
      return {
        dist: Math.hypot(dx, dy),
        cx: (a[0].x + a[1].x) / 2,
        cy: (a[0].y + a[1].y) / 2,
        scale: zoom.scale
      };
    }

    // 더블클릭·더블탭으로 2배 토글
    function toggleDouble(cx, cy) {
      zoomAt(zoom.scale > 1.05 ? zoom.min : 2, cx, cy);
    }
    el.zoomView.addEventListener('dblclick', function (e) {
      var r = el.zoomView.getBoundingClientRect();
      toggleDouble(e.clientX - r.left, e.clientY - r.top);
    });
    var lastTapAt = 0, lastTapX = 0, lastTapY = 0;
    el.zoomView.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') return;      // 마우스는 dblclick 이 처리
      var now = Date.now();
      if (now - lastTapAt < 320 && Math.abs(e.clientX - lastTapX) < 30 && Math.abs(e.clientY - lastTapY) < 30) {
        var r = el.zoomView.getBoundingClientRect();
        toggleDouble(e.clientX - r.left, e.clientY - r.top);
        lastTapAt = 0;
        return;
      }
      lastTapAt = now; lastTapX = e.clientX; lastTapY = e.clientY;
    });

    el.zoomView.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = el.zoomView.getBoundingClientRect();
      zoomAt(zoom.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  /* ── 넘김 효과음 ──────────────────────────────────── */
  var sfx = { on: true, ok: true, proto: null };

  function paintSfx() {
    for (var i = 0; i < sfxItems.length; i++) {
      var it = sfxItems[i];
      it.setAttribute('aria-checked', sfx.on ? 'true' : 'false');
      it.querySelector('.js-sfx-label').textContent = sfx.on ? '넘김 소리 켜짐' : '넘김 소리 꺼짐';
    }
  }

  function toggleSfx() {
    sfx.on = !sfx.on;
    prefSet(SFX_KEY, sfx.on ? 'on' : 'off');
    paintSfx();
    if (sfx.on) playFlip();
  }

  // ogg(원본) 우선, 못 재생하는 브라우저는 mp3 변환본
  function flipSrc() {
    var probe = document.createElement('audio');
    if (probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"')) return 'audio/flip.ogg';
    return 'audio/flip.mp3';
  }

  function wireSfx() {
    sfx.on = prefGet(SFX_KEY, 'on') !== 'off';
    var a = new Audio(flipSrc());
    a.preload = 'auto';
    a.volume = SFX_VOLUME;
    a.addEventListener('error', function () { sfx.ok = false; });
    sfx.proto = a;
    paintSfx();
  }

  // 연속으로 넘겨도 겹쳐 울리도록 매번 복제해 재생한다.
  // 첫 상호작용 전에는 자동재생 정책으로 막히므로 실패는 조용히 무시한다.
  function playFlip() {
    if (!sfx.on || !sfx.ok || !sfx.proto) return;
    try {
      var a = sfx.proto.cloneNode(true);
      a.volume = SFX_VOLUME;
      try { a.currentTime = 0; } catch (e) { /* 아직 로드 전 */ }
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* 정책상 막힘 */ });
    } catch (e) { /* 재생 불가 */ }
  }

  /* ── 배경음악 ─────────────────────────────────────── */
  var music = { available: true, on: false, armed: false, vol: 50 };

  function readMusicPref() { return prefGet(BGM_KEY, 'on') !== 'off'; }

  function paintMusic() {
    // 볼륨 0 도 '꺼짐'으로 보여준다
    var audible = music.on && music.vol > 0;
    var icon = audible ? '#i-music-on' : '#i-music-off';
    var i;
    for (i = 0; i < musicBtns.length; i++) {
      musicBtns[i].querySelector('use').setAttribute('href', icon);
      musicBtns[i].classList.toggle('is-muted', !audible);
    }
    for (i = 0; i < musicItems.length; i++) {
      musicItems[i].querySelector('.js-music-label').textContent = audible ? '배경음악 켜짐' : '배경음악 꺼짐';
      musicItems[i].setAttribute('aria-checked', audible ? 'true' : 'false');
    }
    if (el.fab) el.fab.querySelector('use').setAttribute('href', audible ? '#i-pause' : '#i-play');
  }

  function setVolume(v, persist) {
    music.vol = Math.max(0, Math.min(100, Math.round(v)));
    el.bgm.volume = music.vol / 100;
    el.volRange.value = String(music.vol);
    el.volVal.textContent = String(music.vol);
    if (persist) prefSet(VOL_KEY, String(music.vol));
    paintMusic();
  }

  function toggleMusic() {
    if (!music.available) return;
    setMusic(!music.on);
  }

  // 자동재생 정책에 막혀도 '켜짐' 상태는 유지한다 — 첫 상호작용에서 다시 시도한다
  function tryPlay() {
    var p = el.bgm.play();
    if (p && p.catch) p.catch(function () { /* 정책상 막힘: arm 에서 재시도 */ });
  }

  function setMusic(on) {
    music.on = on;
    prefSet(BGM_KEY, on ? 'on' : 'off');
    if (on) tryPlay();
    else el.bgm.pause();
    paintMusic();
  }

  function wireMusic() {
    el.bgm.src = book.music || 'audio/bgm.mp3';
    setVolume(parseInt(prefGet(VOL_KEY, '50'), 10) || 0, false);
    el.bgm.addEventListener('error', function () {
      music.available = false;
      music.on = false;
      document.querySelectorAll('.js-music').forEach(function (b) {
        b.disabled = true;
        b.title = '배경음악 파일이 없습니다';
      });
      paintMusic();
    });
    el.volRange.addEventListener('input', function () { setVolume(el.volRange.value, true); });
    el.volRange.addEventListener('change', function () { setVolume(el.volRange.value, true); });
    // 기본 켜짐(여름호와 동일). 자동재생이 허용된 환경이면 바로 시작하고,
    // 막히면 켜짐 표시를 유지한 채 첫 상호작용에서 시작한다
    music.on = readMusicPref();
    paintMusic();
    if (music.on) tryPlay();

    var arm = function () {
      if (music.armed) return;
      music.armed = true;
      document.removeEventListener('pointerdown', arm, true);
      document.removeEventListener('keydown', arm, true);
      if (music.available && music.on && el.bgm.paused) tryPlay();
    };
    document.addEventListener('pointerdown', arm, true);
    document.addEventListener('keydown', arm, true);
  }

  /* ── 더보기 · 토스트 ──────────────────────────────── */
  var toastTimer = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    requestAnimationFrame(function () { el.toast.classList.add('is-on'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-on');
      setTimeout(function () { el.toast.hidden = true; }, 260);
    }, ms || 2200);
  }

  function closeMore() {
    el.deskMenu.hidden = true;
    el.deskMore.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu(btn, menu) {
    var open = menu.hidden;
    closeMore();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ── 공유 ─────────────────────────────────────────── */
  function copyLink(url) {
    var done = function () { toast('링크를 복사했습니다'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? done() : toast('복사하지 못했습니다. 주소창을 길게 눌러 복사해 주세요', 3000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
  }

  function drawQR(text) {
    var box = $('share-qr');
    box.textContent = '';
    if (typeof qrcode !== 'function') { box.hidden = true; return; }
    try {
      var q = qrcode(0, 'M');      // 0 = 자동 버전, M = 오류정정 중간
      q.addData(text);
      q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      box.hidden = false;
    } catch (e) {
      box.hidden = true;           // 링크가 너무 길어 QR 로 못 담는 경우
    }
  }

  /* ── 소리 설정 모달 ───────────────────────────────── */
  // 모바일에서는 시트로 열린다. 닫는 중(hidden 이 아직 false)에는 열린 것으로 세지 않아야
  // 가림막이 걷힌다.
  function isSoundOpen() {
    if (el.soundSheet.hidden) return false;
    if (openSheetEl === el.soundSheet) return true;
    return !mobileMode;
  }

  function showSound() {
    closePanel();
    closeMore();
    if (mobileMode) { showSheet(el.soundSheet); return; }
    el.soundSheet.hidden = false;
    el.scrim.hidden = false;
    requestAnimationFrame(function () { el.scrim.classList.add('is-on'); });
  }

  function closeSound() {
    if (!isSoundOpen()) return;
    if (openSheetEl === el.soundSheet) { hideSheet(); return; }
    el.soundSheet.hidden = true;
    dropScrim();
  }

  // 패널·공유·소리 모달이 모두 닫혔을 때만 가림막을 걷는다
  function dropScrim() {
    if (openPanelId || isShareOpen() || isSoundOpen() || sheetIsOpen()) return;
    el.scrim.classList.remove('is-on');
    setTimeout(function () {
      if (!openPanelId && !isShareOpen() && !isSoundOpen() && !sheetIsOpen()) el.scrim.hidden = true;
    }, 240);
  }

  function isShareOpen() { return !$('share').hidden; }

  function openShare() {
    closePanel();
    var url = location.href;
    $('share-url').value = url;
    drawQR(url);
    $('share').hidden = false;
    el.scrim.hidden = false;
    requestAnimationFrame(function () { el.scrim.classList.add('is-on'); });
    setTimeout(function () { $('share-copy').focus(); }, 60);
  }

  function closeShare() {
    if (!isShareOpen()) return;
    $('share').hidden = true;
    dropScrim();
  }

  function doFullscreen() {
    var d = document, r = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
    }
  }

  function doShare() {
    var url = location.href;
    var data = { title: (book && book.title) || document.title, url: url };
    if (navigator.share) {
      // 지원 브라우저는 OS 공유 시트(카카오톡 등)로 넘긴다
      var p;
      try { p = navigator.share(data); } catch (e) { openShare(); return; }
      if (p && p.catch) {
        p.catch(function (err) {
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
          openShare();
        });
      }
    } else openShare();
  }

  function wireMore() {
    var canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    if (!canFull) {
      document.querySelectorAll('[data-act="full"]').forEach(function (b) { b.hidden = true; });
    }

    el.deskMore.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu(el.deskMore, el.deskMenu);
    });
    document.addEventListener('click', function (e) {
      if (!el.deskMenu.hidden && !e.target.closest('.tool-wrap')) closeMore();
    });

    // 두 메뉴가 같은 동작을 공유한다
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'full': closeMore(); doFullscreen(); break;
        case 'share': closeMore(); doShare(); break;
        case 'home': closeMore(); goTo(0, false); break;
        case 'sound': closeMore(); showSound(); break;
        case 'music': toggleMusic(); break;   // 모달은 열어둔다 (볼륨 조절 이어서)
        case 'sfx': toggleSfx(); break;
      }
    });

    $('share-close').addEventListener('click', closeShare);
    $('share-copy').addEventListener('click', function () { copyLink($('share-url').value); });
  }

  /* ── 모바일 하단 바 배선 ──────────────────────────── */
  function wireMobileNav() {
    el.mPrev.addEventListener('click', flipPrev);
    el.mNext.addEventListener('click', flipNext);
    el.mFirst.addEventListener('click', function () { atFirst() ? edgeToast(false) : goTo(0, false); });
    el.mLast.addEventListener('click', function () { atLast() ? edgeToast(true) : goTo(total - 1, false); });
  }

  /* ── 입력 ─────────────────────────────────────────── */
  function wireInput() {
    el.prev.addEventListener('click', flipPrev);
    el.next.addEventListener('click', flipNext);
    el.first.addEventListener('click', function () { atFirst() ? edgeToast(false) : goTo(0, false); });
    el.last.addEventListener('click', function () { atLast() ? edgeToast(true) : goTo(total - 1, false); });

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') { t.blur(); }
        return;
      }
      // 확대 중에는 넘김을 막는다
      if (isZoomOpen() && e.key !== 'Escape') return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': flipNext(); e.preventDefault(); break;
        case 'ArrowLeft': case 'PageUp': flipPrev(); e.preventDefault(); break;
        case 'Home': goTo(0, false); e.preventDefault(); break;
        case 'End': goTo(total - 1, false); e.preventDefault(); break;
        case 'Escape':
          if (isZoomOpen()) closeZoom();
          else if (sheetIsOpen()) hideSheet();
          else if (isSoundOpen()) closeSound();
          else if (isShareOpen()) closeShare();
          else if (!el.deskMenu.hidden) closeMore();
          else if (immersive) setImmersive(false);
          else closePanel();
          break;
      }
    });

    // 책을 직접 눌러 넘기려 할 때도 끝을 알려준다
    el.stage.addEventListener('pointerdown', function (e) {
      if (mobileMode || isZoomOpen() || openPanelId || isShareOpen()) return;
      var host = el.stageInner.firstElementChild;
      if (!host) return;
      var r = host.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      var forward = e.clientX > r.left + r.width / 2;
      if (!forward && atFirst()) edgeToast(false);
      else if (forward && atLast()) edgeToast(true);
    }, true);

    var wheelAt = 0;
    el.stage.addEventListener('wheel', function (e) {
      var now = Date.now();
      if (now - wheelAt < 420) return;
      if (Math.abs(e.deltaY) < 6) return;
      wheelAt = now;
      e.deltaY > 0 ? flipNext() : flipPrev();
    }, { passive: true });

    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  /* ── 시작 ─────────────────────────────────────────── */
  function fail(msg) {
    el.boot.classList.remove('is-gone');
    el.boot.hidden = false;
    el.bootMsg.classList.add('is-error');
    el.bootMsg.textContent = msg;
    var spin = el.boot.querySelector('.boot__spin');
    if (spin) spin.hidden = true;
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function hideBoot() {
    el.boot.classList.add('is-gone');
    setTimeout(function () { el.boot.hidden = true; }, 400);
  }

  function start() {
    if (typeof St === 'undefined' || !St.PageFlip) {
      fail('페이지 넘김 라이브러리를 불러오지 못했습니다. vendor/page-flip.browser.js 를 확인해 주세요.');
      return;
    }
    getJSON('data/book.json').then(function (b) {
      book = b;
      total = Math.max(1, b.pageCount | 0);
      book.pageWidth = b.pageWidth || 1200;
      book.pageHeight = b.pageHeight || 1695;

      // <title> 은 문서에 고정돼 있다 (OG/검색용) — 덮어쓰지 않는다
      el.mhTitle.textContent = (b.title || '').replace(/\s*가을호\s*$/, '') || b.title || '';
      el.mhIssue.textContent = b.issue || '';
      el.mtopTitle.textContent = b.title || document.title;
      el.dbTotal.textContent = String(total);

      buildPages();
      loadPage(0);

      var extras = [
        getJSON(b.search || 'data/search.json').catch(function () { return []; }),
        getJSON(b.toc || 'data/toc.json').catch(function () { return []; })
      ];

      return Promise.all(extras).then(function (res) {
        searchIndex = (res[0] || []).map(function (r) {
          return { page: r.page, norm: norm(r.text) };
        });
        tocData = (res[1] || []).filter(function (t) { return t && t.title && t.page; });

        buildToc();
        wireSearch();
        wireZoom();
        wireSfx();
        wireMusic();
        wireMore();
        wireSlider();
        wireMSlider();
        wirePageInput();
        wireSheets();
        wireMobileNav();
        wireInput();

        if (!tocData.length) {
          panels.toc.btns.forEach(function (b) { if (b) b.disabled = true; });
          el.mToc.disabled = true;
          selectTab('thumbs');
        }
        if (!searchIndex.length) {
          panels.search.btns.forEach(function (b) { if (b) b.disabled = true; });
          el.sheet.querySelector('.stab[data-tab="search"]').disabled = true;
          el.sheetMore.querySelector('[data-more="search"]').disabled = true;
        }

        layout = computeLayout();
        var startAt = hashPage();
        buildFlip(startAt === null ? 0 : startAt);

        var cover = pageEls[0]._img;
        var done = function () { hideBoot(); };
        if (cover.complete) done();
        else {
          cover.addEventListener('load', done, { once: true });
          cover.addEventListener('error', done, { once: true });
          setTimeout(done, 4000);
        }

        if (window.innerWidth < SPREAD_MIN && prefGet(HINT_KEY, '') !== 'seen') {
          prefSet(HINT_KEY, 'seen');
          setTimeout(function () { toast('화면을 탭하면 전체화면으로 볼 수 있어요', 3000); }, 1000);
        }
      });
    }).catch(function (err) {
      fail('책 데이터를 불러오지 못했습니다. data/book.json 을 확인해 주세요.\n(' + err.message + ')');
    });
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else start();
})();
