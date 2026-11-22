/* ============================================================
   لغة الضاد — واجهة المحرّر
   ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const ta = $('code');
  const hl = $('hl');
  const highlightBox = $('highlight');
  const gutterPre = $('gutter-pre');
  const gutter = $('gutter');
  const stripe = $('err-stripe');
  const wrap = $('code-wrap');
  const termBody = $('term-body');
  const terminal = $('terminal');
  const runBtn = $('run');
  const editorMeta = $('editor-meta');
  const statusEl = $('status');
  const statusText = $('status-text');
  const statsEl = $('stats');
  const badgeOut = $('badge-out');
  const badgeTokens = $('badge-tokens');
  const badgeVars = $('badge-vars');
  const tokensBody = $('tokens-table').querySelector('tbody');
  const varsBody = $('vars-table').querySelector('tbody');
  const tokensEmpty = $('tokens-empty');
  const varsEmpty = $('vars-empty');

  const KW = new Set(['متغير', 'اطبع', 'إذا', 'وإلا', 'بينما', 'لكل']);
  const BOOL = new Set(['صح', 'خطأ']);
  const STORE = 'lughatdad.code.v1';

  const TYPE_AR = {
    Double: 'عدد',
    String: 'نص',
    Boolean: 'منطقي',
    null: 'غير مهيّأ',
  };

  /* ---------------------------------------------------------- */
  /* examples                                                   */
  /* ---------------------------------------------------------- */

  const EXAMPLES = [
    {
      name: 'الأساسيات',
      code: `// برنامج ترحيبي بلغة الضاد
متغير الاسم = "يا ضاد";
متغير العمر = 21;

اطبع "أهلًا " + الاسم;
اطبع "عمرك: " + العمر;
اطبع "بعد خمس سنوات: " + (العمر + 5);
`,
    },
    {
      name: 'الشروط',
      code: `// إذا / وإلا
متغير الدرجة = 88;

إذا (الدرجة >= 90) {
  اطبع "التقدير: ممتاز";
} وإلا {
  إذا (الدرجة >= 80) {
    اطبع "التقدير: جيد جدًا";
  } وإلا {
    اطبع "التقدير: يحتاج مراجعة";
  }
}
`,
    },
    {
      name: 'حلقة بينما',
      code: `// جمع الأعداد من ١ إلى ٥
متغير العداد = 1;
متغير المجموع = 0;

بينما (العداد <= 5) {
  المجموع = المجموع + العداد;
  اطبع "بعد إضافة " + العداد + " صار المجموع " + المجموع;
  العداد = العداد + 1;
}

اطبع "المجموع النهائي: " + المجموع;
`,
    },
    {
      name: 'حلقة لكل',
      code: `// جدول ضرب الرقم ٣
لكل (متغير ع = 1; ع <= 5; ع = ع + 1) {
  اطبع ع + " × 3 = " + (ع * 3);
}
`,
    },
    {
      name: 'النصوص والمنطق',
      code: `// نصوص، قيم منطقية، ومقارنات
متغير الاسم = "ضاد";
متغير مشترك = صح;

اطبع "مرحبًا " + الاسم + "!";
اطبع مشترك;
اطبع خطأ;

إذا (10 > 3) {
  اطبع "10 أكبر من 3";
}

إذا (10 == 3) {
  اطبع "متساويان";
} وإلا {
  اطبع "غير متساويين";
}

اطبع -7 + 2;
`,
    },
    {
      name: 'خطأ مقصود',
      code: `// لتجربة رسائل الخطأ: المتغير "النتيجة" غير معرَّف
متغير س = 4;
اطبع س * 2;
اطبع النتيجة;
`,
    },
  ];

  /* ---------------------------------------------------------- */
  /* syntax highlighting                                        */
  /* ---------------------------------------------------------- */

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const wrapSpan = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

  const LINE_RE = new RegExp(
    [
      '(\\/\\/[^\\n]*)',                        // comment
      '("[^"\\n]*(?:"|$))',                     // string
      '(\\d+(?:\\.\\d+)?)',                     // number
      '([\\u0600-\\u06FF][\\u0600-\\u06FF0-9]*)', // arabic word
      '([+\\-*/=!<>]+)',                        // operator
      '([(){};])',                              // punctuation
      '(.)',                                    // anything else
    ].join('|'),
    'gu'
  );

  function highlightLine(line) {
    let out = '';
    let last = 0;
    let m;
    LINE_RE.lastIndex = 0;
    while ((m = LINE_RE.exec(line)) !== null) {
      if (m.index > last) out += esc(line.slice(last, m.index));
      const t = m[0];
      if (m[1]) out += wrapSpan('tok-com', t);
      else if (m[2]) out += wrapSpan('tok-str', t);
      else if (m[3]) out += wrapSpan('tok-num', t);
      else if (m[4]) out += wrapSpan(KW.has(t) ? 'tok-kw' : BOOL.has(t) ? 'tok-bool' : 'tok-id', t);
      else if (m[5]) out += wrapSpan('tok-op', t);
      else if (m[6]) out += wrapSpan('tok-punc', t);
      else out += esc(t);
      last = m.index + t.length;
    }
    if (last < line.length) out += esc(line.slice(last));
    return out;
  }

  function renderCode() {
    const lines = ta.value.split('\n');
    hl.innerHTML = lines.map(highlightLine).join('\n') + '\n';

    const nums = [];
    for (let i = 1; i <= Math.max(lines.length, 1); i++) {
      nums.push(errorLine === i ? `<span class="err">${i}</span>` : String(i));
    }
    gutterPre.innerHTML = nums.join('\n');

    editorMeta.textContent = `${lines.length} سطر`;
    syncScroll();
    updateStripe();
  }

  /* ---------------------------------------------------------- */
  /* scroll + caret + error marker                              */
  /* ---------------------------------------------------------- */

  let errorLine = -1;
  let errorApprox = false;

  function syncScroll() {
    highlightBox.scrollTop = ta.scrollTop;
    highlightBox.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }

  function lineHeight() {
    const cs = getComputedStyle(ta);
    return parseFloat(cs.lineHeight) || 26;
  }

  function updateStripe() {
    if (!(errorLine > 0)) {
      stripe.style.display = 'none';
      return;
    }
    const lh = lineHeight();
    const padTop = parseFloat(getComputedStyle(ta).paddingTop) || 14;
    const top = padTop + (errorLine - 1) * lh - ta.scrollTop;
    stripe.style.display = 'block';
    stripe.classList.toggle('approx', errorApprox);
    stripe.style.height = `${lh}px`;
    stripe.style.top = `${top}px`;
    stripe.style.opacity = top < 0 || top > wrap.clientHeight ? '0' : '1';
  }

  function setErrorLine(line, approx) {
    errorLine = line && line > 0 ? line : -1;
    errorApprox = !!approx && errorLine > 0;
    renderCode();
  }

  function jumpTo(line) {
    if (!(line > 0)) return;
    const lh = lineHeight();
    ta.focus();
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 3);
    const lines = ta.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.setSelectionRange(start, start + (lines[line - 1] || '').length);
    syncScroll();
    updateStripe();
  }

  ta.addEventListener('scroll', () => {
    syncScroll();
    updateStripe();
  });

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      const t = ta.selectionEnd;
      ta.setRangeText('  ', s, t, 'end');
      renderCode();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });

  ta.addEventListener('input', () => {
    renderCode();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, ta.value); } catch (_) {}
    }, 300);
  });

  let saveTimer = null;

  /* ---------------------------------------------------------- */
  /* terminal                                                   */
  /* ---------------------------------------------------------- */

  const escLines = (s) => String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  function termClear() {
    termBody.innerHTML = '<div class="term-line dim">جاهز. اكتب برنامجًا ثم اضغط <b>شغّل</b>.</div>';
    badgeOut.textContent = '—';
  }

  function addTermLine(html) {
    const div = document.createElement('div');
    div.className = 'term-line';
    div.innerHTML = html;
    termBody.appendChild(div);
    return div;
  }

  function scrollTerm() {
    terminal.scrollTop = terminal.scrollHeight;
  }

  function renderOutput(data) {
    termBody.innerHTML = '';
    addTermLine('<span class="prompt">تشغيل</span><span dir="ltr">main.lug</span>');
    scrollTerm();

    const out = escLines(data.out || '');
    const lines = out.length ? out.replace(/\n$/, '').split('\n') : [];
    lines.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'term-line out-line';
      div.textContent = l || '\u00a0';
      termBody.appendChild(div);
    });

    if (data.truncated) {
      addTermLine('<span class="term-line meta">… تم قطع المخرجات لأنها تجاوزت الحد.</span>');
    }

    if (data.error) {
      const e = data.error;
      const approx = e.approx ? ' · تقريبي' : '';
      const loc = e.line > 0
        ? `<span class="err-loc" data-line="${e.line}" title="اذهب إلى السطر">السطر ${e.line}${e.column > 0 ? ` · عمود ${e.column}` : ''}${approx}</span>`
        : '';
      const raw = e.raw && e.raw.length > 0
        ? `<details class="err-raw"><summary>تفاصيل المُحلِّل</summary><pre>${esc(e.raw)}</pre></details>`
        : '';
      const box = document.createElement('div');
      box.className = 'term-error';
      box.innerHTML = `
        <div class="err-head"><span class="err-title">${esc(e.title || 'خطأ')}</span>${loc}</div>
        <div class="err-msg">${esc(e.message || '')}</div>
        ${e.hint ? `<div class="err-hint">${esc(e.hint)}</div>` : ''}
        ${raw}`;
      termBody.appendChild(box);
      setErrorLine(e.line, !!e.approx);
    } else {
      setErrorLine(-1, false);
    }

    const meta = data.error
      ? `✕ توقّف التنفيذ · ${data.ms != null ? data.ms + 'ms' : ''}`
      : `✓ اكتمل التنفيذ · ${lines.length} سطر مخرجات · ${data.ms != null ? data.ms + 'ms' : ''}`;
    addTermLine(`<span class="term-line meta">${esc(meta)}</span>`);
    scrollTerm();
  }

  termBody.addEventListener('click', (ev) => {
    const loc = ev.target.closest('.err-loc');
    if (loc) jumpTo(Number(loc.dataset.line));
  });

  /* ---------------------------------------------------------- */
  /* tokens + variables                                         */
  /* ---------------------------------------------------------- */

  function kindMeta(kind) {
    if (kind === 'ARABIC_IDENTIFIER') return ['اسم', 'id'];
    if (kind === 'NUMBER') return ['عدد', 'num'];
    if (kind === 'STRING') return ['نص', 'str'];
    if (KW.has(kind)) return ['كلمة مفتاحية', 'kw'];
    if (BOOL.has(kind)) return ['منطقي', 'bool'];
    if (/^[+\-*/=!<>]+$/.test(kind)) return ['عامل', 'op'];
    if (/^[(){};]$/.test(kind)) return ['ترقيم', 'punc'];
    return [kind, 'punc'];
  }

  function renderTokens(tokens) {
    tokensBody.innerHTML = '';
    badgeTokens.textContent = String(tokens.length);
    if (!tokens.length) {
      tokensEmpty.style.display = 'block';
      $('tokens-table').style.display = 'none';
      return;
    }
    tokensEmpty.style.display = 'none';
    $('tokens-table').style.display = 'table';

    const frag = document.createDocumentFragment();
    tokens.slice(0, 400).forEach((t, i) => {
      const [label, cls] = kindMeta(t[0]);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="num">${i + 1}</td>
        <td><span class="kind ${cls}">${esc(label)}</span></td>
        <td class="val" dir="ltr">${esc(t[1])}</td>
        <td class="num" dir="ltr">${t[2]}:${t[3]}</td>`;
      frag.appendChild(tr);
    });
    tokensBody.appendChild(frag);
  }

  function renderVars(symbols) {
    varsBody.innerHTML = '';
    badgeVars.textContent = String(symbols.length);
    if (!symbols.length) {
      varsEmpty.style.display = 'block';
      $('vars-table').style.display = 'none';
      return;
    }
    varsEmpty.style.display = 'none';
    $('vars-table').style.display = 'table';

    const frag = document.createDocumentFragment();
    symbols.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="val" dir="auto">${esc(s[0])}</td>
        <td><span class="kind id">${esc(TYPE_AR[s[1]] || s[1])}</span></td>
        <td class="val" dir="auto">${esc(s[2])}</td>`;
      frag.appendChild(tr);
    });
    varsBody.appendChild(frag);
  }

  /* ---------------------------------------------------------- */
  /* status                                                     */
  /* ---------------------------------------------------------- */

  function setStatus(kind, text, stats) {
    statusEl.className = `status ${kind}`;
    statusText.textContent = text;
    statsEl.textContent = stats || '';
  }

  /* ---------------------------------------------------------- */
  /* run                                                        */
  /* ---------------------------------------------------------- */

  let running = false;

  async function run() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    setStatus('busy', 'جارٍ التنفيذ…', '');
    termBody.innerHTML = '<div class="term-line cmd"><span class="spinner"></span> تشغيل main.lug …</div>';
    scrollTerm();

    let data;
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: ta.value }),
      });
      data = await res.json();
    } catch (err) {
      data = {
        ok: false,
        out: '',
        ms: 0,
        symbols: [],
        tokens: [],
        error: {
          title: 'تعذّر الاتصال بالخادم',
          message: 'لم يستجب خادم التنفيذ. تأكّد من تشغيله بأمر npm start.',
          hint: 'شغّل الخادم من مجلّد المشروع: node web/server.js',
          line: -1,
          column: -1,
        },
      };
    }

    renderOutput(data);
    renderTokens(data.tokens || []);
    renderVars(data.symbols || []);

    const outLines = (data.out || '').replace(/\n$/, '').split('\n').filter((l) => l.length);
    badgeOut.textContent = data.error ? '!' : String(outLines.length);

    if (data.error) {
      const where = data.error.line > 0 ? ` · السطر ${data.error.line}` : '';
      setStatus('err', `توقّف: ${data.error.title}${where}`, `${(data.tokens || []).length} رمز · ${(data.symbols || []).length} متغيّر · ${data.ms}ms`);
      if (data.error.line > 0) {
        const lh = lineHeight();
        ta.scrollTop = Math.max(0, (data.error.line - 1) * lh - ta.clientHeight / 2.4);
        syncScroll();
        updateStripe();
      }
    } else {
      setStatus('ok', 'تم التنفيذ بنجاح', `${outLines.length} مخرجات · ${(data.tokens || []).length} رمز · ${(data.symbols || []).length} متغيّر · ${data.ms}ms`);
    }

    running = false;
    runBtn.disabled = false;
    ta.focus();
  }

  runBtn.addEventListener('click', run);
  $('term-clear').addEventListener('click', termClear);
  $('clear').addEventListener('click', () => {
    ta.value = '';
    localStorage.removeItem(STORE);
    setErrorLine(-1);
    renderCode();
    termClear();
    renderTokens([]);
    renderVars([]);
    setStatus('', 'جاهز', '');
    markChip(-1);
    ta.focus();
  });

  /* ---------------------------------------------------------- */
  /* tabs + examples                                            */
  /* ---------------------------------------------------------- */

  function showPane(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showPane(tab.dataset.pane));
  });

  const chipsBox = $('examples');
  EXAMPLES.forEach((ex, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (i === 0 ? ' on' : '');
    b.textContent = ex.name;
    b.addEventListener('click', () => {
      ta.value = ex.code;
      try { localStorage.setItem(STORE, ta.value); } catch (_) {}
      markChip(i);
      setErrorLine(-1);
      renderCode();
      showPane('out');
      run();
    });
    chipsBox.appendChild(b);
  });

  function markChip(index) {
    chipsBox.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === index));
  }

  /* ---------------------------------------------------------- */
  /* boot                                                       */
  /* ---------------------------------------------------------- */

  const params = new URLSearchParams(location.search);
  const exParam = Number(params.get('ex'));
  const paneParam = params.get('pane');

  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch (_) {}

  if (Number.isInteger(exParam) && EXAMPLES[exParam]) {
    ta.value = EXAMPLES[exParam].code;
    markChip(exParam);
    try { localStorage.setItem(STORE, ta.value); } catch (_) {}
  } else {
    ta.value = saved && saved.trim() ? saved : EXAMPLES[0].code;
  }

  renderCode();
  renderTokens([]);
  renderVars([]);

  if (paneParam) showPane(paneParam);

  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      $('build-text').textContent = `${s.parser} · ${s.timeoutMs / 1000}s`;
      $('build-tag').title = `${s.parser} · Node ${s.node} · مهلة ${s.timeoutMs}ms`;
    })
    .catch(() => {});

  setTimeout(run, 450);
})();
