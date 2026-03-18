// ==UserScript==
// @name         Century Tech Solver
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Auto-solver for Century Tech
// @author       Funguy
// @match        https://app.century.tech/*
// @match        https://learn.century.tech/*
// @match        https://*.century.tech/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=century.tech
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      omlxbycxdxfnwmamkbcb.supabase.co
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      api.anthropic.com
// @connect      api.ocr.space
// @connect      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/FergusNallyy/stub-update/main/stub.js
// @downloadURL  https://raw.githubusercontent.com/FergusNallyy/stub-update/main/stub.js
// ==/UserScript==

(function () {
   'use strict';

   // ============================================================
   //  SUPABASE CONFIG
   // ============================================================
   const SUPABASE_URL = 'https://omlxbycxdxfnwmamkbcb.supabase.co';
   const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tbHhieWN4ZHhmbndtYW1rYmNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTk2MTcsImV4cCI6MjA4ODk5NTYxN30.KzCKA0AU62qKl8WSkBAWlH0WYppbxpJPXIyx5gLN-Vs';

   // ============================================================
   //  GITHUB PAYLOAD CONFIG — fill these in
   // ============================================================
   const GITHUB_USER = 'FergusNally';
   const GITHUB_REPO = 'century-tech-validation';
   const GITHUB_FILE = 'payload.js';          // path inside repo
   const GITHUB_BRANCH = 'main';

   // ============================================================
   //  ENCRYPTION  (same key as main script — do not change)
   // ============================================================
   const ENC_KEY_BYTES = new Uint8Array([
      0xa3, 0xf8, 0xc2, 0xe1, 0xd4, 0xb7, 0x65, 0x09,
      0xf1, 0xe2, 0x83, 0xa0, 0xc5, 0xd9, 0x4b, 0x2e,
      0x7f, 0x61, 0x08, 0x34, 0xa9, 0xd2, 0xc5, 0xe0,
      0xb1, 0xf3, 0x84, 0x72, 0x96, 0xa0, 0xd5, 0xe3
   ]);

   async function getEncKey() {
      return crypto.subtle.importKey(
         'raw', ENC_KEY_BYTES, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
      );
   }

   async function decryptText(ciphertext) {
      try {
         const key = await getEncKey();
         const [ivB64, dataB64] = ciphertext.split(':');
         const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
         const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64(ivB64) },
            key,
            fromB64(dataB64)
         );
         return new TextDecoder().decode(decrypted);
      } catch { return null; }
   }

   // ============================================================
   //  HWID
   // ============================================================
   function getHWID() {
      const raw = [
         navigator.userAgent, navigator.language,
         screen.width, screen.height,
         Intl.DateTimeFormat().resolvedOptions().timeZone
      ].join('|');
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
      return 'HWID-' + Math.abs(h).toString(16).toUpperCase();
   }

   // ============================================================
   //  SUPABASE HELPERS
   // ============================================================
   function supabaseGet(url) {
      return new Promise((resolve, reject) => {
         GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers: {
               'apikey': SUPABASE_ANON,
               'Authorization': `Bearer ${SUPABASE_ANON}`
            },
            onload: res => {
               try { resolve(JSON.parse(res.responseText)); }
               catch { reject(new Error('Bad JSON from Supabase')); }
            },
            onerror: () => reject(new Error('Supabase network error'))
         });
      });
   }

   function supabasePatch(url, data) {
      return new Promise((resolve, reject) => {
         GM_xmlhttpRequest({
            method: 'PATCH',
            url,
            headers: {
               'apikey': SUPABASE_ANON,
               'Authorization': `Bearer ${SUPABASE_ANON}`,
               'Content-Type': 'application/json',
               'Prefer': 'return=minimal'
            },
            data: JSON.stringify(data),
            onload: resolve,
            onerror: () => reject(new Error('Supabase patch error'))
         });
      });
   }

   // ============================================================
   //  LICENCE VALIDATION  — returns { valid, row } or throws
   // ============================================================
   async function validateLicence(key) {
      const hwid = getHWID();
      const encoded = encodeURIComponent(key.trim());

      const rows = await supabaseGet(
         `${SUPABASE_URL}/rest/v1/licence_keys?key=eq.${encoded}&active=eq.true` +
         `&select=key,hwid,github_pat,"anthropic key",gemini,"groq key"`
      );

      if (!Array.isArray(rows) || rows.length === 0) return { valid: false };
      const row = rows[0];

      if (row.hwid && row.hwid !== hwid) return { valid: 'locked' };

      // Lock to this machine if not yet locked
      if (!row.hwid) {
         await supabasePatch(
            `${SUPABASE_URL}/rest/v1/licence_keys?key=eq.${encoded}`,
            { hwid }
         ).catch(() => { }); // non-fatal
      }

      return { valid: true, row };
   }

   // ============================================================
   //  GITHUB PAYLOAD FETCH
   // ============================================================
   function fetchPayload(pat) {
      return new Promise((resolve, reject) => {
         GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`,
            headers: {
               'Authorization': `Bearer ${pat}`,
               'Accept': 'application/vnd.github.raw+json',
               'X-GitHub-Api-Version': '2022-11-28'
            },
            timeout: 15000,
            onload: res => {
               if (res.status === 200) {
                  resolve(res.responseText);
               } else if (res.status === 401 || res.status === 403) {
                  reject(new Error('GitHub auth failed — PAT may be expired'));
               } else if (res.status === 404) {
                  reject(new Error('Payload file not found in repo'));
               } else {
                  reject(new Error(`GitHub HTTP ${res.status}`));
               }
            },
            onerror: () => reject(new Error('GitHub network error')),
            ontimeout: () => reject(new Error('GitHub fetch timed out'))
         });
      });
   }

   // ============================================================
   //  ERROR SCREEN  (shown on any fatal failure — no bypass)
   // ============================================================
   function showError(message) {
      // Remove licence gate if still showing
      document.getElementById('ct-licence-gate')?.remove();

      const el = document.createElement('div');
      el.id = 'ct-error-screen';
      el.innerHTML = `
         <style>
            #ct-error-screen {
               position: fixed; inset: 0; z-index: 999999;
               background: rgba(0,0,0,0.92); display: flex;
               align-items: center; justify-content: center;
               font-family: system-ui, sans-serif;
            }
            #ct-error-box {
               background: #111113; border-radius: 10px; padding: 28px;
               width: 360px; box-shadow: 0 8px 40px rgba(0,0,0,0.7),
               0 0 0 1px rgba(255,255,255,0.07); text-align: center;
            }
            #ct-error-box h2 { margin: 0 0 8px; font-size: 15px; color: #f87171; font-weight: 700; }
            #ct-error-box p  { margin: 0; font-size: 12px; color: #71717a; line-height: 1.6; }
         </style>
         <div id="ct-error-box">
            <h2>Century Tech Solver — Failed to load</h2>
            <p>${message}</p>
         </div>
      `;
      document.body.appendChild(el);
   }

   // ============================================================
   //  LICENCE GATE UI
   // ============================================================
   function showLicenceGate(onValidated) {
      const existing = document.getElementById('ct-licence-gate');
      if (existing) existing.remove();

      const gate = document.createElement('div');
      gate.id = 'ct-licence-gate';
      gate.innerHTML = `
         <style>
            #ct-licence-gate {
               position: fixed; inset: 0; z-index: 999999;
               background: rgba(0,0,0,0.85); display: flex;
               align-items: center; justify-content: center;
               font-family: system-ui, sans-serif;
            }
            #ct-licence-box {
               background: #111113; border-radius: 10px; padding: 28px 28px 24px;
               width: 340px; box-shadow: 0 8px 40px rgba(0,0,0,0.7),
               0 0 0 1px rgba(255,255,255,0.07); text-align: center;
            }
            #ct-licence-box h2 { margin: 0 0 4px; font-size: 15px; color: #fafafa; font-weight: 700; }
            #ct-licence-box p  { margin: 0 0 18px; font-size: 12px; color: #71717a; }
            #ct-licence-input {
               width: 100%; background: #18181b; color: #d4d4d8;
               border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
               padding: 9px 12px; font-size: 13px; box-sizing: border-box;
               outline: none; text-align: center; letter-spacing: 1px; margin-bottom: 10px;
            }
            #ct-licence-input:focus { border-color: rgba(59,130,246,0.5); }
            #ct-licence-input::placeholder { color: #3f3f46; letter-spacing: 0; }
            #ct-licence-submit {
               width: 100%; padding: 9px; border: none; border-radius: 6px;
               background: #22c55e; color: #052e16; font-size: 13px;
               font-weight: 700; cursor: pointer; margin-bottom: 10px;
            }
            #ct-licence-submit:disabled { opacity: 0.5; cursor: not-allowed; }
            #ct-licence-msg { font-size: 11px; min-height: 16px; }
            #ct-licence-msg.error { color: #f87171; }
            #ct-licence-msg.info  { color: #60a5fa; }
            #ct-licence-msg.ok    { color: #4ade80; }
         </style>
         <div id="ct-licence-box">
            <h2>Century Tech Solver</h2>
            <p>Enter your licence key to continue</p>
            <input id="ct-licence-input" type="text" placeholder="XXXX-XXXX-XXXX-XXXX"
                   spellcheck="false" autocomplete="off">
            <button id="ct-licence-submit">Activate</button>
            <div id="ct-licence-msg"></div>
         </div>
      `;
      document.body.appendChild(gate);

      const input = document.getElementById('ct-licence-input');
      const btn = document.getElementById('ct-licence-submit');
      const msg = document.getElementById('ct-licence-msg');

      async function attempt() {
         const key = input.value.trim();
         if (!key) { msg.className = 'error'; msg.textContent = 'Please enter a key.'; return; }
         btn.disabled = true;
         msg.className = 'info'; msg.textContent = 'Checking…';
         try {
            const result = await validateLicence(key);
            if (result.valid === true) {
               GM_setValue('licence_key', key);
               msg.className = 'ok'; msg.textContent = '✓ Activated!';
               setTimeout(() => { gate.remove(); onValidated(result.row); }, 800);
            } else if (result.valid === 'locked') {
               msg.className = 'error';
               msg.textContent = 'Key is locked to another device. Contact support to reset.';
               btn.disabled = false;
               input.select();
            } else {
               msg.className = 'error'; msg.textContent = 'Invalid or inactive key.';
               btn.disabled = false;
               input.select();
            }
         } catch {
            msg.className = 'error'; msg.textContent = 'Could not reach server. Check your connection.';
            btn.disabled = false;
         }
      }

      btn.addEventListener('click', attempt);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
      input.focus();
   }

   // ============================================================
   //  BOOT SEQUENCE
   // ============================================================
   async function boot(row) {
      // 1. Decrypt GitHub PAT from Supabase row
      if (!row.github_pat) {
         showError('No GitHub token found on licence. Contact support.');
         return;
      }
      const pat = await decryptText(row.github_pat);
      if (!pat) {
         showError('Failed to decrypt GitHub token. Contact support.');
         return;
      }

      // 2. Fetch payload from private GitHub repo
      let payloadCode;
      try {
         payloadCode = await fetchPayload(pat);
      } catch (e) {
         showError(`Failed to load solver: ${e.message}`);
         return;
      }

      // 3. Pass GM functions and the Supabase row into the payload explicitly
      //    The payload receives these as arguments so it doesn't rely on globals
      try {
         const payloadFn = new Function(
            'GM_xmlhttpRequest',
            'GM_setValue',
            'GM_getValue',
            'html2canvas',
            'supabaseRow',
            payloadCode
         );
         payloadFn(GM_xmlhttpRequest, GM_setValue, GM_getValue, html2canvas, row);
      } catch (e) {
         showError(`Solver failed to initialise: ${e.message}`);
         console.error('[Century] Payload error:', e);
      }
   }

   // ============================================================
   //  ENTRY POINT
   // ============================================================
   async function init() {
      const savedKey = GM_getValue('licence_key', '');

      if (savedKey) {
         // Re-validate on every load — enables revocation and HWID enforcement
         try {
            const result = await validateLicence(savedKey);
            if (result.valid === true) {
               await boot(result.row);
            } else {
               // Key revoked or HWID mismatch — clear and show gate
               GM_setValue('licence_key', '');
               showLicenceGate(row => boot(row));
            }
         } catch {
            // Network failure — block. No offline bypass.
            showError('Could not reach licence server. Check your connection.');
         }
      } else {
         showLicenceGate(row => boot(row));
      }
   }

   const checkReady = setInterval(() => {
      if (document.body) {
         clearInterval(checkReady);
         setTimeout(init, 1500);
      }
   }, 100);

})();
