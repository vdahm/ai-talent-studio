import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dxtvsavrezicbucysrdy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JDhkLGz75sgOYaxdGh2SOw_CrlgOGUS';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

window.talentStudioSupabase = supabase;

const STATE_KEYS = [
  'vd.studio.brand',
  'vd.studio.enrichmentQuota',
  'vd.studio.george.conversation',
  'vd.studio.processStep',
  'vd.studio.review',
  'vd.studio.stageReview.v2'
];

let currentUser = null;
let saveTimer = null;
let internalWrite = false;

function snapshotState() {
  const out = {};
  for (const key of STATE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

async function saveWorkspaceState() {
  if (!currentUser || internalWrite) return;
  const state = snapshotState();
  const { error } = await supabase
    .from('workspace_state')
    .upsert({ owner_user_id: currentUser.id, state }, { onConflict: 'owner_user_id' });
  if (error) console.warn('Workspace sync failed:', error.message);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorkspaceState, 650);
}

const originalSetItem = localStorage.setItem.bind(localStorage);
const originalRemoveItem = localStorage.removeItem.bind(localStorage);

localStorage.setItem = function(key, value) {
  originalSetItem(key, value);
  if (STATE_KEYS.includes(String(key))) scheduleSave();
};

localStorage.removeItem = function(key) {
  originalRemoveItem(key);
  if (STATE_KEYS.includes(String(key))) scheduleSave();
};

async function restoreWorkspaceState(user) {
  const marker = 'talent-studio-restored:' + user.id;
  if (sessionStorage.getItem(marker) === '1') return;

  const { data, error } = await supabase
    .from('workspace_state')
    .select('state')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('Workspace restore failed:', error.message);
    return;
  }

  if (!data?.state || Object.keys(data.state).length === 0) {
    await saveWorkspaceState();
    sessionStorage.setItem(marker, '1');
    return;
  }

  let changed = false;
  internalWrite = true;
  try {
    for (const [key, value] of Object.entries(data.state)) {
      if (!STATE_KEYS.includes(key)) continue;
      if (typeof value !== 'string') continue;
      if (localStorage.getItem(key) !== value) {
        originalSetItem(key, value);
        changed = true;
      }
    }
  } finally {
    internalWrite = false;
  }

  sessionStorage.setItem(marker, '1');
  if (changed) location.reload();
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #liveAuthOverlay{position:fixed;inset:0;z-index:99999;background:rgba(249,249,249,.98);display:grid;place-items:center;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #liveAuthOverlay.hidden{display:none}
    .live-auth-card{width:min(430px,calc(100vw - 36px));background:#fff;border:1px solid #e1e4e7;border-radius:24px;box-shadow:0 24px 70px rgba(28,45,74,.12);padding:28px}
    .live-auth-card .eyebrow{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#B94D3A;font-weight:700}
    .live-auth-card h1{margin:8px 0 6px;color:#1C2D4A;font-size:28px;letter-spacing:-1px}
    .live-auth-card p{margin:0 0 20px;color:#66727c;font-size:12px;line-height:1.65}
    .live-auth-card label{display:block;font-size:10px;font-weight:650;color:#45515c;margin:12px 0 6px}
    .live-auth-card input{width:100%;box-sizing:border-box;border:1px solid #dfe3e7;border-radius:12px;padding:12px 13px;font:inherit;font-size:13px;outline:none}
    .live-auth-card input:focus{border-color:#B94D3A;box-shadow:0 0 0 3px rgba(185,77,58,.08)}
    .live-auth-actions{display:flex;gap:9px;margin-top:18px}
    .live-auth-actions button{flex:1;border:0;border-radius:12px;padding:11px 13px;font-size:11px;font-weight:700;cursor:pointer}
    .live-auth-primary{background:#1C2D4A;color:#fff}
    .live-auth-secondary{background:#f2f4f6;color:#45515c}
    #liveAuthStatus{min-height:18px;margin-top:12px;font-size:10px;color:#7a858e;line-height:1.5}
    #liveUserChip{position:fixed;top:13px;right:calc(var(--george-width,390px) + 18px);z-index:97;background:#fff;border:1px solid #dfe3e7;border-radius:999px;padding:7px 9px 7px 11px;display:none;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(28,45,74,.06);font-size:9px;color:#66727c}
    #liveUserChip button{border:0;background:#f2f4f6;color:#4d5963;border-radius:999px;padding:5px 8px;font-size:9px;cursor:pointer}
    @media(max-width:900px){#liveUserChip{right:calc(var(--george-width,330px) + 8px)}}
  `;
  document.head.appendChild(style);
}

function injectAuthUi() {
  const overlay = document.createElement('div');
  overlay.id = 'liveAuthOverlay';
  overlay.innerHTML = `
    <div class="live-auth-card">
      <div class="eyebrow">AI Talent Studio · Live</div>
      <h1>Sign in</h1>
      <p>Your searches, feedback, George conversations and workflow state are stored securely in Supabase.</p>
      <label for="liveEmail">Email</label>
      <input id="liveEmail" type="email" autocomplete="email" placeholder="name@company.com">
      <label for="livePassword">Password</label>
      <input id="livePassword" type="password" autocomplete="current-password" placeholder="Password">
      <div class="live-auth-actions">
        <button id="liveSignIn" class="live-auth-primary" type="button">Sign in</button>
        <button id="liveSignUp" class="live-auth-secondary" type="button">Create account</button>
      </div>
      <div id="liveAuthStatus"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const chip = document.createElement('div');
  chip.id = 'liveUserChip';
  chip.innerHTML = '<span id="liveUserEmail"></span><button id="liveSignOut" type="button">Sign out</button>';
  document.body.appendChild(chip);

  document.getElementById('liveSignIn').addEventListener('click', async () => {
    await submitAuth('signin');
  });
  document.getElementById('liveSignUp').addEventListener('click', async () => {
    await submitAuth('signup');
  });
  document.getElementById('liveSignOut').addEventListener('click', async () => {
    await saveWorkspaceState();
    sessionStorage.clear();
    await supabase.auth.signOut();
  });

  document.getElementById('livePassword').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') await submitAuth('signin');
  });
}

function setAuthStatus(message, isError=false) {
  const el = document.getElementById('liveAuthStatus');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? '#B94D3A' : '#6f7a84';
}

async function submitAuth(mode) {
  const email = document.getElementById('liveEmail').value.trim();
  const password = document.getElementById('livePassword').value;
  if (!email || !password) {
    setAuthStatus('Enter email and password.', true);
    return;
  }
  setAuthStatus(mode === 'signup' ? 'Creating account…' : 'Signing in…');

  const result = mode === 'signup'
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password });

  if (result.error) {
    setAuthStatus(result.error.message, true);
    return;
  }

  if (mode === 'signup' && !result.data.session) {
    setAuthStatus('Account created. Check your email to confirm the address, then sign in.');
  } else {
    setAuthStatus('Signed in.');
  }
}

async function applySession(session) {
  const overlay = document.getElementById('liveAuthOverlay');
  const chip = document.getElementById('liveUserChip');
  currentUser = session?.user ?? null;

  if (!currentUser) {
    overlay?.classList.remove('hidden');
    if (chip) chip.style.display = 'none';
    return;
  }

  overlay?.classList.add('hidden');
  if (chip) chip.style.display = 'flex';
  const email = document.getElementById('liveUserEmail');
  if (email) email.textContent = currentUser.email || 'Signed in';
  await restoreWorkspaceState(currentUser);
}

injectStyles();
injectAuthUi();

const { data: { session } } = await supabase.auth.getSession();
await applySession(session);

supabase.auth.onAuthStateChange(async (_event, nextSession) => {
  await applySession(nextSession);
});

window.addEventListener('beforeunload', () => {
  if (currentUser) saveWorkspaceState();
});


/* George realtime speech-to-speech voice chat.
   The long-lived OpenAI API key stays server-side in the Supabase Edge Function.
   The browser only receives a short-lived Realtime client secret. */
class GeorgeRealtimeVoice {
  constructor() {
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.audio = null;
    this.active = false;
    this.connecting = false;
    this.inputItemsSeen = new Set();
    this.outputItemsSeen = new Set();
  }

  button() {
    return document.getElementById('georgeSpeak');
  }

  george() {
    return window.talentStudioGeorge || null;
  }

  add(who, text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    const george = this.george();
    if (george?.addMessage) {
      george.addMessage(who, clean, george.getContext?.().title || 'George voice');
    }
  }

  setButtonState(state, label) {
    const button = this.button();
    if (!button) return;
    button.dataset.voiceState = state;
    button.classList.toggle('listening', state === 'live' || state === 'connecting');
    const span = button.querySelector('span');
    if (span) span.textContent = label;
    button.title = state === 'live' ? 'End conversation with George' : 'Speak with George';
  }

  contextSnapshot() {
    const george = this.george();
    if (!george?.contextSnapshot) {
      return {
        context: { title: 'AI Talent Studio' },
        note: 'No structured application context was exposed.'
      };
    }
    return george.contextSnapshot();
  }

  async getRealtimeToken() {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData?.session) {
      throw new Error('Please sign in before starting Speak with George.');
    }

    const { data, error } = await supabase.functions.invoke('realtime-token', {
      body: { context: this.contextSnapshot() }
    });

    if (error) {
      let message = error.message || 'Could not start George voice.';
      try {
        const details = await error.context?.json?.();
        if (details?.error) message = details.error;
        if (details?.details) message += ' ' + details.details;
      } catch {}
      throw new Error(message);
    }

    if (!data?.value) {
      throw new Error(data?.error || 'No Realtime client secret was returned.');
    }
    return data.value;
  }

  handleServerEvent(event) {
    if (!event || typeof event !== 'object') return;

    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const key = event.item_id || event.event_id;
      if (key && this.inputItemsSeen.has(key)) return;
      if (key) this.inputItemsSeen.add(key);
      if (event.transcript) this.add('user', event.transcript);
      return;
    }

    if (event.type === 'response.output_audio_transcript.done') {
      const key = event.item_id || event.response_id || event.event_id;
      if (key && this.outputItemsSeen.has(key)) return;
      if (key) this.outputItemsSeen.add(key);
      if (event.transcript) this.add('assistant', event.transcript);
      return;
    }

    if (event.type === 'response.done') {
      const response = event.response;
      if (response?.status && response.status !== 'completed' && response.status !== 'cancelled') {
        const reason = response?.status_details?.error?.message || response?.status_details?.reason;
        if (reason) this.add('assistant', 'Voice session notice: ' + reason);
      }
      return;
    }

    if (event.type === 'error') {
      const message = event.error?.message || 'Realtime voice returned an error.';
      console.warn('George Realtime error:', event);
      this.add('assistant', message);
    }
  }

  async start() {
    if (this.active || this.connecting) return;
    this.connecting = true;
    this.setButtonState('connecting', 'Connecting…');

    try {
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Realtime voice needs a modern browser with WebRTC and microphone access.');
      }

      const ephemeralKey = await this.getRealtimeToken();

      const pc = new RTCPeerConnection();
      this.pc = pc;

      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      this.audio = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.stream = stream;
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;

      dc.addEventListener('message', (event) => {
        try {
          this.handleServerEvent(JSON.parse(event.data));
        } catch (error) {
          console.warn('Could not parse George Realtime event:', error);
        }
      });

      dc.addEventListener('open', () => {
        this.active = true;
        this.connecting = false;
        this.setButtonState('live', 'End George');
        this.add('assistant', 'Voice conversation started. I am listening in the current context.');
      });

      dc.addEventListener('close', () => {
        if (this.active || this.connecting) this.stop(false);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: 'Bearer ' + ephemeralKey,
          'Content-Type': 'application/sdp'
        }
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error('OpenAI Realtime connection failed (' + response.status + '): ' + detail.slice(0, 240));
      }

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: await response.text()
      });
    } catch (error) {
      console.error('Speak with George failed:', error);
      this.add('assistant', error?.message || 'Speak with George could not be started.');
      this.stop(false);
    }
  }

  stop(addMessage = true) {
    const wasActive = this.active || this.connecting;
    this.active = false;
    this.connecting = false;

    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    try {
      this.stream?.getTracks()?.forEach((track) => track.stop());
    } catch {}
    try {
      if (this.audio) {
        this.audio.pause();
        this.audio.srcObject = null;
        this.audio.remove();
      }
    } catch {}

    this.dc = null;
    this.pc = null;
    this.stream = null;
    this.audio = null;
    this.inputItemsSeen.clear();
    this.outputItemsSeen.clear();
    this.setButtonState('idle', 'Speak with George');

    if (addMessage && wasActive) {
      this.add('assistant', 'Voice conversation ended.');
    }
  }

  async toggle() {
    if (this.active || this.connecting) {
      this.stop(true);
    } else {
      await this.start();
    }
  }
}

const georgeRealtimeVoice = new GeorgeRealtimeVoice();
window.georgeRealtimeVoice = georgeRealtimeVoice;

function bindGeorgeRealtimeButton() {
  const button = document.getElementById('georgeSpeak');
  if (!button || button.dataset.realtimeBound === '1') return;
  button.dataset.realtimeBound = '1';
  button.addEventListener('click', async (event) => {
    // Capture phase prevents the old browser speech-recognition demo handler
    // from also firing on the same button.
    event.preventDefault();
    event.stopImmediatePropagation();
    await georgeRealtimeVoice.toggle();
  }, true);
  georgeRealtimeVoice.setButtonState('idle', 'Speak with George');
}

bindGeorgeRealtimeButton();
new MutationObserver(bindGeorgeRealtimeButton).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('beforeunload', () => georgeRealtimeVoice.stop(false));
