/*!
 * 股海浮沉 —— 30 天炒股模拟
 * 纯原生 JS + DOM/Canvas，零依赖，可直接部署到 GitHub Pages。
 */
(() => {
  'use strict';

  /* ==================== 常量 ==================== */
  const DAYS = 30;
  const START_CASH = 10000;
  const FEE = 0.001;            // 手续费 0.1%
  const STORE_BEST = 'stock.best';
  const PRICE_FLOOR = 0.01;

  const STOCK_DEFS = [
    { code: 'MIAN', name: '老王面馆', emoji: '🍜', base: 38, drift: 0.0012, vol: 0.014, color: '#d9a34a' },
    { code: 'BATT', name: '九号电池', emoji: '🔋', base: 126, drift: 0.0026, vol: 0.036, color: '#6fd08c' },
    { code: 'BANK', name: '中原银行', emoji: '🏦', base: 8.6, drift: 0.0006, vol: 0.007, color: '#7aa7d8' },
    { code: 'AERO', name: '星舰航天', emoji: '🚀', base: 412, drift: 0.0034, vol: 0.070, color: '#b48cf0' },
    { code: 'MEME', name: '摸鱼娱乐', emoji: '🎲', base: 2.4, drift: 0.0016, vol: 0.100, color: '#ef7fa3' },
  ];

  const NEWS = [
    { text: '发布爆款新品，股价走强', mult: 0.16 },
    { text: '财报超预期，机构上调评级', mult: 0.12 },
    { text: '拿下大额订单', mult: 0.10 },
    { text: '宣布回购计划', mult: 0.07 },
    { text: '被曝财务问题，股价重挫', mult: -0.18 },
    { text: '核心高管出走', mult: -0.09 },
    { text: '遭监管问询，短期承压', mult: -0.07 },
  ];

  const BIG_NEWS = [
    { text: '产品引爆全网，连续涨停', mult: 0.34 },
    { text: '技术突破，想象空间打开', mult: 0.26 },
    { text: '突发事故停摆，恐慌抛售', mult: -0.28 },
    { text: '被做空机构狙击', mult: -0.32 },
  ];

  const MARKET_NEWS = [
    { text: '央行降息，市场普涨', mult: 0.05 },
    { text: '经济数据超预期，全市场走强', mult: 0.07 },
    { text: '外部利空来袭，大盘跳水', mult: -0.06 },
    { text: '加息预期升温，资金离场', mult: -0.08 },
  ];

  const RANKS = [
    { min: 10, name: '股神', emoji: '👑', line: '这波操作已经可以开班授课了。' },
    { min: 3, name: '高手', emoji: '🏆', line: '收益相当扎实，风控和运气都在线。' },
    { min: 1.5, name: '老手', emoji: '📈', line: '跑赢了本金，账户曲线很健康。' },
    { min: 1.0, name: '散户', emoji: '🙂', line: '小赚一点，至少没被市场教育。' },
    { min: 0.7, name: '被套', emoji: '😵', line: '亏了一些，下次记得别满仓追高。' },
    { min: 0, name: '韭菜', emoji: '🥬', line: '这一轮学费交得有点多。' },
  ];

  /* ==================== DOM ==================== */
  const app = document.getElementById('app');
  const el = (id) => document.getElementById(id);
  const listEl = el('list');
  const chartCanvas = el('chart');
  const overlay = el('overlay');
  const ovTitle = el('ovTitle');
  const ovText = el('ovText');
  const ovBtn = el('ovBtn');
  const ticker = el('ticker');

  /* ==================== 状态 ==================== */
  let st = null;

  /* ==================== 工具 ==================== */
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function gauss() {
    // 三个均匀分布求和近似正态。用常量随机时结果恒为 0，方便做确定性测试
    return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  }

  function money(n, digits) {
    const d = digits === undefined ? 0 : digits;
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function pct(n) {
    return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  }

  function toneClass(n) {
    if (n > 0.00001) return 'up';
    if (n < -0.00001) return 'down';
    return 'flat';
  }

  function readStore(key, fb) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fb : v;
    } catch (e) {
      return fb;
    }
  }

  function writeStore(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ==================== 开局 ==================== */
  function newGame() {
    // 每局给每只股票一点点趋势差异，让「哪只在涨」每局都不同
    const stocks = STOCK_DEFS.map((def) => {
      const trend = def.drift + (Math.random() - 0.5) * 0.0022;
      return {
        code: def.code,
        name: def.name,
        emoji: def.emoji,
        color: def.color,
        drift: trend,
        vol: def.vol,
        price: def.base,
        prev: def.base,
        hist: [def.base],
        shares: 0,
      };
    });
    st = {
      day: 1,
      cash: START_CASH,
      sel: 0,
      qty: 0,
      over: false,
      news: null,
      stocks: stocks,
      startWorth: START_CASH,
    };
    render();
  }

  /* ==================== 净值 ==================== */
  function holdingValue() {
    let v = 0;
    for (const s of st.stocks) v += s.shares * s.price;
    return v;
  }

  function netWorth() {
    return st.cash + holdingValue();
  }

  function maxAffordable() {
    const s = st.stocks[st.sel];
    if (!s) return 0;
    return Math.floor(st.cash / (s.price * (1 + FEE)));
  }

  function qtyCap() {
    const s = st.stocks[st.sel];
    return Math.max(maxAffordable(), s ? s.shares : 0);
  }

  function stepSize() {
    return Math.max(1, Math.floor(Math.max(1, maxAffordable()) / 20));
  }

  function setQty(v) {
    st.qty = clamp(Math.round(v), 0, qtyCap());
    renderTrade();
  }

  /* ==================== 交易 ==================== */
  function toast(msg) {
    const t = el('tradeToast');
    t.textContent = msg;
    if (toast.timer) clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.textContent = ''; }, 2600);
  }

  function buy() {
    if (st.over) return;
    const s = st.stocks[st.sel];
    // 自动夹到"买得起"为止：这样「最大」按钮对买入也有意义，
    // 玩家不需要为了凑整去反复加减
    const q = Math.min(st.qty, maxAffordable());
    if (q <= 0) { toast('现金不够买 1 股'); return; }
    const cost = s.price * q;
    const fee = cost * FEE;
    st.cash -= cost + fee;
    s.shares += q;
    st.qty = 0;
    render();
    toast('买入 ' + q + ' 股，花费 ' + money(cost + fee, 2));
  }

  function sell() {
    if (st.over) return;
    const s = st.stocks[st.sel];
    // 同理：自动夹到持仓上限，不会出现"想清仓却卖不掉"
    const q = Math.min(st.qty, s.shares);
    if (q <= 0) { toast(s.shares ? '先选数量' : '没有持仓'); return; }
    const gross = s.price * q;
    const fee = gross * FEE;
    st.cash += gross - fee;
    s.shares -= q;
    st.qty = 0;
    render();
    toast('卖出 ' + q + ' 股，到手 ' + money(gross - fee, 2));
  }

  /* ==================== 新闻 ==================== */
  function rollNews() {
    const r = Math.random();
    if (r < 0.09) {
      const m = MARKET_NEWS[Math.floor(Math.random() * MARKET_NEWS.length)];
      return { stock: '*', text: m.text, mult: m.mult };
    }
    if (r < 0.36) {
      const s = st.stocks[Math.floor(Math.random() * st.stocks.length)];
      const hot = s.code === 'MEME' || s.code === 'AERO';
      const pool = hot ? BIG_NEWS : NEWS;
      const n = pool[Math.floor(Math.random() * pool.length)];
      return { stock: s.code, text: s.name + n.text, mult: n.mult };
    }
    return null;
  }

  /* ==================== 推进一天 ==================== */
  function nextDay() {
    if (st.over) return;
    st.day += 1;
    if (st.day > DAYS) {
      st.day = DAYS;
      endRun();
      return;
    }

    const news = rollNews();
    st.news = news;

    for (const s of st.stocks) {
      s.prev = s.price;
      let move = s.drift + gauss() * s.vol;
      if (news && news.stock === s.code) move += news.mult;
      if (news && news.stock === '*') move += news.mult;
      s.price = Math.max(PRICE_FLOOR, s.price * (1 + move));
      s.hist.push(s.price);
      if (s.hist.length > 60) s.hist.shift();
    }

    st.qty = 0;
    render();
  }

  /* ==================== 结算 ==================== */
  function endRun() {
    st.over = true;
    const worth = netWorth();
    const mult = worth / START_CASH;
    const rank = RANKS.find((r) => mult >= r.min) || RANKS[RANKS.length - 1];

    const prevBest = Number(readStore(STORE_BEST, 0)) || 0;
    const isBest = worth > prevBest;
    if (isBest) writeStore(STORE_BEST, Math.round(worth));

    render();

    showOverlay({
      title: rank.emoji + ' ' + rank.name,
      bad: mult < 1,
      text: '30 个交易日结束了。<br><br>'
        + '起始资金 <b>' + money(START_CASH) + '</b><br>'
        + '期末总资产 <b>' + money(worth) + '</b><br>'
        + '收益率 <b class="' + toneClass(worth - START_CASH) + '">' + pct(mult - 1) + '</b><br><br>'
        + rank.line
        + (isBest ? '<br><br><em>新纪录！</em>' : '<br><br>历史最高 <b>' + money(prevBest) + '</b>'),
      btn: '再来一局',
      // 少了这行，点「再来一局」只会关掉弹窗，棋盘还停在死局上
      onStart: () => { newGame(); },
    });
  }

  /* ==================== 遮罩 ==================== */
  function showOverlay(opt) {
    ovTitle.textContent = opt.title || '';
    ovTitle.classList.toggle('is-bad', !!opt.bad);
    ovText.innerHTML = opt.text || '';
    ovBtn.textContent = opt.btn || '继续';
    ovBtn.onclick = () => {
      overlay.hidden = true;
      if (opt.onStart) opt.onStart();
    };
    overlay.hidden = false;
  }

  /* ==================== 绘图 ==================== */
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }

  function drawSeries(cv, series, color, opts) {
    const o = opts || {};
    const g = fitCanvas(cv);
    const ctx = g.ctx;
    const W = g.w;
    const H = g.h;
    ctx.clearRect(0, 0, W, H);
    // 第 1 天只有一个数据点，画一条水平线，别让图表空着
    if (series.length === 1) {
      const y = H / 2;
      ctx.beginPath();
      ctx.moveTo(o.spark ? 0 : 6, y);
      ctx.lineTo(W - (o.spark ? 0 : 6), y);
      ctx.strokeStyle = hexA(color, 0.5);
      ctx.lineWidth = o.spark ? 1.2 : 2;
      ctx.stroke();
      return;
    }
    if (series.length < 2) return;

    const pad = o.pad === undefined ? 2 : o.pad;
    let min = Infinity;
    let max = -Infinity;
    for (const v of series) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 1e-9) { max = min + 1; }
    const x = (i) => pad + (i / (series.length - 1)) * (W - pad * 2);
    const y = (v) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);

    // 面积
    if (!o.spark) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, hexA(color, 0.28));
      grad.addColorStop(1, hexA(color, 0));
      ctx.beginPath();
      ctx.moveTo(x(0), H);
      for (let i = 0; i < series.length; i++) ctx.lineTo(x(i), y(series[i]));
      ctx.lineTo(x(series.length - 1), H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 折线
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      if (i === 0) ctx.moveTo(x(i), y(series[i]));
      else ctx.lineTo(x(i), y(series[i]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = o.spark ? 1.4 : 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 末端点
    if (!o.spark) {
      const lx = x(series.length - 1);
      const ly = y(series[series.length - 1]);
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 6, 0, Math.PI * 2);
      ctx.fillStyle = hexA(color, 0.22);
      ctx.fill();
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ==================== 渲染 ==================== */
  function renderHud() {
    el('dayNum').textContent = String(st.day);
    const worth = netWorth();
    const chg = worth / st.startWorth - 1;
    el('netWorth').textContent = money(worth);
    const p = el('netPct');
    p.textContent = pct(chg);
    p.className = 'hud__pct ' + toneClass(chg);
    el('netWorth').className = toneClass(chg);
  }

  function renderTicker() {
    if (!st.news) {
      ticker.hidden = true;
      return;
    }
    ticker.hidden = false;
    ticker.dataset.tone = st.news.mult >= 0 ? 'up' : 'down';
    el('tickerTag').textContent = st.news.stock === '*' ? '大盘' : '个股';
    el('tickerText').textContent = st.news.text;
  }

  function renderChart() {
    const s = st.stocks[st.sel];
    el('chartName').textContent = s.emoji + ' ' + s.name;
    el('chartPrice').textContent = money(s.price, 2);
    const chg = s.prev ? s.price / s.prev - 1 : 0;
    const cEl = el('chartChg');
    cEl.textContent = pct(chg);
    cEl.className = 'chartbox__chg ' + toneClass(chg);
    el('chartPrice').className = 'chartbox__price ' + toneClass(chg);

    let min = Infinity;
    let max = -Infinity;
    for (const v of s.hist) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    el('chartLow').textContent = '最低 ' + money(min, 2);
    el('chartHigh').textContent = '最高 ' + money(max, 2);

    drawSeries(chartCanvas, s.hist, s.color, { pad: 6 });
  }

  function renderList() {
    listEl.innerHTML = '';
    st.stocks.forEach((s, i) => {
      const chg = s.prev ? s.price / s.prev - 1 : 0;
      const row = document.createElement('div');
      row.className = 'row' + (i === st.sel ? ' is-active' : '');
      row.dataset.index = String(i);

      const emoji = document.createElement('span');
      emoji.className = 'row__emoji';
      emoji.textContent = s.emoji;

      const id = document.createElement('div');
      id.className = 'row__id';
      id.innerHTML = '<span class="row__name">' + s.name + '</span>'
        + '<span class="row__code">' + s.code + (s.shares ? ' · 持 ' + s.shares + ' 股' : '') + '</span>';

      const spark = document.createElement('canvas');
      spark.className = 'row__spark';
      spark.width = 54;
      spark.height = 24;

      const nums = document.createElement('div');
      nums.className = 'row__nums';
      nums.innerHTML = '<span class="row__price ' + toneClass(chg) + '">' + money(s.price, 2) + '</span>'
        + '<span class="row__chg ' + toneClass(chg) + '">' + pct(chg) + '</span>';

      row.appendChild(emoji);
      row.appendChild(id);
      row.appendChild(spark);
      row.appendChild(nums);
      listEl.appendChild(row);

      drawSeries(spark, s.hist, chg >= 0 ? '#e5484d' : '#2fbf71', { spark: true, pad: 2 });

      row.addEventListener('click', () => {
        st.sel = i;
        st.qty = 0;
        render();
      });
    });
  }

  function renderTrade() {
    const s = st.stocks[st.sel];
    el('qty').textContent = String(st.qty);

    const buyQ = Math.min(st.qty, maxAffordable());
    const sellQ = Math.min(st.qty, s.shares);
    const buyBtn = el('btnBuy');
    const sellBtn = el('btnSell');

    buyBtn.disabled = st.over || buyQ <= 0;
    sellBtn.disabled = st.over || sellQ <= 0;
    buyBtn.textContent = buyQ > 0 ? '买入 ' + buyQ + ' 股' : '买入';
    sellBtn.textContent = sellQ > 0 ? '卖出 ' + sellQ + ' 股' : '卖出';

    const holdTxt = s.shares ? '持 ' + s.shares + ' 股' : '无持仓';
    el('tradeHint').textContent = st.over
      ? '本局已结束'
      : '现金 ' + money(st.cash, 2) + ' · ' + holdTxt + ' · 手续费 0.1%';
  }

  function render() {
    if (!st) return;
    renderHud();
    renderTicker();
    renderChart();
    renderList();
    renderTrade();
    el('btnNext').textContent = st.day >= DAYS ? '结算 →' : '下一天 →';
  }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    el('btnMinus').addEventListener('click', () => setQty(st.qty - stepSize()));
    el('btnPlus').addEventListener('click', () => setQty(st.qty + stepSize()));
    el('btnMax').addEventListener('click', () => {
      st.qty = qtyCap();
      renderTrade();
    });
    el('btnBuy').addEventListener('click', buy);
    el('btnSell').addEventListener('click', sell);
    el('btnNext').addEventListener('click', nextDay);

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!overlay.hidden) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ovBtn.click(); }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); nextDay(); }
      if (e.key === 'b' || e.key === 'B') buy();
      if (e.key === 's' || e.key === 'S') sell();
      if (e.key === 'ArrowUp') { e.preventDefault(); st.sel = (st.sel + st.stocks.length - 1) % st.stocks.length; st.qty = 0; render(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); st.sel = (st.sel + 1) % st.stocks.length; st.qty = 0; render(); }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 120);
    });
  }

  /* ==================== 启动 ==================== */
  function init() {
    bind();
    newGame();
    app.dataset.ready = '1';

    const best = Number(readStore(STORE_BEST, 0)) || 0;
    showOverlay({
      title: '股海浮沉',
      text: '给你 <b>' + money(START_CASH) + '</b> 本金，<b>30 个交易日</b>。<br>'
        + '买哪只、什么时候走，全看你。<br><br>'
        + '每只股票的波动性格完全不同：<br>'
        + '🏦 银行稳如老狗　🍜 面馆慢牛<br>'
        + '🔋 电池温和成长　🚀 航天大起大落<br>'
        + '🎲 娱乐一天一个样<br><br>'
        + '<em>红涨绿跌</em>，手续费 0.1%。'
        + (best ? '<br><br>历史最高总资产 <b>' + money(best) + '</b>' : ''),
      btn: '开始交易',
      onStart: () => { newGame(); },
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* 可选 */ });
      });
    }
  }

  init();
})();
