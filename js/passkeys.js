/*
  Passkeys: sign in with Face ID, a fingerprint or the device's screen lock
  instead of an emailed code (the worker's /passkey/ endpoints).

  window.mt3ukPasskeys:
  - supported()                 this browser can use passkeys
  - signIn()                    -> Promise of { session, email }
  - autofill(onSignedIn)        offers the passkey in the keyboard bar or
                                the email box's suggestions, where supported
  - register(session)           adds a passkey for the signed-in member
  - list(session), remove(session, id)
  - deviceName()                "iPhone", "Android phone", "Mac" and so on
  - hasOnThisDevice() / markThisDevice()  remembered in this browser
*/
(function () {
  var API = 'https://late-darkness-ebc8.modtesla3uk.workers.dev';
  var DEVICE_KEY = 'mt3ukPasskeyHere';

  function toBytes(b64url) {
    var s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function toB64url(buffer) {
    var bytes = new Uint8Array(buffer);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function post(path, body, session) {
    var headers = { 'Content-Type': 'application/json' };
    if (session) headers['X-Session-Token'] = session;
    return fetch(API + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), cache: 'no-store' })
      .then(function (res) { return res.json(); });
  }

  // The browser's own messages are technical; these say what happened.
  function friendly(err) {
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return 'Cancelled, or no passkey was chosen.';
    if (name === 'InvalidStateError') return 'This device already has an MT3UK passkey.';
    if (name === 'SecurityError') return 'Passkeys only work on mt3uk.com.';
    return (err && err.message) || 'Something went wrong, please try again.';
  }

  function deviceName() {
    var ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/CrOS/.test(ua)) return 'Chromebook';
    if (/Linux/.test(ua)) return 'Linux computer';
    return 'This device';
  }

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // Browsers allow one passkey request at a time, so the button cancels
  // the background (keyboard bar) one first.
  var pending = null;
  function cancelAutofill() {
    if (pending) { try { pending.abort(); } catch (e) {} pending = null; }
  }

  function getOptions(o) {
    return { challenge: toBytes(o.challenge), rpId: o.rpId, userVerification: o.userVerification, allowCredentials: [], timeout: o.timeout };
  }

  function finishSignIn(cred) {
    return post('/passkey/login/verify', {
      id: toB64url(cred.rawId),
      response: {
        clientDataJSON: toB64url(cred.response.clientDataJSON),
        authenticatorData: toB64url(cred.response.authenticatorData),
        signature: toB64url(cred.response.signature)
      }
    }).then(function (data) {
      if (!data || !data.success) throw new Error((data && data.message) || 'That passkey didn\u2019t work.');
      window.mt3ukPasskeys.markThisDevice(true);
      return data;
    });
  }

  window.mt3ukPasskeys = {
    supported: function () {
      return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
    },
    deviceName: deviceName,
    hasOnThisDevice: function () { return read(DEVICE_KEY) === '1'; },
    markThisDevice: function (on) {
      try { if (on) localStorage.setItem(DEVICE_KEY, '1'); else localStorage.removeItem(DEVICE_KEY); } catch (e) {}
    },

    signIn: function () {
      cancelAutofill();
      return post('/passkey/login/options').then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || 'Could not start passkey sign-in.');
        return navigator.credentials.get({ publicKey: getOptions(data.publicKey) });
      }).then(finishSignIn).catch(function (err) { throw new Error(friendly(err)); });
    },

    // Passkey autofill: tapping an email box marked autocomplete="username
    // webauthn" offers the member's MT3UK passkey (the iPhone keyboard's
    // Passwords key, or the suggestions under the box). Picking it signs
    // them in. Quietly does nothing where the browser can't.
    autofill: function (onSignedIn) {
      var PKC = window.PublicKeyCredential;
      if (!PKC || typeof PKC.isConditionalMediationAvailable !== 'function' || typeof AbortController === 'undefined') return;
      PKC.isConditionalMediationAvailable().then(function (ok) {
        if (!ok) return;
        return post('/passkey/login/options').then(function (data) {
          if (!data || !data.success) return;
          cancelAutofill();
          var controller = new AbortController();
          pending = controller;
          return navigator.credentials.get({ mediation: 'conditional', publicKey: getOptions(data.publicKey), signal: controller.signal })
            .then(function (cred) {
              if (pending === controller) pending = null;
              return finishSignIn(cred);
            })
            .then(function (result) { if (onSignedIn) onSignedIn(result); });
        });
      }).catch(function () {});
    },

    register: function (session) {
      return post('/passkey/register/options', {}, session).then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || 'Could not start setting up a passkey.');
        var o = data.publicKey;
        return navigator.credentials.create({
          publicKey: {
            challenge: toBytes(o.challenge),
            rp: o.rp,
            user: { id: toBytes(o.user.id), name: o.user.name, displayName: o.user.displayName },
            pubKeyCredParams: o.pubKeyCredParams,
            authenticatorSelection: o.authenticatorSelection,
            excludeCredentials: (o.excludeCredentials || []).map(function (c) { return { type: 'public-key', id: toBytes(c.id) }; }),
            attestation: o.attestation,
            timeout: o.timeout
          }
        });
      }).then(function (cred) {
        return post('/passkey/register/verify', {
          id: toB64url(cred.rawId),
          name: deviceName(),
          response: {
            clientDataJSON: toB64url(cred.response.clientDataJSON),
            attestationObject: toB64url(cred.response.attestationObject)
          }
        }, session);
      }).then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || 'The passkey could not be set up.');
        window.mt3ukPasskeys.markThisDevice(true);
        return data;
      }).catch(function (err) { throw new Error(friendly(err)); });
    },

    list: function (session) {
      return fetch(API + '/passkey/list', { headers: { 'X-Session-Token': session }, cache: 'no-store' })
        .then(function (res) { return res.json(); });
    },

    remove: function (session, id) {
      return post('/passkey/delete', { id: id }, session);
    }
  };
})();
