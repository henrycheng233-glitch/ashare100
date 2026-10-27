/* A股百强 —— 单页静态报告（无依赖，图表为手写 SVG） */
(() => {
  const DATA = window.__DATA__;
  const COMPANIES = DATA.companies;
  const CODES = Object.keys(COMPANIES);
  const app = document.getElementById('app');
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 格式化 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // 全站唯一数字出口：整数部分一律千分位（前端升级方案 §2.1）
  const NF = {};
  const nf = (d) => (NF[d] ||= new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmt = (v, d = 2) => (isNum(v) ? nf(d).format(v) : '—');
  const money = (v) => {
    if (!isNum(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return fmt(v / 1e12, 2) + '万亿';
    if (a >= 1e10) return fmt(v / 1e8, 0) + '亿';
    if (a >= 1e8) return fmt(v / 1e8, 1) + '亿';
    if (a >= 1e4) return fmt(v / 1e4, 0) + '万';
    return fmt(v, 0) + '元';
  };
  const yi = (v, d = 1) => fmt(isNum(v) ? v / 1e8 : v, d);
  const pct = (v, d = 2) => (isNum(v) ? fmt(v, Math.abs(v) >= 1000 ? 0 : d) + '%' : '—');
  const spct = (v, d = 2) => (isNum(v) ? (v > 0 ? '+' : '') + pct(v, d) : '—');
  const num = (v, d = 2) => fmt(v, d);
  const int = (v) => fmt(v, 0);
  const dstr = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '.') : '—');
  const cls = (v) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : '');
  // 缺失值统一显示「—」，悬停说明原因（字段说明_前端.md 第四节）
  const NA = (why = '数据缺失') => `<span class="na" title="${why}">—</span>`;

  /* ---------- 组件：浮层提示（替换原生 title，方案 §3.1） ---------- */
  // 任何带 title / data-tip 的元素悬停即显示；data-tip-fn 指向 TIP_FN 中的函数，可返回 HTML
  const TIP_FN = {};
  const tipEl = document.createElement('div');
  tipEl.className = 'ftip'; tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  const placeTip = (e) => {
    const pad = 14, r = tipEl.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tipEl.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
  };
  const tipTarget = (e) => e.target.closest && e.target.closest('[title],[data-tip],[data-tip-fn]');
  // 被省略号截断的文字：悬停时自动补上全文提示（向上查 3 层，找到实际溢出的元素）
  document.addEventListener('pointerover', (e) => {
    let el = e.target;
    for (let i = 0; i < 3 && el && el !== document.body; i++, el = el.parentElement) {
      if (el.dataset?.tip || el.dataset?.tipFn || el.hasAttribute?.('title')) return;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && !/^(svg|SELECT|INPUT|TEXTAREA)$/.test(el.tagName)) {
        const txt = el.innerText.trim();
        if (txt && txt.length < 400 && !el.querySelector('table, svg')) el.dataset.tip = txt;
        return;
      }
    }
  }, true);
  document.addEventListener('pointerover', (e) => {
    const t = tipTarget(e);
    if (!t) return;
    if (t.hasAttribute('title')) { t.dataset.tip = t.getAttribute('title'); t.removeAttribute('title'); }
    const html = t.dataset.tipFn ? TIP_FN[t.dataset.tipFn]?.(t) : esc(t.dataset.tip).replace(/\n/g, '<br>');
    if (!html) return;
    tipEl.innerHTML = html;
    tipEl.classList.add('on'); placeTip(e);
  });
  document.addEventListener('pointermove', (e) => { if (tipEl.classList.contains('on')) placeTip(e); });
  document.addEventListener('pointerout', (e) => { if (tipTarget(e)) tipEl.classList.remove('on'); });
  window.addEventListener('hashchange', () => tipEl.classList.remove('on'));
  const NA_WHY = { ytd: '上市时间不足，无 2025 年末基准价', r1y: '上市不满 1 年', chg: '数据缺失', pe: '无市盈率数据', roe: '无 2025 年报数据', cagr: '上市时间不足，无法计算 3 年复合增速', dy: '数据缺失' };
  const arrow = (v) => (isNum(v) ? (v > 0 ? '▲' : v < 0 ? '▼' : '') : '');
  const FMT = { money, pct, num, int, yi: (v) => (isNum(v) ? yi(v, 2) + '亿' : '—'), yuan: (v) => (isNum(v) ? fmt(v, 3) + '元' : '—'), x: (v) => (isNum(v) ? fmt(v, 2) + '倍' : '—') };

  const norm = (s) => String(s || '').toLowerCase().replace(/[\s·．.，,、\-_/（）()【】[\]]/g, '');

  /* ---------- 索引与排名 ---------- */
  const INDEX = CODES.map((code) => {
    const id = COMPANIES[code].identity;
    const hay = norm([code, code.replace(/\.(SH|SZ|BJ)$/, ''), id.name_full, id.name_abbr,
      id.pinyin_abbr, ...(id.aliases || []), ...(id.former_names || [])].join('|'));
    return { code, id, hay, mv: COMPANIES[code].market.total_mv || 0 };
  });
  const BY_MV = [...INDEX].sort((a, b) => b.mv - a.mv);
  const MV_RANK = Object.fromEntries(BY_MV.map((x, i) => [x.code, i + 1]));
  const INDUSTRY = {};
  BY_MV.forEach((x) => { (INDUSTRY[x.id.industry_sw1] ||= []).push(x.code); });

  function search(q, limit = 30) {
    const k = norm(q);
    if (!k) return [];
    const hit = INDEX.filter((x) => x.hay.includes(k));
    const rank = (x) => {
      if (x.code.slice(0, 6) === k || norm(x.code) === k) return 0;
      if (norm(x.id.name_abbr) === k) return 1;
      if (norm(x.id.name_full) === k) return 2;
      if (norm(x.id.pinyin_abbr) === k) return 3;
      return 4;
    };
    hit.sort((a, b) => rank(a) - rank(b) || b.mv - a.mv);
    return hit.slice(0, limit);
  }

  /* ---------- 公司 Logo：logos.js 提供 代码 → 文件名；缺失或加载失败时显示首字字标 ---------- */
  const LOGOS = window.__LOGOS__ || {};
  const logo = (code, size, extra = '') => {
    const name = COMPANIES[code]?.identity.name_abbr || '';
    const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`;
    return LOGOS[code]
      ? `<span class="clogo ${extra}" style="${st}" data-ch="${esc(name.slice(0, 1))}"><img src="${LOGOS[code].startsWith('data:') ? LOGOS[code] : 'logos/' + esc(LOGOS[code])}" alt="" loading="lazy" onerror="this.parentNode.classList.add('mono');this.remove()"></span>`
      : `<span class="clogo mono ${extra}" style="${st}" data-ch="${esc(name.slice(0, 1))}"></span>`;
  };

  /* ---------- 收藏（仅存本机浏览器） ---------- */
  const FAV_KEY = 'ashare100:fav';
  const favs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } };
  const setFavs = (a) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch { /* 无痕模式等 */ } };


  /* ---------- 图表：通用柱线组合（手写 SVG） ---------- */
  const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceScale(lo, hi, n = 4) {
    if (lo === hi) { hi = lo + 1; }
    const step = niceStep((hi - lo) / n);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toFixed(10));
    return { lo, hi, ticks, step };
  }
  const tickLabel = (t, step) => {
    const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return t.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  // cfg: { years, series:[{key,name,kind:'bar'|'line',axis:'L'|'R',values,color,fmt}], unitL, unitR, height }
  function drawChart(host, cfg, animate = true) {
    host._cfg = cfg;
    const st = host._st || (host._st = { hidden: new Set() });
    const W = Math.max(280, host.clientWidth);
    const H = cfg.height || (W < 500 ? 230 : 280);
    const shown = cfg.series.filter((s) => !st.hidden.has(s.key));
    const hasR = shown.some((s) => s.axis === 'R');
    const padL = 48, padR = hasR ? 48 : 10, padT = 12, padB = 30;
    const n = cfg.years.length, iw = W - padL - padR, ih = H - padT - padB, band = iw / n;
    const dom = (ax) => {
      const vals = shown.filter((s) => s.axis === ax).flatMap((s) => s.values.filter(isNum));
      return vals.length ? niceScale(Math.min(0, ...vals), Math.max(0, ...vals)) : null;
    };
    const L = dom('L'), R = dom('R');
    const Y = (sc, v) => padT + ih - ((v - sc.lo) / (sc.hi - sc.lo)) * ih;
    const cx = (i) => padL + band * (i + 0.5);

    let g = `<g class="grid">`;
    const main = L || R;
    if (main) main.ticks.forEach((t) => {
      const y = Y(main, t);
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" ${t === 0 ? 'class="zero" stroke-dasharray="0"' : ''}/>`;
    });
    g += '</g>';
    let ax = '';
    if (L) L.ticks.forEach((t) => { ax += `<text x="${padL - 8}" y="${Y(L, t) + 4}" text-anchor="end">${tickLabel(t, L.step)}</text>`; });
    if (R) R.ticks.forEach((t) => { ax += `<text x="${W - padR + 8}" y="${Y(R, t) + 4}">${tickLabel(t, R.step)}</text>`; });
    cfg.years.forEach((yr, i) => { ax += `<text class="yr" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${yr}</text>`; });

    let hl = '';
    cfg.years.forEach((_, i) => { hl += `<rect class="hl" data-i="${i}" x="${padL + band * i + 2}" y="${padT}" width="${band - 4}" height="${ih}" rx="4"/>`; });

    const bars = shown.filter((s) => s.kind === 'bar');
    const nb = bars.length, gap = 4;
    const bw = Math.max(4, Math.min(28, (band * 0.66 - gap * (nb - 1)) / Math.max(1, nb)));
    let b = '';
    bars.forEach((s, j) => {
      const sc = s.axis === 'R' ? R : L;
      s.values.forEach((v, i) => {
        if (!isNum(v)) return;
        const x = cx(i) - (nb * bw + (nb - 1) * gap) / 2 + j * (bw + gap);
        const y0 = Y(sc, 0), y1 = Y(sc, v);
        b += `<rect class="cb${v < 0 ? ' neg' : ''}" style="--d:${i * 70 + j * 40}ms;fill:${s.color}" x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="2"/>`;
      });
    });
    let l = '';
    shown.filter((s) => s.kind === 'line').forEach((s) => {
      const sc = s.axis === 'R' ? R : L;
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (!isNum(v)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${Y(sc, v).toFixed(1)}`;
        pen = true;
      });
      if (d) l += `<path class="cl" pathLength="1" style="stroke:${s.color}" d="${d}"/>`;
      s.values.forEach((v, i) => {
        if (isNum(v)) l += `<circle class="cp" style="--d:${500 + i * 120}ms;fill:${s.color}" cx="${cx(i)}" cy="${Y(sc, v)}" r="4"/>`;
      });
    });

    const legend = cfg.series.map((s) => `<button class="lg" data-k="${s.key}" aria-pressed="${!st.hidden.has(s.key)}"><i class="${s.kind === 'line' ? 'ln' : ''}" style="background:${s.color}"></i>${esc(s.name)}</button>`).join('');
    const axisNote = [cfg.unitL && L ? `左轴：${cfg.unitL}` : '', cfg.unitR && R ? `右轴：${cfg.unitR}` : ''].filter(Boolean).join(' · ');

    host.innerHTML = `
      <div class="chart-head"><div class="legend">${legend}</div><div class="axisnote">${axisNote}</div></div>
      <div class="cv">
        <svg class="${animate && !REDUCED ? '' : 'still'}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.label || '图表')}">${g}${hl}${b}${l}${ax}</svg>
        <div class="tip"></div>
      </div>
      ${cfg.foot ? `<div class="chart-foot">${cfg.foot}</div>` : ''}`;

    host.querySelectorAll('.lg').forEach((btn) => btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (st.hidden.has(k)) st.hidden.delete(k);
      else if (cfg.series.length - st.hidden.size > 1) st.hidden.add(k);
      drawChart(host, cfg, true);
    }));

    const svg = host.querySelector('svg'), tip = host.querySelector('.tip');
    const hls = [...svg.querySelectorAll('.hl')];
    // cfg.sync：同组图表悬停同一年时互相联动（对比页）
    if (cfg.sync) host.dataset.sync = cfg.sync;
    const show = (i, quiet) => {
      if (!quiet && cfg.sync) document.querySelectorAll(`.chart-host[data-sync="${cfg.sync}"]`).forEach((h) => { if (h !== host && h._sync) h._sync.show(i, true); });
      hls.forEach((r, k) => r.classList.toggle('on', k === i));
      tip.innerHTML = `<b>${cfg.years[i]}${cfg.tipSuffix || ''}</b>` + cfg.series.filter((s) => !st.hidden.has(s.key))
        .map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)}<span>${(FMT[s.fmt] || num)(s.values[i])}</span></div>`).join('');
      tip.classList.add('on');
      const tw = tip.offsetWidth;
      let left = cx(i) + band / 2;
      if (left + tw > W) left = cx(i) - band / 2 - tw;
      tip.style.left = Math.max(0, left) + 'px';
    };
    const hide = (quiet) => {
      if (quiet !== true && cfg.sync) document.querySelectorAll(`.chart-host[data-sync="${cfg.sync}"]`).forEach((h) => { if (h !== host && h._sync) h._sync.hide(true); });
      hls.forEach((r) => r.classList.remove('on')); tip.classList.remove('on');
    };
    host._sync = { show, hide };
    const idx = (e) => {
      const rect = svg.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const i = Math.floor((x - padL) / band);
      return i >= 0 && i < n ? i : -1;
    };
    svg.addEventListener('mousemove', (e) => { const i = idx(e); i < 0 ? hide() : show(i); });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', (e) => { const i = idx(e); if (i >= 0) show(i); }, { passive: true });
  }

  /* 环形图（仅用于全为正值、合计约 100% 的拆分） */
  function donut(list, total) {
    const r = 56, C = 2 * Math.PI * r;
    let acc = 0, s = '';
    list.forEach((x, i) => {
      const len = (x.ratio / 100) * C;
      s += `<circle class="seg" data-i="${i}" r="${r}" cx="75" cy="75" style="stroke:${COLORS[i % COLORS.length]};--d:${i * 120}ms" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 75 75)"/>`;
      acc += len;
    });
    return `<svg class="donut" viewBox="0 0 150 150"><circle r="${r}" cx="75" cy="75" style="stroke:var(--color-brand-soft)"/>${s}
      <text class="ctr" x="75" y="74" text-anchor="middle">${money(total)}</text><text x="75" y="94" text-anchor="middle">合计营收</text></svg>`;
  }

  /* ---------- 公共：顶栏 SiteHeader ---------- */
  // Logo：圆角方块内三根递增的柱子拼成抽象的“A”，最高一根为琥珀色，顶部一个点代表“百强之首”
  const LOGO_MARK = `<svg class="lg-m" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#2B3036"/>
    <rect x="7" y="17" width="4.5" height="9" rx="1.5" fill="#8A9099"/>
    <rect x="13.75" y="11" width="4.5" height="15" rx="1.5" fill="#D99A1E"/>
    <rect x="20.5" y="14" width="4.5" height="12" rx="1.5" fill="#C9CCD1"/>
    <circle cx="16" cy="6.8" r="2" fill="#D99A1E"/></svg>`;
  function siteHeader(active, crumb = '') {
    const link = (k, href, t) => `<a href="${href}" class="${active === k ? 'on' : ''}">${t}</a>`;
    return `<div class="topbar"><div class="wrap bar">
      <a class="logo" href="#/" aria-label="Ashare100 公司全景图谱 首页">${LOGO_MARK}<span class="lg-t"><b>Ashare<em>100</em></b><small>公司全景图谱</small></span></a>
      <nav class="sitenav">${link('home', '#/', '首页')}${link('list', '#/list', '榜单')}${link('rank', '#/rank', '排行')}${link('industry', '#/industry', '行业')}${link('compare', '#/compare', '对比')}${link('timeline', '#/timeline', '时间轴')}${link('about', '#/about', '关于')}</nav>
      ${crumb}
      ${jumpBox()}
      <span class="asof">${esc(DATA.meta.as_of_date)} 收盘</span>
    </div></div>`;
  }
  // 任意页面按 / 聚焦顶栏搜索（输入框内不拦截）
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const j = document.getElementById('jump');
    if (j) { e.preventDefault(); j.focus(); }
  });

  /* ---------- 公共：派生行（首页与榜单共用） ---------- */
  const ROWS = BY_MV.map((x) => {
    const c = COMPANIES[x.code], m = c.market, an = c.financials.annual || [];
    return {
      code: x.code, name: x.id.name_abbr, ind: x.id.industry_sw1, ind2: x.id.industry_sw2, board: x.id.board,
      idx: m.index_members || [], rank: MV_RANK[x.code],
      mv: m.total_mv, chg: m.change_pct, ytd: m.ytd_return, r1y: m.return_1y, pe: m.pe_ttm, pb: m.pb, dy: m.dividend_yield,
      roe: an[4]?.roe, rev25: an[4]?.revenue, np25: an[4]?.net_profit, cagr: c.financials.derived?.revenue_cagr_3y,
      revs: an.map((r) => r.revenue), years: an.map((r) => r.fiscal_year)
    };
  });
  const ROW = Object.fromEntries(ROWS.map((r) => [r.code, r]));

  /* ---------- 指标注册表（排行 / 榜单 / 同行共用，方案 §3.3） ---------- */
  // group 一级分组；better 'high' | 'low' | null；fin=false 表示对银行、非银金融无意义，排行默认剔除；hist 为年报字段名，用于 5 年迷你趋势
  const AN = (c, k, i = 4) => c.financials.annual?.[i]?.[k];
  const METRICS = {
    mv: { group: 'scale', name: '总市值', get: (c) => c.market.total_mv, fmt: money, better: 'high', fin: true, note: '2026-10-22 收盘' },
    rev25: { group: 'scale', name: '营业总收入 2025', get: (c) => AN(c, 'revenue'), fmt: money, better: 'high', fin: true, note: '2025 年报，合并报表', hist: 'revenue' },
    np25: { group: 'scale', name: '归母净利润 2025', get: (c) => AN(c, 'net_profit'), fmt: money, better: 'high', fin: true, note: '2025 年报，合并报表', hist: 'net_profit' },
    assets: { group: 'scale', name: '总资产 2025', get: (c) => AN(c, 'total_assets'), fmt: money, better: 'high', fin: true, hist: 'total_assets' },
    emp: { group: 'scale', name: '员工人数', get: (c) => c.identity.employees, fmt: (v) => int(v) + ' 人', better: 'high', fin: true, note: '截至 2025-12-31' },
    roe: { group: 'profit', name: 'ROE 2025', get: (c) => AN(c, 'roe'), fmt: pct, better: 'high', fin: true, note: '加权平均净资产收益率，2025 年报', hist: 'roe' },
    roa: { group: 'profit', name: 'ROA 2025', get: (c) => AN(c, 'roa'), fmt: pct, better: 'high', fin: true, hist: 'roa' },
    nm: { group: 'profit', name: '净利率 2025', get: (c) => AN(c, 'net_margin'), fmt: pct, better: 'high', fin: true, hist: 'net_margin' },
    gm: { group: 'profit', name: '毛利率 2025', get: (c) => AN(c, 'gross_margin'), fmt: pct, better: 'high', fin: false, note: '金融业无毛利率口径，已剔除', hist: 'gross_margin' },
    cagr: { group: 'growth', name: '营收 3 年复合', get: (c) => c.financials.derived?.revenue_cagr_3y, fmt: spct, better: 'high', fin: true, note: '2022–2025 年复合增速；次新股基数小，数值可能极端' },
    npcagr: { group: 'growth', name: '净利 3 年复合', get: (c) => c.financials.derived?.net_profit_cagr_3y, fmt: spct, better: 'high', fin: true, note: '2022–2025 年复合增速' },
    revyoy: { group: 'growth', name: '营收同比（中报）', get: (c) => c.financials.latest?.revenue_yoy, fmt: spct, better: 'high', fin: true, note: '2026 年中报较上年同期' },
    npyoy: { group: 'growth', name: '净利同比（中报）', get: (c) => c.financials.latest?.net_profit_yoy, fmt: spct, better: 'high', fin: true, note: '2026 年中报较上年同期' },
    pe: { group: 'value', name: '市盈率 TTM', get: (c) => (c.market.pe_ttm > 0 ? c.market.pe_ttm : null), fmt: (v) => num(v) + ' 倍', better: 'low', fin: true, note: '亏损公司（PE 为负）不参与排序' },
    pb: { group: 'value', name: '市净率', get: (c) => c.market.pb, fmt: (v) => num(v) + ' 倍', better: 'low', fin: true, note: 'MRQ' },
    ps: { group: 'value', name: '市销率 TTM', get: (c) => c.market.ps_ttm, fmt: (v) => num(v) + ' 倍', better: 'low', fin: false, note: '金融业营收口径不同，已剔除' },
    dy: { group: 'return', name: '股息率', get: (c) => c.market.dividend_yield, fmt: pct, better: 'high', fin: true, note: '2026-10-22，近 12 个月派息 ÷ 股价' },
    payout: { group: 'return', name: '5 年分红率', get: (c) => c.dividends.payout_5y, fmt: pct, better: 'high', fin: true, note: '2021–2025 累计分红 ÷ 累计归母净利' },
    divyears: { group: 'return', name: '连续分红年数', get: (c) => c.dividends.consecutive_years, fmt: (v) => int(v) + ' 年', better: 'high', fin: true, note: '含 2026 中期' },
    cumdiv: { group: 'return', name: '5 年累计分红', get: (c) => c.dividends.cum_dividend_5y, fmt: money, better: 'high', fin: true, note: '2021–2025' },
    debt: { group: 'health', name: '资产负债率', get: (c) => AN(c, 'debt_ratio'), fmt: pct, better: 'low', fin: false, note: '金融业负债率结构性偏高，已剔除', hist: 'debt_ratio' },
    ocfnp: { group: 'health', name: '现金流 / 净利', get: (c) => AN(c, 'ocf_to_np'), fmt: (v) => num(v) + ' 倍', better: 'high', fin: false, note: '经营现金流 ÷ 归母净利，2025 年报；金融业已剔除', hist: 'ocf_to_np' },
    gw: { group: 'health', name: '商誉 / 净资产', get: (c) => c.financials.derived?.goodwill_to_equity, fmt: pct, better: 'low', fin: true, note: '商誉 ÷ 归母净资产' },
    rd: { group: 'health', name: '研发费用率', get: (c) => AN(c, 'rd_ratio'), fmt: pct, better: 'high', fin: false, note: '研发费用 ÷ 营收，2025 年报', hist: 'rd_ratio' },
    chg: { group: 'market', name: '当日涨跌', get: (c) => c.market.change_pct, fmt: spct, better: 'high', fin: true, mkt: true, note: '2026-10-22' },
    ytd: { group: 'market', name: '年初至今', get: (c) => c.market.ytd_return, fmt: spct, better: 'high', fin: true, mkt: true, note: '前复权；无 2025 年末基准价的新股不计' },
    r1y: { group: 'market', name: '近 1 年', get: (c) => c.market.return_1y, fmt: spct, better: 'high', fin: true, mkt: true, note: '前复权' },
    r3y: { group: 'market', name: '近 3 年', get: (c) => c.market.return_3y, fmt: spct, better: 'high', fin: true, mkt: true, note: '前复权' },
    amount: { group: 'market', name: '成交额', get: (c) => c.market.amount, fmt: money, better: 'high', fin: true, note: '2026-10-22' },
    turnover: { group: 'market', name: '换手率', get: (c) => c.market.turnover_rate, fmt: pct, better: 'high', fin: true, note: '2026-10-22' },
    ctrl: { group: 'gov', name: '控股股东持股', get: (c) => c.shareholders.controlling_ratio, fmt: pct, better: null, fin: true },
    inst: { group: 'gov', name: '机构持股', get: (c) => c.shareholders.inst_hold_ratio, fmt: pct, better: null, fin: true, note: '基金/保险/券商/QFII/社保' },
    north: { group: 'gov', name: '陆股通持股', get: (c) => c.shareholders.northbound_ratio, fmt: pct, better: null, fin: true, note: '占总股本' },
    pledge: { group: 'gov', name: '质押比例', get: (c) => c.shareholders.pledge_ratio_total, fmt: pct, better: 'low', fin: true, note: '全公司质押 ÷ 总股本' },
    holderchg: { group: 'gov', name: '股东户数变化', get: (c) => c.shareholders.holder_num_change_pct, fmt: spct, better: null, fin: true, note: '较上一期' }
  };
  const GROUPS = { scale: '规模', profit: '盈利能力', growth: '成长性', value: '估值', return: '股东回报', health: '财务健康', market: '市场表现', gov: '股东与治理' };
  const FIN_INDS = ['银行', '非银金融'];
  const isFin = (code) => FIN_INDS.includes(COMPANIES[code].identity.industry_sw1);
  const mval = (key, code) => { const v = METRICS[key].get(COMPANIES[code]); return isNum(v) ? v : null; };
  // 排名：opts.dir 'asc'|'desc'（默认按 better），opts.fin 是否保留金融业，opts.board 板块，opts.ind 行业
  function ranked(key, opts = {}) {
    const mt = METRICS[key];
    const dir = opts.dir || (mt.better === 'low' ? 'asc' : 'desc');
    const keepFin = opts.fin ?? mt.fin;
    const list = ROWS.filter((r) => (keepFin || !FIN_INDS.includes(r.ind)) && (!opts.board || r.board === opts.board) && (!opts.ind || r.ind === opts.ind))
      .map((r) => ({ ...r, v: mval(key, r.code) })).filter((r) => r.v != null);
    return list.sort((a, b) => (dir === 'asc' ? a.v - b.v : b.v - a.v) || a.rank - b.rank);
  }
  const quantile = (xs, q) => { const b = xs.filter(isNum).sort((p, s) => p - s); if (!b.length) return null; const i = (b.length - 1) * q, lo = Math.floor(i); return b[lo] + (b[Math.min(lo + 1, b.length - 1)] - b[lo]) * (i - lo); };

  function sparkline(vals, years, label = '营业总收入', f = money) {
    const pts = vals.map((v, i) => [i, v]).filter(([, v]) => isNum(v));
    if (pts.length < 2) return '<span class="faint">—</span>';
    const W = 84, H = 26, lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    const x = (i) => 3 + (i / (vals.length - 1)) * (W - 6);
    const y = (v) => H - 4 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 8);
    let d = '', pen = false;
    vals.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    const last = pts[pts.length - 1], first = pts[0];
    const up = last[1] >= first[1];
    const title = vals.map((v, i) => `${years[i]}：${isNum(v) ? f(v) : '—'}`).join('\n');
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="${esc(label)}趋势"><title>${esc(label)}\n${title}</title>
      <path d="${d}" class="${up ? 'sp-up' : 'sp-dn'}"/><circle cx="${x(last[0])}" cy="${y(last[1])}" r="2.5" class="${up ? 'sp-up' : 'sp-dn'}"/></svg>`;
  }

  /* ---------- 首页 ---------- */
  const sum = (a) => a.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
  const median = (a) => { const b = a.filter(isNum).sort((p, q) => p - q); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };

  /* ---------- 组件：可滚动排行卡（方案 §3.2） ---------- */
  // 默认露出 5 行，悬停后卡内可滚到前 20；dir 覆盖默认排序方向；竖线为百强中位数
  const FIN_N = ROWS.filter((r) => FIN_INDS.includes(r.ind)).length;
  function rankCard(key, dir, title) {
    const mt = METRICS[key];
    const def = mt.better === 'low' ? 'asc' : 'desc';
    const list = ranked(key, { dir });
    const top = list.slice(0, 20);
    const med = median(list.map((r) => r.v));
    const max = Math.max(1e-9, ...top.map((r) => Math.abs(r.v)), Math.abs(med || 0));
    const note = [mt.note, mt.fin ? '' : `已剔除金融业 ${FIN_N} 家`, `百强中位数 ${mt.fmt(med)}`, '竖线 = 百强中位数'].filter(Boolean).join('\n');
    const href = `#/rank/${key}${dir && dir !== def ? '?dir=' + dir : ''}`;
    return `<article class="rank-card">
      <header><h3>${esc(title || mt.name + (dir && dir !== def ? '（倒序）' : ''))}</h3><span class="qi" data-tip="${esc(note)}">ⓘ</span></header>
      <div class="body" tabindex="0" aria-label="${esc(title || mt.name)} 前 20">${top.map((r, i) => `<a class="obs-row" href="#/${r.code}">
        <span class="i">${i + 1}</span><span class="n">${esc(r.name)}<small>${esc(r.ind)}</small></span>
        <span class="b"><i style="width:${(Math.abs(r.v) / max) * 100}%;--d:${Math.min(i, 5) * 60}ms" class="${mt.mkt ? cls(r.v) : ''}"></i>${isNum(med) && med > 0 ? `<em style="left:${(med / max) * 100}%"></em>` : ''}</span>
        <span class="v ${mt.mkt ? cls(r.v) : ''}">${mt.fmt(r.v)}</span></a>`).join('')}</div>
      <div class="more"><button class="rk-expand" type="button" aria-expanded="false">展开前 20</button><a href="${href}">查看全部 ${list.length} 家 →</a></div>
    </article>`;
  }
  const HOME_GROUPS = {
    // 默认只露 3 张常用卡，其余在分组标签与排行中心
    pick: ['常用', [['np25'], ['dy'], ['ytd']]],
    ...Object.fromEntries(Object.entries(GROUPS).map(([g, n]) => [g, [n, Object.keys(METRICS).filter((k) => METRICS[k].group === g).slice(0, 6).map((k) => [k])]]))
  };
  const rankGrid = (g) => HOME_GROUPS[g][1].map(([k, d, t]) => rankCard(k, d || undefined, t)).join('');

  // 指标条悬停：合计值的前 5 大贡献公司
  TIP_FN.top = (el) => {
    const k = el.dataset.m, list = ranked(k), tot = sum(list.map((r) => r.v));
    return `<div class="tip-h"><b>${esc(METRICS[k].name)} · 前 5 大贡献</b></div><div class="tip-list">${list.slice(0, 5).map((r, i) => `<div class="tip-row" style="--d:${i * 20}ms"><span class="n">${esc(r.name)}</span>
      <span class="b"><i style="width:${(r.v / list[0].v) * 100}%"></i></span><span class="v">${money(r.v)}</span><span class="v">${pct((r.v / tot) * 100, 1)}</span></div>`).join('')}</div>
      <div class="tip-f">前 5 家合计占 ${pct((sum(list.slice(0, 5).map((r) => r.v)) / tot) * 100, 1)}</div>`;
  };

  /* 行业 × 指标热力图（方案 §6.2）：格值 = 行业中位数，颜色 = 该列在 20 个行业中的分位（已按优劣方向） */
  const HM_COLS = ['roe', 'nm', 'cagr', 'pe', 'pb', 'dy', 'ytd', 'debt'];
  const heatColor = (p) => { const k = p / 100, a = [240, 240, 238], b = [31, 35, 40]; return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * k)).join(',')})`; };
  function heatmap() {
    const inds = Object.keys(INDUSTRY).sort((a, b) => sum(INDUSTRY[b].map((k) => ROW[k].mv)) - sum(INDUSTRY[a].map((k) => ROW[k].mv)));
    const cell = {}, allMed = {};
    HM_COLS.forEach((k) => {
      const mt = METRICS[k];
      allMed[k] = median(CODES.filter((c) => mt.fin || !isFin(c)).map((c) => mval(k, c)));
      inds.forEach((ind) => {
        if (!mt.fin && FIN_INDS.includes(ind)) { cell[ind + k] = { na: true }; return; }
        const vs = INDUSTRY[ind].map((c) => ({ c, v: mval(k, c) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
        cell[ind + k] = { v: median(vs.map((x) => x.v)), hi: vs[0], lo: vs[vs.length - 1] };
      });
      const meds = inds.map((ind) => cell[ind + k].v);
      inds.forEach((ind) => { const x = cell[ind + k]; if (isNum(x.v)) x.p = pctRank(meds, x.v, mt.better !== 'low'); });
    });
    const nm = (c) => COMPANIES[c].identity.name_abbr;
    return `<div class="tblwrap"><table class="heat"><thead><tr><th>行业</th>${HM_COLS.map((k) => `<th title="${esc(METRICS[k].note || '')}">${esc(shortName(METRICS[k]))}</th>`).join('')}</tr></thead><tbody>
      ${inds.map((ind) => `<tr><th><a href="#/industry?ind=${encodeURIComponent(ind)}">${esc(ind)}</a><small>${INDUSTRY[ind].length}</small></th>${HM_COLS.map((k) => {
        const x = cell[ind + k], mt = METRICS[k];
        if (x.na) return '<td class="na-cell" title="金融业不适用">—</td>';
        if (!isNum(x.v)) return '<td class="na-cell">—</td>';
        const col = heatColor(x.p);
        const tip = `${ind} · ${mt.name}\n行业中位数 ${mt.fmt(x.v)}（20 个行业中第 ${fmt(x.p, 0)} 分位）\n百强中位数 ${mt.fmt(allMed[k])}\n行业内最高 ${nm(x.hi.c)} ${mt.fmt(x.hi.v)} · 最低 ${nm(x.lo.c)} ${mt.fmt(x.lo.v)}\n点击查看行业内排名`;
        return `<td style="background:${col};color:${inkFor(col)}"><a href="#/rank/${k}?ind=${encodeURIComponent(ind)}${mt.fin ? '' : ''}" title="${esc(tip)}">${esc(mt.fmt(x.v).replace(/ 倍$/, ''))}</a></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* 分布面板（方案 §6.3）：当日涨跌分箱柱 / 年初至今条带 */
  const CHG_BINS = [[-Infinity, -3, '≤ −3%'], [-3, -1, '−3 ~ −1%'], [-1, 0, '−1 ~ 0'], [0, 0, '平盘'], [0, 1, '0 ~ 1%'], [1, 3, '1 ~ 3%'], [3, Infinity, '≥ 3%']];
  function distView(host, mode) {
    if (mode === 'ytd') { const list = ranked('ytd'); host.innerHTML = stripPlot(list, METRICS.ytd, Math.max(260, host.clientWidth), Math.max(150, host.clientHeight - 30)) + '<div class="chart-foot">每点一家公司，大小 = 总市值；悬停看名称，点击进入。</div>'; return; }
    const bins = CHG_BINS.map(([a, b, n]) => ({ n, a, b, list: ROWS.filter((r) => isNum(r.chg) && (a === b ? r.chg === 0 : r.chg > a && r.chg <= b && r.chg !== 0)) }));
    const max = Math.max(1, ...bins.map((x) => x.list.length));
    host._bins = bins;
    host.innerHTML = `<div class="hist">${bins.map((x, bi) => `<div class="hcol" data-bin="${bi}" role="button" tabindex="0" title="${esc(x.n + ' · ' + x.list.length + ' 家\n' + x.list.slice(0, 15).map((r) => r.name + ' ' + spct(r.chg)).join('\n') + (x.list.length > 15 ? '\n…' : ''))}">
        <span class="hn">${x.list.length}</span><i class="${x.a >= 0 && x.b > 0 ? 'up' : x.b <= 0 && x.a < 0 ? 'down' : ''}" style="height:${(x.list.length / max) * 100}%"></i><span class="hl">${x.n}</span></div>`).join('')}</div>
      <div class="chart-foot">2026-10-22 当日涨跌幅分布；点击柱子列出该区间的公司。</div><div class="binlist" id="binlist"></div>`;
  }

  // 点击分布柱：在下方列出该区间公司（按涨跌幅排序），可进入公司页
  function showBin(host, bi) {
    const x = host._bins[bi], box = host.querySelector('#binlist');
    host.querySelectorAll('.hcol').forEach((c) => c.classList.toggle('on', +c.dataset.bin === bi));
    const list = [...x.list].sort((a, b) => b.chg - a.chg);
    box.innerHTML = `<div class="bl-h"><b>${x.n}</b><span>${list.length} 家</span><a class="morelink" href="#/list?sort=chg">在榜单中查看 →</a></div>`
      + (list.length ? `<div class="bl-body">${list.map((r) => `<a href="#/${r.code}"><span>${esc(r.name)}<small>${esc(r.ind)}</small></span><b class="${cls(r.chg)}">${spct(r.chg)}</b></a>`).join('')}</div>` : '<div class="empty">该区间没有公司</div>');
  }
  // 年初至今前后 5 名（填补分布面板下方空白）
  function ytdEnds() {
    const list = ranked('ytd');
    const row = (r) => `<a href="#/${r.code}"><span>${esc(r.name)}<small>${esc(r.ind)}</small></span><b class="${cls(r.v)}">${spct(r.v)}</b></a>`;
    return `<div class="ytd-ends"><div><h3>年初至今涨幅前 5</h3>${list.slice(0, 5).map(row).join('')}</div><div><h3>年初至今跌幅前 5</h3>${list.slice(-5).reverse().map(row).join('')}</div></div>
      <a class="morelink" href="#/rank/ytd">年初至今全部排名 →</a>`;
  }

  const TOP_MODES = { mv: ['市值前 20', 'mv', 'desc'], up: ['当日领涨', 'chg', 'desc'], dn: ['当日领跌', 'chg', 'asc'], amt: ['成交额前 20', 'amount', 'desc'] };
  function topTable(mode) {
    const [, k, dir] = TOP_MODES[mode];
    return ranked(k, { dir }).slice(0, 20).map((r) => `
      <tr tabindex="0" data-href="#/${r.code}">
        <td class="rk">${r.rank}</td>
        <td class="nm"><div class="nmw">${logo(r.code, 24)}<div><a href="#/${r.code}" tabindex="-1">${esc(r.name)}</a><small>${r.code}</small></div></div></td>
        <td class="muted">${esc(r.ind)}</td>
        <td class="num">${money(r.mv)}</td>
        <td class="num ${cls(r.chg)}">${spct(r.chg)}</td>
        <td class="num">${money(mval('amount', r.code))}</td>
        <td class="num">${isNum(r.pe) ? num(r.pe) : NA(NA_WHY.pe)}</td>
        <td class="num">${pct(r.dy)}</td>
        <td>${sparkline(r.revs, r.years)}</td>
      </tr>`).join('');
  }

  function homeView() {
    const tmv = sum(ROWS.map((r) => r.mv)), trev = sum(ROWS.map((r) => r.rev25)), tnp = sum(ROWS.map((r) => r.np25));
    const boards = ['主板', '科创板', '创业板'].map((b) => ({ b, n: ROWS.filter((r) => r.board === b).length, mv: sum(ROWS.filter((r) => r.board === b).map((r) => r.mv)) }));
    const upN = ROWS.filter((r) => r.chg > 0).length, dnN = ROWS.filter((r) => r.chg < 0).length;
    const favList = favs().filter((k) => COMPANIES[k]);
    const inds = Object.keys(INDUSTRY).map((ind) => indItem(ind, tmv)).sort((a, b) => b.mv - a.mv);
    return `
    ${siteHeader('home')}
    <div class="wrap home dash-page">
      <div class="dash-head">
        <div><div class="kicker">市场总览 · 数据截至 ${esc(DATA.meta.as_of_date)} 收盘 · 财务 2026 年中报</div><h1 class="ptitle">A 股市值前 100 家公司</h1></div>
        <div class="hot">${favList.length ? `<span class="favs">收藏：${favList.map((k) => `<a href="#/${k}">${esc(COMPANIES[k].identity.name_abbr)}</a>`).join('')}</span>` : ''}</div>
      </div>

      <div class="hgroup"><h2>样本概况</h2><span>行情 ${esc(DATA.meta.as_of_date)} 收盘 · 合计为 2025 年报</span></div>
      <section class="statstrip">
        <div><div class="k">百强合计总市值</div><div class="v"><span class="cu" data-v="${tmv}" data-f="money">${money(tmv)}</span></div><div class="s">2026-10-22 收盘</div></div>
        <div data-tip-fn="top" data-m="rev25"><div class="k">2025 年营业总收入合计 <span class="qi">ⓘ</span></div><div class="v"><span class="cu" data-v="${trev}" data-f="money">${money(trev)}</span></div><div class="s">100 家年报合计</div></div>
        <div data-tip-fn="top" data-m="np25"><div class="k">2025 年归母净利润合计 <span class="qi">ⓘ</span></div><div class="v"><span class="cu" data-v="${tnp}" data-f="money">${money(tnp)}</span></div><div class="s">含亏损公司</div></div>
        <a class="stat-link" href="#/rank/chg"><div class="k">当日涨跌家数</div><div class="v"><span class="up">${upN}</span><span class="slash">/</span><span class="down">${dnN}</span></div><div class="s">平盘 ${100 - upN - dnN} 家 · 股息率中位数 ${pct(median(ROWS.map((r) => r.dy)))}</div></a>
        <div class="boards">
          <div class="k">板块构成（按市值）</div>
          <div class="bstack">${boards.map((x, i) => `<a href="#/list?board=${encodeURIComponent(x.b)}" style="width:${(x.mv / tmv) * 100}%;background:${COLORS[i]}" title="${x.b} ${x.n} 家 · ${money(x.mv)}\n点击查看"></a>`).join('')}</div>
          <div class="blegend">${boards.map((x, i) => `<span><i style="background:${COLORS[i]}"></i>${x.b} ${x.n} 家 · ${pct((x.mv / tmv) * 100, 1)}</span>`).join('')}</div>
        </div>
      </section>

      <div class="hgroup"><h2>行业构成</h2></div>
      <div class="dash">
        <section class="panel span-8" id="industry">
          <header><h2>行业版图</h2>
            <div class="tabs" id="tmcolor" role="tablist"><button role="tab" data-t="mv" aria-selected="true">按市值</button><button role="tab" data-t="ytd" aria-selected="false">按年初至今涨跌</button></div></header>
          <div class="tm-bar"><div class="crumbs" id="tmcrumb"></div><div class="tm-legend" id="tmlegend"></div></div>
          <div class="treemap" id="treemap" aria-label="行业矩形树图"></div>
          <div class="chart-foot">行业为申万一级。年初至今为行业内按市值加权（不含无基准价的新股）。</div>
        </section>
        <section class="panel span-4">
          <header><h2>行业列表</h2><span class="note">与树图联动 · 点击下钻</span></header>
          <div class="indlist"><table class="tbl compact"><thead><tr><th>行业</th><th class="num">总市值</th><th class="num">占比</th><th class="num">年初至今</th></tr></thead>
            <tbody id="indlist">${inds.map((it) => `<tr data-k="${esc(it.key)}" tabindex="0"><td><a href="#/industry?ind=${encodeURIComponent(it.key)}" tabindex="-1">${esc(it.label)}</a><small>${it.n} 家</small></td><td class="num">${money(it.mv)}</td><td class="num">${pct(it.share, 1)}</td><td class="num ${cls(it.ytd)}">${spct(it.ytd, 1)}</td></tr>`).join('')}</tbody></table></div>
        </section>

      </div>

      <div class="hgroup"><h2>百强榜单</h2></div>
      <div class="dash">
        <section class="panel span-12">
          <header><div class="tabs" id="toptabs" role="tablist">${Object.entries(TOP_MODES).map(([k, [n]], i) => `<button role="tab" data-t="${k}" aria-selected="${i === 0}">${n}</button>`).join('')}</div>
            <a class="morelink" href="#/list">全部 100 家 · 排序与筛选 →</a></header>
          <div class="tblwrap"><table class="tbl rank-tbl compact"><thead><tr><th>排名</th><th>公司</th><th>行业</th><th class="num">总市值</th><th class="num">涨跌幅</th><th class="num">成交额</th><th class="num">市盈率</th><th class="num">股息率</th><th>营收趋势</th></tr></thead><tbody id="preview">${topTable('mv')}</tbody></table></div>
        </section>
      </div>

      <div class="hgroup"><h2>继续探索</h2></div>
      <div class="dash">
        <section class="panel span-12" id="obs">
          <header><h2>数据观察</h2>
            <div class="tabs" id="rkgroup" role="tablist">${Object.entries(HOME_GROUPS).map(([g, [n]], i) => `<button role="tab" data-t="${g}" aria-selected="${i === 0}">${n}</button>`).join('')}</div>
            <a class="morelink" href="#/rank">排行中心 →</a></header>
          <div class="rankgrid" id="rankgrid">${rankGrid('pick')}</div>
        </section>
      </div>
      <details class="more-explore" id="moreexp">
        <summary>展开更多：行业 × 指标热力图、涨跌分布</summary>
        <div class="dash">
          <section class="panel span-7">
            <header><h2>行业 × 指标热力图</h2></header>
            ${heatmap()}
          </section>
          <section class="panel span-5">
            <header><h2>分布</h2><div class="tabs" id="disttabs" role="tablist"><button role="tab" data-t="chg" aria-selected="true">当日涨跌</button><button role="tab" data-t="ytd" aria-selected="false">年初至今</button></div></header>
            <div class="strip-host" id="dist"></div>
            <div class="sub-sep"></div>
            ${ytdEnds()}
          </section>
        </div>
      </details>

      ${pageFoot()}
    </div>`;
  }
  const pageFoot = () => `<footer>
      <span>行情 ${esc(DATA.meta.as_of_date)} 收盘快照，非实时</span><span>财务最新期 2026 年中报</span>
      <span>来源：东方财富 · 巨潮资讯 · 港交所 · 中证指数 · 国证指数 · 上证e互动 · 深交所互动易 · 理杏仁 · 准上市</span>
      <span>本站为课程作业，仅整理公开信息，不构成投资建议 · <a href="#/about">关于本项目</a></span></footer>`;

  function bindHome() {
    bindJump();
    document.querySelectorAll('.cu').forEach(countUp);
    const preview = document.getElementById('preview');
    bindRowNav(preview);
    tabs('toptabs', (k) => { preview.innerHTML = topTable(k); });
    const grid = document.getElementById('rankgrid');
    tabs('rkgroup', (k) => { grid.innerHTML = rankGrid(k); });
    const dist = document.getElementById('dist');
    let distMode = 'chg';
    dist._redraw = () => distView(dist, distMode);
    dist._redraw();
    tabs('disttabs', (k) => { distMode = k; dist._redraw(); });
    // 折叠区展开后宽度才确定，再按实际宽度重绘
    document.getElementById('moreexp').addEventListener('toggle', (e) => { if (e.target.open) dist._redraw(); });
    dist.addEventListener('click', (e) => {
      const d = e.target.closest('[data-k]');
      if (d) { location.hash = '#/' + d.dataset.k; return; }
      const h = e.target.closest('.hcol[data-bin]');
      if (h) showBin(dist, +h.dataset.bin);
    });
    dist.addEventListener('keydown', (e) => { const h = e.target.closest('.hcol[data-bin]'); if (h && e.key === 'Enter') showBin(dist, +h.dataset.bin); });

    /* 行业矩形树图 + 行业列表联动 */
    const host = document.getElementById('treemap');
    const list = document.getElementById('indlist');
    const st = { color: 'mv', ind: null };
    host._redraw = (anim) => { drawTreemap(host, st, anim); mark(null); };
    tabs('tmcolor', (k) => { st.color = k; host._redraw(true); });
    host._redraw(true);
    // 容器宽度变化（左侧栏挂载、缩放、窗口变化）时按新宽度重算，保证格子不超出框
    let lastW = host.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 1) { lastW = host.clientWidth; host._redraw(false); } });
    ro.observe(host);
    // 列表行 ↔ 树图格子：小行业在顶层并入「其他」格
    const tileFor = (k) => host.querySelector(`.tile[data-k="${CSS.escape(k)}"]`) || (!st.ind ? host.querySelector(`.tile[data-k="${OTHER}"]`) : null);
    function mark(k) {
      host.classList.toggle('hov', !!k);
      host.querySelectorAll('.tile.hl').forEach((t) => t.classList.remove('hl'));
      list.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('hl', tr.dataset.k === k || (!k && tr.dataset.k === st.ind)));
      if (k && !st.ind) { const t = tileFor(k); if (t) t.classList.add('hl'); }
    }
    list.addEventListener('mouseover', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) mark(tr.dataset.k); });
    list.addEventListener('mouseleave', () => mark(null));
    host.addEventListener('mouseover', (e) => {
      const t = e.target.closest('.tile');
      if (!t || st.ind) return;
      list.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('hl', tr.dataset.k === t.dataset.k || (t.dataset.k === OTHER && host._items.find((x) => x.other)?.subs.some((s) => s.key === tr.dataset.k))));
    });
    host.addEventListener('mouseleave', () => mark(null));
    list.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (!tr || e.target.closest('a')) return;
      st.ind = tr.dataset.k; host._redraw(true);
    });
    list.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (tr && e.key === 'Enter') { st.ind = tr.dataset.k; host._redraw(true); }
    });
    observers = [ro];
  }

  /* ---------- 矩形树图（squarified） ---------- */
  function squarify(values, x, y, w, h) {
    const total = values.reduce((a, b) => a + b, 0);
    const areas = values.map((v) => (v / total) * w * h);
    const out = [];
    const worst = (row, s) => {
      const rs = row.reduce((a, b) => a + b, 0), mx = Math.max(...row), mn = Math.min(...row);
      return Math.max((s * s * mx) / (rs * rs), (rs * rs) / (s * s * mn));
    };
    let i = 0;
    while (i < areas.length) {
      const s = Math.min(w, h);
      const row = [areas[i]];
      let j = i + 1;
      while (j < areas.length && worst([...row, areas[j]], s) <= worst(row, s)) { row.push(areas[j]); j++; }
      const rs = row.reduce((a, b) => a + b, 0);
      if (w >= h) {
        const cw = rs / h; let yy = y;
        row.forEach((a) => { out.push({ x, y: yy, w: cw, h: a / cw }); yy += a / cw; });
        x += cw; w -= cw;
      } else {
        const rh = rs / w; let xx = x;
        row.forEach((a) => { out.push({ x: xx, y, w: a / rh, h: rh }); xx += a / rh; });
        y += rh; h -= rh;
      }
      i = j;
    }
    return out;
  }

  // 涨跌着色：A 股红涨绿跌，深浅表示幅度
  const mktColor = (v) => {
    if (!isNum(v)) return '#D6D8DB';
    const k = Math.min(1, Math.abs(v) / 40);
    const [r, g, b] = v >= 0 ? [217, 58, 58] : [19, 160, 111];
    const mix = (c) => Math.round(244 - (244 - c) * (0.25 + 0.75 * k));
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  };
  // 市值占比着色：浅蓝 → 深海军蓝（k = 相对最大格的市值比，开方后映射）
  const shareColor = (k) => {
    const t = Math.sqrt(Math.max(0, Math.min(1, k))), a = [228, 230, 233], b = [31, 35, 40];
    return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * (0.08 + 0.92 * t))).join(',')})`;
  };
  const inkFor = (col) => {
    const [r, g, b] = col.match(/\d+/g).map(Number);
    return (r * 299 + g * 587 + b * 114) / 1000 < 150 ? '#fff' : 'var(--color-text-primary)';
  };

  // 格子太窄放不下全称时用的简称；悬停提示始终显示全称
  const IND_SHORT = { '交通运输': '交运', '国防军工': '军工', '基础化工': '化工', '机械设备': '机械', '非银金融': '非银', '食品饮料': '食饮',
    '公用事业': '公用', '电力设备': '电新', '医药生物': '医药', '有色金属': '有色', '家用电器': '家电', '石油石化': '石化', '建筑装饰': '建筑', '计算机': '计算机' };
  const OTHER = '__other', OTHER_SHARE = 1.2; // 占比低于 1.2% 的行业合并为「其他」
  let measureCtx;
  const textW = (s, px, bold) => {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${bold ? 600 : 400} ${px}px system-ui, sans-serif`;
    return measureCtx.measureText(s).width;
  };
  const indItem = (ind, tmv) => {
    const rows = INDUSTRY[ind].map((k) => ROW[k]);
    const mv = sum(rows.map((r) => r.mv));
    const w = rows.filter((r) => isNum(r.ytd));
    const ytd = w.length ? sum(w.map((r) => r.ytd * r.mv)) / sum(w.map((r) => r.mv)) : null;
    return { key: ind, label: ind, mv, n: rows.length, ytd, share: (mv / tmv) * 100, rows: [...rows].sort((a, b) => b.mv - a.mv) };
  };
  // 悬停浮层：行业列出成分公司（最多 8 家）+ 市值条；公司显示行情
  TIP_FN.tm = (el) => {
    const it = el.closest('.treemap')._items[+el.dataset.i];
    if (it.code) {
      return `<div class="tip-h"><b>${esc(it.label)}</b><span>${it.code}</span></div>
        <div class="tip-kv"><span>总市值</span><b>${money(it.mv)}</b><span>行业内占比</span><b>${pct(it.share, 1)}</b>
        <span>年初至今</span><b class="${cls(it.ytd)}">${spct(it.ytd)}</b><span>当日</span><b class="${cls(it.chg)}">${spct(it.chg)}</b></div>
        <div class="tip-f">${esc(it.sub || '')} · 点击进入公司档案</div>`;
    }
    const rows = it.subs ? it.subs : it.rows;
    const max = Math.max(...rows.map((r) => r.mv));
    const list = rows.slice(0, 8).map((r, i) => `<div class="tip-row" style="--d:${i * 20}ms"><span class="n">${esc(r.name || r.label)}</span>
      <span class="b"><i style="width:${(r.mv / max) * 100}%"></i></span><span class="v">${money(r.mv)}</span>
      <span class="v ${cls(r.ytd)}">${spct(r.ytd, 1)}</span></div>`).join('');
    return `<div class="tip-h"><b>${esc(it.label)}</b><span>${it.subs ? it.subs.length + ' 个行业' : it.n + ' 家'}</span></div>
      <div class="tip-sub">${money(it.mv)} · 占百强 ${pct(it.share, 1)} · 年初至今（加权）<b class="${cls(it.ytd)}">${spct(it.ytd)}</b></div>
      <div class="tip-list">${list}</div>
      <div class="tip-f">${rows.length > 8 ? `另 ${rows.length - 8} ${it.subs ? '个行业' : '家'} · ` : ''}点击下钻</div>`;
  };

  function drawTreemap(host, st, anim) {
    const W = host.clientWidth, H = W < 640 ? Math.round(W * 1.15) : Math.round(Math.min(560, W * 0.5));
    host.style.height = H + 'px';
    const tmv = sum(ROWS.map((r) => r.mv));
    const all = Object.keys(INDUSTRY).map((ind) => indItem(ind, tmv));
    const small = all.filter((x) => x.share < OTHER_SHARE).sort((a, b) => b.mv - a.mv);
    let items;
    if (!st.ind) {
      items = all.filter((x) => x.share >= OTHER_SHARE);
      if (small.length > 1) {
        const mv = sum(small.map((x) => x.mv));
        const ytd = sum(small.map((x) => (isNum(x.ytd) ? x.ytd * x.mv : 0))) / sum(small.filter((x) => isNum(x.ytd)).map((x) => x.mv));
        items.push({ key: OTHER, label: `其他 ${small.length} 个行业`, mv, n: sum(small.map((x) => x.n)), ytd, share: (mv / tmv) * 100, subs: small, other: true });
      } else items.push(...small);
    } else if (st.ind === OTHER) {
      items = small;
    } else {
      const imv = sum(INDUSTRY[st.ind].map((k) => ROW[k].mv));
      items = INDUSTRY[st.ind].map((k) => ({ key: k, label: ROW[k].name, mv: ROW[k].mv, ytd: ROW[k].ytd, share: (ROW[k].mv / imv) * 100, code: k, sub: ROW[k].ind2, chg: ROW[k].chg }));
    }
    items.sort((a, b) => (a.other ? 1 : b.other ? -1 : b.mv - a.mv));
    host._items = items;
    const rects = squarify(items.map((x) => x.mv), 0, 0, W, H);
    const maxMv = Math.max(...items.filter((x) => !x.other).map((x) => x.mv));
    host.innerHTML = items.map((it, i) => {
      const r = rects[i];
      // 市值模式：按占比做蓝色深浅渐变（开方压缩，避免最大格独占深色）；涨跌模式红绿发散
      const col = st.color === 'ytd' ? mktColor(it.ytd) : it.other ? 'rgb(232,232,230)' : shareColor(it.mv / maxMv);
      const iw = r.w - 24; // 减去左右内边距
      const tvPx = textW(money(it.mv), 20, true) <= iw ? 20 : 16;
      // 高度不足时逐级减少内容：名称+数值+占比 → 名称+数值 → 只有名称
      const big = r.w >= 84 && r.h >= 70 && textW(money(it.mv), tvPx, true) <= iw;
      const tsFull = st.color === 'ytd' ? '年初至今 ' + spct(it.ytd) : (it.code ? '行业内 ' : '占比 ') + pct(it.share, 1) + (!it.code ? ' · ' + it.n + ' 家' : '');
      const tsShort = st.color === 'ytd' ? spct(it.ytd) : pct(it.share, 1);
      const ts = r.h < 92 ? '' : textW(tsFull, 12) <= iw ? tsFull : textW(tsShort, 12) <= iw ? tsShort : '';
      let label = '';
      if (r.w >= 40 && r.h >= 26) {
        const px = r.w < 80 ? 12 : 13;
        const short = IND_SHORT[it.label];
        if (textW(it.label, px, true) <= iw) label = it.label;
        else if (short && textW(short, px, true) <= iw) label = short;
        else if (it.other && textW('其他', px, true) <= iw) label = '其他';
        if (label) label = `<span class="tn" style="font-size:${px}px">${esc(label)}</span>`;
      }
      return `<button class="tile${it.other ? ' other' : ''}" data-k="${esc(it.key)}" data-i="${i}" data-tip-fn="tm" aria-label="${esc(it.label)}"
        style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${col};color:${inkFor(col)};--d:${anim && !REDUCED ? i * 25 : 0}ms">
        ${label}
        ${big && label ? `<span class="tv" style="font-size:${tvPx}px">${money(it.mv)}</span>${ts ? `<span class="ts">${ts}</span>` : ''}` : ''}
      </button>`;
    }).join('');
    if (!anim) host.classList.add('still'); else host.classList.remove('still');

    const crumb = document.getElementById('tmcrumb');
    crumb.innerHTML = st.ind === OTHER
      ? `<button id="tmback">← 全部行业</button><b>其他 ${small.length} 个行业</b><span class="faint">各占百强不足 ${OTHER_SHARE}% · 合计 ${money(sum(small.map((x) => x.mv)))}</span>`
      : st.ind
        ? `<button id="tmback">← 全部行业</button><b>${esc(st.ind)}</b><span class="faint">${INDUSTRY[st.ind].length} 家 · ${money(sum(INDUSTRY[st.ind].map((k) => ROW[k].mv)))}</span><a class="morelink" href="#/industry?ind=${encodeURIComponent(st.ind)}">行业详情：估值与盈利散点 →</a>`
        : `<b>全部 ${Object.keys(INDUSTRY).length} 个申万一级行业</b><span class="faint">合计 ${money(tmv)}</span>`;
    document.getElementById('tmlegend').innerHTML = st.color === 'ytd'
      ? '<span class="lgd"><i style="background:' + mktColor(-40) + '"></i>−40%</span><span class="lgd"><i style="background:' + mktColor(0) + '"></i>0</span><span class="lgd"><i style="background:' + mktColor(40) + '"></i>+40%</span><span class="lgd"><i style="background:#D6D8DB"></i>无基准</span>'
      : '';
    const back = document.getElementById('tmback');
    if (back) back.addEventListener('click', () => { st.ind = null; host._redraw(true); });
    host.onclick = (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      tipEl.classList.remove('on');
      if (st.ind && st.ind !== OTHER) location.hash = '#/' + t.dataset.k;
      else { st.ind = t.dataset.k; host._redraw(true); }
    };
  }

  /* ---------- 杜邦分解（方案 §7.2 #2）：ROE ≈ 净利率 × 总资产周转率 × 权益乘数，用期末值近似 ---------- */
  function dupont(c) {
    return (c.financials.annual || []).map((r) => {
      const ok = isNum(r.net_profit) && r.revenue > 0 && r.total_assets > 0 && r.equity_parent > 0;
      if (!ok) return { y: r.fiscal_year, roe: r.roe };
      const nm = (r.net_profit / r.revenue) * 100, at = r.revenue / r.total_assets, em = r.total_assets / r.equity_parent;
      return { y: r.fiscal_year, nm, at, em, calc: (nm * at * em), roe: r.roe };
    });
  }
  const DP_ALL = CODES.map((k) => dupont(COMPANIES[k])[4] || {});
  const DP_F = [['nm', '净利率', (v) => pct(v)], ['at', '总资产周转率', (v) => num(v) + ' 次'], ['em', '权益乘数', (v) => num(v) + ' 倍']];
  // 主驱动：三项因子在百强中的百分位最高者
  const dpDriver = (d) => {
    if (!isNum(d?.nm)) return null;
    const ps = DP_F.map(([k, n]) => [n, pctRank(DP_ALL.map((x) => x[k]), d[k], true)]);
    return ps.sort((a, b) => b[1] - a[1])[0];
  };
  function dupontBlock(c) {
    const rows = dupont(c);
    const last = rows[4];
    if (!rows.some((r) => isNum(r.nm))) return '';
    const drv = dpDriver(last);
    const p = (k, v) => pctRank(DP_ALL.map((x) => x[k]), v, true);
    return `<div class="sub">杜邦分解 · ROE 从哪里来<span class="note">ROE ≈ 净利率 × 总资产周转率 × 权益乘数（用期末值近似，与报告的加权 ROE 有差异）</span></div>
      ${isNum(last?.nm) ? `<div class="dp-cards">${DP_F.map(([k, n, f]) => `<div class="kpi${drv && drv[0] === n ? ' drv' : ''}"><div class="k">${n} 2025</div><div class="v">${f(last[k])}</div>
        <div class="pbar" data-tip="在百强中位于第 ${fmt(p(k, last[k]), 0)} 百分位"><i style="left:${p(k, last[k])}%"></i></div><div class="s">百强分位 ${fmt(p(k, last[k]), 0)}</div></div>`).join('<div class="dp-x">×</div>')}
        <div class="dp-x">=</div><div class="kpi"><div class="k">计算 ROE</div><div class="v">${pct(last.calc)}</div><div class="s">报告 ROE ${pct(last.roe)}</div></div></div>
        ${drv ? `<p class="dp-note">主驱动：<b>${drv[0]}</b>（三项中百强分位最高）。${drv[0] === '权益乘数' ? '高杠杆是金融业的业务特征，与实业公司比较时需注意。' : ''}</p>` : ''}` : ''}
      <div class="tblwrap"><table class="tbl compact"><thead><tr><th>年度</th>${DP_F.map(([, n]) => `<th class="num">${n}</th>`).join('')}<th class="num">计算 ROE</th><th class="num">报告 ROE</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.y}</td>${DP_F.map(([k, , f]) => `<td class="num">${isNum(r[k]) ? f(r[k]) : NA('该年无数据')}</td>`).join('')}<td class="num">${pct(r.calc)}</td><td class="num">${pct(r.roe)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // 按分组排列的指标下拉框
  const metricSelect = (id, sel, full) => `<select id="${id}">${Object.entries(GROUPS).map(([g, n]) => `<optgroup label="${n}">${Object.keys(METRICS).filter((k) => METRICS[k].group === g).map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(full && SC_FULL[k] ? SC_FULL[k][0] : METRICS[k].name)}</option>`).join('')}</optgroup>`).join('')}</select>`;

  /* ---------- 排行中心 #/rank 与单指标全量页 #/rank/<key>（方案 §6.4） ---------- */
  /* 组合筛选（方案 §6.1）：多条件同时满足的公司，纯规则筛选 */
  const COMBOS = [
    { name: '股息率高 · 市净率低', desc: '股息率位于百强前 25%，且市净率 ≤ 百强中位数；按股息率排序', cols: ['dy', 'pb'],
      test: (k, md) => mval('dy', k) >= md.dy75 && mval('pb', k) != null && mval('pb', k) <= md.pb, sort: 'dy' },
    { name: '盈利质量', desc: 'ROE ≥ 10% 且经营现金流 / 净利 ≥ 1 倍（剔除金融业）；按 ROE 排序', cols: ['roe', 'ocfnp'],
      test: (k) => !isFin(k) && mval('roe', k) >= 10 && mval('ocfnp', k) >= 1, sort: 'roe' },
    { name: '量价背离', desc: '营收 3 年复合 > 0，但年初至今下跌；按营收增速排序', cols: ['cagr', 'ytd'],
      test: (k) => mval('cagr', k) > 0 && mval('ytd', k) < 0, sort: 'cagr' },
    { name: '分红稳定', desc: '连续分红 ≥ 6 年且 5 年分红率 ≥ 40%；按分红率排序', cols: ['payout', 'divyears'],
      test: (k) => mval('divyears', k) >= 6 && mval('payout', k) >= 40, sort: 'payout' }
  ];
  function comboCard(cb) {
    const md = { dy75: quantile(CODES.map((k) => mval('dy', k)), 0.75), pb: median(CODES.map((k) => mval('pb', k))) };
    const list = CODES.filter((k) => cb.test(k, md)).sort((a, b) => mval(cb.sort, b) - mval(cb.sort, a));
    return `<article class="rank-card combo"><header><h3>${esc(cb.name)}</h3><span class="badge">${list.length} 家</span><span class="qi" data-tip="${esc(cb.desc)}">ⓘ</span></header>
      <div class="combo-desc">${esc(cb.desc)}</div>
      <div class="body" tabindex="0">${list.map((k, i) => `<a class="obs-row combo-row" href="#/${k}"><span class="i">${i + 1}</span><span class="n">${esc(ROW[k].name)}<small>${esc(ROW[k].ind)}</small></span>
        ${cb.cols.map((c) => `<span class="v ${METRICS[c].mkt ? cls(mval(c, k)) : ''}">${METRICS[c].fmt(mval(c, k))}</span>`).join('')}</a>`).join('') || '<div class="empty">无符合条件的公司</div>'}</div>
      <div class="more combo-cols">${cb.cols.map((c) => esc(shortName(METRICS[c]))).join(' · ')}</div></article>`;
  }
  // 杜邦驱动分布：每家 ROE 的主驱动因子
  function dupontCard() {
    const g = {};
    CODES.forEach((k) => { const d = dpDriver(dupont(COMPANIES[k])[4]); if (d) (g[d[0]] ||= []).push(k); });
    return `<article class="rank-card combo"><header><h3>ROE 主驱动</h3><span class="qi" data-tip="杜邦分解：ROE ≈ 净利率 × 总资产周转率 × 权益乘数；三项中百强分位最高者为主驱动">ⓘ</span></header>
      <div class="combo-desc">按杜邦分解的主驱动因子归类（2025 年报）</div>
      <div class="body" tabindex="0">${DP_F.map(([, n]) => `<div class="drv-g"><b>${n}驱动</b><small>${(g[n] || []).length} 家</small><div>${(g[n] || []).sort((a, b) => ROW[a].rank - ROW[b].rank).map((k) => `<a href="#/${k}/fin">${esc(ROW[k].name)}</a>`).join('')}</div></div>`).join('')}</div>
      <div class="more combo-cols">点击公司看其杜邦分解</div></article>`;
  }

  // 默认展开的常用维度；其余收进「更多指标」，多条件现象放最后
  const RANK_MAIN = ['profit', 'value', 'return', 'market'];
  const RANK_MORE = Object.keys(GROUPS).filter((g) => !RANK_MAIN.includes(g));
  function rankView() {
    const sec = (g) => `<section class="hsec" id="rg-${g}"><header><div><h2>${GROUPS[g]}</h2></div></header>
        <div class="rankgrid">${Object.keys(METRICS).filter((k) => METRICS[k].group === g).map((k) => rankCard(k)).join('')}</div></section>`;
    return `
    ${siteHeader('rank')}
    <div class="wrap rankpage">
      <div class="kicker">排行中心</div>
      <h1 class="ptitle">按维度看百强</h1>
      <nav class="ichips">${[...RANK_MAIN, ...RANK_MORE].map((g) => `<a class="ichip" href="#/rank" data-g="${g}">${GROUPS[g]}</a>`).join('')}<a class="ichip" href="#/rank" data-g="combo">多条件现象</a></nav>
      ${RANK_MAIN.map(sec).join('')}
      <details class="more-explore" id="rkmore">
        <summary>展开更多指标：${RANK_MORE.map((g) => GROUPS[g]).join('、')}</summary>
        ${RANK_MORE.map(sec).join('')}
      </details>
      <section class="hsec" id="rg-combo"><header><div><h2>多条件现象</h2></div></header>
        <div class="rankgrid">${COMBOS.map(comboCard).join('')}${dupontCard()}</div></section>
      ${pageFoot()}
    </div>`;
  }
  function bindRank() {
    bindJump();
    document.querySelector('.ichips').addEventListener('click', (e) => {
      const a = e.target.closest('[data-g]');
      if (!a) return;
      e.preventDefault();
      if (RANK_MORE.includes(a.dataset.g)) document.getElementById('rkmore').open = true;
      document.getElementById('rg-' + a.dataset.g).scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
    });
  }

  function parseRank() {
    const [, key] = location.hash.split('?')[0].replace(/^#\/?/, '').split('/');
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    const mt = METRICS[key];
    return { key, mt, dir: p.get('dir') || (mt && mt.better === 'low' ? 'asc' : 'desc'), fin: p.has('fin') ? p.get('fin') === '1' : mt?.fin, board: p.get('board') || '', ind: p.get('ind') || '' };
  }
  const rankHash = (st) => {
    const def = st.mt.better === 'low' ? 'asc' : 'desc';
    const p = new URLSearchParams();
    if (st.dir !== def) p.set('dir', st.dir);
    if (st.fin !== st.mt.fin) p.set('fin', st.fin ? '1' : '0');
    if (st.board) p.set('board', st.board);
    if (st.ind) p.set('ind', st.ind);
    return `#/rank/${st.key}${p.toString() ? '?' + p : ''}`;
  };

  // 分布条带：每个点一家公司（大小 = 市值），同像素区间内向上堆叠；两端 2% 极值压在边缘并画成空心
  // H 可按容器高度传入，让条带图填满面板，避免下方留空
  function stripPlot(list, mt, W, H = 150) {
    const padL = 16, padR = 16, base = H - 34;
    const lo = quantile(list.map((r) => r.v), 0.02), hi = quantile(list.map((r) => r.v), 0.98);
    const span = hi - lo || 1;
    const X = (v) => padL + ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (W - padL - padR);
    const maxMv = Math.max(...ROWS.map((r) => r.mv || 0));
    const rad = (mv) => 3 + 6 * Math.sqrt((mv || 0) / maxMv);
    const placed = [];
    const dots = [...list].sort((a, b) => b.mv - a.mv).map((r) => {
      const x = X(r.v), rr = rad(r.mv);
      let y = base - rr;
      while (placed.some((p) => Math.abs(p.x - x) < p.r + rr && Math.abs(p.y - y) < p.r + rr)) y -= 3;
      placed.push({ x, y, r: rr });
      const out = r.v < lo || r.v > hi;
      return `<circle class="sdot${out ? ' out' : ''}${mt.mkt ? ' ' + cls(r.v) : ''}" cx="${x}" cy="${Math.max(rr + 2, y)}" r="${rr}" data-k="${r.code}" data-tip="${esc(`${r.name} · ${r.ind}\n${mt.name} ${mt.fmt(r.v)}${out ? '（极值，已压到边缘）' : ''}`)}"/>`;
    }).join('');
    const q1 = quantile(list.map((r) => r.v), 0.25), q3 = quantile(list.map((r) => r.v), 0.75), md = median(list.map((r) => r.v));
    const ticks = niceScale(lo, hi, 5).ticks.filter((t) => t >= lo && t <= hi);
    return `<svg class="strip" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(mt.name)} 分布">
      <rect class="iqr" x="${X(q1)}" y="8" width="${Math.max(1, X(q3) - X(q1))}" height="${base - 4}"/>
      <line class="axis" x1="${padL}" x2="${W - padR}" y1="${base + 2}" y2="${base + 2}"/>
      ${ticks.map((t) => `<text x="${X(t)}" y="${base + 20}" text-anchor="middle">${mt.fmt(t)}</text>`).join('')}
      <line class="med" x1="${X(md)}" x2="${X(md)}" y1="4" y2="${base + 2}"/><text class="medt" x="${X(md) + 4}" y="14">中位数 ${mt.fmt(md)}</text>
      ${dots}</svg>`;
  }

  function rankKeyView() {
    const st = parseRank();
    if (!st.mt) return rankView();
    const { mt } = st;
    const list = ranked(st.key, st);
    const vals = list.map((r) => r.v);
    const md = median(vals);
    const total = ROWS.filter((r) => (st.fin || !FIN_INDS.includes(r.ind)) && (!st.board || r.board === st.board) && (!st.ind || r.ind === st.ind)).length;
    // 行业中位数（不受行业筛选影响，便于横向比较）
    const all = ranked(st.key, { ...st, ind: '' });
    const byInd = {};
    all.forEach((r) => { (byInd[r.ind] ||= []).push(r.v); });
    const indMed = Object.entries(byInd).map(([k, v]) => [k, median(v), v.length]).sort((a, b) => (st.dir === 'asc' ? a[1] - b[1] : b[1] - a[1]));
    const imax = Math.max(1e-9, ...indMed.map((x) => Math.abs(x[1])));
    const indRankOf = {};
    Object.keys(byInd).forEach((ind) => all.filter((r) => r.ind === ind).forEach((r, i, arr) => { indRankOf[r.code] = `${i + 1}/${arr.length}`; }));
    const allVals = all.map((r) => r.v);
    const better = (v) => pctRank(allVals, v, st.dir !== 'asc');
    const hist = (code) => (mt.hist ? sparkline(COMPANIES[code].financials.annual.map((r) => r[mt.hist]), COMPANIES[code].financials.annual.map((r) => r.fiscal_year), mt.name.replace(/ 2025$/, ''), mt.fmt) : '');
    const delta = (v) => {
      if (!isNum(md)) return '—';
      if (mt.fmt === pct || mt.fmt === spct) return `${v - md >= 0 ? '+' : ''}${fmt(v - md, 2)} pp`;
      return md ? spct(((v - md) / Math.abs(md)) * 100, 1) : '—';
    };
    const g = mt.group;
    return `
    ${siteHeader('rank', `<div class="crumb"><a href="#/rank">排行</a><span>›</span><span>${GROUPS[g]}</span><span>›</span><b>${esc(mt.name)}</b></div>`)}
    <div class="wrap rankpage">
      <div class="kicker"><a href="#/rank">排行中心</a> · ${GROUPS[g]}</div>
      <div class="rk-title"><h1 class="ptitle">${esc(mt.name)}</h1>
        <select id="rkkey" aria-label="切换指标">${Object.entries(GROUPS).map(([gg, n]) => `<optgroup label="${n}">${Object.keys(METRICS).filter((k) => METRICS[k].group === gg).map((k) => `<option value="${k}"${k === st.key ? ' selected' : ''}>${esc(METRICS[k].name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      ${mt.note ? `<p class="lede">${esc(mt.note)}</p>` : ''}
      <div class="filters" id="rkfilters">
        <div class="segctl" role="group" aria-label="排序"><button data-dir="desc" aria-pressed="${st.dir === 'desc'}">从高到低</button><button data-dir="asc" aria-pressed="${st.dir === 'asc'}">从低到高</button></div>
        <label class="chk"><input type="checkbox" id="rkfin"${st.fin ? ' checked' : ''}> 含金融业（${FIN_N} 家）${mt.fin ? '' : '<span class="faint">· 该指标对金融业不适用</span>'}</label>
        <div class="segctl" role="group" aria-label="板块">${['', '主板', '科创板', '创业板'].map((b) => `<button data-board="${b}" aria-pressed="${st.board === b}">${b || '全部板块'}</button>`).join('')}</div>
        ${st.ind ? `<span class="tag brand">${esc(st.ind)} <button id="rkind" aria-label="取消行业筛选">×</button></span>` : ''}
        <button class="reset" id="rkcsv">导出 CSV</button>
      </div>
      <div class="statstrip rk-stats">
        <div><div class="k">覆盖</div><div class="v">${list.length} 家</div><div class="s">${total - list.length ? `缺失或不适用 ${total - list.length} 家` : '无缺失'}</div></div>
        <div><div class="k">中位数</div><div class="v">${mt.fmt(md)}</div><div class="s">四分位 ${mt.fmt(quantile(vals, 0.25))} ～ ${mt.fmt(quantile(vals, 0.75))}</div></div>
        <div><div class="k">平均值</div><div class="v">${mt.fmt(vals.length ? sum(vals) / vals.length : null)}</div><div class="s">受极值影响，参考中位数</div></div>
        <div><div class="k">${st.dir === 'asc' ? '最低' : '最高'}</div><div class="v">${list[0] ? mt.fmt(list[0].v) : '—'}</div><div class="s">${list[0] ? esc(list[0].name) : ''}</div></div>
      </div>
      <div class="dash">
        <section class="panel span-8"><header><h2>分布</h2><span class="note">每点一家公司 · 大小 = 总市值 · 阴影为四分位区间</span></header><div class="strip-host" id="strip"></div></section>
        <section class="panel span-4"><header><h2>行业中位数</h2><span class="note">点击筛选该行业</span></header>
          <div class="indmed" id="indmed">${indMed.map(([k, v, n]) => `<button class="hb${k === st.ind ? ' on' : ''}" data-ind="${esc(k)}"><span class="n">${esc(k)}<small>${n}</small></span><span class="b"><i style="width:${(Math.abs(v) / imax) * 100}%" class="${v < 0 ? 'neg' : ''}"></i></span><span class="v">${mt.fmt(v)}</span></button>`).join('')}</div></section>
        <section class="panel span-12"><header><h2>全部排名</h2><span class="note">${list.length} 家 · 行业内排名与百强分位不受板块 / 行业筛选影响</span></header>
          <div class="tblwrap"><table class="tbl rank-tbl compact"><thead><tr><th>排名</th><th>公司</th><th>行业</th><th class="num">${esc(mt.name)}</th><th class="num">行业内</th><th class="num">百强分位</th><th class="num">较中位数</th><th class="num">总市值</th>${mt.hist ? '<th>5 年趋势</th>' : ''}</tr></thead>
          <tbody id="rkbody">${list.map((r, i) => `<tr tabindex="0" data-href="#/${r.code}"><td class="rk">${i + 1}</td>
            <td class="nm"><a href="#/${r.code}" tabindex="-1">${esc(r.name)}</a><small>${r.code}</small></td><td class="muted">${esc(r.ind)}</td>
            <td class="num sorted ${mt.mkt ? cls(r.v) : ''}">${mt.fmt(r.v)}</td><td class="num">${indRankOf[r.code] || '—'}</td>
            <td class="num">${isNum(better(r.v)) ? fmt(better(r.v), 0) : '—'}</td><td class="num">${delta(r.v)}</td><td class="num">${money(r.mv)}</td>${mt.hist ? `<td>${hist(r.code)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="9" class="emptyrow">没有符合条件的公司</td></tr>`}</tbody></table></div></section>
      </div>
      ${pageFoot()}
    </div>`;
  }

  function bindRankKey() {
    bindJump();
    const st = parseRank();
    if (!st.mt) return bindRank();
    const rerender = () => {
      history.replaceState(null, '', rankHash(st));
      const y = scrollY;
      app.innerHTML = rankKeyView();
      bindRankKey();
      scrollTo(0, y);
    };
    const list = ranked(st.key, st);
    const host = document.getElementById('strip');
    // 条带图高度对齐右侧「行业中位数」面板，避免左侧面板下方大片留白
    const side = document.getElementById('indmed').closest('.panel');
    host._redraw = () => {
      const H = Math.max(150, side.clientHeight - (host.offsetTop - host.closest('.panel').offsetTop) - 24);
      host.innerHTML = list.length ? stripPlot(list, st.mt, Math.max(280, host.clientWidth), H) : '<div class="empty">没有数据</div>';
    };
    host._redraw();
    host.addEventListener('click', (e) => { const d = e.target.closest('[data-k]'); if (d) location.hash = '#/' + d.dataset.k; });
    bindRowNav(document.getElementById('rkbody'));
    document.getElementById('rkkey').addEventListener('change', (e) => { location.hash = '#/rank/' + e.target.value; });
    document.getElementById('rkfilters').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.dir) st.dir = b.dataset.dir;
      else if (b.dataset.board != null) st.board = b.dataset.board;
      else if (b.id === 'rkind') st.ind = '';
      else if (b.id === 'rkcsv') {
        const rows = [['排名', '代码', '公司', '行业', st.mt.name], ...list.map((r, i) => [i + 1, r.code, r.name, r.ind, r.v])];
        const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `百强排行_${st.mt.name}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      } else return;
      rerender();
    });
    document.getElementById('rkfin').addEventListener('change', (e) => { st.fin = e.target.checked; rerender(); });
    document.getElementById('indmed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ind]');
      if (b) { st.ind = st.ind === b.dataset.ind ? '' : b.dataset.ind; rerender(); }
    });
  }

  /* ---------- 榜单页 ---------- */
  const LIST_COLS = [
    { k: 'rank', t: '排名', get: (r) => r.rank, f: (v) => v, dir: 'asc' },
    { k: 'name', t: '公司', nosort: true },
    { k: 'ind', t: '行业', nosort: true },
    // 取数与格式统一引用 METRICS；市盈率保留负值（亏损照实展示并排在最后），故单独取原值
    ...[['mv', '总市值'], ['chg', '涨跌幅'], ['ytd', '年初至今'], ['r1y', '近 1 年']].map(([k, t]) => ({ k, t, get: (r) => mval(k, r.code), f: METRICS[k].fmt, mkt: METRICS[k].mkt })),
    { k: 'pe', t: '市盈率 TTM', get: (r) => r.pe, f: (v) => num(v), dir: 'asc', negLast: true },
    ...[['pb', '市净率'], ['dy', '股息率'], ['roe', 'ROE 2025'], ['cagr', '营收 3 年复合']].map(([k, t]) => ({ k, t, get: (r) => mval(k, r.code), f: k === 'pb' ? (v) => num(v) : METRICS[k].fmt, dir: METRICS[k].better === 'low' ? 'asc' : undefined })),
    { k: 'spark', t: '营收趋势', nosort: true }
  ];
  const INDEX_NAMES = ['上证50', '沪深300', '中证A500', '科创50', '创业板指'];

  function parseQuery() {
    const q = location.hash.split('?')[1] || '';
    const p = new URLSearchParams(q);
    const n = +p.get('n');
    return { q: p.get('q') || '', ind: p.get('ind') || '', board: p.get('board') || '', idx: p.get('idx') || '', ex: p.get('ex') || '', sort: p.get('sort') || 'mv', dir: p.get('dir') || 'desc',
      n: PAGE_SIZES.includes(n) ? n : 20, p: Math.max(1, +p.get('p') || 1), hide: p.has('hide') ? p.get('hide') : LIST_HIDE_DEF };
  }
  const PAGE_SIZES = [20, 50, 100];
  // 默认隐藏的列（「列设置」可勾选显示，写入地址 hide=）
  const LIST_HIDE_DEF = 'r1y,spark';

  function listView() {
    const st = parseQuery();
    const inds = Object.entries(INDUSTRY).sort((a, b) => b[1].length - a[1].length);
    return `
    ${siteHeader('list')}
    <div class="wrap listpage">
      <div class="kicker">百强榜单</div>
      <h1 class="ptitle">全部 100 家公司</h1>
      <div class="filters">
        <div class="fsearch"><input id="lq" value="${esc(st.q)}" placeholder="筛选：代码 · 简称 · 拼音" autocomplete="off" aria-label="筛选公司"></div>
        <select id="lind" aria-label="行业"><option value="">全部行业</option>${inds.map(([k, v]) => `<option value="${esc(k)}"${st.ind === k ? ' selected' : ''}>${esc(k)}（${v.length}）</option>`).join('')}</select>
        <div class="segctl" id="lboard" role="group" aria-label="板块">${['', '主板', '科创板', '创业板'].map((b) => `<button data-v="${b}" aria-pressed="${st.board === b}">${b || '全部板块'}</button>`).join('')}</div>
        <select id="lidx" aria-label="指数"><option value="">全部指数</option>${INDEX_NAMES.map((k) => `<option${st.idx === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
        <select id="lex" aria-label="上市地"><option value="">全部上市地</option>${[['SH', '上交所'], ['SZ', '深交所'], ['AH', 'A+H 两地上市']].map(([k, n]) => `<option value="${k}"${st.ex === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <button class="reset" id="lreset">重置</button>
        <details class="colpick"><summary>列设置</summary><div>${LIST_COLS.slice(2).map((c) => `<label><input type="checkbox" value="${c.k}"${st.hide.split(`,`).includes(c.k) ? '' : ' checked'}> ${c.t}</label>`).join('')}</div></details>
        <span class="lcount" id="lcount"></span>
      </div>
      <style id="lcolstyle"></style>
      <div class="tblwrap sticky2"><table class="tbl rank-tbl full" id="ltable"><thead><tr>${LIST_COLS.map((c) => c.nosort
        ? `<th class="c-${c.k}">${c.t}</th>`
        : `<th class="c-${c.k}" aria-sort="none"><button data-k="${c.k}">${c.t}<i></i></button></th>`).join('')}</tr></thead><tbody id="lbody"></tbody></table></div>
      <div class="pager" id="lpager"></div>
      ${pageFoot()}
    </div>`;
  }

  function bindList() {
    bindJump();
    const st = parseQuery();
    const body = document.getElementById('lbody'), count = document.getElementById('lcount'), pager = document.getElementById('lpager');
    // 筛选、排序变化时回到第 1 页
    const render = (keepPage) => {
      if (!keepPage) st.p = 1;
      const k = norm(st.q);
      let rows = ROWS.filter((r) => (!st.ind || r.ind === st.ind) && (!st.board || r.board === st.board) && (!st.idx || r.idx.includes(st.idx)) && (!st.ex || (st.ex === 'AH' ? isAH(r.code) : exOf(r.code) === st.ex))
        && (!k || INDEX.find((x) => x.code === r.code).hay.includes(k)));
      const col = LIST_COLS.find((c) => c.k === st.sort) || LIST_COLS[3];
      const sgn = st.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (!isNum(va) && !isNum(vb)) return a.rank - b.rank;
        if (!isNum(va)) return 1;
        if (!isNum(vb)) return -1;
        // 亏损公司的负市盈率无可比性，无论升降序都排在盈利公司之后
        if (col.negLast && (va < 0) !== (vb < 0)) return va < 0 ? 1 : -1;
        return (va - vb) * sgn || a.rank - b.rank;
      });
      const total = rows.length, pages = Math.max(1, Math.ceil(total / st.n));
      st.p = Math.min(st.p, pages);
      const from = (st.p - 1) * st.n;
      rows = rows.slice(from, from + st.n);
      body.innerHTML = rows.length ? rows.map((r) => `
        <tr tabindex="0" data-href="#/${r.code}">
          <td class="rk c-rank">${r.rank}</td>
          <td class="nm c-name"><div class="nmw">${logo(r.code, 24)}<div><a href="#/${r.code}" tabindex="-1">${esc(r.name)}</a><small>${r.code}</small></div></div></td>
          <td class="muted ind c-ind"><button class="indlink" data-ind="${esc(r.ind)}" tabindex="-1">${esc(r.ind)}</button></td>
          ${LIST_COLS.slice(3, -1).map((c) => { const v = c.get(r); return `<td class="c-${c.k}${c.mkt ? ' ' + cls(v) : ''}${st.sort === c.k ? ' sorted' : ''}">${isNum(v) ? c.f(v) : NA(NA_WHY[c.k])}</td>`; }).join('')}
          <td class="c-spark">${sparkline(r.revs, r.years)}</td>
        </tr>`).join('') : `<tr><td colspan="${LIST_COLS.length}" class="emptyrow">无此公司 · <button id="lclear">清除筛选</button></td></tr>`;
      count.textContent = `共 ${total} 家`;
      pager.innerHTML = total ? `<span class="pinfo">第 ${from + 1}–${from + rows.length} 家，共 ${total} 家</span>
        ${pages > 1 ? `<div class="pbtns"><button data-p="${st.p - 1}"${st.p === 1 ? ' disabled' : ''}>‹ 上一页</button>${Array.from({ length: pages }, (_, i) => `<button data-p="${i + 1}" aria-current="${i + 1 === st.p}">${i + 1}</button>`).join('')}<button data-p="${st.p + 1}"${st.p === pages ? ' disabled' : ''}>下一页 ›</button></div>` : ''}
        <label class="psize">每页 <select id="lsize">${PAGE_SIZES.map((n) => `<option value="${n}"${n === st.n ? ' selected' : ''}>${n === 100 ? '全部' : n}</option>`).join('')}</select></label>` : '';
      document.querySelectorAll('#ltable th[aria-sort]').forEach((th) => {
        const on = th.querySelector('button').dataset.k === st.sort;
        th.setAttribute('aria-sort', on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      const clr = document.getElementById('lclear');
      if (clr) clr.addEventListener('click', reset);
      const p = new URLSearchParams(Object.entries(st).filter(([kk, v]) => v && !(kk === 'sort' && v === 'mv') && !(kk === 'dir' && v === 'desc') && !(kk === 'n' && v === 20) && !(kk === 'p' && v === 1) && !(kk === 'hide' && v === LIST_HIDE_DEF)));
      document.getElementById('lcolstyle').textContent = st.hide.split(',').filter(Boolean).map((c) => `#ltable .c-${c}{display:none}`).join('');
      history.replaceState(null, '', '#/list' + (p.toString() ? '?' + p : ''));
    };
    const reset = () => {
      Object.assign(st, { q: '', ind: '', board: '', idx: '', ex: '', sort: 'mv', dir: 'desc', p: 1 });
      document.getElementById('lex').value = '';
      document.getElementById('lq').value = '';
      document.getElementById('lind').value = '';
      document.getElementById('lidx').value = '';
      document.querySelectorAll('#lboard button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === ''));
      render();
    };
    document.getElementById('lq').addEventListener('input', (e) => { st.q = e.target.value.trim(); render(); });
    document.getElementById('lind').addEventListener('change', (e) => { st.ind = e.target.value; render(); });
    document.getElementById('lidx').addEventListener('change', (e) => { st.idx = e.target.value; render(); });
    document.getElementById('lex').addEventListener('change', (e) => { st.ex = e.target.value; render(); });
    document.getElementById('lboard').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      st.board = b.dataset.v;
      document.querySelectorAll('#lboard button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      render();
    });
    document.getElementById('lreset').addEventListener('click', reset);
    document.querySelector('#ltable thead').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const col = LIST_COLS.find((c) => c.k === b.dataset.k);
      if (st.sort === col.k) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
      else { st.sort = col.k; st.dir = col.dir || 'desc'; }
      render();
    });
    body.addEventListener('click', (e) => {
      const ib = e.target.closest('.indlink');
      if (ib) { st.ind = ib.dataset.ind; document.getElementById('lind').value = st.ind; render(); e.stopPropagation(); }
    });
    pager.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b || b.disabled) return;
      st.p = +b.dataset.p;
      render(true);
      document.getElementById('ltable').scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    });
    document.querySelector('.colpick').addEventListener('change', () => {
      st.hide = [...document.querySelectorAll('.colpick input')].filter((i) => !i.checked).map((i) => i.value).join(',');
      render(true);
    });
    pager.addEventListener('change', (e) => { if (e.target.id === 'lsize') { st.n = +e.target.value; render(); } });
    bindRowNav(body);
    render(true);
  }

  /* ---------- 公司对比页 ---------- */
  const CMP_KEY = 'ashare100:cmp';
  const cmpLast = () => { try { return JSON.parse(localStorage.getItem(CMP_KEY) || '[]').filter((k) => COMPANIES[k]); } catch { return []; } };
  const cmpSave = (a) => { try { localStorage.setItem(CMP_KEY, JSON.stringify(a)); } catch { /* 忽略 */ } };
  const cmpWith = (code) => [...cmpLast().filter((k) => k !== code), code].slice(-4);
  // 快速组合：按大类分组，均为本站 100 家内的同行公司（最多 4 家）
  const CMP_PRESETS = [
    ['四大行', ['601398.SH', '601939.SH', '601288.SH', '601988.SH'], '金融'],
    ['股份制银行', ['600036.SH', '601166.SH', '601998.SH', '000001.SZ'], '金融'],
    ['城商行', ['002142.SZ', '600919.SH'], '金融'],
    ['保险', ['601318.SH', '601628.SH', '601601.SH', '601319.SH'], '金融'],
    ['券商', ['600030.SH', '601688.SH', '601211.SH', '300059.SZ'], '金融'],
    ['白酒', ['600519.SH', '000858.SZ'], '消费'],
    ['白色家电', ['000333.SZ', '000651.SZ', '600690.SH'], '消费'],
    ['三桶油', ['601857.SH', '600028.SH', '600938.SH'], '能源'],
    ['煤炭', ['601088.SH', '601225.SH', '601898.SH', '600188.SH'], '能源'],
    ['电力', ['600900.SH', '601985.SH', '003816.SZ', '600025.SH'], '能源'],
    ['新能源车与电池', ['300750.SZ', '002594.SZ'], '能源'],
    ['半导体制造', ['688981.SH', '688347.SH', '688825.SH'], '科技'],
    ['AI 芯片', ['688256.SH', '688041.SH', '688795.SH', '688802.SH'], '科技'],
    ['光模块', ['300308.SZ', '300502.SZ', '300394.SZ'], '科技'],
    ['通信运营', ['600941.SH', '601728.SH'], '科技'],
    ['有色金属', ['601899.SH', '603993.SH', '002379.SZ'], '其他']
  ].map(([n, ks, g]) => [n, ks.filter((k) => COMPANIES[k]), g]).filter(([, ks]) => ks.length >= 2);
  const CMP_PRESET_GROUPS = [...new Set(CMP_PRESETS.map((x) => x[2]))];

  /* ---------- 对比页组件（方案 §7.3） ---------- */
  const isPctFmt = (mt) => mt.fmt === pct || mt.fmt === spct;
  const gapText = (mt, a, b) => (isPctFmt(mt) ? `${fmt(Math.abs(a - b), 2)} pp` : b ? `${fmt(Math.abs((a - b) / b) * 100, 0)}%` : '—');
  // ① 结论条：对每个有优劣方向的指标找出领先者，按领先幅度挑 3 条（每个分组最多 1 条）；纯规则，不做判断
  function cmpConclusion(sel) {
    const out = [];
    Object.keys(METRICS).forEach((k) => {
      const mt = METRICS[k];
      // 只挑有分析意义的维度：跳过规模体量与当日交易类指标
      if (!mt.better || ['scale', 'gov'].includes(mt.group) || ['chg', 'amount', 'turnover'].includes(k)) return;
      const vs = sel.map((c) => ({ c, v: !mt.fin && isFin(c) ? null : mval(k, c) })).filter((x) => x.v != null);
      if (vs.length < 2) return;
      vs.sort((a, b) => (mt.better === 'low' ? a.v - b.v : b.v - a.v));
      const [a, b] = vs;
      const rel = isPctFmt(mt) ? Math.abs(a.v - b.v) / 10 : Math.abs((a.v - b.v) / (Math.abs(b.v) || 1));
      out.push({ k, mt, a, b, rel });
    });
    const used = new Set();
    const pick = out.sort((x, y) => y.rel - x.rel).filter((x) => (used.has(x.mt.group) ? false : used.add(x.mt.group))).slice(0, 3);
    if (!pick.length) return '';
    const nm = (c) => esc(COMPANIES[c].identity.name_abbr);
    return `<b>要点</b>${pick.map((x) => `<span>${nm(x.a.c)} 的<em>${esc(x.mt.name)}</em>最${x.mt.better === 'low' ? '低' : '高'}（${esc(x.mt.fmt(x.a.v))}），比第二名 ${nm(x.b.c)} ${x.mt.better === 'low' ? '低' : '高'} ${gapText(x.mt, x.a.v, x.b.v)}</span>`).join('')}<small>按领先幅度自动挑选，仅为数值比较</small>`;
  }
  // ③ 杜邦并排：三个因子 + 计算 ROE
  function cmpDupont(sel) {
    const rows = sel.map((k) => ({ k, d: dupont(COMPANIES[k])[4] || {} }));
    return `<div class="chartbox"><div class="sub" style="margin-top:0">杜邦分解 2025</div><div class="tblwrap flat"><table class="tbl compact"><thead><tr><th>公司</th>${DP_F.map(([, n]) => `<th class="num">${n}</th>`).join('')}<th class="num">计算 ROE</th><th>主驱动</th></tr></thead><tbody>
      ${rows.map(({ k, d }, i) => `<tr><td><i class="dotc" style="background:${COLORS[i]}"></i>${esc(COMPANIES[k].identity.name_abbr)}</td>${DP_F.map(([kk, , f]) => {
        const vs = rows.map((r) => r.d[kk]).filter(isNum), best = Math.max(...vs);
        return `<td class="num${isNum(d[kk]) && d[kk] === best && vs.length > 1 ? ' best' : ''}">${isNum(d[kk]) ? f(d[kk]) : '—'}</td>`;
      }).join('')}<td class="num">${pct(d.calc)}</td><td>${dpDriver(d)?.[0] || '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="chart-foot">ROE ≈ 净利率 × 总资产周转率 × 权益乘数；主驱动为三项中百强分位最高者。</div></div>`;
  }
  // ③ 股东结构 100% 堆叠条：控股股东 / 机构 / 陆股通 / 其他
  function cmpHolders(sel) {
    const parts = [['控股股东', (s) => s.controlling_ratio, 'var(--chart-1)'], ['机构', (s) => s.inst_hold_ratio, 'var(--chart-2)'], ['陆股通', (s) => s.northbound_ratio, 'var(--chart-3)']];
    return `<div class="chartbox"><div class="sub" style="margin-top:0">股东结构</div>${sel.map((k) => {
      const s = COMPANIES[k].shareholders;
      const vs = parts.map(([n, g, col]) => [n, isNum(g(s)) ? g(s) : 0, col]);
      const rest = Math.max(0, 100 - sum(vs.map((x) => x[1])));
      return `<div class="hstack-row"><span class="n">${esc(COMPANIES[k].identity.name_abbr)}</span><span class="hstack">${vs.map(([n, v, col]) => `<i style="width:${v}%;background:${col}" title="${n} ${pct(v)}"></i>`).join('')}<i class="rest" style="width:${rest}%" title="其他 ${pct(rest)}"></i></span></div>`;
    }).join('')}<div class="sublegend">${parts.map(([n, , col]) => `<span><i style="background:${col}"></i>${n}</span>`).join('')}<span><i style="background:#E2E2E0"></i>其他</span></div>
      <div class="chart-foot">机构与控股股东可能有重叠（如控股股东本身为机构），仅示意。</div></div>`;
  }
  // ④ 分组对照表：数值 + 百强分位细条 + ◆ 最优；diff=true 时显示相对第一家的差值
  function cmpTable(sel, diff, closed = {}) {
    const nm = (k) => esc(COMPANIES[k].identity.name_abbr);
    const head = `<tr><th>指标</th>${sel.map((k, i) => `<th style="--c:${COLORS[i]}"><a href="#/${k}">${nm(k)}</a></th>`).join('')}<th class="num">百强中位数</th></tr>`;
    const body = Object.entries(PEER_PICK).map(([g, keys]) => {
      const lead = {};
      const rows = keys.map((k) => {
        const mt = METRICS[k];
        const vals = sel.map((c) => (!mt.fin && isFin(c) ? undefined : mval(k, c)));
        const nums = vals.filter(isNum);
        const best = mt.better && nums.length >= 2 ? (mt.better === 'low' ? Math.min(...nums) : Math.max(...nums)) : null;
        vals.forEach((v, i) => { if (isNum(v) && v === best) lead[sel[i]] = (lead[sel[i]] || 0) + 1; });
        const allV = CODES.filter((c) => mt.fin || !isFin(c)).map((c) => mval(k, c));
        const cells = vals.map((v, i) => {
          if (v === undefined) return '<td><span class="faint" title="金融业无此口径">不适用</span></td>';
          if (!isNum(v)) return `<td>${NA()}</td>`;
          const p = pctRank(allV, v, mt.better !== 'low');
          const base = vals[0];
          const shown = diff && i > 0 ? (isNum(base) ? (isPctFmt(mt) ? `${v - base >= 0 ? '+' : ''}${fmt(v - base, 2)} pp` : base ? spct(((v - base) / Math.abs(base)) * 100, 1) : '—') : '—') : mt.fmt(v);
          return `<td class="${v === best ? 'best' : ''}"><span class="cv-v ${mt.mkt && !(diff && i > 0) ? cls(v) : ''}">${shown}</span><span class="pbar" title="百强第 ${fmt(p, 0)} 百分位"><i style="left:${p}%;background:${COLORS[i]}"></i></span></td>`;
        }).join('');
        return `<tr class="g-${g}"><th scope="row" title="${esc(mt.note || '')}">${esc(mt.name)}</th>${cells}<td class="num faint">${mt.fmt(median(allV))}</td></tr>`;
      }).join('');
      const leadTxt = Object.entries(lead).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${nm(c)} ${n}`).join(' · ');
      return `<tr class="grp${closed[g] ? ' closed' : ''}" data-g="${g}"><td colspan="${sel.length + 2}"><span class="caret">${closed[g] ? '▸' : '▾'}</span>${GROUPS[g]}${leadTxt ? `<small>领先项：${leadTxt}</small>` : ''}</td></tr>${closed[g] ? '' : rows}`;
    }).join('');
    return `<table class="tbl cmp-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  const CMP_CHART = [
    ['revenue', '营业总收入', 'yiv', '亿元', (r) => (isNum(r?.revenue) ? r.revenue / 1e8 : null)],
    ['net_profit', '归母净利润', 'yiv', '亿元', (r) => (isNum(r?.net_profit) ? r.net_profit / 1e8 : null)],
    ['roe', 'ROE', 'pct', '%', (r) => r?.roe],
    ['gross_margin', '毛利率', 'pct', '%', (r) => r?.gross_margin],
    ['net_margin', '净利率', 'pct', '%', (r) => r?.net_margin],
    ['debt_ratio', '资产负债率', 'pct', '%', (r) => r?.debt_ratio],
    ['ocf', '经营现金流', 'yiv', '亿元', (r) => (isNum(r?.ocf) ? r.ocf / 1e8 : null)]
  ];

  // 雷达维度：在百强中的百分位（0–100）。估值与负债率越低得分越高；亏损公司不计估值分
  const pctRank = (vals, v, higher) => {
    const xs = vals.filter(isNum).sort((a, b) => a - b);
    if (!isNum(v) || xs.length < 2) return null;
    const below = xs.filter((x) => x < v).length, eq = xs.filter((x) => x === v).length;
    const p = ((below + (eq - 1) / 2) / (xs.length - 1)) * 100;
    return higher ? p : 100 - p;
  };
  const RADAR_DIMS = [
    ['规模', '总市值', (c) => c.market.total_mv, true],
    ['盈利', 'ROE 2025', (c) => c.financials.annual[4]?.roe, true],
    ['成长', '营收 3 年复合', (c) => c.financials.derived?.revenue_cagr_3y, true],
    ['估值', '市盈率（越低越外）', (c) => (c.market.pe_ttm > 0 ? c.market.pe_ttm : null), false],
    ['分红', '股息率', (c) => c.market.dividend_yield, true],
    ['稳健', '资产负债率（越低越外）', (c) => c.financials.annual[4]?.debt_ratio, false]
  ].map(([name, desc, get, higher]) => ({ name, desc, get, higher, all: CODES.map((k) => get(COMPANIES[k])) }));

  function parseCompare() {
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    return (p.get('c') || '').split(',').filter((k, i, a) => COMPANIES[k] && a.indexOf(k) === i).slice(0, 4);
  }

  function compareView() {
    return `
    ${siteHeader('compare')}
    <div class="wrap cmppage">
      <div class="kicker">公司对比</div>
      <h1 class="ptitle">把 2–4 家公司放在一起看</h1>
      <div class="picker">
        <div class="chips" id="cmpchips"></div>
        <div class="jump addbox"><input id="cmpq" autocomplete="off" spellcheck="false" placeholder="添加公司：代码 · 简称 · 拼音" aria-label="添加对比公司"><div class="drop" id="cmpdrop" role="listbox"></div></div>
      </div>
      <div class="presets"><span class="plabel">快速组合</span>${CMP_PRESET_GROUPS.map((g) => `<span class="pgroup"><em>${g}</em>${CMP_PRESETS.filter((x) => x[2] === g).map(([n, ks]) => `<button data-c="${ks.join(',')}">${n}</button>`).join('')}</span>`).join('')}</div>
      <div id="cmpbody"></div>
      ${pageFoot()}
    </div>`;
  }

  function bindCompare() {
    bindJump();
    let sel = parseCompare();
    if (!sel.length) sel = cmpLast().length >= 2 ? cmpLast() : (CMP_PRESETS[1] || CMP_PRESETS[0])[1];
    const body = document.getElementById('cmpbody');
    let metric = 'revenue';
    // base：雷达百分位基准（全金融公司时默认行业内）；index：走势指数化；diff：对照表差值模式；closed：折叠的分组
    const cst = { base: 'all', userBase: false, index: false, diff: false, closed: {} };

    const render = () => {
      cmpSave(sel);
      history.replaceState(null, '', '#/compare' + (sel.length ? '?c=' + sel.join(',') : ''));
      document.getElementById('cmpchips').innerHTML = sel.map((k, i) => `
        <span class="chip" style="--c:${COLORS[i]}">${logo(k, 28, 'chip-logo')}<a href="#/${k}">${esc(COMPANIES[k].identity.name_abbr)}</a><small>${k.slice(0, 6)}</small><button data-k="${k}" aria-label="移除 ${esc(COMPANIES[k].identity.name_abbr)}">×</button></span>`).join('')
        + (sel.length < 4 ? `<span class="chip-hint">${sel.length < 2 ? '至少再选 ' + (2 - sel.length) + ' 家' : '还可添加 ' + (4 - sel.length) + ' 家'}</span>` : '');
      document.querySelector('.addbox').style.display = sel.length >= 4 ? 'none' : '';
      if (sel.length < 2) { body.innerHTML = '<div class="empty bigempty">请至少选择 2 家公司开始对比</div>'; return; }

      const cs = sel.map((k) => COMPANIES[k]);
      const inds = [...new Set(cs.map((c) => c.identity.industry_sw1))];
      const fin = cs.some((c) => c.financials.annual[4]?.gross_margin == null);
      const holderDates = [...new Set(cs.map((c) => c.shareholders.holder_num_date))];
      const notes = [
        inds.length > 1 ? `所选公司分属 ${inds.join('、')} 等不同行业，估值与利润率的行业差异较大，横向比较需谨慎。` : '',
        fin ? '含金融企业：毛利率、存货、应收等科目不适用，显示为「—」。' : '',
        holderDates.length > 1 ? `股东数据截止日不同（${holderDates.join('、')}）。` : '',
        cs.some((c) => c.financials.annual.some((r) => r.revenue == null)) ? '含 2021 年后上市的公司，上市前年度无数据，曲线断开。' : ''
      ].filter(Boolean);

      const nm = (k) => esc(COMPANIES[k].identity.name_abbr);
      const allFin = sel.every(isFin);
      const sameInd = inds.length === 1;
      if (!cst.userBase) cst.base = allFin ? 'ind' : 'all';
      body.innerHTML = `
        ${notes.length ? `<div class="notice">${notes.map((n) => `<p>${n}</p>`).join('')}</div>` : ''}
        <div class="cmp-sum">${cmpConclusion(sel)}</div>
        <section class="hsec cmp-sec"><header><div><div class="kicker">① 综合画像</div><h2>相对位置</h2></div>
          <div class="tabs" id="radarbase" role="tablist"><button role="tab" data-t="all" aria-selected="${cst.base === 'all'}">百强内百分位</button><button role="tab" data-t="ind" aria-selected="${cst.base === 'ind'}">所属行业内百分位</button></div></header>
          <div class="radar-wrap"><div class="radar" id="radar"></div><div class="radar-side" id="radarside"></div></div>
        </section>
        <section class="hsec cmp-sec"><header><div><div class="kicker">② 走势联动</div><h2>2021–2025</h2></div><span class="note">悬停任意一张图的某一年，其他图同步高亮</span></header>
          <div class="filters sc-ctl"><div class="tabs" id="cmptabs" role="tablist">${CMP_CHART.map(([k, n]) => `<button role="tab" data-t="${k}" aria-selected="${k === metric}">${n}</button>`).join('')}</div>
            <div class="segctl" id="cmpidx" role="group"><button data-v="abs" aria-pressed="${!cst.index}">绝对值</button><button data-v="idx" aria-pressed="${cst.index}">指数化（2021 = 100）</button></div></div>
          <div class="cmp-charts">
            <div class="chartbox"><div class="chart-host" id="cmpchart"></div></div>
            <div class="chartbox"><div class="chart-host" id="cmpdiv"></div></div>
          </div>
        </section>
        <section class="hsec cmp-sec"><header><div><div class="kicker">③ 结构拆解</div><h2>杜邦分解与股东结构</h2></div><span class="note">2025 年报；股东为最新一期</span></header>
          <div class="cmp-two">${cmpDupont(sel)}${cmpHolders(sel)}</div>
        </section>
        <section class="hsec cmp-sec"><header><div><div class="kicker">④ 指标对照</div><h2>分组逐项比较</h2></div>
          <div class="segctl" id="cmpdiff" role="group"><button data-v="val" aria-pressed="${!cst.diff}">数值</button><button data-v="diff" aria-pressed="${cst.diff}">相对 ${nm(sel[0])} 的差值</button></div></header>
          <div class="tblwrap" id="cmptbl">${cmpTable(sel, cst.diff)}</div>
          <div class="chart-foot">格内细条为在百强 100 家中的百分位（已按优劣方向，越靠右越优）；◆ 为所选公司中最优；点击分组标题折叠。${allFin || !sameInd ? '' : ''}</div>
        </section>`;

      drawRadar(document.getElementById('radar'), document.getElementById('radarside'), sel, cst.base);
      tabs('radarbase', (k) => { cst.base = k; cst.userBase = true; drawRadar(document.getElementById('radar'), document.getElementById('radarside'), sel, cst.base); });
      const host = document.getElementById('cmpchart');
      const drawCmp = (anim) => {
        const [, name, fmtk, unit, get] = CMP_CHART.find((x) => x[0] === metric);
        const series = sel.map((k, i) => {
          let values = COMPANIES[k].financials.annual.map(get);
          if (cst.index) { const b = values.find((v) => isNum(v) && v > 0); values = values.map((v) => (isNum(v) && b ? (v / b) * 100 : null)); }
          return { key: k, name: COMPANIES[k].identity.name_abbr, kind: 'line', axis: 'L', fmt: cst.index ? 'num' : fmtk, color: COLORS[i], values };
        });
        host._st = null;
        drawChart(host, { label: '对比 ' + name, years: [2021, 2022, 2023, 2024, 2025], unitL: cst.index ? '指数' : unit, series, sync: 'cmp',
          foot: name + (cst.index ? '，以每家公司首个正值年度为 100，便于比较不同体量的增速。' : '（年报）。点击图例可隐藏某家公司。') }, anim);
      };
      const divHost = document.getElementById('cmpdiv');
      divHost._st = null;
      drawChart(divHost, { label: '每股派息对比', years: [2021, 2022, 2023, 2024, 2025], unitL: '元/股', sync: 'cmp',
        series: sel.map((k, i) => ({ key: k, name: COMPANIES[k].identity.name_abbr, kind: 'bar', axis: 'L', fmt: 'yuan', color: COLORS[i], values: COMPANIES[k].dividends.annual.map((x) => x.dps_pretax) })),
        foot: '每股派息（税前，按方案所属年度）。' }, true);
      drawCmp(true);
      tabs('cmptabs', (k) => { metric = k; drawCmp(true); });
      document.getElementById('cmpidx').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        cst.index = b.dataset.v === 'idx';
        document.querySelectorAll('#cmpidx button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        drawCmp(true);
      });
      document.getElementById('cmpdiff').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        cst.diff = b.dataset.v === 'diff';
        document.querySelectorAll('#cmpdiff button').forEach((x) => x.setAttribute('aria-pressed', x === b));
        document.getElementById('cmptbl').innerHTML = cmpTable(sel, cst.diff, cst.closed);
      });
      document.getElementById('cmptbl').addEventListener('click', (e) => {
        const g = e.target.closest('tr.grp');
        if (!g) return;
        cst.closed[g.dataset.g] = !cst.closed[g.dataset.g];
        document.getElementById('cmptbl').innerHTML = cmpTable(sel, cst.diff, cst.closed);
      });
    };

    const add = (k) => { if (COMPANIES[k] && !sel.includes(k) && sel.length < 4) { sel = [...sel, k]; render(); } };
    bindSearch('cmpq', 'cmpdrop', 8, add);
    document.getElementById('cmpchips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) { sel = sel.filter((x) => x !== b.dataset.k); render(); }
    });
    document.querySelector('.presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-c]');
      if (b) { sel = b.dataset.c.split(','); render(); }
    });
    render();
  }

  const RADAR_FMT = [money, pct, spct, (v) => num(v) + ' 倍', pct, pct];
  // base='ind' 时百分位只在该公司所属申万一级行业内计算（金融业的负债率等不再因行业结构垫底）
  function drawRadar(host, side, sel, base = 'all') {
    const S = 360, C = S / 2, R = 130, n = RADAR_DIMS.length;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [C + Math.cos(a) * R * (v / 100), C + Math.sin(a) * R * (v / 100)];
    };
    let g = '';
    [20, 40, 60, 80, 100].forEach((lv) => {
      g += `<polygon class="ring" points="${RADAR_DIMS.map((_, i) => pt(i, lv).join(',')).join(' ')}"/>`;
    });
    RADAR_DIMS.forEach((d, i) => {
      const [x, y] = pt(i, 100), [lx, ly] = pt(i, 118);
      g += `<line class="spoke" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/><text class="ax" x="${lx}" y="${ly + 4}" text-anchor="middle">${d.name}</text>`;
    });
    const pool = (d, k) => (base === 'ind' ? INDUSTRY[COMPANIES[k].identity.industry_sw1].map((x) => d.get(COMPANIES[x])) : d.all);
    const scores = sel.map((k) => RADAR_DIMS.map((d) => pctRank(pool(d, k), d.get(COMPANIES[k]), d.higher)));
    const rawTip = (j, i) => {
      const k = sel[j], d = RADAR_DIMS[i], v = d.get(COMPANIES[k]), sc = scores[j][i];
      return `${COMPANIES[k].identity.name_abbr} · ${d.name}（${d.desc}）\n原始值 ${isNum(v) ? RADAR_FMT[i](v) : '—'}\n${base === 'ind' ? '行业内' : '百强内'}${sc == null ? '：不适用' : '第 ' + Math.round(sc) + ' 百分位'}`;
    };
    let polys = '';
    scores.forEach((sc, j) => {
      const pts = sc.map((v, i) => pt(i, v ?? 0).join(',')).join(' ');
      polys += `<g class="rp" data-j="${j}" style="--c:${COLORS[j]};--d:${j * 120}ms"><polygon points="${pts}"/>${sc.map((v, i) => `<circle cx="${pt(i, v ?? 0)[0]}" cy="${pt(i, v ?? 0)[1]}" r="4.5" data-tip="${esc(rawTip(j, i))}"></circle>`).join('')}</g>`;
    });
    host.innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="六维雷达图">${g}${polys}</svg>`;
    side.innerHTML = `<table class="mini-tbl radar-tbl"><thead><tr><th>维度（依据）</th>${sel.map((k, j) => `<th data-j="${j}" style="color:${COLORS[j]}">${esc(COMPANIES[k].identity.name_abbr)}</th>`).join('')}</tr></thead><tbody>
      ${RADAR_DIMS.map((d, i) => `<tr><td>${d.name}<small>${d.desc}</small></td>${scores.map((sc, j) => `<td data-j="${j}" title="${esc(rawTip(j, i))}">${sc[i] == null ? '<span class="na">—</span>' : Math.round(sc[i])}</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="chart-foot">数值为百分位：100 表示在${base === 'ind' ? '所属申万一级行业内' : '百强中'}该项排第一，悬停看原始值。市盈率为负（亏损）时估值项不计分，图中画在圆心。${base === 'ind' ? '' : '银行、保险等的资产负债率天然偏高，「稳健」维度建议切换到行业内百分位。'}</p>`;
    const hi = (j) => {
      host.querySelector('svg').classList.toggle('hov', j != null);
      host.querySelectorAll('.rp').forEach((p) => p.classList.toggle('on', p.dataset.j === j));
    };
    side.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-j]'); hi(t ? t.dataset.j : null); });
    side.addEventListener('mouseleave', () => hi(null));
    host.addEventListener('mouseover', (e) => { const t = e.target.closest('.rp'); hi(t ? t.dataset.j : null); });
    host.addEventListener('mouseleave', () => hi(null));
  }

  /* ---------- 行业页 ---------- */
  function parseIndustry() {
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    const ind = p.get('ind');
    return INDUSTRY[ind] ? ind : Object.keys(INDUSTRY)[0];
  }

  /* ---------- 时间轴页 #/timeline?c=代码：百强的成立与上市日期 + 资本市场重要节点 ---------- */
  const EXTRA = window.__EXTRA__ || {};
  const foundDate = (k) => EXTRA[k]?.found_date || null;
  const yearOf = (d) => (d ? +d.slice(0, 4) + (+d.slice(5, 7) - 1) / 12 : null);
  // 上市地：A 股交易所看代码后缀；是否同时在港股上市，按简介与公告标题推断
  const HK_RE = /香港联交所|联交所|香港交易所|H股/, HK_ANN_RE = /H股公告|港股公告|翌日披露|证券变动月报表|海外监管公告/;
  const isAH = (k) => { const c = COMPANIES[k]; return HK_RE.test(c.identity.profile || '') || (c.announcements?.items || []).some((a) => HK_ANN_RE.test(a.title || '')); };
  const EXCH = { SH: '上交所', SZ: '深交所' };
  const exOf = (k) => k.slice(-2);
  // 时间轴页：独立页面 timeline.html（纵向脊柱 · 制度演进 + 公司进度），这里嵌入并保留站点顶栏
  /* ---------- 关于本项目 #/about ---------- */
  const ABOUT_MODULES = [
    ['A', '滕梓棋', '公司身份与行情', '公司全称、所属行业、上市日期、董事长、员工人数、主营业务；收盘价、市值、估值指标与区间涨跌幅', '东方财富 F10 及行情、估值接口；行业分类与员工人数以 Choice 导出数据复核'],
    ['B', '程建诚', '财务', '2021–2025 年度报告及 2026 年半年度报告：营业收入、归母净利润、毛利率、ROE 及三张报表关键科目', '东方财富财务数据接口，按报告期批量获取后筛选样本公司'],
    ['C', '崔扬', '股东、分红、主营与同行', '实际控制人、前十大股东、股东户数、机构与北向资金持股；近五年分红；主营构成与可比公司', '东方财富股东、分红及主营构成接口'],
    ['D', '沈亦冰', '投资者问答与公告', '投资者问答（含回复情况）、近十二个月公告标题', '上证e互动、深交所互动易、巨潮资讯；7 家沪市公司的问答取自理杏仁、准上市']
  ];
  // 网站各页面一览：[名称, 地址, 用途, 主要内容]
  const ABOUT_PAGES = [
    ['首页', '#/', '了解样本全貌', '样本合计市值、营收与净利润，板块构成，行业版图（矩形树图），市值前 20 名，以及按指标排序的数据观察、行业 × 指标热力图和涨跌分布'],
    ['榜单', '#/list', '查找与筛选公司', '100 家公司的完整列表，可按行业、板块、指数、上市地筛选，按任一列排序，支持分页与列设置'],
    ['排行', '#/rank', '按指标比较', '35 项指标分 8 个维度（规模、盈利能力、成长性、估值、股东回报、财务健康、市场表现、股东与治理）排序；单项指标页给出分布、行业中位数和完整排名，可导出 CSV'],
    ['行业', '#/industry', '理解行业结构', '各申万一级行业的公司数、市值占比、估值与盈利中位数，二级行业构成，以及可自选坐标轴的散点图（每个视角附有解读）'],
    ['对比', '#/compare', '横向比较 2–4 家公司', '相对位置雷达图、五年走势联动、杜邦分解、股东结构与分组指标对照，内置 16 组常用对比组合'],
    ['时间轴', '#/timeline', '把公司放回时间里', '以纵向时间轴并列呈现资本市场制度演进（分四级）与百强公司的成立、上市日期，可拖动缩放浏览'],
    ['公司档案', '#/600519.SH', '深入了解单家公司', '概览、财务（含杜邦分解）、股东、分红、主营构成、同行对比、投资者问答、公告八个栏目']
  ];
  function aboutView() {
    return `
    ${siteHeader('about')}
    <div class="wrap aboutpage">
      <div class="kicker">关于</div>
      <h1 class="ptitle">关于本项目</h1>
      <p class="ab-lead">本网站为大模型课程结课作业。项目选取 A 股市值排名前 100 位的上市公司，将分散于证券交易所、巨潮资讯及各财经平台的公开信息进行汇总与整理，为每家公司建立一份档案，内容涵盖公司概况、近年经营表现、股东结构、分红情况，以及投资者问答与公告。</p>
      <p class="ab-lead">本网站仅整理和呈现公开数据，不作预测，亦不构成任何投资建议。页面中的排名、百分位及“要点”均由现有数据直接排序或计算得出。</p>

      <section class="ab-sec"><h2>样本与数据时点</h2>
        <div class="ab-grid">
          <div><b>100 家</b><span>以 2026 年 10 月 21 日收盘市值排名前 100 位的公司为样本，样本名单此后保持不变</span></div>
          <div><b>2026-10-22 收盘</b><span>股价、市值、市盈率、涨跌幅等行情数据均为当日收盘快照，非实时数据</span></div>
          <div><b>2021–2025 年及 2026 年中报</b><span>年度数据覆盖五个完整会计年度，“最新一期”指 2026 年半年度报告</span></div>
          <div><b>2026-06-30</b><span>股东名单与持股比例的截止日期；投资者问答与公告采集至 10 月 22 日</span></div>
        </div>
        <p class="ab-note">各类数据的时点不尽相同，页面已在相应数值旁注明日期。进行跨公司比较时，请留意口径是否一致。</p>
      </section>

      <section class="ab-sec"><h2>网站页面一览</h2>
        <div class="ab-pages">${ABOUT_PAGES.map(([t, href, use, what]) => `<a href="${href}"><div class="ap-h"><b>${t}</b><span>${use}</span></div><p>${what}</p></a>`).join('')}</div>
      </section>

      <section class="ab-sec"><h2>数据来源与分工</h2>
        <p>项目按页面板块分为四个数据模块，各成员分别提交结构统一的 JSON 文件，经合并与校验后生成 <code>data.json</code>，网页仅读取该文件。</p>
        <div class="ab-flow"><span>A 身份与行情</span><span>B 财务</span><span>C 股东与分红</span><span>D 问答与公告</span><i>→</i><span class="m">合并与校验</span><i>→</i><span class="m">data.json</span><i>→</i><span class="m">网页</span></div>
        <div class="tblwrap"><table class="tbl ab-tbl"><thead><tr><th>模块</th><th>负责人</th><th>内容</th><th>来源</th></tr></thead>
          <tbody>${ABOUT_MODULES.map(([k, who, t, what, src]) => `<tr><td><b>${k}</b> ${t}</td><td>${who}</td><td>${what}</td><td>${src}</td></tr>`).join('')}
          <tr><td><b>前端</b> 网页</td><td>施页川、胡源、程建诚<br>滕梓棋（最终调试与设计）</td><td>搜索、公司档案、榜单、排行、行业、对比、时间轴等全部页面</td><td>纯静态页面，仅读取合并后的 data.json，无需后端</td></tr></tbody></table></div>
        <p class="ab-note">同一字段存在多个来源时，按“交易所公告原文、巨潮资讯、东方财富”的顺序取用，且同一模块内只使用一套来源，以保证 100 家公司口径一致。公司成立日期取自东方财富 F10；公司标识取自各公司官网图标，个别缺失项以公开图标服务补齐。</p>
      </section>

      <section class="ab-sec"><h2>质量控制</h2>
        <ul class="ab-list">
          <li>开工前制定统一的字段规范（现行版本为 v1.4），对单位、精度及空值写法作出约定：金额统一以“元”为单位，缺失记为 null，未分红记为 0。</li>
          <li>各模块先以单家公司试运行，核对格式无误后再采集全部 100 家。</li>
          <li>合并时统一运行校验脚本，最近一次结果为 0 个错误、2 条提示（一家公司董事长字段为空，一家公司年度营收单位待复核）。</li>
          <li>针对首轮发现的缺口进行了多轮补全，包括成交额、沪市投资者问答、指数成分及员工人数等，每轮均留有补全报告。</li>
          <li>页面严格区分空值与零值：未采集到的数据显示为“—”并说明原因，确为零的才显示 0。</li>
        </ul>
      </section>

      <section class="ab-sec"><h2>浏览建议</h2>
        <div class="ab-routes">
          <a href="#/600519.SH"><b>① 数据最完整的公司</b><span>${esc(COMPANIES['600519.SH'].identity.name_abbr)}：依次浏览概览、财务、股东、分红与公告</span></a>
          <a href="#/688825.SH"><b>② 新近上市的公司</b><span>${esc(COMPANIES['688825.SH'].identity.name_abbr)}：了解上市前年度、无年初涨跌及未分红等情形的处理方式</span></a>
          <a href="#/compare?c=601398.SH,601939.SH,601288.SH,601988.SH"><b>③ 四大行对比</b><span>银行业不适用毛利率、资产负债率等指标，对比中相应显示为“不适用”</span></a>
          <a href="#/timeline"><b>④ 时间轴</b><span>在同一时间轴上观察百强公司的成立、上市与资本市场制度的演进</span></a>
        </div>
      </section>
      ${pageFoot()}
    </div>`;
  }

  function timelineView() {
    const c = new URLSearchParams(location.hash.split('?')[1] || '').get('c') || '';
    return `
    ${siteHeader('timeline')}
    <iframe class="tl-embed"${document.getElementById('tl-src') ? '' : ` src="timeline.html${c ? '?c=' + encodeURIComponent(c) : ''}"`} aria-label="资本市场与百强时间轴"></iframe>`;
  }
  // 离线单文件版：时间轴页内联在 #tl-src 中，用 srcdoc 载入，高亮公司通过 window.__TL_FOCUS__ 传入
  function bindTimeline() {
    bindJump();
    const inline = document.getElementById('tl-src');
    if (!inline) return;
    window.__TL_FOCUS__ = new URLSearchParams(location.hash.split('?')[1] || '').get('c') || '';
    document.querySelector('.tl-embed').srcdoc = inline.textContent.replace(/<\\\/script/g, '</script');
  }

  function industryView() {
    const ind = parseIndustry();
    const rows = INDUSTRY[ind].map((k) => ROW[k]);
    const tmv = sum(ROWS.map((r) => r.mv)), imv = sum(rows.map((r) => r.mv));
    const w = rows.filter((r) => isNum(r.ytd));
    const ytd = w.length ? sum(w.map((r) => r.ytd * r.mv)) / sum(w.map((r) => r.mv)) : null;
    const sw2 = {};
    rows.forEach((r) => { (sw2[r.ind2] ||= []).push(r); });
    const subs = Object.entries(sw2).sort((a, b) => sum(b[1].map((r) => r.mv)) - sum(a[1].map((r) => r.mv)));
    const kpi = new URLSearchParams(location.hash.split('?')[1] || '').get('kpi') || 'n';
    const indOrder = Object.keys(INDUSTRY).sort((a, b) => sum(INDUSTRY[b].map((k) => ROW[k].mv)) - sum(INDUSTRY[a].map((k) => ROW[k].mv)));
    const iPe = median(rows.map((r) => (r.pe > 0 ? r.pe : null))), aPe = median(ROWS.map((r) => (r.pe > 0 ? r.pe : null)));
    const iRoe = median(rows.map((r) => r.roe)), aRoe = median(ROWS.map((r) => r.roe));
    const lead = rows.filter((r) => isNum(r.ytd)).sort((a, b) => b.ytd - a.ytd);
    const chips = Object.entries(INDUSTRY).map(([k, v]) => `<a class="ichip${k === ind ? ' on' : ''}" href="#/industry?ind=${encodeURIComponent(k)}">${esc(k)}<small>${v.length}</small></a>`).join('');
    const table = rows.map((r) => `
      <tr tabindex="0" data-href="#/${r.code}" data-sub="${esc(r.ind2)}">
        <td class="rk">${r.rank}</td>
        <td class="nm"><a href="#/${r.code}" tabindex="-1">${esc(r.name)}</a><small>${r.code}</small></td>
        <td class="muted">${esc(r.ind2)}</td>
        <td>${money(r.mv)}</td><td>${isNum(r.pe) ? num(r.pe) : NA(NA_WHY.pe)}</td><td>${num(r.pb)}</td>
        <td>${isNum(r.roe) ? pct(r.roe) : NA(NA_WHY.roe)}</td><td>${pct(r.dy)}</td><td class="${cls(r.ytd)}">${isNum(r.ytd) ? spct(r.ytd) : NA(NA_WHY.ytd)}</td>
        <td>${sparkline(r.revs, r.years)}</td></tr>`).join('');
    return `
    ${siteHeader('industry')}
    <div class="wrap indpage">
      <div class="kicker">行业 · 申万一级</div>
      <div class="ichips" id="ichips">${chips}</div>
      <h1 class="ptitle">${esc(ind)}</h1>
      <div class="statstrip ind-stats kpi-pick" id="kpipick" role="tablist">
        <button role="tab" data-kpi="n" aria-selected="${kpi === 'n'}"><div class="k">百强中的公司</div><div class="v">${rows.length} 家</div><div class="s">${subs.length} 个申万二级</div></button>
        <button role="tab" data-kpi="mv" aria-selected="${kpi === 'mv'}"><div class="k">合计总市值</div><div class="v">${money(imv)}</div><div class="s">占百强 ${pct((imv / tmv) * 100, 1)} · 第 ${indOrder.indexOf(ind) + 1} / ${indOrder.length}</div></button>
        <button role="tab" data-kpi="pe" aria-selected="${kpi === 'pe'}"><div class="k">市盈率中位数</div><div class="v">${num(iPe)}</div><div class="s">TTM 盈利公司 · 较百强中位数 ${aPe ? spct(((iPe - aPe) / aPe) * 100, 0) : '—'}</div></button>
        <button role="tab" data-kpi="roe" aria-selected="${kpi === 'roe'}"><div class="k">ROE 中位数</div><div class="v">${pct(iRoe)}</div><div class="s">2025 · 较百强 ${isNum(iRoe) && isNum(aRoe) ? (iRoe - aRoe >= 0 ? '+' : '') + fmt(iRoe - aRoe, 2) + ' pp' : '—'}</div></button>
        <button role="tab" data-kpi="ytd" aria-selected="${kpi === 'ytd'}"><div class="k">年初至今（市值加权）</div><div class="v ${cls(ytd)}">${spct(ytd)}</div><div class="s">${lead.length ? `领涨 ${esc(lead[0].name)} · 领跌 ${esc(lead[lead.length - 1].name)}` : '不含无基准价新股'}</div></button>
      </div>
      <div class="subbar" id="subbar">${subs.map(([k, v], i) => `<button data-sub="${esc(k)}" style="flex:${sum(v.map((r) => r.mv))};background:${i < 5 ? COLORS[i] : '#BFC3C8'}" title="${esc(k)} · ${v.length} 家 · ${money(sum(v.map((r) => r.mv)))}\n点击只看该二级行业"></button>`).join('')}</div>
      <div class="sublegend" id="sublegend">${subs.map(([k, v], i) => `<button data-sub="${esc(k)}"><i style="background:${i < 5 ? COLORS[i] : '#BFC3C8'}"></i>${esc(k)} ${v.length} 家</button>`).join('')}</div>

      <section class="hsec"><header><div><div class="kicker">指标视图</div><h2 id="kpititle"></h2></div></header>
        <div class="chartbox" id="kpiview"></div>
      </section>

      <section class="hsec"><header><div><div class="kicker">散点视角</div><h2 id="sctitle">市盈率 × ROE</h2></div>
        <div class="tabs" id="scmode" role="tablist"><button role="tab" data-t="ind" aria-selected="true">仅本行业</button><button role="tab" data-t="all" aria-selected="false">叠加百强其他公司</button></div></header>
        <div class="filters sc-ctl" id="scctl">
          <div class="segctl" role="group" aria-label="预设视角">${SC_PRESETS.map(([x, y, n], i) => `<button data-x="${x}" data-y="${y}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div>
          <label>X 轴 ${metricSelect('scx', 'pe', true)}</label><label>Y 轴 ${metricSelect('scy', 'roe', true)}</label>
        </div>
        <p class="sc-desc" id="scdesc">${esc(scDesc('pe', 'roe'))}</p>
        <div class="chartbox"><div class="scatter-host" id="scatter"></div></div>
      </section>

      <section class="hsec"><header><div><div class="kicker">公司列表</div><h2>${esc(ind)} · ${rows.length} 家</h2></div>
        <a class="morelink" href="#/compare?c=${rows.slice(0, 4).map((r) => r.code).join(',')}">对比市值前 ${Math.min(4, rows.length)} 家 →</a></header>
        <div class="tblwrap"><table class="tbl rank-tbl"><thead><tr><th>排名</th><th>公司</th><th>二级行业</th><th>总市值</th><th>市盈率</th><th>市净率</th><th>ROE 2025</th><th>股息率</th><th>年初至今</th><th>营收趋势</th></tr></thead><tbody id="indbody">${table}</tbody></table></div>
      </section>
      ${pageFoot()}
    </div>`;
  }

  /* 行业页 KPI 视图（方案 §7.1）：sub 为选中的二级行业（null = 全部） */
  const KPI_VIEWS = {
    n: ['公司构成 · 按二级行业', 'mv'], mv: ['总市值', 'mv'], pe: ['市盈率 TTM（盈利公司）', 'pe'], roe: ['ROE 5 年走势', 'roe'], ytd: ['年初至今涨跌', 'ytd']
  };
  function kpiView(host, ind, kpi, sub) {
    const rows = INDUSTRY[ind].map((k) => ROW[k]).filter((r) => !sub || r.ind2 === sub);
    const subsAll = [...new Set(INDUSTRY[ind].map((k) => ROW[k].ind2))].sort((a, b) => sum(INDUSTRY[ind].filter((k) => ROW[k].ind2 === b).map((k) => ROW[k].mv)) - sum(INDUSTRY[ind].filter((k) => ROW[k].ind2 === a).map((k) => ROW[k].mv)));
    const subColor = (s) => (subsAll.indexOf(s) < 5 ? COLORS[subsAll.indexOf(s)] : '#BFC3C8');
    document.getElementById('kpititle').textContent = KPI_VIEWS[kpi][0] + (sub ? ' · ' + sub : '');
    if (kpi === 'roe') {
      const years = [2021, 2022, 2023, 2024, 2025];
      const med = (codes) => years.map((y, i) => median(codes.map((k) => COMPANIES[k].financials.annual[i]?.roe)));
      host.innerHTML = '<div class="chart-host" id="kpichart"></div>';
      const ch = document.getElementById('kpichart');
      ch._st = null;
      drawChart(ch, {
        label: 'ROE 中位数走势', years, unitL: '%',
        series: [
          { key: 'ind', name: (sub || ind) + ' 中位数', kind: 'line', axis: 'L', fmt: 'pct', color: COLORS[0], values: med(rows.map((r) => r.code)) },
          { key: 'all', name: '百强中位数', kind: 'line', axis: 'L', fmt: 'pct', color: COLORS[2], values: med(CODES) }
        ],
        foot: '各年为该年年报 ROE 的中位数；上市前年度不计入。'
      }, true);
      return;
    }
    const key = KPI_VIEWS[kpi][1];
    const mt = METRICS[key];
    const list = rows.map((r) => ({ ...r, v: mval(key, r.code) })).filter((r) => r.v != null).sort((a, b) => (mt.better === 'low' ? a.v - b.v : b.v - a.v));
    const allMed = median(CODES.map((k) => mval(key, k)));
    const max = Math.max(1e-9, ...list.map((r) => Math.abs(r.v)), Math.abs(allMed || 0));
    const tot = sum(list.map((r) => r.v));
    host.innerHTML = list.length ? `<div class="hbars">${list.map((r, i) => `<a class="hb" href="#/${r.code}" style="--d:${i * 30}ms">
        <span class="n">${esc(r.name)}<small>${esc(r.ind2)}</small></span>
        <span class="b"><i style="width:${(Math.abs(r.v) / max) * 100}%;background:${mt.mkt ? '' : subColor(r.ind2)}" class="${mt.mkt ? cls(r.v) : ''}"></i>${key !== 'mv' && isNum(allMed) && allMed > 0 ? `<em style="left:${(allMed / max) * 100}%"></em>` : ''}</span>
        <span class="v ${mt.mkt ? cls(r.v) : ''}">${mt.fmt(r.v)}${key === 'mv' ? `<small>${pct((r.v / tot) * 100, 1)}</small>` : ''}</span></a>`).join('')}</div>
      <div class="chart-foot">${key === 'mv' ? '' : `竖线为百强中位数 ${mt.fmt(allMed)}。`}${rows.length - list.length ? `另有 ${rows.length - list.length} 家无数据未列出。` : ''}</div>`
      : '<div class="empty">所选范围内无数据</div>';
  }

  function bindIndustry() {
    bindJump();
    const ind = parseIndustry();
    const kst = { kpi: new URLSearchParams(location.hash.split('?')[1] || '').get('kpi') || 'n', sub: null };
    const kv = document.getElementById('kpiview');
    const drawK = () => {
      kpiView(kv, ind, kst.kpi, kst.sub);
      document.querySelectorAll('[data-sub]').forEach((el) => el.classList.toggle('dim', !!kst.sub && el.dataset.sub !== kst.sub));
      document.querySelectorAll('#indbody tr').forEach((tr) => { tr.hidden = !!kst.sub && tr.dataset.sub !== kst.sub; });
      history.replaceState(null, '', `#/industry?ind=${encodeURIComponent(ind)}${kst.kpi !== 'n' ? '&kpi=' + kst.kpi : ''}`);
    };
    document.getElementById('kpipick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kpi]');
      if (!b) return;
      kst.kpi = b.dataset.kpi;
      document.querySelectorAll('#kpipick [data-kpi]').forEach((x) => x.setAttribute('aria-selected', x === b));
      drawK();
    });
    ['subbar', 'sublegend'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => {
      const b = e.target.closest('[data-sub]');
      if (b) { kst.sub = kst.sub === b.dataset.sub ? null : b.dataset.sub; drawK(); }
    }));
    drawK();
    const on = document.querySelector('.ichip.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    bindRowNav(document.getElementById('indbody'));
    const host = document.getElementById('scatter');
    const st = { mode: 'ind', x: 'pe', y: 'roe', zoom: null };
    host._redraw = (anim) => drawScatter(host, ind, st, anim);
    tabs('scmode', (k) => { st.mode = k; st.zoom = null; host._redraw(true); });
    const sx = document.getElementById('scx'), sy = document.getElementById('scy');
    const setAxes = () => {
      sx.value = st.x; sy.value = st.y; st.zoom = null;
      document.getElementById('sctitle').textContent = `${shortName(METRICS[st.x])} × ${shortName(METRICS[st.y])}`;
      document.getElementById('scdesc').textContent = scDesc(st.x, st.y);
      document.querySelectorAll('#scctl [data-x]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.x === st.x && b.dataset.y === st.y));
      host._redraw(true);
    };
    document.getElementById('scctl').addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) { st.x = b.dataset.x; st.y = b.dataset.y; setAxes(); } });
    sx.addEventListener('change', () => { st.x = sx.value; setAxes(); });
    sy.addEventListener('change', () => { st.y = sy.value; setAxes(); });
    host._redraw(true);
  }

  /* ---------- 自定义轴散点（方案 §7.2 #1）：轴可选、标签避让、四象限标注、拖拽框选放大 ---------- */
  // 预设视角：[X, Y, 名称, 这个组合看什么]
  const SC_PRESETS = [
    ['pe', 'roe', '市盈率 × ROE', '看“贵不贵”和“赚钱效率”是否匹配：右上是高 ROE 但估值也高，左上是高 ROE 且估值较低。'],
    ['pb', 'roe', '市净率 × ROE（金融业常用）', '银行、保险常用。ROE 越高通常对应越高的市净率；ROE 高而市净率低的点，说明市场给的溢价较少。'],
    ['dy', 'payout', '股息率 × 5 年分红率', '看分红是否可持续：分红率和股息率都高是“高派息”；股息率高但分红率低，多是股价较低所致。'],
    ['cagr', 'npcagr', '营收增速 × 净利增速', '看增长质量：对角线上方是利润比收入涨得快（利润率在提升），下方是增收不增利。'],
    ['ytd', 'roe', '年初至今 × ROE', '看今年的涨跌与基本面是否一致：高 ROE 却下跌、低 ROE 却大涨的公司，值得进一步查看原因。'],
    ['gm', 'nm', '毛利率 × 净利率', '看费用侵蚀：两者差距越大，说明销售、管理、研发等费用吃掉的利润越多（金融业不适用）。'],
    ['debt', 'roe', '资产负债率 × ROE', '看杠杆是否推高了 ROE：负债率低而 ROE 高，盈利更多来自经营本身（金融业不适用）。']
  ];
  // 散点说明用的完整指标名与“高 / 低”含义（不用简写）
  const SC_FULL = {
    mv: ['总市值（2026-10-22 收盘）', '市值大', '市值小'], rev25: ['2025 年营业总收入', '收入规模大', '收入规模小'], np25: ['2025 年归属于母公司股东的净利润', '利润多', '利润少'],
    assets: ['2025 年末总资产', '资产规模大', '资产规模小'], emp: ['员工人数', '员工多', '员工少'],
    roe: ['2025 年净资产收益率（ROE）', '用股东的钱赚钱效率高', '赚钱效率低'], roa: ['2025 年总资产收益率（ROA）', '资产利用效率高', '资产利用效率低'],
    nm: ['2025 年净利率', '每 1 元收入留下的利润多', '利润率薄'], gm: ['2025 年毛利率', '产品附加值高', '产品附加值低'],
    cagr: ['营业总收入近 3 年复合增长率（2022–2025）', '收入增长快', '收入增长慢或下降'], npcagr: ['归母净利润近 3 年复合增长率（2022–2025）', '利润增长快', '利润增长慢或下降'],
    revyoy: ['2026 年上半年营业总收入同比增长率', '近期收入加速', '近期收入放缓'], npyoy: ['2026 年上半年归母净利润同比增长率', '近期利润加速', '近期利润放缓'],
    pe: ['市盈率（滚动 12 个月，TTM）', '估值贵', '估值便宜'], pb: ['市净率（股价 / 每股净资产）', '相对净资产溢价高', '接近或低于净资产'], ps: ['市销率（滚动 12 个月，TTM）', '每 1 元收入估值高', '每 1 元收入估值低'],
    dy: ['股息率（近 12 个月分红 / 股价）', '分红回报高', '分红回报低'], payout: ['近 5 年平均分红率（分红 / 净利润）', '利润中拿出来分红的比例高', '分红比例低'],
    divyears: ['连续分红年数', '分红持续时间长', '分红历史短'], cumdiv: ['近 5 年累计分红金额', '累计分红多', '累计分红少'],
    debt: ['2025 年末资产负债率', '负债多、杠杆高', '负债少、更稳健'], ocfnp: ['2025 年经营现金流净额 / 归母净利润', '利润的现金含量高', '利润的现金含量低'],
    gw: ['商誉 / 净资产', '并购形成的商誉占比高', '商誉占比低'], rd: ['2025 年研发费用 / 营业收入', '研发投入强度高', '研发投入少'],
    chg: ['2026-10-22 当日涨跌幅', '当日上涨', '当日下跌'], ytd: ['2026 年初至今涨跌幅（前复权）', '今年涨得多', '今年跌得多'],
    r1y: ['近 1 年涨跌幅（前复权）', '近一年涨得多', '近一年跌得多'], r3y: ['近 3 年涨跌幅（前复权）', '近三年涨得多', '近三年跌得多'],
    amount: ['2026-10-22 成交额', '交易活跃', '交易清淡'], turnover: ['2026-10-22 换手率', '换手活跃', '换手低'],
    ctrl: ['控股股东持股比例', '股权集中', '股权分散'], inst: ['机构投资者持股比例', '机构持有多', '机构持有少'], north: ['陆股通（北向资金）持股比例', '外资持有多', '外资持有少'],
    pledge: ['股权质押比例', '质押多', '质押少'], holderchg: ['股东户数较上期变化', '股东户数增加（筹码分散）', '股东户数减少（筹码集中）']
  };
  // 两类指标放在一起时，这个组合能回答什么问题
  const SC_PAIR = {
    'value|profit': '估值和盈利能力是否匹配', 'value|growth': '估值是否有成长性支撑', 'growth|growth': '增长的质量与持续性',
    'return|value': '分红回报与估值的关系', 'return|profit': '分红是否建立在足够的盈利之上', 'return|return': '分红是否稳定、可持续',
    'market|profit': '股价表现与盈利能力是否一致', 'market|growth': '股价表现与业绩增长是否一致', 'market|value': '涨跌之后估值处在什么位置', 'market|market': '短期与长期股价表现是否一致',
    'scale|profit': '体量大的公司是否也更赚钱', 'scale|growth': '大公司与小公司谁增长更快', 'scale|value': '市场是否给大公司更高或更低的估值', 'scale|scale': '不同规模口径之间的对应关系',
    'health|profit': '盈利是否依赖高杠杆或伴随风险', 'health|value': '财务稳健程度与估值的关系', 'health|growth': '增长是否靠举债或研发投入推动',
    'gov|market': '股东结构与股价表现的关系', 'gov|profit': '股东结构与盈利能力的关系', 'gov|value': '股东结构与估值的关系',
    'growth|profit': '增长快的公司是否同时赚钱效率高（增长质量）', 'profit|profit': '不同盈利指标之间是否一致（利润从哪里来）',
    'return|growth': '高分红是否以牺牲增长为代价', 'return|market': '高分红公司今年的股价表现', 'return|health': '分红是否有现金流和稳健的资产负债表支撑',
    'scale|return': '大公司是否分红更多', 'scale|health': '体量与财务稳健程度的关系', 'scale|market': '大公司与小公司的股价表现差异', 'scale|gov': '体量与股东结构的关系',
    'health|health': '财务风险指标之间是否相互印证', 'health|market': '财务稳健程度与股价表现的关系',
    'gov|growth': '股东结构与业绩增长的关系', 'gov|gov': '不同股东群体的持股是否此消彼长', 'gov|return': '股东结构与分红政策的关系', 'gov|health': '股东结构与财务风险的关系',
    'value|value': '不同估值口径是否给出一致的“贵 / 便宜”判断', 'market|health': '财务稳健程度与股价表现的关系'
  };
  const scDesc = (x, y) => {
    const preset = SC_PRESETS.find((p) => p[0] === x && p[1] === y);
    const [fx, hx, lx] = SC_FULL[x] || [METRICS[x].name, '数值高', '数值低'];
    const [fy, hy, ly] = SC_FULL[y] || [METRICS[y].name, '数值高', '数值低'];
    const gx = METRICS[x].group, gy = METRICS[y].group;
    const q = SC_PAIR[gx + '|' + gy] || SC_PAIR[gy + '|' + gx] || '两项指标之间是否存在关联';
    const axes = `横轴：${fx}；纵轴：${fy}。`;
    if (preset) return `${axes}${preset[3]}`;
    return `${axes}这个组合用来观察${q}。右上角是“${hx}、${hy}”的公司，左下角是“${lx}、${ly}”；左上和右下两个角是两项指标背离的公司，通常最值得点开看原因。虚线为本行业中位数。`;
  };
  const LOG_KEYS = new Set(['pe', 'pb', 'ps', 'mv', 'rev25', 'np25', 'assets', 'cumdiv', 'amount']);
  const shortName = (mt) => mt.name.replace(/ 2025$| TTM$|（中报）$/, '');
  function drawScatter(host, ind, st, anim) {
    const W = Math.max(300, host.clientWidth), H = W < 640 ? 360 : 460;
    const padL = 56, padR = 20, padT = 16, padB = 46;
    const iw = W - padL - padR, ih = H - padT - padB;
    const xm = METRICS[st.x], ym = METRICS[st.y];
    const mine = INDUSTRY[ind].map((k) => ROW[k]);
    const subMv = {};
    mine.forEach((r) => { subMv[r.ind2] = (subMv[r.ind2] || 0) + (r.mv || 0); });
    const subs = Object.keys(subMv).sort((a, b) => subMv[b] - subMv[a]);
    const logX = LOG_KEYS.has(st.x), logY = LOG_KEYS.has(st.y);
    const val = (r) => ({ ...r, xv: mval(st.x, r.code), yv: mval(st.y, r.code) });
    const ok = (r) => r.xv != null && r.yv != null && (!logX || r.xv > 0) && (!logY || r.yv > 0);
    const inZoom = (r) => !st.zoom || (r.xv >= st.zoom.x0 && r.xv <= st.zoom.x1 && r.yv >= st.zoom.y0 && r.yv <= st.zoom.y1);
    const all = mine.map(val);
    const pts = all.filter(ok).filter(inZoom);
    const others = st.mode === 'all' ? ROWS.filter((r) => r.ind !== ind).map(val).filter(ok).filter(inZoom) : [];
    const excluded = all.filter((r) => !ok(r));
    const dom = [...pts, ...others];
    if (!dom.length) { host.innerHTML = '<div class="empty">所选指标在本行业没有可画的数据</div>'; return; }
    const tf = (log) => (log ? Math.log10 : (v) => v), itf = (log) => (log ? (v) => 10 ** v : (v) => v);
    const fx = tf(logX), fy = tf(logY), ifx = itf(logX), ify = itf(logY);
    const ext = (vals, f, log) => {
      let lo = Math.min(...vals.map(f)), hi = Math.max(...vals.map(f));
      if (st.zoom) return [lo, hi === lo ? lo + 1 : hi];
      const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
      return log ? [lo - pad, hi + pad] : [Math.min(lo - pad, lo >= 0 ? 0 : lo - pad), hi + pad];
    };
    let [x0, x1] = st.zoom ? [fx(st.zoom.x0), fx(st.zoom.x1)] : ext(dom.map((r) => r.xv), fx, logX);
    let [y0, y1] = st.zoom ? [fy(st.zoom.y0), fy(st.zoom.y1)] : ext(dom.map((r) => r.yv), fy, logY);
    const xs = logX ? null : niceScale(x0, x1, 6), ys = logY ? null : niceScale(y0, y1, 5);
    if (xs && !st.zoom) [x0, x1] = [xs.lo, xs.hi];
    if (ys && !st.zoom) [y0, y1] = [ys.lo, ys.hi];
    const X = (v) => padL + ((fx(v) - x0) / (x1 - x0)) * iw;
    const Y = (v) => padT + ih - ((fy(v) - y0) / (y1 - y0)) * ih;
    const invX = (px) => ifx(x0 + ((px - padL) / iw) * (x1 - x0));
    const invY = (py) => ify(y0 + ((padT + ih - py) / ih) * (y1 - y0));
    const LOGT = [0.1, 0.2, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 200, 500, 1000, 2000, 5000, 1e4, 2e4, 5e4, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13];
    const logTicks = (a, b) => { const t = LOGT.filter((v) => Math.log10(v) >= a && Math.log10(v) <= b); return t.length > 8 ? t.filter((v) => /^[125]/.test(String(v))) : t; };
    const xticks = logX ? logTicks(x0, x1) : xs.ticks.filter((t) => t >= x0 && t <= x1);
    const yticks = logY ? logTicks(y0, y1) : ys.ticks.filter((t) => t >= y0 && t <= y1);
    const tick = (mt, t) => (mt.fmt === money ? money(t) : mt.fmt(t).replace(/ 倍$/, ''));

    let g = '<g class="grid">';
    yticks.forEach((t) => { g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(t)}" y2="${Y(t)}" ${t === 0 ? 'class="zero" stroke-dasharray="0"' : ''}/>`; });
    xticks.forEach((t) => { g += `<line x1="${X(t)}" x2="${X(t)}" y1="${padT}" y2="${padT + ih}"/>`; });
    g += '</g>';
    let ax = '';
    yticks.forEach((t) => { ax += `<text x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end">${tick(ym, t)}</text>`; });
    xticks.forEach((t) => { ax += `<text x="${X(t)}" y="${padT + ih + 18}" text-anchor="middle">${tick(xm, t)}</text>`; });
    ax += `<text class="axt" x="${padL + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(xm.name)}${logX ? '（对数坐标）' : ''}</text>`;
    ax += `<text class="axt" x="14" y="${padT + ih / 2}" text-anchor="middle" transform="rotate(-90 14 ${padT + ih / 2})">${esc(ym.name)}${logY ? '（对数）' : ''}</text>`;

    // 行业中位数十字线 + 四象限角标
    const mX = median(pts.map((r) => r.xv)), mY = median(pts.map((r) => r.yv));
    let med = '';
    if (pts.length >= 3) {
      med = `<line class="med" x1="${X(mX)}" x2="${X(mX)}" y1="${padT}" y2="${padT + ih}"/><line class="med" x1="${padL}" x2="${W - padR}" y1="${Y(mY)}" y2="${Y(mY)}"/>
        <text class="medt" x="${X(mX) + 6}" y="${padT + 12}">行业中位 ${esc(xm.fmt(mX))}</text><text class="medt" x="${W - padR - 6}" y="${Y(mY) - 6}" text-anchor="end">行业中位 ${esc(ym.fmt(mY))}</text>`;
      const q = (hx, hy) => `${shortName(xm)}${hx ? '高' : '低'} · ${shortName(ym)}${hy ? '高' : '低'}`;
      med += `<g class="quad"><text x="${padL + 8}" y="${padT + 14}">${q(0, 1)}</text><text x="${W - padR - 8}" y="${padT + 28}" text-anchor="end">${q(1, 1)}</text>
        <text x="${padL + 8}" y="${padT + ih - 8}">${q(0, 0)}</text><text x="${W - padR - 8}" y="${padT + ih - 8}" text-anchor="end">${q(1, 0)}</text></g>`;
    }
    const maxMv = Math.max(...ROWS.map((r) => r.mv || 0));
    const rad = (mv) => 5 + 18 * Math.sqrt((mv || 0) / maxMv);
    const bg = others.map((r) => `<circle class="dot bgdot" data-k="${r.code}" cx="${X(r.xv)}" cy="${Y(r.yv)}" r="${Math.max(3, rad(r.mv) * 0.6)}"/>`).join('');
    const sorted = [...pts].sort((a, b) => b.mv - a.mv);
    // 标签避让：按市值从大到小依次尝试 右 / 左 / 上 / 下，与已放置标签或气泡重叠则换位，都不行就不画（悬停仍可见）
    const boxes = sorted.map((r) => { const rr = rad(r.mv); return { x0: X(r.xv) - rr, x1: X(r.xv) + rr, y0: Y(r.yv) - rr, y1: Y(r.yv) + rr }; });
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const placed = [];
    const labels = sorted.map((r, i) => {
      const cxp = X(r.xv), cyp = Y(r.yv), rr = rad(r.mv), w = r.name.length * 12 + 2, h = 14;
      const cand = [[cxp + rr + 4, cyp + 4, 'start'], [cxp - rr - 4, cyp + 4, 'end'], [cxp, cyp - rr - 5, 'middle'], [cxp, cyp + rr + 13, 'middle']];
      for (const [tx, ty, anc] of cand) {
        const bx = anc === 'start' ? tx : anc === 'end' ? tx - w : tx - w / 2;
        const box = { x0: bx, x1: bx + w, y0: ty - 11, y1: ty - 11 + h };
        if (box.x0 < padL || box.x1 > W - padR || box.y0 < padT || box.y1 > padT + ih) continue;
        if (placed.some((p) => hit(p, box)) || boxes.some((b, j) => j !== i && hit(b, box))) continue;
        placed.push(box);
        return `<text class="dl" x="${tx}" y="${ty}" text-anchor="${anc}">${esc(r.name)}</text>`;
      }
      return '';
    });
    const fg = sorted.map((r, i) => {
      const col = subs.indexOf(r.ind2) < 5 ? COLORS[subs.indexOf(r.ind2)] : '#8A9099';
      return `<g class="dotg" style="--d:${anim && !REDUCED ? i * 40 : 0}ms"><circle class="dot" data-k="${r.code}" cx="${X(r.xv)}" cy="${Y(r.yv)}" r="${rad(r.mv)}" style="fill:${col}"/></g>`;
    }).join('') + `<g class="dls">${labels.join('')}</g>`;
    const hidden = labels.filter((x) => !x).length;

    host.innerHTML = `
      <div class="chart-head"><div class="legend">${subs.map((s, i) => `<span class="lg"><i style="background:${i < 5 ? COLORS[i] : '#8A9099'};border-radius:50%"></i>${esc(s)}</span>`).join('')}${others.length ? '<span class="lg"><i style="background:#D6D8DB;border-radius:50%"></i>百强其他公司</span>' : ''}</div>
        <div class="axisnote">气泡大小 = 总市值 · 拖拽框选放大 · 点击进入公司${st.zoom ? ' · <button class="linkbtn" id="sczoomreset">重置缩放</button>' : ''}</div></div>
      <div class="cv"><svg class="${anim && !REDUCED ? '' : 'still'}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ind)} ${esc(xm.name)}与${esc(ym.name)}散点图">${g}${med}${bg}${fg}${ax}<rect class="brush" width="0" height="0"/></svg><div class="tip"></div></div>
      <div class="chart-foot">${excluded.length ? `未画出：${excluded.map((r) => esc(r.name)).join('、')}（数据缺失${logX || logY ? '或对数轴上为非正值' : ''}）。` : ''}${hidden ? `${hidden} 个标签因重叠未显示，悬停可看。` : ''}虚线为本行业中位数。</div>`;

    const svg = host.querySelector('svg'), tip = host.querySelector('.tip'), brush = svg.querySelector('.brush');
    const pos = (e) => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let drag = null;
    svg.addEventListener('mousedown', (e) => { if (e.button) return; const [x, y] = pos(e); if (x > padL && x < W - padR && y > padT && y < padT + ih) { drag = [x, y]; e.preventDefault(); } });
    svg.addEventListener('mousemove', (e) => {
      if (drag) {
        const [x, y] = pos(e);
        brush.setAttribute('x', Math.min(x, drag[0])); brush.setAttribute('y', Math.min(y, drag[1]));
        brush.setAttribute('width', Math.abs(x - drag[0])); brush.setAttribute('height', Math.abs(y - drag[1]));
        tip.classList.remove('on');
        return;
      }
      const d = e.target.closest('.dot');
      if (!d) { tip.classList.remove('on'); return; }
      const r = ROW[d.dataset.k];
      tip.innerHTML = `<b>${esc(r.name)} <span style="opacity:.7;font-weight:400">${r.code}</span></b>
        <div>${esc(r.ind)} · ${esc(r.ind2)}</div><div>总市值<span>${money(r.mv)}</span></div>
        <div>${esc(xm.name)}<span>${xm.fmt(mval(st.x, r.code))}</span></div><div>${esc(ym.name)}<span>${ym.fmt(mval(st.y, r.code))}</span></div>`;
      tip.classList.add('on');
      const [x, y] = pos(e);
      tip.style.left = Math.min(W - tip.offsetWidth, x + 14) + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
    });
    const end = (e) => {
      if (!drag) return;
      const [x, y] = pos(e), [sx, sy] = drag;
      drag = null;
      brush.setAttribute('width', 0); brush.setAttribute('height', 0);
      if (Math.abs(x - sx) < 12 || Math.abs(y - sy) < 12) return;
      st.zoom = { x0: invX(Math.min(x, sx)), x1: invX(Math.max(x, sx)), y0: invY(Math.max(y, sy)), y1: invY(Math.min(y, sy)) };
      host._redraw(true);
    };
    svg.addEventListener('mouseup', end);
    svg.addEventListener('mouseleave', (e) => { end(e); tip.classList.remove('on'); });
    svg.addEventListener('click', (e) => { const d = e.target.closest('.dot'); if (d) location.hash = '#/' + d.dataset.k; });
    const rs = document.getElementById('sczoomreset');
    if (rs) rs.addEventListener('click', () => { st.zoom = null; host._redraw(true); });
  }

  /* 表格行：点击、方向键、回车 */
  function bindRowNav(tbody) {
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const tr = e.target.closest('tr[data-href]');
      if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
    });
    tbody.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-href]');
      if (!tr) return;
      if (e.key === 'Enter') location.hash = tr.dataset.href;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nx = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
        if (nx && nx.dataset.href) nx.focus();
      }
    });
  }

  /* ---------- 详情页 ---------- */
  // 标签页：概览包含 hero 与公司简介两个 section；无主营构成数据时不显示「主营」
  const TABS = [['overview', '概览'], ['fin', '财务'], ['holders', '股东'], ['div', '分红'], ['seg', '主营'], ['peers', '同行'], ['qa', '问答'], ['ann', '公告']];
  const companyTabs = (hasSeg) => TABS.filter(([k]) => k !== 'seg' || hasSeg);
  const TAB_OF = (secId) => (secId === 'profile' ? 'overview' : secId);

  function companyView(code) {
    const c = COMPANIES[code];
    const id = c.identity, m = c.market, f = c.financials, s = c.shareholders, d = c.dividends, p = c.peers;
    const lat = f.latest || {};
    const isFav = favs().includes(code);
    const indRank = (INDUSTRY[id.industry_sw1] || []).indexOf(code) + 1;
    const indN = (INDUSTRY[id.industry_sw1] || []).length;

    /* 身份区 */
    const tags = [
      `<span class="tag code">${code}</span>`,
      `<span class="tag">${esc(id.board || '')}</span>`,
      `<a class="tag brand" href="#/industry?ind=${encodeURIComponent(id.industry_sw1 || '')}" title="查看行业页">${esc(id.industry_sw1 || '')} · ${esc(id.industry_sw2 || '')}</a>`,
      ...(m.index_members || []).map((x) => `<span class="tag">${esc(x)}</span>`),
      id.st_status && id.st_status !== '正常' ? `<span class="tag warn">${esc(id.st_status)}</span>` : ''
    ].join('');
    const star = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';

    /* 核心指标 */
    const chg = m.change_pct;
    const metrics = `
      <div class="metric big"><div class="k">收盘价（元）</div>
        <div class="v"><span class="cu" data-v="${m.price}" data-f="num">${num(m.price)}</span><span class="chg ${cls(chg)}">${arrow(chg)} ${spct(chg)}</span></div>
        <div class="s">成交额 ${money(m.amount)} · 换手 ${pct(m.turnover_rate)}</div></div>
      <div class="metric"><div class="k">总市值</div><div class="v"><span class="cu" data-v="${m.total_mv}" data-f="money">${money(m.total_mv)}</span></div><div class="s">百强第 ${MV_RANK[code]} · 行业第 ${indRank}/${indN}</div></div>
      <div class="metric"><div class="k">市盈率 TTM</div><div class="v"><span class="cu" data-v="${m.pe_ttm}" data-f="num">${num(m.pe_ttm)}</span></div><div class="s">静态 ${num(m.pe_static)}</div></div>
      <div class="metric"><div class="k">市净率 MRQ</div><div class="v"><span class="cu" data-v="${m.pb}" data-f="num">${num(m.pb)}</span></div><div class="s">市销率 ${num(m.ps_ttm)}</div></div>
      <div class="metric"><div class="k">股息率</div><div class="v"><span class="cu" data-v="${m.dividend_yield}" data-f="pct">${pct(m.dividend_yield)}</span></div><div class="s">连续分红 ${d.consecutive_years ?? '—'} 年</div></div>
      <div class="metric"><div class="k">ROE（${esc((lat.report_type || '最新').replace(/^\d{4}年/, ''))}）</div><div class="v"><span class="cu" data-v="${lat.roe}" data-f="pct">${pct(lat.roe)}</span></div><div class="s">流通市值 ${money(m.float_mv)}</div></div>`;

    /* 52 周区间（bug 3：圆点上标出当前价） */
    let range = '<div class="empty">52 周区间数据不足</div>';
    if (isNum(m.low_52w) && isNum(m.high_52w) && m.high_52w > m.low_52w) {
      const pos = Math.min(1, Math.max(0, (m.price - m.low_52w) / (m.high_52w - m.low_52w)));
      range = `
        <div class="lbl">52 周区间（前复权）</div>
        <div class="track"><div class="mk" data-pos="${(pos * 100).toFixed(1)}"><b>${num(m.price)}</b><i></i></div></div>
        <div class="ends"><span><em>最低</em>${num(m.low_52w)}</span><span><em>最高</em>${num(m.high_52w)}</span></div>
        <div class="pos">当前价位于区间 ${(pos * 100).toFixed(0)}% 处</div>`;
    }
    const retCell = (k, v) => isNum(v)
      ? `<div class="ret ${cls(v)}"><div class="k">${k}</div><div class="v ${cls(v)}">${spct(v)}</div></div>`
      : `<div class="ret"><div class="k">${k}</div><div class="v na">上市时间不足</div></div>`;
    const rets = `<div class="lbl">区间涨跌（前复权）</div><div class="rets">${retCell('年初至今', m.ytd_return)}${retCell('近 1 年', m.return_1y)}${retCell('近 3 年', m.return_3y)}</div>`;

    /* 公司档案 */
    const site = id.website ? `<a href="https://${esc(id.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${esc(id.website)}</a>` : '—';
    const facts = [
      ['公司全称', esc(id.name_full)],
      ['英文名称', esc(id.name_en || '—')],
      ['上市日期', dstr(id.list_date)],
      ['注册地', esc(id.province || '—') + (id.city && id.city !== id.province ? ' ' + esc(id.city) : '')],
      ['董事长', esc(id.chairman || '—') + (id.chairman ? '' : ' <span class="faint">（空缺）</span>')],
      ['员工人数', isNum(id.employees) ? int(id.employees) + ' 人' : '—'],
      ['审计意见', esc(id.audit_opinion || '—')],
      ['所属指数', (m.index_members || []).length ? esc(m.index_members.join('、')) : '<span class="faint">未纳入上证50、沪深300、中证A500、科创50、创业板指</span>'],
      ['曾用名', (id.former_names || []).length ? esc(id.former_names.join('、')) : '<span class="faint">无</span>'],
      ['官网', site]
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    /* 财务：最新一期 */
    const yoy = (v) => `<div class="s ${cls(v)}">同比 ${spct(v)}</div>`;
    const fin = `
      <div class="sub">${esc(lat.report_type || '最新一期')}<span class="note">报告期 ${esc(lat.report_period || '—')}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="k">营业总收入</div><div class="v">${money(lat.revenue)}</div>${yoy(lat.revenue_yoy)}</div>
        <div class="kpi"><div class="k">归母净利润</div><div class="v ${isNum(lat.net_profit) && lat.net_profit < 0 ? 'down' : ''}">${money(lat.net_profit)}</div>${yoy(lat.net_profit_yoy)}</div>
        <div class="kpi"><div class="k">扣非归母净利</div><div class="v">${money(lat.net_profit_deducted)}</div><div class="s faint">EPS ${num(lat.eps)} 元</div></div>
        <div class="kpi"><div class="k">毛利率</div><div class="v">${pct(lat.gross_margin)}</div><div class="s faint">净利率 ${pct(lat.net_margin)}</div></div>
        <div class="kpi"><div class="k">资产负债率</div><div class="v">${pct(lat.debt_ratio)}</div><div class="s faint">ROE ${pct(lat.roe)}</div></div>
        <div class="kpi"><div class="k">经营现金流</div><div class="v">${money(lat.ocf)}</div><div class="s faint">半年度累计</div></div>
      </div>
      <div class="sub">年度经营表现 · 2021–2025<span class="note">金额单位：亿元 · 鼠标悬停查看明细 · 点击图例显示/隐藏</span></div>
      <div class="tabs" role="tablist" id="fintabs">
        ${FIN_TABS.map((t, i) => `<button role="tab" data-t="${t.key}" aria-selected="${i === 0}">${t.name}</button>`).join('')}
      </div>
      <div class="chartbox"><div class="chart-host" id="finchart"></div></div>
      <div class="tblwrap" id="fintable"></div>
      <div class="derived">
        <span>营收 3 年复合增速<b class="${cls(f.derived?.revenue_cagr_3y)}">${spct(f.derived?.revenue_cagr_3y)}</b></span>
        <span>净利 3 年复合增速<b class="${cls(f.derived?.net_profit_cagr_3y)}">${spct(f.derived?.net_profit_cagr_3y)}</b></span>
        <span>应收账款 / 营收<b>${pct(f.derived?.receivables_to_revenue)}</b></span>
        <span>商誉 / 归母净资产<b>${pct(f.derived?.goodwill_to_equity)}</b></span>
      </div>
      ${dupontBlock(c)}`;

    /* 股东 */
    const top10 = (s.top10 || []).slice(0, 10);
    const sum10 = top10.reduce((a, h) => a + (h.hold_ratio || 0), 0);
    const stack = top10.map((h, i) => `<i data-i="${i}" title="${esc(h.name)} ${num(h.hold_ratio)}%" style="width:${(h.hold_ratio || 0)}%;background:${i === 0 ? 'var(--chart-1)' : i === 1 ? 'var(--chart-2)' : i === 2 ? 'var(--chart-3)' : i === 3 ? 'var(--chart-4)' : 'var(--chart-5)'};--d:${i * 60}ms"></i>`).join('')
      + `<i class="rest" style="width:${Math.max(0, 100 - sum10)}%" title="其他股东 ${num(Math.max(0, 100 - sum10))}%"></i>`;
    const maxR = Math.max(1, ...top10.map((h) => h.hold_ratio || 0));
    const chgCell = (h) => {
      if (h.hold_num_change == null) return '<span class="tag warn" style="height:20px">新进</span>';
      if (h.hold_num_change === 0) return '<span class="faint">不变</span>';
      const v = h.hold_num_change;
      return `<span class="${cls(v)}">${arrow(v)} ${fmt(Math.abs(v) / 1e4, 0)}万股</span>`;
    };
    const holderRows = top10.map((h, i) => `
      <div class="holder" data-i="${i}">
        <div class="rk">${h.rank}</div>
        <div class="n" title="${esc(h.name)}">${esc(h.name)}</div>
        <div class="b"><i style="width:${((h.hold_ratio || 0) / maxR) * 100}%;background:${i < 4 ? COLORS[i] : 'var(--chart-5)'};--d:${i * 60}ms"></i></div>
        <div class="r">${num(h.hold_ratio)}%</div>
        <div class="c">${chgCell(h)}</div>
      </div>`).join('');
    const ctrlName = s.controlling_shareholder || '—';
    const execs = (s.executives || []).map((e) => `<tr><td>${esc(e.name)}</td><td class="muted">${esc(e.title)}</td><td>${isNum(e.pay) ? (e.pay === 0 ? '0 元' : money(e.pay)) : '<span class="faint" title="年报/招股书金额尚未逐人核实">薪酬未核实</span>'}</td></tr>`).join('');
    const hnc = s.holder_num_change_pct;
    // 次新股上市后户数可能暴增数万倍（如长鑫科技），大数去掉小数位并说明
    const hncText = spct(hnc);
    const unlock = (s.unlock_12m || []).length
      ? (s.unlock_12m || []).map((u) => `<tr><td>${dstr(u.date)}</td><td>${fmt(u.shares / 1e8, 2)} 亿股</td><td>${pct(u.ratio)}</td></tr>`).join('')
      : '';
    const holders = `
      <div class="ctrl">
        <div class="card"><div class="k">实际控制人</div><div class="v">${esc(s.controller || '—')}</div></div>
        <div class="card"><div class="k">控股股东</div><div class="v">${esc(ctrlName)}</div>
          <div class="s">${isNum(s.controlling_ratio) ? `持股 ${num(s.controlling_ratio)}%` : (ctrlName === '无控股股东' ? '股权较分散' : '')}</div></div>
      </div>
      <div class="sub">股权结构<span class="note">前十大股东合计 ${num(sum10)}% · 截至 ${esc(s.holder_num_date || '—')}</span></div>
      <div class="stack" id="stack">${stack}</div>
      <div class="stack-note"><span>深色 → 浅色：第 1–5 大股东</span><span>斜纹：其他股东</span></div>
      <div class="hstats">
        <div class="kpi"><div class="k">股东户数</div><div class="v">${isNum(s.holder_num) ? int(s.holder_num) + ' 户' : '—'}</div>
          <div class="s ${cls(hnc)}"${isNum(hnc) && Math.abs(hnc) >= 1000 ? ' title="上期为上市前，股东户数基数极小"' : ''}>较上期 ${hncText}</div></div>
        <div class="kpi"><div class="k">机构持股（财务投资者）</div><div class="v">${pct(s.inst_hold_ratio)}</div><div class="s">${isNum(s.inst_hold_ratio) ? '基金/保险/券商/QFII/社保' : '该期暂无可比数据'}</div></div>
        <div class="kpi"><div class="k">陆股通持股</div><div class="v">${pct(s.northbound_ratio)}</div><div class="s">${isNum(s.northbound_ratio) ? '占总股本' : '未查得持股数据'}</div></div>
        <div class="kpi"><div class="k">质押比例</div><div class="v">${pct(s.pledge_ratio_total)}</div><div class="s">${s.pledge_ratio_total === 0 ? '无质押' : '全公司质押 ÷ 总股本'}</div></div>
      </div>
      <div class="sub">前十大股东<span class="note">持股变化为较上期增减；悬停联动股权结构条</span></div>
      <div class="holders" id="holders">${holderRows || '<div class="empty">暂无数据</div>'}</div>
      <div class="two">
        <div><div class="sub">核心高管</div><table class="mini-tbl"><thead><tr><th>姓名</th><th>职务</th><th>2025 年税前报酬</th></tr></thead><tbody>${execs}</tbody></table></div>
        <div><div class="sub">未来 12 个月解禁</div>${unlock ? `<table class="mini-tbl"><thead><tr><th>日期</th><th>数量</th><th>占总股本</th></tr></thead><tbody>${unlock}</tbody></table>` : '<div class="empty">未来 12 个月无解禁</div>'}</div>
      </div>`;

    /* 分红（bug 5：未分红年度标注） */
    const divRows = d.annual.map((x) => {
      const none = !x.dps_pretax;
      return `<tr><td class="yr">${x.fiscal_year}</td>
        <td>${none ? '<span class="nodiv">本年度未分红</span>' : num(x.dps_pretax, 4)}</td>
        <td>${none ? '<span class="na">—</span>' : money(x.total_amount)}</td>
        <td>${x.payout_ratio == null ? NA('当年归母净利为负，分红率无意义') : pct(x.payout_ratio)}</td>
        <td>${none ? '<span class="na">—</span>' : pct(x.dividend_yield)}</td>
        <td>${x.ex_date ? dstr(x.ex_date) : '<span class="na">—</span>'}</td></tr>`;
    }).join('');
    const bb = d.buyback_3y;
    const div = `
      <div class="divstats">
        <div class="kpi"><div class="k">连续分红</div><div class="v">${d.consecutive_years ?? '—'} 年</div><div class="s faint">含 2026 中期</div></div>
        <div class="kpi"><div class="k">5 年累计分红</div><div class="v">${money(d.cum_dividend_5y)}</div><div class="s faint">2021–2025</div></div>
        <div class="kpi"><div class="k">5 年累计归母净利</div><div class="v">${money(d.cum_netprofit_5y)}</div><div class="s faint">同期</div></div>
        <div class="kpi"><div class="k">5 年分红率</div><div class="v">${pct(d.payout_5y)}</div><div class="s faint">${d.payout_5y == null ? '累计净利为负，不适用' : '累计分红 ÷ 累计净利'}</div></div>
        <div class="kpi"><div class="k">近 3 年回购</div><div class="v">${bb === 0 ? '0' : money(bb)}</div><div class="s faint">${bb == null ? '回购金额待核实' : bb === 0 ? '已核实无市场回购' : '实际已支付金额'}</div></div>
      </div>
      <div class="chartbox"><div class="chart-host" id="divchart"></div></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>年度</th><th>每股派息（元，税前）</th><th>分红总额</th><th>分红率</th><th>股息率</th><th>除权除息日</th></tr></thead><tbody>${divRows}</tbody></table></div>`;

    /* 主营构成 */
    const segBlock = (type, title) => {
      const all = (p.segments || []).filter((x) => x.type === type);
      if (!all.length) return '';
      const pos = all.filter((x) => (x.ratio || 0) > 0).sort((a, b) => b.ratio - a.ratio);
      const neg = all.filter((x) => (x.ratio || 0) < 0);
      const period = all[0].period || '';
      if (!neg.length) {
        const total = pos.reduce((a, x) => a + (x.revenue || 0), 0);
        return `<div class="card"><div class="sub" style="margin-top:0">${title}<span class="note">${esc(period)}</span></div>
          <div class="donut-wrap" data-donut>${donut(pos, total)}<div class="seglist">${pos.map((x, i) => `
            <div class="segrow" data-i="${i}"><i style="background:${COLORS[i % COLORS.length]}"></i><div class="n" title="${esc(x.name)}">${esc(x.name)}<small>${money(x.revenue)}</small></div><div class="r">${pct(x.ratio, 1)}</div></div>`).join('')}</div></div></div>`;
      }
      const max = Math.max(...pos.map((x) => x.ratio));
      return `<div class="card"><div class="sub" style="margin-top:0">${title}<span class="note">${esc(period)}</span></div>
        ${pos.map((x, i) => `<div class="segbar"><div class="n" title="${esc(x.name)}">${esc(x.name)} <span class="faint">${money(x.revenue)}</span></div><div class="r">${pct(x.ratio, 1)}</div><div class="b"><i style="width:${(x.ratio / max) * 100}%;background:${COLORS[i % COLORS.length]};--d:${i * 80}ms"></i></div></div>`).join('')}
        ${neg.map((x) => `<div class="segbar neg"><div class="n">${esc(x.name)} <span class="faint">${money(x.revenue)}</span></div><div class="r">${pct(x.ratio, 1)}</div></div>`).join('')}
        <div class="chart-foot">含分部间抵销（负值），各分部占比相加超过 100%，故不画环形图。</div></div>`;
    };
    const segs = segBlock('product', '按产品') + segBlock('region', '按地区');

    /* 同行 */
    const peerIn = (p.peer_codes || []).filter((x) => COMPANIES[x]);
    const peerOut = (p.peer_codes || []).filter((x) => !COMPANIES[x]);
    const peers = (peerIn.length ? `
      <div class="tabs" role="tablist" id="peertabs">${Object.entries(PEER_PICK).map(([g], i) => `<button role="tab" data-t="${g}" aria-selected="${i === 0}">${GROUPS[g]}</button>`).join('')}</div>
      <div id="peerbox" style="margin-top:16px"></div>` : '<div class="empty">可比公司均不在百强名单内，暂无对比数据</div>')
      + (peerOut.length ? `<div class="peer-out">另有可比公司 ${peerOut.map(esc).join('、')} 不在百强名单内，无数据。同行按申万二级行业、市值降序选取。</div>` : '');

    /* 问答（bug 1：按提问日降序显示） */
    const QA_THIRD_PARTY = ['601658.SH', '601766.SH', '688012.SH', '688235.SH', '688802.SH', '688808.SH', '688820.SH'];
    const qaItems = [...(c.qa.items || [])].sort((a, b) => (b.ask_date || '').localeCompare(a.ask_date || ''));
    // 回复率与平均回复天数（只计有回复日期的）；第三方来源无回答时与「公司未回复」区分
    const third = QA_THIRD_PARTY.includes(code);
    const answered = qaItems.filter((x) => x.answer);
    const days = answered.filter((x) => x.answer_date && x.ask_date).map((x) => (new Date(x.answer_date) - new Date(x.ask_date)) / 864e5);
    const srcs = [...new Set(qaItems.map((x) => x.source))];
    const qaBar = qaItems.length ? `<div class="qa-stats"><span>共 <b>${qaItems.length}</b> 条</span><span>已回复 <b>${answered.length}</b> 条 · 回复率 <b>${pct((answered.length / qaItems.length) * 100, 0)}</b></span>
        ${days.length ? `<span>平均回复用时 <b>${fmt(sum(days) / days.length, 1)}</b> 天</span>` : ''}</div>
      <div class="annbar" id="qabar">${[['all', '全部', qaItems.length], ['yes', '已回复', answered.length], ['no', '未回复', qaItems.length - answered.length]].map(([k, n, ct], i) => `<button class="chip" data-f="${k}" aria-pressed="${i === 0}">${n}<b>${ct}</b></button>`).join('')}
        ${srcs.length > 1 ? srcs.map((s) => `<button class="chip" data-s="${s}" aria-pressed="false">${s === 'irm' ? '深交所互动易' : '上证e互动'}</button>`).join('') : ''}
        <input id="qaq" type="search" placeholder="搜索问题与回答" aria-label="搜索问答"></div>` : '';
    const qa = qaItems.length ? `${qaBar}<div class="qa-list" id="qalist">${qaItems.map((x, i) => `
      <article class="qa-item" data-i="${i}" data-ans="${x.answer ? 1 : 0}" data-src="${esc(x.source)}">
        <div class="qa-meta"><span>提问 ${dstr(x.ask_date)}</span><span>${x.source === 'irm' ? '深交所互动易' : '上证e互动'}</span>${qaLink(x, i, third)}</div>
        <div class="qa-q">${esc(x.question || '（提问内容缺失）')}</div>
        ${x.answer ? `<div class="qa-a${x.answer.length > 160 ? ' clamp' : ''}" id="qa${i}"><span class="ad">回复 ${dstr(x.answer_date)}</span><span class="qa-at">${esc(x.answer)}</span></div>${x.answer.length > 160 ? `<button class="qa-more" data-t="qa${i}">展开全文</button>` : ''}`
          : third ? '<span class="qa-none" title="第三方整理的记录不含回答">来源未提供回答</span>' : '<span class="qa-none" title="公司尚未回复">暂无回复信息</span>'}
      </article>`).join('')}<div class="empty" id="qaempty" hidden>没有符合条件的问答</div></div>
      ${QA_THIRD_PARTY.includes(code) ? '<p class="qa-note">以上问答来源：理杏仁、准上市（上证e互动历史记录的第三方整理）；提问年份为推定。</p>' : ''}`
      : '<div class="empty">暂无数据</div>';

    /* 公告：按月分组，全文/摘要/英文版折叠 */
    const ann = announcementBlock(code, c.announcements);

    /* F10 式布局：左目录（标签页 + 同行业公司）+ 吸顶摘要条（方案 §4.4） */
    const counts = { qa: qaItems.length, ann: isNum(c.announcements.count_12m) ? c.announcements.count_12m : (c.announcements.items || []).length };
    const nav = companyTabs(!!segs).map(([k, t], i) => `<a href="#/${code}/${k}" data-s="${k}"><kbd>${i + 1}</kbd>${t}${counts[k] ? `<small>${int(counts[k])}</small>` : ''}</a>`).join('');
    const sibs = INDUSTRY[id.industry_sw1] || [];
    const peerNav = sibs.slice(0, 12).map((k) => `<a href="#/${k}" class="${k === code ? 'on' : ''}"><span>${esc(COMPANIES[k].identity.name_abbr)}</span><em class="${cls(COMPANIES[k].market.change_pct)}">${spct(COMPANIES[k].market.change_pct)}</em></a>`).join('');
    const sumbar = `<div class="sumbar"><div class="wrap">
        ${logo(code, 22)}<b>${esc(id.name_abbr)}</b><span class="mono">${code}</span>
        <span class="px">${num(m.price)}</span><span class="${cls(chg)}">${arrow(chg)} ${spct(chg)}</span>
        <span><em>总市值</em>${money(m.total_mv)}</span><span><em>PE</em>${num(m.pe_ttm)}</span><span><em>PB</em>${num(m.pb)}</span><span><em>股息率</em>${pct(m.dividend_yield)}</span>
        <span class="keys" data-tip="快捷键：1–${companyTabs(!!segs).length} 切换标签 · [ ] 同行业上一家/下一家 · c 加入对比 · / 搜索">⌨</span>
      </div></div>`;

    return `
    ${siteHeader('company', `<div class="crumb"><b>${esc(id.name_abbr)}</b><span class="mono">${code}</span></div>`)}
    ${sumbar}
    <div class="wrap report tabbed" data-code="${code}">
      <aside class="side">
        <nav class="secnav" id="secnav" aria-label="章节">${nav}</nav>
        <div class="sidepeers"><div class="hd">${esc(id.industry_sw1)} · ${sibs.length} 家</div>${peerNav}${sibs.length > 12 ? `<a href="#/industry?ind=${encodeURIComponent(id.industry_sw1)}" class="more">全部 ${sibs.length} 家 →</a>` : ''}</div>
      </aside>
      <div class="main">
        <section id="overview" class="hero">
          <div class="eyebrow">${tags}</div>
          <div class="title">
            ${logo(code, 64, 'hero-logo')}<div><h1>${esc(id.name_abbr)}</h1><div class="full">${esc(id.name_full)}${id.name_en ? ' · ' + esc(id.name_en) : ''}</div></div>
            <div class="hero-act">
              <a class="fav" href="#/compare?c=${encodeURIComponent(cmpWith(code).join(','))}" title="与最近对比的公司一起比较"><svg viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-7"/></svg><span>加入对比</span></a>
              <button class="fav${isFav ? ' on' : ''}" id="fav" aria-pressed="${isFav}">${star}<span>${isFav ? '已收藏' : '收藏'}</span></button>
            </div>
          </div>
          <p class="sum">${esc(id.business_summary || '')}</p>
          <div class="stampline"><span>行情 ${esc(m.as_of_date || DATA.meta.as_of_date)} 收盘</span><span>财务 ${esc(lat.report_type || '—')}</span><span>股东 截至 ${esc(s.holder_num_date || '—')}</span></div>
          <div class="metrics">${metrics}</div>
          <div class="band"><div class="range">${range}</div><div>${rets}</div></div>
        </section>

        <section class="sec rv" id="profile"><header><h2>公司</h2><span class="note">员工数截至 2025-12-31</span></header>
          <dl class="facts">${facts}</dl>
          ${profileBlock(code, id)}
        </section>

        <section class="sec rv" id="fin"><header><h2>财务</h2><span class="note">合并报表 · 归母口径 · 营收为营业总收入</span></header>${fin}</section>

        <section class="sec rv" id="holders"><header><h2>股东与治理</h2><span class="note">数据截至 ${esc(s.holder_num_date || '—')}</span></header>${holders}</section>

        <section class="sec rv" id="div"><header><h2>股东回报</h2><span class="note">按方案所属年度归集，同年中期与年度合并</span></header>${div}</section>

        ${segs ? `<section class="sec rv" id="seg"><header><h2>主营构成</h2><span class="note">最新年报</span></header><div class="segs">${segs}</div></section>` : ''}

        <section class="sec rv" id="peers"><header><h2>同行对比</h2><a class="morelink" href="#/industry?ind=${encodeURIComponent(id.industry_sw1)}" data-tip="打开${esc(id.industry_sw1)}行业页：全部公司、行业指标与散点图">申万二级 ${esc(id.industry_sw2 || '')} · 查看${esc(id.industry_sw1)}行业 →</a></header>${peers}</section>

        <section class="sec rv" id="qa"><header><h2>投资者问答</h2><span class="note">最近 ${qaItems.length} 条 · 按提问日倒序</span></header>${qa}</section>

        <section class="sec rv" id="ann"><header><h2>近期公告</h2><span class="note">近 12 个月共 ${isNum(c.announcements.count_12m) ? int(c.announcements.count_12m) : '—'} 条${c.announcements.complete ? '' : ` · 本站收录最近 ${(c.announcements.items || []).length} 条`}</span></header>${ann}</section>

        <footer>
          <span>行情 ${esc(DATA.meta.as_of_date)} 收盘快照，非实时</span>
          <span>财务 ${esc(lat.report_type || '')}</span>
          <span>来源：东方财富 · 巨潮资讯 · 港交所 · 上证e互动 · 深交所互动易 · 理杏仁 · 准上市</span>
        </footer>
      </div>
    </div>`;
  }

  /* 问答来源链接（方案 §8.3）：上证e互动只有公司主页，不是单条问答页，不能标「原文」 */
  function qaLink(x, i, thirdParty) {
    if (!x.url) return '';
    const isPage = x.url_type ? x.url_type === 'company_page' : x.source === 'sse_e' && /company\.do/.test(x.url);
    if (!isPage) return `<span class="qa-src"><a href="${esc(x.url)}" target="_blank" rel="noopener">原文 ↗</a></span>`;
    const tip = `上证e互动没有单条问答的固定地址，链接打开的是公司问答主页，可按提问日期 ${dstr(x.ask_date)} 查找。${thirdParty ? '本条由第三方（理杏仁、准上市）整理。' : ''}`;
    return `<span class="qa-src"><button type="button" class="qa-copy" data-q="${i}">复制问题</button>
      <a href="${esc(x.url)}" target="_blank" rel="noopener">上证e互动公司页 ↗</a><span class="qi" data-tip="${esc(tip)}">ⓘ</span></span>`;
  }

  /* 公司简介：按句分段 + 关键事实标签 + 来源（方案 §8.1） */
  const cnPunct = (s) => s.replace(/,(?=\S)/g, '，').replace(/;(?=\S)/g, '；').replace(/:(?=\D)/g, '：');
  const paras = (s, n = 3) => {
    const sents = cnPunct(s).match(/[^。！？]+[。！？]?/g) || [];
    const out = [];
    for (let i = 0; i < sents.length; i += n) out.push(sents.slice(i, i + n).join('').trim());
    return out.filter(Boolean);
  };
  const f10Url = (code) => `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?type=web&code=${code.slice(-2)}${code.slice(0, 6)}`;
  function profileBlock(code, id) {
    const text = id.profile || '';
    if (!text) return '<div class="empty">暂无简介</div>';
    const ps = paras(text);
    const facts = [];
    // 标签可点击：成立 → 时间轴；上市地 → 榜单按上市地筛选
    const fd = foundDate(code);
    if (fd) facts.push(['成立 ' + dstr(fd), `#/timeline?c=${code}`, '在时间轴上查看百强的成立与上市日期']);
    facts.push([EXCH[exOf(code)] + '上市', `#/list?ex=${exOf(code)}`, `查看所有在${EXCH[exOf(code)]}上市的百强公司`]);
    if (isAH(code)) facts.push(['香港联交所上市', '#/list?ex=AH', '查看所有 A+H 两地上市的百强公司']);
    const src = id.profile_source || { name: '东方财富 F10 · 公司概况', url: f10Url(code) };
    const site = id.website ? `<a href="https://${esc(id.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">公司官网 ↗</a>` : '';
    return `${facts.length ? `<div class="prof-tags">${facts.map(([x, href, tip]) => `<a class="tag tag-link" href="${href}" data-tip="${esc(tip)}">${esc(x)} →</a>`).join('')}</div>` : ''}
      <div class="profile-body" id="prof">${ps.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${ps.length > 1 ? '<button class="more" id="more">展开简介</button>' : ''}
      <div class="prof-src"><span>来源：<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)} ↗</a>${src.edited ? '（经人工校订）' : ''}</span>
        <span>数据截至 ${esc(DATA.meta.as_of_date)}</span>${site}</div>`;
  }

  /* 公告分类：优先用数据里的 category，没有时按标题关键词推断（方案 §8.4）。顺序有意义：中介机构报告要先于融资、问询判断 */
  const ANN_CATS = [
    ['periodic', '定期报告与业绩', /年度报告|半年度报告|季度报告|年报|中报|季报|业绩预|业绩快报|业绩说明会/],
    ['hk', 'H股 / 境外', /^.{0,16}(H股公告|港股公告|H股市场公告)|翌日披露|证券变动月报表|海外监管/],
    ['agency', '中介机构报告', /律师事务所|会计师事务所|法律意见书|保荐书|(证券|会计师|律师).{0,20}(核查意见|专项意见|专项说明)|证券股份有限公司关于|证券有限责任公司关于/],
    ['dividend', '分红送转', /分红|派息|权益分派|利润分配|送股|转增/],
    ['meeting', '股东大会', /股东大会|股东会/],
    ['reg', '监管与问询', /问询|处罚|警示|关注函|立案|整改|监管函|监管措施|审核通过|上市审核/],
    ['finance', '融资与证券', /发行|募集|债券|可转债|配股|增发|向特定对象|上市公告|资本补充|永续债/],
    ['equity', '股本与股东变动', /增持|减持|回购|质押|解禁|限售|股份变动|权益变动|激励|持股|股份奖励/],
    ['board', '董事会与治理', /董事会|监事会|独立董事|董事|监事|高级管理人员|任职|辞职|聘任|章程|制度|工作办法|规则|议事/],
    ['major', '重大事项', /重大|收购|出售|重组|合同|中标|关联交易|担保|诉讼|仲裁|投资|增资|委托贷款/],
    ['hk2', 'H股 / 境外', /H股|香港|联交所|境外/],
    ['other', '其他', /[\s\S]*/]
  ];
  const ANN_NAME = Object.fromEntries(ANN_CATS.map(([k, n]) => [k, n]));
  const annCat = (x) => x.category || ANN_CATS.find(([, , re]) => re.test(x.title || ''))[0].replace('hk2', 'hk');

  function announcementBlock(code, ann) {
    const items = ann.items || [];
    if (!items.length) return '<div class="empty">暂无数据</div>';
    const counts = {};
    items.forEach((x) => { const k = annCat(x); counts[k] = (counts[k] || 0) + 1; });
    const chips = [['all', '全部', items.length], ...ANN_CATS.filter(([k]) => counts[k]).map(([k, n]) => [k, n, counts[k]])];
    const partial = isNum(ann.count_12m) && ann.count_12m > items.length && !ann.complete;
    const cninfo = `https://www.cninfo.com.cn/new/fulltextSearch?notautosubmit=&keyWord=${code.slice(0, 6)}`;
    return `<div class="annbar" id="annbar">${chips.map(([k, n, c], i) => `<button class="chip" data-c="${k}" aria-pressed="${i === 0}">${esc(n)}<b>${c}</b></button>`).join('')}
        <input id="annq" type="search" placeholder="搜索公告标题" aria-label="搜索公告标题"></div>
      <div id="annlist">${announcementList(items)}</div>
      <p class="ann-note">${ann.items.some((x) => x.category) ? '' : '分类按公告标题关键词推断，仅供筛选参考。'}${partial ? `本站收录最近 ${items.length} 条，近 12 个月全部 ${ann.count_12m} 条可在<a href="${cninfo}" target="_blank" rel="noopener">巨潮资讯 ↗</a>查看。` : ''}</p>`;
  }

  function announcementList(items) {
    if (!items.length) return '<div class="empty">没有符合条件的公告</div>';
    const SUFFIX = /[（(]?(摘要|英文版|English Version)[）)]?\s*$/i;
    const groups = [], byBase = {};
    items.forEach((x) => {
      const title = x.title || '';
      const m = title.match(SUFFIX);
      const base = title.replace(SUFFIX, '').trim();
      const key = (x.date || '') + '|' + base;
      if (byBase[key]) { byBase[key].vars.push({ label: m ? m[1].replace(/English Version/i, '英文版') : '全文', url: x.url }); return; }
      const g = { date: x.date, title: m ? base : title, url: x.url, vars: [], kind: m ? m[1] : null, cat: annCat(x) };
      byBase[key] = g; groups.push(g);
    });
    let html = '<ul class="notes">', mo = '';
    groups.forEach((g) => {
      const mm = (g.date || '').slice(0, 7);
      if (mm !== mo) { mo = mm; html += `<li class="mo">${mm.replace('-', ' 年 ')} 月</li>`; }
      const vars = g.vars.length ? `<span class="vars">${g.vars.map((v) => `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.label)}</a>`).join('')}</span>` : '';
      html += `<li class="n"><div class="d">${dstr(g.date)}</div><div><span class="cat">${esc(ANN_NAME[g.cat])}</span><a class="t" href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.title)}</a>${vars}</div></li>`;
    });
    return html + '</ul>';
  }

  /* ---------- 财务图表配置 ---------- */
  const FIN_TABS = [
    { key: 'scale', name: '营收与利润',
      series: [['revenue', '营业总收入', 'bar', 'L', 'yi'], ['net_profit', '归母净利润', 'bar', 'L', 'yi'], ['net_profit_deducted', '扣非归母净利', 'bar', 'L', 'yi']],
      unitL: '亿元',
      cols: [['revenue', '营收', 'yi'], ['revenue_yoy', '营收同比', 'spct'], ['net_profit', '归母净利', 'yi'], ['net_profit_yoy', '净利同比', 'spct'], ['net_profit_deducted', '扣非归母', 'yi'], ['eps', 'EPS（元）', 'num']] },
    { key: 'margin', name: '盈利能力',
      series: [['gross_margin', '毛利率', 'line', 'L', 'pct'], ['net_margin', '净利率', 'line', 'L', 'pct'], ['roe', 'ROE（加权）', 'line', 'L', 'pct'], ['roa', 'ROA', 'line', 'L', 'pct']],
      unitL: '%',
      cols: [['gross_margin', '毛利率', 'pct'], ['net_margin', '净利率', 'pct'], ['roe', 'ROE', 'pct'], ['roa', 'ROA', 'pct'], ['bvps', '每股净资产（元）', 'num']] },
    { key: 'cost', name: '费用结构',
      series: [['selling_expense_ratio', '销售费用率', 'line', 'L', 'pct'], ['admin_expense_ratio', '管理费用率', 'line', 'L', 'pct'], ['finance_expense_ratio', '财务费用率', 'line', 'L', 'pct'], ['rd_ratio', '研发费用率', 'line', 'L', 'pct']],
      unitL: '%',
      cols: [['selling_expense_ratio', '销售费用率', 'pct'], ['admin_expense_ratio', '管理费用率', 'pct'], ['finance_expense_ratio', '财务费用率', 'pct'], ['rd_ratio', '研发费用率', 'pct'], ['rd_expense', '研发费用', 'yi']] },
    { key: 'cash', name: '现金流',
      series: [['ocf', '经营现金流', 'bar', 'L', 'yi'], ['capex', '资本开支', 'bar', 'L', 'yi'], ['fcf', '自由现金流', 'line', 'L', 'yi']],
      unitL: '亿元',
      cols: [['ocf', '经营现金流', 'yi'], ['capex', '资本开支', 'yi'], ['fcf', '自由现金流', 'yi'], ['ocf_to_np', '现金流 / 净利', 'x']] },
    { key: 'bs', name: '资产负债',
      series: [['total_assets', '总资产', 'bar', 'L', 'yi'], ['total_liab', '总负债', 'bar', 'L', 'yi'], ['debt_ratio', '资产负债率', 'line', 'R', 'pct']],
      unitL: '亿元', unitR: '资产负债率 %',
      cols: [['total_assets', '总资产', 'yi'], ['total_liab', '总负债', 'yi'], ['debt_ratio', '负债率', 'pct'], ['cash', '货币资金', 'yi'], ['receivables', '应收账款', 'yi'], ['inventory', '存货', 'yi'], ['goodwill', '商誉', 'yi'], ['interest_debt', '有息负债', 'yi'], ['equity_parent', '归母净资产', 'yi']] }
  ];
  const CELL = { yi: (v) => yi(v, 1), pct: (v) => pct(v), spct: (v) => `<span class="${cls(v)}">${spct(v)}</span>`, num: (v) => num(v), x: (v) => (isNum(v) ? fmt(v, 2) + '倍' : '—') };

  function finConfig(annual, tab) {
    const t = FIN_TABS.find((x) => x.key === tab);
    return {
      label: '年度财务 ' + t.name,
      years: annual.map((r) => r.fiscal_year),
      unitL: t.unitL, unitR: t.unitR,
      series: t.series.map(([k, name, kind, axis, fmt], i) => ({
        key: k, name, kind, axis, fmt,
        color: COLORS[i],
        values: annual.map((r) => (r[k] == null ? null : fmt === 'yi' ? r[k] / 1e8 : r[k]))
      })).map((s) => ({ ...s, fmt: s.fmt === 'yi' ? 'yiv' : s.fmt })),
      foot: annual.some((r) => r.revenue == null) ? '空缺年份为上市前年度，图中断开。' : (tab === 'margin' && annual.every((r) => r.gross_margin == null) ? '金融企业不适用毛利率。' : '')
    };
  }
  FMT.yiv = (v) => money(isNum(v) ? v * 1e8 : v);

  function finTable(annual, tab) {
    const t = FIN_TABS.find((x) => x.key === tab);
    const head = `<tr><th>年度</th>${t.cols.map(([, n]) => `<th>${n}</th>`).join('')}</tr>`;
    const body = annual.map((r) => r.revenue == null && r.total_assets == null
      ? `<tr><td class="yr">${r.fiscal_year}</td><td colspan="${t.cols.length}" class="na">上市前年度，无数据</td></tr>`
      : `<tr><td class="yr">${r.fiscal_year}</td>${t.cols.map(([k, , f]) => `<td>${r[k] == null ? NA(['gross_margin', 'inventory', 'receivables', 'interest_debt'].includes(k) ? '金融企业不适用或未披露' : '数据缺失') : CELL[f](r[k])}</td>`).join('')}</tr>`).join('');
    return `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  /* ---------- 同行对比配置 ---------- */
  // 一级分组 → 二级指标（方案 §8.2）；治理组附带审计意见、ST 状态两列文字
  const PEER_PICK = {
    scale: ['mv', 'rev25', 'np25', 'assets'], value: ['pe', 'pb', 'ps', 'dy'], profit: ['roe', 'roa', 'nm', 'gm'],
    growth: ['cagr', 'npcagr', 'revyoy', 'npyoy'], return: ['dy', 'payout', 'divyears', 'cumdiv'], health: ['debt', 'ocfnp', 'gw', 'rd'],
    market: ['ytd', 'r1y', 'r3y', 'turnover'], gov: ['ctrl', 'inst', 'north', 'pledge']
  };
  // 矩阵：行 = 本公司 + 同行，列 = 分组内指标；每格 = 数值 + 组内条 + 组内排名；底部为同行中位数与百强中位数
  function peerMatrix(code, group, sortKey) {
    const keys = PEER_PICK[group];
    const codes = [code, ...COMPANIES[code].peers.peer_codes.filter((x) => COMPANIES[x])];
    const na = (k, c) => !METRICS[k].fin && isFin(c);
    const cols = keys.map((k) => {
      const vs = codes.map((c) => (na(k, c) ? null : mval(k, c)));
      const nums = vs.filter(isNum);
      const order = [...nums].sort((a, b) => (METRICS[k].better === 'low' ? a - b : b - a));
      return { k, vs, max: Math.max(1e-9, ...nums.map(Math.abs)), order, peerMed: median(vs), allMed: median(CODES.filter((c) => !na(k, c)).map((c) => mval(k, c))) };
    });
    let idx = codes.map((_, i) => i);
    if (sortKey) {
      const col = cols.find((x) => x.k === sortKey);
      if (col) idx.sort((a, b) => { const va = col.vs[a], vb = col.vs[b]; if (!isNum(va)) return 1; if (!isNum(vb)) return -1; return METRICS[sortKey].better === 'low' ? va - vb : vb - va; });
    }
    const cell = (col, i) => {
      const v = col.vs[i], mt = METRICS[col.k];
      if (!isNum(v)) return `<td class="num">${na(col.k, codes[i]) ? '<span class="faint" title="金融业无此口径">不适用</span>' : NA()}</td>`;
      const rk = mt.better ? `<small>${col.order.indexOf(v) + 1}/${col.order.length}</small>` : '';
      return `<td class="num"><span class="mv ${mt.mkt ? cls(v) : ''}">${mt.fmt(v)}</span>${rk}<span class="mb"><i style="width:${(Math.abs(v) / col.max) * 100}%" class="${v < 0 ? 'neg' : ''}"></i></span></td>`;
    };
    const gov = group === 'gov';
    const body = idx.map((i) => {
      const k = codes[i], id = COMPANIES[k].identity, self = k === code;
      return `<tr class="${self ? 'self' : ''}" ${self ? '' : `tabindex="0" data-href="#/${k}"`}><td class="nm">${self ? `<b>${esc(id.name_abbr)}</b> ◀` : `<a href="#/${k}" tabindex="-1">${esc(id.name_abbr)}</a>`}<small>${k}</small></td>
        ${cols.map((col) => cell(col, i)).join('')}${gov ? `<td>${esc(id.audit_opinion || '—')}</td><td>${esc(id.st_status || '—')}</td>` : ''}</tr>`;
    }).join('');
    const medRow = (label, f) => `<tr class="medrow"><td>${label}</td>${cols.map((col) => `<td class="num">${isNum(col[f]) ? METRICS[col.k].fmt(col[f]) : '—'}</td>`).join('')}${gov ? '<td></td><td></td>' : ''}</tr>`;
    return `<div class="tblwrap"><table class="tbl peer-mx"><thead><tr><th>公司</th>${cols.map((col) => `<th class="num"><button data-sort="${col.k}" class="${sortKey === col.k ? 'on' : ''}" title="${esc((METRICS[col.k].note || '') + '\n点击按此列排序')}">${esc(METRICS[col.k].name)}</button></th>`).join('')}${gov ? '<th>审计意见</th><th>ST 状态</th>' : ''}</tr></thead>
      <tbody id="peerbody">${body}</tbody><tfoot>${medRow('同行中位数', 'peerMed')}${medRow('百强中位数', 'allMed')}</tfoot></table></div>
      <div class="chart-foot">格内小字为同行内排名（按指标的优劣方向）；${group === 'gov' ? '治理与合规目前只有审计意见、ST 状态、质押与持股结构，问询函、处罚等待公告分类数据补齐后加入；' : ''}「不适用」为该指标对金融业无意义。</div>`;
  }

  /* ---------- 顶栏搜索（bug 2：无结果提示“无此公司”） ---------- */
  function jumpBox() {
    return `<div class="jump"><input id="jump" autocomplete="off" spellcheck="false" placeholder="搜索代码 · 简称 · 拼音（按 / ）" aria-label="切换公司" role="combobox" aria-expanded="false"><div class="drop" id="drop" role="listbox"></div></div>`;
  }
  const bindJump = () => bindSearch('jump', 'drop', 8);
  // onPick 存在时：选中结果交给回调（如对比页添加公司），而不是跳转
  function bindSearch(inputId, dropId, limit, onPick) {
    const input = document.getElementById(inputId);
    const drop = document.getElementById(dropId);
    if (!input) return;
    let act = -1;
    const items = () => [...drop.querySelectorAll('a')];
    const close = () => { drop.classList.remove('on'); input.setAttribute('aria-expanded', 'false'); act = -1; };
    const open = (html) => { drop.innerHTML = html; drop.classList.add('on'); input.setAttribute('aria-expanded', 'true'); act = -1; };
    const row = (x) => `<a href="#/${x.code}" role="option">${logo(x.code, 22)}<span>${esc(x.id.name_abbr)}</span><span class="ind">${esc(x.id.industry_sw1 || '')}</span><span class="c">${x.code.slice(0, 6)}</span></a>`;
    const render = () => {
      const q = input.value.trim();
      if (!q) {
        const f = favs().filter((k) => COMPANIES[k]);
        return f.length ? open('<div class="hd">我的收藏</div>' + f.map((k) => row(INDEX.find((x) => x.code === k))).join('')) : close();
      }
      const hits = search(q, limit);
      open(hits.length ? hits.map(row).join('') : '<div class="none">无此公司</div>');
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      const list = items();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        act = (act + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list.forEach((a, i) => a.classList.toggle('act', i === act));
        list[act].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter' && list.length) {
        const href = list[Math.max(0, act)].getAttribute('href');
        if (onPick) { e.preventDefault(); onPick(href.slice(2)); input.value = ''; close(); } else location.hash = href;
      }
      if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    drop.addEventListener('mousedown', (e) => e.preventDefault());
    if (onPick) drop.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      onPick(a.getAttribute('href').slice(2));
      input.value = '';
      close();
    });
  }

  /* ---------- 交互绑定 ---------- */
  let observers = [];
  function countUp(el) {
    const v = parseFloat(el.dataset.v);
    const f = FMT[el.dataset.f] || num;
    if (!isFinite(v) || REDUCED) return;
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(v * e);
      if (k < 1) requestAnimationFrame(tick); else el.textContent = f(v);
    };
    requestAnimationFrame(tick);
  }

  function bindCompany(code) {
    const c = COMPANIES[code];
    bindJump();

    /* 收藏 */
    const fav = document.getElementById('fav');
    fav.addEventListener('click', () => {
      let a = favs();
      const on = !a.includes(code);
      a = on ? [code, ...a] : a.filter((x) => x !== code);
      setFavs(a);
      fav.classList.toggle('on', on);
      fav.setAttribute('aria-pressed', on);
      fav.querySelector('span').textContent = on ? '已收藏' : '收藏';
    });

    /* 简介展开 */
    const more = document.getElementById('more');
    if (more) more.addEventListener('click', () => {
      const pr = document.getElementById('prof');
      pr.classList.toggle('open');
      more.textContent = pr.classList.contains('open') ? '收起简介' : '展开简介';
    });

    /* 问答：复制问题（上证e互动无单条链接时用于站内查找） */
    const qaSorted = [...(c.qa.items || [])].sort((a, b) => (b.ask_date || '').localeCompare(a.ask_date || ''));
    document.querySelectorAll('.qa-copy').forEach((b) => b.addEventListener('click', () => {
      const q = qaSorted[+b.dataset.q]?.question || '';
      const done = () => { b.textContent = '已复制'; setTimeout(() => { b.textContent = '复制问题'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(q).then(done, () => { b.textContent = '复制失败'; });
      else { const t = document.createElement('textarea'); t.value = q; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch { /* 忽略 */ } t.remove(); }
    }));

    /* 问答：回复状态 / 来源筛选 + 全文搜索（命中词高亮） */
    const qabar = document.getElementById('qabar');
    if (qabar) {
      const qst = { f: 'all', s: null, kw: '' };
      const mark = (text, kw) => (kw ? esc(text).split(esc(kw)).join(`<mark>${esc(kw)}</mark>`) : esc(text));
      const renderQa = () => {
        let n = 0;
        document.querySelectorAll('#qalist .qa-item').forEach((el) => {
          const x = qaSorted[+el.dataset.i];
          const hay = (x.question || '') + (x.answer || '');
          const show = (qst.f === 'all' || (qst.f === 'yes') === (el.dataset.ans === '1')) && (!qst.s || el.dataset.src === qst.s) && (!qst.kw || hay.includes(qst.kw));
          el.hidden = !show;
          if (show) n++;
          el.querySelector('.qa-q').innerHTML = mark(x.question || '（提问内容缺失）', qst.kw);
          const at = el.querySelector('.qa-at');
          if (at) at.innerHTML = mark(x.answer, qst.kw);
        });
        document.getElementById('qaempty').hidden = n > 0;
      };
      qabar.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        if (b.dataset.f) { qst.f = b.dataset.f; qabar.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
        if (b.dataset.s) { qst.s = qst.s === b.dataset.s ? null : b.dataset.s; qabar.querySelectorAll('[data-s]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.s === qst.s)); }
        renderQa();
      });
      document.getElementById('qaq').addEventListener('input', (e) => { qst.kw = e.target.value.trim(); renderQa(); });
    }

    /* 公告：分类 + 标题搜索 */
    const annbar = document.getElementById('annbar');
    if (annbar) {
      const all = c.announcements.items || [];
      let cat = 'all';
      const q = document.getElementById('annq');
      const renderAnn = () => {
        const kw = q.value.trim().toLowerCase();
        const list = all.filter((x) => (cat === 'all' || annCat(x) === cat) && (!kw || (x.title || '').toLowerCase().includes(kw)));
        document.getElementById('annlist').innerHTML = announcementList(list);
      };
      annbar.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        cat = b.dataset.c;
        annbar.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
        renderAnn();
      });
      q.addEventListener('input', renderAnn);
    }

    /* 数字滚动 + 52 周标记入场 */
    document.querySelectorAll('.cu').forEach(countUp);
    const mk = document.querySelector('.range .mk');
    if (mk) setTimeout(() => { mk.style.left = mk.dataset.pos + '%'; }, 60);

    /* 财务：切换 */
    const annual = c.financials.annual;
    const finHost = document.getElementById('finchart');
    const finTbl = document.getElementById('fintable');
    let finTab = 'scale';
    const renderFin = (animate) => { finHost._st = null; drawChart(finHost, finConfig(annual, finTab), animate); finTbl.innerHTML = finTable(annual, finTab); };
    finTbl.innerHTML = finTable(annual, finTab);
    tabs('fintabs', (k) => { finTab = k; renderFin(true); });

    /* 分红图 */
    const divHost = document.getElementById('divchart');
    const divCfg = {
      label: '每股派息与分红率',
      years: c.dividends.annual.map((x) => x.fiscal_year),
      unitL: '元/股', unitR: '分红率 %',
      series: [
        { key: 'dps', name: '每股派息（税前）', kind: 'bar', axis: 'L', fmt: 'yuan', color: COLORS[0], values: c.dividends.annual.map((x) => x.dps_pretax) },
        { key: 'payout', name: '分红率', kind: 'line', axis: 'R', fmt: 'pct', color: COLORS[2], values: c.dividends.annual.map((x) => x.payout_ratio) }
      ],
      foot: c.dividends.annual.some((x) => !x.dps_pretax) ? '柱高为 0 的年度为本年度未分红。' : ''
    };

    /* 同行 */
    const peerBox = document.getElementById('peerbox');
    if (peerBox) {
      const pst = { g: 'scale', sort: null };
      const drawPeers = () => { peerBox.innerHTML = peerMatrix(code, pst.g, pst.sort); bindRowNav(document.getElementById('peerbody')); };
      drawPeers();
      tabs('peertabs', (k) => { pst.g = k; pst.sort = null; drawPeers(); });
      peerBox.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]');
        if (b) { pst.sort = pst.sort === b.dataset.sort ? null : b.dataset.sort; drawPeers(); }
      });
    }

    /* 股权结构条与前十大联动 */
    const stack = document.getElementById('stack');
    const holders = document.getElementById('holders');
    const link = (i) => {
      stack.classList.toggle('hov', i != null);
      stack.querySelectorAll('i[data-i]').forEach((x) => x.classList.toggle('on', x.dataset.i === String(i)));
      holders.querySelectorAll('.holder').forEach((x) => x.classList.toggle('on', x.dataset.i === String(i)));
    };
    [stack, holders].forEach((el) => {
      el.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-i]'); if (t) link(t.dataset.i); });
      el.addEventListener('mouseleave', () => link(null));
    });

    /* 环形图与列表联动 */
    document.querySelectorAll('[data-donut]').forEach((w) => {
      const hi = (i) => {
        w.querySelectorAll('circle.seg').forEach((x) => x.classList.toggle('on', x.dataset.i === i));
        w.querySelectorAll('.segrow').forEach((x) => x.classList.toggle('on', x.dataset.i === i));
      };
      w.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-i]'); if (t) hi(t.dataset.i); });
      w.addEventListener('mouseleave', () => hi(null));
    });

    /* 问答展开 */
    document.querySelectorAll('.qa-more').forEach((b) => b.addEventListener('click', () => {
      const a = document.getElementById(b.dataset.t);
      a.classList.toggle('clamp');
      b.textContent = a.classList.contains('clamp') ? '展开全文' : '收起';
    }));

    /* 标签页切换：只显示当前标签的 section；图表在首次可见时绘制（隐藏时宽度为 0） */
    const lazy = { fin: () => renderFin(true), div: () => drawChart(divHost, divCfg, true) };
    const nav = document.getElementById('secnav');
    const tabKeys = [...nav.querySelectorAll('a')].map((a) => a.dataset.s);
    app._tab = (t) => {
      if (!tabKeys.includes(t)) t = 'overview';
      document.querySelectorAll('.report .main > section').forEach((sct) => {
        const on = TAB_OF(sct.id) === t;
        sct.classList.toggle('on', on);
        if (on) sct.classList.add('in');
      });
      nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.s === t));
      if (lazy[t]) { lazy[t](); delete lazy[t]; }
      const on = nav.querySelector('a.on');
      if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - 16, behavior: REDUCED ? 'auto' : 'smooth' });
      const top = document.querySelector('.report').getBoundingClientRect().top + scrollY - 120;
      if (scrollY > top) scrollTo(0, Math.max(0, top));
    };
    /* 快捷键：数字切换标签，[ ] 同行业上一家 / 下一家，c 加入对比 */
    const sibs = INDUSTRY[c.identity.industry_sw1] || [];
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= tabKeys.length) location.hash = `#/${code}/${tabKeys[n - 1]}`;
      else if (e.key === '[' || e.key === ']') {
        const i = sibs.indexOf(code), j = (i + (e.key === ']' ? 1 : -1) + sibs.length) % sibs.length;
        if (sibs.length > 1) location.hash = '#/' + sibs[j];
      } else if (e.key === 'c') location.hash = '#/compare?c=' + encodeURIComponent(cmpWith(code).join(','));
    };
    document.addEventListener('keydown', onKey);
    observers = [{ disconnect: () => document.removeEventListener('keydown', onKey) }];
  }

  // 光标光斑：块状元素上跟随鼠标的柔光圆斑，颜色随光标横向位置在琥珀 → 珊瑚 → 青之间渐变（样式见 style.css .glow）
  // 排行卡不加：卡片可滚动，离开时光斑会停在角落
  const GLOW_SEL = '.tile, .statstrip > div, .statstrip > a, .kpi-pick > button, .kpi, .indlist tbody tr, .ichip, .pnav a';
  const GLOW_STOPS = [[217, 154, 30], [232, 106, 84], [38, 166, 154]];
  const glowAt = (x, a) => {
    const t = Math.max(0, Math.min(1, x / innerWidth)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
    return `rgba(${GLOW_STOPS[i].map((v, j) => Math.round(v + (GLOW_STOPS[i + 1][j] - v) * f)).join(',')},${a})`;
  };
  if (!REDUCED) document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.(GLOW_SEL);
    if (!el) return;
    el.classList.add('glow');
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
    el.style.setProperty('--glow', glowAt(e.clientX, el.classList.contains('tile') ? 0.7 : 0.22));
  }, { passive: true });

  // 排行卡「展开前 20」：触屏无悬停时也能看到全部 20 名
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.rk-expand');
    if (!b) return;
    const on = b.closest('.rank-card').classList.toggle('open');
    b.setAttribute('aria-expanded', on);
    b.textContent = on ? '收起' : '展开前 20';
  });

  function tabs(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.getAttribute('aria-selected') === 'true') return;
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', x === b));
      onChange(b.dataset.t);
    });
  }

  /* 窗口变化时按实际宽度重绘图表（不重放动画） */
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      // 隐藏标签里的图表宽度为 0，跳过
      document.querySelectorAll('.chart-host').forEach((h) => { if (h._cfg && h.offsetParent) drawChart(h, h._cfg, false); });
      document.querySelectorAll('.treemap, .scatter-host, .strip-host').forEach((h) => { if (h._redraw && h.offsetParent) h._redraw(false); });
    }, 150);
  });

  /* ---------- 电脑版左侧选择栏（≥1024px 显示；窄屏隐藏，沿用页面内原有导航） ---------- */
  const WIDE = window.matchMedia('(min-width:1024px)');
  function mountPageNav(kind) {
    const wrap = app.querySelector('.wrap.dash-page, .wrap.rankpage, .wrap.cmppage, .wrap.indpage');
    if (!wrap) return;
    // 每项：{ n 名称, el 目标区块 | href 链接, sub 次级, cnt 计数, on 当前, g 排行分组 }
    let items = [];
    if (kind === 'home') {
      items = [...wrap.querySelectorAll('.hgroup')].map((h) => ({ n: h.querySelector('h2').textContent, el: h }));
      wrap.querySelectorAll('#moreexp .panel').forEach((p) => items.push({ n: p.querySelector('h2').textContent, el: p, sub: true }));
    } else if (kind === 'compare') {
      items = [...wrap.querySelectorAll('.cmp-sec')].map((s) => ({ n: s.querySelector('.kicker').textContent, el: s }));
    } else if (kind === 'industry') {
      const cur = parseIndustry();
      items = Object.entries(INDUSTRY).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ n: k, href: '#/industry?ind=' + encodeURIComponent(k), cnt: v.length, on: k === cur }));
    } else if (kind === 'rank') {
      items = [...RANK_MAIN, ...RANK_MORE, 'combo'].map((g) => ({ n: g === 'combo' ? '多条件现象' : GROUPS[g], el: wrap.querySelector('#rg-' + g), g }));
    }
    if (!items.length) return;
    const nav = document.createElement('aside');
    nav.className = 'pnav';
    nav.setAttribute('aria-label', '本页目录');
    nav.innerHTML = items.map((it, i) => `<a href="${it.href || '#'}" data-i="${i}" class="${it.sub ? 'pn-sub' : ''}${it.on ? ' on' : ''}">${esc(it.n)}${it.cnt != null ? `<small>${it.cnt}</small>` : ''}</a>`).join('');
    wrap.classList.add('has-pnav', 'pnav-' + kind);
    wrap.prepend(nav);
    const links = [...nav.querySelectorAll('a')];
    const mark = (i) => links.forEach((a, j) => a.classList.toggle('on', j === i));

    if (kind === 'rank') {
      // 排行：选中哪个维度只显示哪个维度（仅宽屏，窄屏仍整页铺开）
      const more = wrap.querySelector('#rkmore');
      if (more) more.open = true;
      const pick = (g) => {
        const i = Math.max(0, items.findIndex((it) => it.g === g));
        items.forEach((it, j) => it.el.classList.toggle('on', j === i));
        mark(i);
        history.replaceState(null, '', '#/rank' + (i ? '?g=' + items[i].g : ''));
      };
      pick(new URLSearchParams(location.hash.split('?')[1] || '').get('g') || items[0].g);
      nav.addEventListener('click', (e) => {
        const a = e.target.closest('a'); if (!a) return;
        e.preventDefault();
        pick(items[+a.dataset.i].g);
        scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
      });
      return;
    }
    if (kind === 'industry') return;
    // 首页 / 对比：点击滚动到区块，滚动时高亮当前区块
    let clicked = null;
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a'); if (!a) return;
      e.preventDefault();
      const el = items[+a.dataset.i].el, d = el.closest('details');
      if (d) d.open = true;
      clicked = +a.dataset.i;
      mark(clicked);
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - 76, behavior: REDUCED ? 'auto' : 'smooth' });
    });
    const spy = () => {
      if (!WIDE.matches) return;
      let cur = 0;
      items.forEach((it, i) => { if (it.el.offsetParent && it.el.getBoundingClientRect().top < 140) cur = i; });
      // 滚到底时最后几个区块到不了顶部，按点击的目标高亮
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4 && clicked != null) cur = clicked;
      mark(cur);
    };
    window.addEventListener('scroll', spy, { passive: true });
    observers.push({ disconnect: () => window.removeEventListener('scroll', spy) });
    spy();
  }

  /* ---------- 路由 ---------- */
  function route() {
    const [code, sub] = location.hash.replace(/^#\/?/, '').split('?')[0].trim().split('/');
    // 同一家公司内切换标签：不重渲染
    const cur = document.querySelector('.report.tabbed');
    if (COMPANIES[code] && cur && cur.dataset.code === code && app._tab) { app._tab(sub || 'overview'); return; }
    observers.forEach((o) => o.disconnect());
    observers = [];
    app._tab = null;
    if (code === 'rank') {
      app.innerHTML = sub ? rankKeyView() : rankView();
      document.title = `${sub && METRICS[sub] ? METRICS[sub].name + ' · ' : ''}排行 · Ashare100`;
      window.scrollTo(0, 0);
      if (sub && METRICS[sub]) bindRankKey(); else { bindRank(); mountPageNav('rank'); }
    } else if (code === 'about') {
      app.innerHTML = aboutView();
      document.title = '关于 · Ashare100';
      window.scrollTo(0, 0);
      bindJump();
    } else if (code === 'timeline') {
      app.innerHTML = timelineView();
      document.title = '时间轴 · Ashare100';
      window.scrollTo(0, 0);
      bindTimeline();
    } else if (code === 'list') {
      app.innerHTML = listView();
      document.title = '榜单 · Ashare100';
      window.scrollTo(0, 0);
      bindList();
    } else if (code === 'compare') {
      app.innerHTML = compareView();
      document.title = '公司对比 · Ashare100';
      window.scrollTo(0, 0);
      bindCompare();
      mountPageNav('compare');
    } else if (code === 'industry') {
      app.innerHTML = industryView();
      document.title = `${parseIndustry()} · 行业 · Ashare100`;
      window.scrollTo(0, 0);
      bindIndustry();
      mountPageNav('industry');
    } else if (code && COMPANIES[code]) {
      app.innerHTML = companyView(code);
      document.title = `${COMPANIES[code].identity.name_abbr} · Ashare100`;
      window.scrollTo(0, 0);
      bindCompany(code);
      app._tab(sub || 'overview');
    } else {
      app.innerHTML = homeView();
      document.title = 'Ashare100 · 公司全景图谱';
      bindHome();
      mountPageNav('home');
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
