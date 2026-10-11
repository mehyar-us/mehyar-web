/**
 * analytics-consent.js — consent-gated Google Analytics 4 + Google Tag Manager
 * for mayor.mehyar.us.
 *
 * Privacy design (Consent Mode v2):
 *  - Consent defaults are set to DENIED the moment this file parses — before
 *    any measurement tag is injected and before any choice is stored.
 *  - The GTM container (GTM-PZLMLZ5C) and the GA4 gtag.js library
 *    (G-6RCJMF73VJ) are injected ONLY after the visitor accepts. GA4 is
 *    loaded as direct gtag.js ONLY — never configured inside GTM, so
 *    pageviews can never double-count.
 *  - This site runs no ads: ad_storage / ad_user_data / ad_personalization
 *    stay denied even after acceptance.
 *  - No external request leaves the browser before consent: this file is
 *    same-origin, and the measurement-library URLs appear only inside
 *    loadGrantedTags(), which is reachable only from the consent-granted
 *    code path.
 *
 * Storage: localStorage key `mayor.analytics-consent.v1` = 'granted' |
 * 'denied' | absent.
 */
(function () {
  'use strict';

  var GA4_MEASUREMENT_ID = 'G-6RCJMF73VJ';
  var GTM_CONTAINER_ID = 'GTM-PZLMLZ5C';
  var STORAGE_KEY = 'mayor.analytics-consent.v1';
  var BANNER_ID = 'mayor-consent-banner';

  /* ------------------------------------------------------------------ */
  /* 1. Consent Mode defaults — denied, set immediately on parse.        */
  /* ------------------------------------------------------------------ */
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted'
  });

  var tagsLoaded = false;

  function readChoice() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }
  function writeChoice(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      /* private mode: choice simply does not persist */
    }
  }
  function clearChoice() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* nothing stored to clear */
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. Granted path: update Consent Mode (ads stay denied — no ads on   */
  /*    this site), then load the measurement tags exactly once.          */
  /* ------------------------------------------------------------------ */
  function applyGrantedConsent() {
    gtag('consent', 'update', {
      analytics_storage: 'granted',
      functionality_storage: 'granted',
      personalization_storage: 'granted'
    });
  }

  /**
   * The ONLY place googletagmanager.com is ever touched. Called solely from
   * enableGrantedAnalytics(), which runs only after an explicit accept (or a
   * stored 'granted' choice).
   */
  function loadGrantedTags() {
    if (tagsLoaded) {
      return;
    }
    tagsLoaded = true;
    /* Standard GTM snippet. GA4 config is deliberately NOT added here. */
    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s),
        dl = l !== 'dataLayer' ? '&l=' + l : '';
      j.async = true;
      j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', GTM_CONTAINER_ID);
    /* GA4, direct gtag.js only — never via GTM (would double-count). */
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
    document.head.appendChild(g);
    gtag('js', new Date());
    gtag('config', GA4_MEASUREMENT_ID);
  }

  function enableGrantedAnalytics() {
    applyGrantedConsent();
    loadGrantedTags();
  }

  /* ------------------------------------------------------------------ */
  /* 3. Consent banner — shown only when no choice is stored.             */
  /* ------------------------------------------------------------------ */
  function onAccept() {
    writeChoice('granted');
    hideConsentBanner();
    enableGrantedAnalytics();
  }

  function onReject() {
    writeChoice('denied');
    hideConsentBanner();
  }

  function hideConsentBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function showConsentBanner() {
    if (document.getElementById(BANNER_ID)) {
      return;
    }
    var bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.className = 'mayor-consent-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics consent');
    bar.setAttribute('aria-live', 'polite');

    var copy = document.createElement('p');
    copy.className = 'mayor-consent-copy';
    copy.textContent =
      'We use Google Analytics to understand aggregate site traffic. It only loads if you accept.';
    bar.appendChild(copy);

    var actions = document.createElement('div');
    actions.className = 'mayor-consent-actions';

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'mayor-consent-btn mayor-consent-accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', onAccept);

    var reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'mayor-consent-btn mayor-consent-reject';
    reject.textContent = 'Reject';
    reject.addEventListener('click', onReject);

    actions.appendChild(accept);
    actions.appendChild(reject);
    bar.appendChild(actions);
    document.body.appendChild(bar);
  }

  /* Footer "Cookie settings" triggers — bound here so no inline handler is
   * needed (the site CSP forbids inline scripts). */
  function bindReopenTriggers() {
    var triggers = document.querySelectorAll('[data-mayor-consent-reopen]');
    for (var i = 0; i < triggers.length; i++) {
      triggers[i].addEventListener('click', function (ev) {
        ev.preventDefault();
        window.MayorConsent.reopen();
      });
    }
  }

  window.MayorConsent = {
    /** Clear the stored choice and re-show the banner (footer link). */
    reopen: function () {
      clearChoice();
      showConsentBanner();
    }
  };

  /* ------------------------------------------------------------------ */
  /* 4. Boot: honor a stored choice, otherwise ask.                      */
  /* ------------------------------------------------------------------ */
  function init() {
    bindReopenTriggers();
    var choice = readChoice();
    if (choice === 'granted') {
      enableGrantedAnalytics();
    } else if (choice === 'denied') {
      return;
    } else {
      showConsentBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
