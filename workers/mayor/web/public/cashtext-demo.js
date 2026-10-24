/* CashText teaser — the scripted demo's driver. Canned flow only:
 * it makes no network calls, collects nothing, and writes nothing;
 * the two dataLayer pushes are the demo start/complete engagement
 * events (GTM loads only under the visitor's analytics consent,
 * like every other page on this site). */
(function () {
  window.dataLayer = window.dataLayer || [];
  function push(event) { window.dataLayer.push({ event: event, module: 'cashtext', surface: 'cashtext-demo' }); }
  function show(id) { document.getElementById(id).classList.add('on'); }
  var started = false;
  document.getElementById('start').addEventListener('click', function () {
    if (!started) { started = true; push('cashtext_demo_start'); }
    show('step-1'); show('step-2');
    document.getElementById('step-0').style.display = 'none';
  });
  document.getElementById('edit').addEventListener('click', function () {
    document.getElementById('edit-note').hidden = false;
  });
  document.getElementById('dismiss').addEventListener('click', function () {
    var note = document.getElementById('edit-note');
    note.hidden = false;
    note.textContent = 'In the real module, Dismiss cancels the draft and nothing is sent. For the demo, Approve & send keeps the story moving.';
  });
  document.getElementById('approve').addEventListener('click', function () { show('step-3'); });
  document.getElementById('chase').addEventListener('click', function () { show('step-4'); });
  document.getElementById('copy').addEventListener('click', function () {
    var text = 'Hi Maria — a friendly nudge on the $400 invoice for the bathroom work, due last Friday. The pay link is on the invoice I just re-sent. Anything you need from me to get it paid?';
    if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () {}); }
    document.getElementById('copy-note').hidden = false;
  });
  document.getElementById('approve-chase').addEventListener('click', function () {
    show('step-5'); push('cashtext_demo_complete');
  });
  document.getElementById('replay').addEventListener('click', function () { window.location.reload(); });
})();
