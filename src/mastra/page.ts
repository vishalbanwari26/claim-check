// The review page, as one string so `mastra build` cannot lose a separate file.
// Drafts and claims are untrusted text (pasted by a person, produced by a model), so the script
// below only ever inserts them as text nodes, never as HTML.

export const reviewPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claim-check review</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --card:#181b22; --line:#2a2f3a; --text:#e6e8ee; --dim:#9aa3b2; --accent:#6ea8fe; --ok:#4cc38a; --bad:#ef6a6a; --warn:#e5b45a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 10px; }
  .dim { color: var(--dim); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin: 10px 0; }
  textarea, input[type=text] { width: 100%; background: #10131a; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; }
  textarea { min-height: 140px; resize: vertical; }
  button { background: #232836; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 14px; font: inherit; cursor: pointer; }
  button:hover:enabled { border-color: var(--accent); } button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); color: #0b1020; border-color: var(--accent); font-weight: 600; }
  button.on-approve { background: var(--ok); color: #07130d; border-color: var(--ok); }
  button.on-correct { background: var(--warn); color: #161006; border-color: var(--warn); }
  button.on-reject { background: var(--bad); color: #190808; border-color: var(--bad); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .row > * { flex: 0 0 auto; }
  .grow { flex: 1 1 200px !important; }
  .run { cursor: pointer; } .run:hover { border-color: var(--accent); }
  .tag { display:inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); margin-right: 6px; }
  .tag.bad { color: var(--bad); border-color: var(--bad); } .tag.ok { color: var(--ok); border-color: var(--ok); }
  .evidence { color: var(--dim); font-size: 13px; margin: 2px 0 0 12px; }
  .error { color: var(--bad); margin: 8px 0; } .problem { color: var(--warn); margin: 6px 0; }
  .hidden { display: none; }
</style>
</head>
<body>
<main>
  <h1>claim-check review</h1>
  <div class="dim">Nothing becomes a confirmed fact until a person has decided every flagged claim.</div>

  <div id="home">
    <h2>Check a draft</h2>
    <div class="card">
      <textarea id="draft" placeholder="Paste the CV or cover letter text here"></textarea>
      <div class="row" style="margin-top:8px">
        <input type="text" id="candidate" class="grow" value="ines-varga" aria-label="Candidate id">
        <input type="text" id="job" class="grow" value="quillbeam-ai-engineer" aria-label="Job id">
        <button id="start" class="primary">Check draft</button>
      </div>
      <div id="startNote" class="dim" style="margin-top:6px"></div>
    </div>

    <h2>Waiting for review</h2>
    <div id="list" class="dim">Loading...</div>
  </div>

  <div id="review" class="hidden"></div>
  <div id="error" class="error"></div>
</main>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  // Text only: append() turns a string into a text node, so nothing here can become markup.
  var el = function (tag, props) {
    var n = document.createElement(tag);
    Object.assign(n, props || {});
    for (var i = 2; i < arguments.length; i++) n.append(arguments[i]);
    return n;
  };
  var api = function (path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
        return body;
      });
    });
  };
  var fail = function (e) { $('error').textContent = e.message || String(e); };
  var clearError = function () { $('error').textContent = ''; };

  var current = null; // { runId, pending, choices, reviewer, approveSupported }

  function loadList() {
    api('/review/runs').then(function (runs) {
      var box = $('list');
      box.textContent = '';
      if (!runs.length) { box.textContent = 'No runs waiting for review.'; return; }
      runs.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      runs.forEach(function (r) {
        var flagged = r.flaggedCount === null ? '? flagged' : r.flaggedCount + ' flagged';
        var card = el('div', { className: 'card run', onclick: function () { openRun(r.runId); } },
          el('span', { className: 'tag' + (r.flaggedCount === 0 ? ' ok' : ' bad'), textContent: flagged }),
          el('span', { className: 'tag', textContent: new Date(r.createdAt).toLocaleString() }),
          el('div', { textContent: r.preview }));
        box.append(card);
      });
    }).catch(fail);
  }

  function openRun(runId) {
    clearError();
    api('/review/runs/' + encodeURIComponent(runId)).then(function (pending) {
      current = { runId: runId, pending: pending, choices: {}, reviewer: '', approveSupported: false };
      show(true);
      render();
    }).catch(fail);
  }

  function show(inReview) {
    $('home').classList.toggle('hidden', inReview);
    $('review').classList.toggle('hidden', !inReview);
    if (!inReview) { current = null; loadList(); }
  }

  function undecided() {
    var done = {};
    current.pending.decided.forEach(function (d) { done[d.claimId] = true; });
    return current.pending.flagged.filter(function (c) { return !done[c.id]; });
  }

  function isReady() {
    if (!current.reviewer.trim()) return false;
    return undecided().every(function (c) {
      var ch = current.choices[c.id];
      return ch && (ch.action !== 'correct' || (ch.text || '').trim());
    });
  }

  function claimBlock(c) {
    var parts = [
      el('div', {}, el('span', { className: 'tag bad', textContent: c.agentVerdict }), el('strong', { textContent: c.text })),
      el('div', { className: 'dim', textContent: 'Sentence ' + c.sentence + ': ' + c.sentenceText }),
      el('div', { className: 'dim', textContent: 'Agent says: ' + c.agentReason })
    ];
    c.citedEvidence.forEach(function (e) { parts.push(el('div', { className: 'evidence', textContent: 'Evidence ' + e.id + ': ' + e.text.split('\\n')[0] })); });
    return parts;
  }

  function render() {
    var root = $('review');
    root.textContent = '';
    var p = current.pending;
    root.append(el('div', { className: 'row' },
      el('button', { textContent: 'Back to list', onclick: function () { show(false); } }),
      el('span', { className: 'dim', textContent: 'Run ' + current.runId })));

    p.problems.forEach(function (m) { root.append(el('div', { className: 'problem', textContent: m })); });

    var reviewer = el('input', { type: 'text', value: current.reviewer, placeholder: 'Your name (required)', oninput: function () { current.reviewer = reviewer.value; refresh(); } });
    root.append(el('h2', { textContent: 'Reviewer' }), reviewer);

    root.append(el('h2', { textContent: 'Flagged, needs a decision (' + undecided().length + ' left)' }));
    p.decided.forEach(function (d) {
      root.append(el('div', { className: 'card' }, el('span', { className: 'tag ok', textContent: 'decided: ' + d.action }), el('span', { textContent: d.claimId })));
    });
    undecided().forEach(function (c) {
      var ch = current.choices[c.id] || (current.choices[c.id] = { action: null, text: '' });
      var textBox = el('textarea', { className: ch.action === 'correct' ? '' : 'hidden', placeholder: 'What is actually true?', value: ch.text || '', oninput: function () { ch.text = textBox.value; refresh(); } });
      textBox.style.minHeight = '60px';
      var buttons = ['approve', 'correct', 'reject'].map(function (a) {
        var label = { approve: 'Approve as true', correct: 'Correct it', reject: 'Reject' }[a];
        var b = el('button', { textContent: label, className: ch.action === a ? 'on-' + a : '', onclick: function () { ch.action = a; render(); } });
        return b;
      });
      var card = el('div', { className: 'card' });
      claimBlock(c).forEach(function (n) { card.append(n); });
      card.append(el('div', { className: 'row', style: 'margin-top:8px' }, buttons[0], buttons[1], buttons[2]), textBox);
      root.append(card);
    });

    root.append(el('h2', { textContent: 'The agent thinks these are supported (' + p.supportedAwaitingApproval.length + ')' }));
    p.supportedAwaitingApproval.forEach(function (c) {
      var card = el('div', { className: 'card' }, el('span', { className: 'tag ok', textContent: c.agentVerdict }), el('span', { textContent: c.text }),
        el('div', { className: 'dim', textContent: 'Agent says: ' + c.agentReason }));
      root.append(card);
    });
    if (p.supportedAwaitingApproval.length) {
      var box = el('input', { type: 'checkbox', checked: current.approveSupported, onchange: function () { current.approveSupported = box.checked; } });
      root.append(el('label', { className: 'row' }, box, el('span', { textContent: 'I read these and accept them' })));
    }

    if (p.uncheckedSentences.length) {
      root.append(el('h2', { textContent: 'No claim was taken from these sentences. Read them yourself.' }));
      p.uncheckedSentences.forEach(function (s) { root.append(el('div', { className: 'card dim', textContent: 'S' + s.n + ': ' + s.text })); });
    }

    var submit = el('button', { id: 'submit', className: 'primary', textContent: 'Submit decisions', onclick: submitNow });
    root.append(el('div', { style: 'margin-top:18px' }, submit));
    refresh();
  }

  function refresh() { var s = $('submit'); if (s) s.disabled = !isReady(); }

  function submitNow() {
    clearError();
    var decisions = Object.keys(current.choices).filter(function (id) { return current.choices[id].action; }).map(function (id) {
      var ch = current.choices[id];
      var d = { claimId: id, action: ch.action };
      if (ch.action === 'correct') d.correctedFact = ch.text.trim();
      return d;
    });
    $('submit').disabled = true;
    api('/review/runs/' + encodeURIComponent(current.runId) + '/decisions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer: current.reviewer.trim(), decisions: decisions, approveSupported: current.approveSupported })
    }).then(function (out) {
      if (out.done) showReport(out.report);
      else { current.pending = out.pending; current.choices = {}; render(); }
    }).catch(function (e) { fail(e); refresh(); });
  }

  function showReport(r) {
    var root = $('review');
    root.textContent = '';
    root.append(el('button', { textContent: 'Back to list', onclick: function () { show(false); } }));
    root.append(el('h2', { textContent: 'Result' }));
    r.claims.forEach(function (c) {
      var who = c.decidedBy ? 'by ' + c.decidedBy : 'nobody signed off';
      var card = el('div', { className: 'card' }, el('span', { className: 'tag ' + (c.status === 'verified' || c.status === 'corrected' ? 'ok' : 'bad'), textContent: c.status }),
        el('span', { textContent: c.text + ' (' + who + ')' }));
      if (c.correctedFact) card.append(el('div', { className: 'dim', textContent: 'Correct fact: ' + c.correctedFact }));
      root.append(card);
    });
    root.append(el('div', { className: 'dim', textContent: 'Counts: ' + JSON.stringify(r.counts) + '. Facts added to memory: ' + (r.factsAdded.join(', ') || 'none') + '.' }));
  }

  $('start').onclick = function () {
    clearError();
    var draft = $('draft').value;
    if (!draft.trim()) { fail(new Error('Paste a draft first.')); return; }
    $('start').disabled = true;
    $('startNote').textContent = 'Checking. This calls the model and takes a few seconds...';
    api('/review/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: draft, candidateId: $('candidate').value.trim(), jobId: $('job').value.trim() }) })
      .then(function (out) { $('startNote').textContent = ''; $('start').disabled = false; openRun(out.runId); })
      .catch(function (e) { $('startNote').textContent = ''; $('start').disabled = false; fail(e); });
  };

  loadList();
  var wanted = new URLSearchParams(location.search).get('run');
  if (wanted) openRun(wanted);
})();
</script>
</body>
</html>`
