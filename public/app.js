/* COMUNICA+ — cliente web (Painel Operacional + Push-to-Talk).
 * Sem frameworks: só o cliente Socket.IO (servido pelo backend) + APIs do navegador.
 */
(() => {
  'use strict';

  // ----------------------------------------------------------------------- //
  // Estado
  // ----------------------------------------------------------------------- //
  const state = {
    user: JSON.parse(localStorage.getItem('comunica_user') || 'null'),
    token: localStorage.getItem('comunica_token') || null,
    channels: [],
    activeChannel: null,
    priority: 'rotina',
    socket: null,
    transmitting: false,
    mediaRecorder: null,
    chunks: [],
    recognition: null,
    liveTranscript: '',
    startedAt: null,
    activeSpeakers: {}, // channelId -> speaker
    // WebRTC (voz ao vivo)
    socketId: null,
    localStream: null, // MediaStream do microfone durante a fala
    isSpeaker: false,
    peers: {}, // socketId remoto -> RTCPeerConnection
  };

  const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const PRIORITY_EMOJI = { rotina: '🟢', importante: '🟡', urgente: '🟠', emergencia: '🔴' };

  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    setTimeout(() => t.classList.add('hidden'), 3200);
  }

  async function api(path, opts) {
    const headers = { 'Content-Type': 'application/json', ...(opts && opts.headers) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) { doLogout(); throw new Error('Sessão expirada. Entre novamente.'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Erro na requisição');
    }
    return res.json();
  }

  function setSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem('comunica_token', token);
    localStorage.setItem('comunica_user', JSON.stringify(user));
  }

  function doLogout() {
    localStorage.removeItem('comunica_token');
    localStorage.removeItem('comunica_user');
    location.reload();
  }

  // ----------------------------------------------------------------------- //
  // Autenticação (login + cadastro com senha e papel)
  // ----------------------------------------------------------------------- //
  let authMode = 'login'; // 'login' | 'register'

  function authError(msg) {
    const box = $('#auth-error');
    if (!msg) return box.classList.add('hidden');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  async function initAuth() {
    const [sectors, roles] = await Promise.all([api('/api/users/sectors'), api('/api/users/roles')]);
    $('#reg-sector').innerHTML = sectors.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
    $('#reg-role').innerHTML = roles.map((r) => `<option value="${r.key}">${esc(r.label)}</option>`).join('');

    const setMode = (mode) => {
      authMode = mode;
      $('#tab-login').classList.toggle('active', mode === 'login');
      $('#tab-register').classList.toggle('active', mode === 'register');
      $('#register-fields').classList.toggle('hidden', mode !== 'register');
      $('#auth-btn').textContent = mode === 'login' ? 'Entrar no rádio' : 'Cadastrar e entrar';
      $('#auth-password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
      authError('');
    };
    $('#tab-login').addEventListener('click', () => setMode('login'));
    $('#tab-register').addEventListener('click', () => setMode('register'));

    const submit = async () => {
      authError('');
      const login = $('#auth-login').value.trim();
      const password = $('#auth-password').value;
      if (!login || !password) return authError('Informe login e senha.');
      try {
        let result;
        if (authMode === 'login') {
          result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
        } else {
          const name = $('#reg-name').value.trim();
          if (!name) return authError('Informe seu nome.');
          result = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, sector: $('#reg-sector').value, role: $('#reg-role').value, login, password }),
          });
        }
        setSession(result.token, result.user);
        enterApp();
      } catch (e) {
        authError(e.message);
      }
    };
    $('#auth-btn').addEventListener('click', submit);
    $('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  $('#logout-btn').addEventListener('click', doLogout);

  // ----------------------------------------------------------------------- //
  // Entrada no app
  // ----------------------------------------------------------------------- //
  const ROLE_LABELS = { admin: 'Admin', diretor: 'Direção', coordenador: 'Coordenador', operador: 'Operador' };

  async function enterApp() {
    $('#login').classList.add('hidden');
    $('#user-chip').innerHTML =
      `${esc(state.user.name)}<span class="role-badge">${esc(ROLE_LABELS[state.user.role] || state.user.role)}</span>`;
    await loadChannels();
    await refreshOccurrences();
    await refreshStats();
    connectSocket();
    setupPriorityPicker();
    setupPtt();
    setupSearch();
    setupTextFallback();
  }

  // ----------------------------------------------------------------------- //
  // Canais
  // ----------------------------------------------------------------------- //
  async function loadChannels() {
    state.channels = await api('/api/channels');
    renderChannels();
    // Seleciona o primeiro canal por padrão.
    if (!state.activeChannel && state.channels.length) selectChannel(state.channels[0]);
  }

  function renderChannels() {
    const list = $('#channel-list');
    list.innerHTML = '';
    for (const ch of state.channels) {
      const li = el('li');
      if (state.activeChannel && ch.id === state.activeChannel.id) li.classList.add('active');
      const speaker = state.activeSpeakers[ch.id];
      li.innerHTML =
        `<span class="ch-name">${esc(ch.name)}</span>` +
        (speaker ? `<span class="live">no ar</span>` : '');
      li.addEventListener('click', () => selectChannel(ch));
      list.appendChild(li);
    }
  }

  function selectChannel(ch) {
    state.activeChannel = ch;
    $('#active-channel-name').textContent = ch.name;
    $('#active-channel-desc').textContent = ch.description || '';
    $('#feed-channel-tag').textContent = ch.name;
    $('#ptt').disabled = false;
    renderChannels();
    if (state.socket) state.socket.emit('join_channel', { channelId: ch.id }, (ack) => {
      if (ack && ack.activeSpeaker) showTalkBanner(ack.activeSpeaker);
      else hideTalkBanner();
    });
    loadFeed();
  }

  async function loadFeed() {
    if (!state.activeChannel) return;
    const txs = await api(`/api/transmissions?channelId=${state.activeChannel.id}&limit=30`);
    renderFeed(txs);
  }

  // ----------------------------------------------------------------------- //
  // Feed de transmissões
  // ----------------------------------------------------------------------- //
  function renderFeed(txs) {
    const feed = $('#feed');
    feed.innerHTML = '';
    if (!txs.length) { feed.appendChild(el('div', 'empty', 'Nenhuma transmissão neste canal ainda.')); return; }
    for (const tx of txs) feed.appendChild(renderTxCard(tx));
  }

  function renderTxCard(tx) {
    const card = el('div', `tx-card prio-${tx.priority}`);
    const kw = (tx.keywords || []).map((k) => `<span class="kw">${esc(k)}</span>`).join('');
    card.innerHTML = `
      <div class="tx-head">
        <span class="tx-who">${PRIORITY_EMOJI[tx.priority] || ''} ${esc(tx.userName)}</span>
        <span class="tx-meta">${esc(tx.channelName)} · ${fmtTime(tx.startedAt)}</span>
      </div>
      <div class="tx-transcript">${esc(tx.transcript)}</div>
      <div class="tx-summary"><span class="summary-label">Resumo IA:</span>\n${esc(tx.summary)}</div>
      ${kw ? `<div class="tx-keywords">${kw}</div>` : ''}
      <div class="tx-actions">
        ${tx.audioPath ? `<button data-play="${tx.id}">▶ Reproduzir</button>` : '<span class="tx-meta">sem áudio</span>'}
        <button data-receipt="${tx.id}">✓ Confirmar escuta</button>
        <span class="receipt-info" data-receipt-info="${tx.id}"></span>
      </div>`;
    const playBtn = card.querySelector(`[data-play]`);
    if (playBtn) playBtn.addEventListener('click', () => playTransmissionAudio(tx.id));
    card.querySelector('[data-receipt]').addEventListener('click', async () => {
      try {
        await api(`/api/transmissions/${tx.id}/receipts`, {
          method: 'POST', body: JSON.stringify({ userId: state.user.id, type: 'escutado' }),
        });
        loadReceiptInfo(tx.id, card);
        toast('Escuta confirmada.');
      } catch (e) { toast(e.message); }
    });
    loadReceiptInfo(tx.id, card);
    return card;
  }

  async function loadReceiptInfo(txId, card) {
    try {
      const receipts = await api(`/api/transmissions/${txId}/receipts`);
      const span = card.querySelector(`[data-receipt-info="${txId}"]`);
      if (span) span.textContent = receipts.length ? `${receipts.length} confirmação(ões)` : '';
    } catch { /* silencioso */ }
  }

  // Reprodução do áudio protegido: busca com o token e toca via object URL.
  async function playTransmissionAudio(txId) {
    try {
      const res = await fetch(`/api/transmissions/${txId}/audio`, {
        headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      toast('Não foi possível reproduzir o áudio.');
    }
  }

  // ----------------------------------------------------------------------- //
  // Prioridade
  // ----------------------------------------------------------------------- //
  function setupPriorityPicker() {
    const picker = $('#priority-picker');
    const buttons = picker.querySelectorAll('.prio');
    const select = (p) => {
      state.priority = p;
      buttons.forEach((b) => b.classList.toggle('selected', b.dataset.priority === p));
    };
    buttons.forEach((b) => b.addEventListener('click', () => select(b.dataset.priority)));
    select('rotina');
  }

  // ----------------------------------------------------------------------- //
  // Push-to-Talk
  // ----------------------------------------------------------------------- //
  function pickMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    if (typeof MediaRecorder === 'undefined') return '';
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
  }

  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + ' ';
        else interim += t;
      }
      if (finalText) state.liveTranscript += finalText;
      $('#live-transcript-text').textContent = (state.liveTranscript + interim).trim() || '—';
    };
    rec.onerror = () => {};
    try { rec.start(); return rec; } catch { return null; }
  }

  async function startTransmit() {
    if (state.transmitting || !state.activeChannel) return;
    // Reserva o canal (respeita ocupação/prioridade no servidor).
    const ack = await emitAsync('ptt_start', { channelId: state.activeChannel.id, priority: state.priority });
    if (!ack || !ack.ok) {
      if (ack && ack.denied) {
        const sp = ack.activeSpeaker;
        toast(`Canal ocupado — ${sp ? sp.userName : 'alguém'} está no ar.`);
      } else {
        toast((ack && ack.error) || 'Não foi possível iniciar a transmissão.');
      }
      return;
    }

    state.transmitting = true;
    state.isSpeaker = true;
    state.liveTranscript = '';
    state.startedAt = ack.startedAt || new Date().toISOString();
    $('#live-transcript-text').textContent = '—';
    const ptt = $('#ptt');
    ptt.classList.add('transmitting');
    ptt.querySelector('.ptt-label').textContent = 'Transmitindo…';

    // Captura de áudio: o MESMO stream alimenta o WebRTC (voz ao vivo) e o
    // MediaRecorder (gravação para o registro permanente).
    state.chunks = [];
    state.localStream = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.localStream = stream;
      // Conecta ouvintes que já anunciaram interesse (podem ter chegado antes do stream).
      (state._pendingJoins || []).forEach((id) => speakerConnectTo(id));
      state._pendingJoins = [];
      const mime = pickMime();
      try {
        state.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        state.mediaRecorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
        state.mediaRecorder.start();
      } catch {
        state.mediaRecorder = null; // sem gravação; a voz ao vivo ainda funciona
      }
    } catch {
      state.mediaRecorder = null; // sem microfone; segue só com transcrição/texto
    }
    state.recognition = startRecognition();
  }

  async function stopTransmit(cancel) {
    if (!state.transmitting) return;
    state.transmitting = false;
    state.isSpeaker = false;
    const ptt = $('#ptt');
    ptt.classList.remove('transmitting');
    ptt.querySelector('.ptt-label').textContent = 'Segure para falar';

    // Encerra a voz ao vivo: fecha os pares (ouvintes também fecham em ptt_ended).
    closeAllPeers();
    state._pendingJoins = [];

    if (state.recognition) { try { state.recognition.stop(); } catch {} state.recognition = null; }

    const durationMs = state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : 0;

    const finalize = async (audioBase64, mimeType) => {
      const transcript = state.liveTranscript.trim();
      if (cancel) {
        state.socket.emit('ptt_cancel', { channelId: state.activeChannel.id });
        return;
      }
      const ack = await emitAsync('ptt_end', {
        channelId: state.activeChannel.id,
        priority: state.priority,
        transcript,
        audioBase64,
        mimeType,
        durationMs,
        startedAt: state.startedAt,
      });
      if (ack && ack.ok) refreshAfterTransmission(ack);
      else toast((ack && ack.error) || 'Falha ao registrar transmissão.');
    };

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      const mr = state.mediaRecorder;
      mr.onstop = async () => {
        stopLocalMedia();
        const blob = new Blob(state.chunks, { type: mr.mimeType || 'audio/webm' });
        const base64 = await blobToBase64(blob);
        finalize(base64, mr.mimeType || 'audio/webm');
      };
      mr.stop();
    } else {
      stopLocalMedia();
      finalize(undefined, undefined);
    }
  }

  function stopLocalMedia() {
    if (state.localStream) {
      state.localStream.getTracks().forEach((t) => t.stop());
      state.localStream = null;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function setupPtt() {
    const ptt = $('#ptt');
    // Hold-to-talk via ponteiro.
    ptt.addEventListener('pointerdown', (e) => { e.preventDefault(); startTransmit(); });
    window.addEventListener('pointerup', () => { if (state.transmitting) stopTransmit(false); });
    // Barra de espaço.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); startTransmit();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && state.transmitting) { e.preventDefault(); stopTransmit(false); }
    });
  }

  // Envio via texto (fallback sem microfone).
  function setupTextFallback() {
    const send = async () => {
      const input = $('#text-message');
      const text = input.value.trim();
      if (!text) return;
      if (!state.activeChannel) return toast('Selecione um canal.');
      const startAck = await emitAsync('ptt_start', { channelId: state.activeChannel.id, priority: state.priority });
      if (!startAck || !startAck.ok) { toast('Canal ocupado.'); return; }
      const ack = await emitAsync('ptt_end', {
        channelId: state.activeChannel.id,
        priority: state.priority,
        transcript: text,
        durationMs: 0,
        startedAt: new Date().toISOString(),
      });
      if (ack && ack.ok) { input.value = ''; refreshAfterTransmission(ack); }
      else toast((ack && ack.error) || 'Falha ao transmitir.');
    };
    $('#text-send').addEventListener('click', send);
    $('#text-message').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }

  function refreshAfterTransmission(ack) {
    if (ack.occurrence) toast('📒 Nova ocorrência registrada automaticamente.', ack.occurrence.priority);
    loadFeed();
    refreshOccurrences();
    refreshStats();
  }

  // ----------------------------------------------------------------------- //
  // WebRTC — voz ao vivo (malha P2P, sinalização via Socket.IO)
  // ----------------------------------------------------------------------- //
  function newPeer(remoteId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (e) => {
      if (e.candidate) state.socket.emit('webrtc_ice', { to: remoteId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(remoteId);
    };
    state.peers[remoteId] = pc;
    return pc;
  }

  function closePeer(remoteId) {
    const pc = state.peers[remoteId];
    if (pc) { try { pc.close(); } catch {} delete state.peers[remoteId]; }
    const el = document.getElementById('rtc-audio-' + remoteId);
    if (el) el.remove();
    updateLiveBadge();
  }

  function closeAllPeers() {
    Object.keys(state.peers).forEach(closePeer);
  }

  // Falante: ao receber o "join" de um ouvinte, cria a conexão e envia a oferta.
  async function speakerConnectTo(remoteId) {
    if (!state.localStream || state.peers[remoteId]) return;
    const pc = newPeer(remoteId);
    state.localStream.getTracks().forEach((t) => pc.addTrack(t, state.localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit('webrtc_offer', { to: remoteId, sdp: pc.localDescription });
  }

  // Ouvinte: ao receber a oferta do falante, responde e toca o áudio ao vivo.
  async function listenerHandleOffer(fromId, sdp) {
    const pc = newPeer(fromId);
    pc.ontrack = (e) => playRemoteStream(fromId, e.streams[0]);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.socket.emit('webrtc_answer', { to: fromId, sdp: pc.localDescription });
  }

  async function handleAnswer(fromId, sdp) {
    const pc = state.peers[fromId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async function handleIce(fromId, candidate) {
    const pc = state.peers[fromId];
    if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} }
  }

  function playRemoteStream(fromId, stream) {
    let el = document.getElementById('rtc-audio-' + fromId);
    if (!el) {
      el = document.createElement('audio');
      el.id = 'rtc-audio-' + fromId;
      el.autoplay = true;
      document.body.appendChild(el);
    }
    el.srcObject = stream;
    el.play().catch(() => {});
    updateLiveBadge();
  }

  function updateLiveBadge() {
    const badge = $('#live-badge');
    if (!badge) return;
    const playing = Object.keys(state.peers).some((id) => document.getElementById('rtc-audio-' + id));
    badge.classList.toggle('hidden', !(playing && !state.isSpeaker));
  }

  // ----------------------------------------------------------------------- //
  // Socket.IO — tempo real
  // ----------------------------------------------------------------------- //
  function connectSocket() {
    // Autentica o WebSocket com o mesmo token JWT (handshake).
    const socket = io({ auth: { token: state.token } });
    state.socket = socket;
    socket.on('connect', () => {
      state.socketId = socket.id;
      socket.emit('identify', {}, () => {
        if (state.activeChannel) socket.emit('join_channel', { channelId: state.activeChannel.id });
      });
    });

    socket.on('unauthorized', () => { toast('Sessão não autorizada.'); doLogout(); });

    socket.on('presence', (data) => renderPresence(data));

    // --- Sinalização WebRTC (voz ao vivo) --------------------------------- //
    // Ouvinte anunciou-se → falante cria a conexão e envia a oferta.
    socket.on('webrtc_join', ({ from }) => {
      if (!state.isSpeaker) return;
      if (state.localStream) speakerConnectTo(from);
      else { state._pendingJoins = state._pendingJoins || []; state._pendingJoins.push(from); }
    });
    socket.on('webrtc_offer', ({ from, sdp }) => listenerHandleOffer(from, sdp));
    socket.on('webrtc_answer', ({ from, sdp }) => handleAnswer(from, sdp));
    socket.on('webrtc_ice', ({ from, candidate }) => handleIce(from, candidate));

    socket.on('ptt_started', (data) => {
      state.activeSpeakers[data.channelId] = data;
      renderChannels();
      const isMine = data.userId === state.user.id;
      const sameChannel = state.activeChannel && data.channelId === state.activeChannel.id;
      if (sameChannel && !isMine) {
        showTalkBanner(data);
        // Ouvinte do canal ativo pede a voz ao vivo ao falante (WebRTC).
        if (data.speakerSocketId) socket.emit('webrtc_join', { to: data.speakerSocketId });
      }
      if (data.priority === 'emergencia' && !isMine) {
        toast(`🔴 EMERGÊNCIA — ${data.userName} (${data.sectorLabel || ''})`, 'emergencia');
      }
    });

    socket.on('ptt_ended', (data) => {
      delete state.activeSpeakers[data.channelId];
      renderChannels();
      if (state.activeChannel && data.channelId === state.activeChannel.id) hideTalkBanner();
      // Encerra a voz ao vivo deste canal (fecha os pares e para o áudio).
      if (!state.isSpeaker) closeAllPeers();
    });

    socket.on('ptt_interrupted', () => {
      toast('🔴 Sua transmissão foi interrompida por uma emergência.', 'emergencia');
      if (state.transmitting) stopTransmit(true);
    });

    socket.on('transmission_created', ({ transmission, occurrence }) => {
      // A voz já foi ouvida ao vivo (WebRTC); aqui só atualizamos o registro.
      // O clipe gravado permanece disponível para reprodução no histórico.
      if (state.activeChannel && transmission.channelId === state.activeChannel.id) {
        loadFeed();
      }
      if (occurrence) refreshOccurrences();
      refreshStats();
    });
  }

  function emitAsync(event, payload) {
    return new Promise((resolve) => {
      if (!state.socket) return resolve(null);
      let done = false;
      state.socket.emit(event, payload, (ack) => { done = true; resolve(ack); });
      setTimeout(() => { if (!done) resolve(null); }, 8000);
    });
  }

  function renderPresence(data) {
    $('#online-count').textContent = `${data.online.length} online`;
    const list = $('#online-list');
    list.innerHTML = '';
    for (const u of data.online) {
      const li = el('li');
      li.innerHTML = `<span class="dot"></span><span><div class="who">${esc(u.userName)}</div><div class="role">${esc(u.sectorLabel)}</div></span>`;
      list.appendChild(li);
    }
    // Atualiza indicadores de canal no ar.
    state.activeSpeakers = {};
    for (const a of data.activeChannels) state.activeSpeakers[a.channelId] = a;
    renderChannels();
  }

  function showTalkBanner(speaker) {
    const banner = $('#talk-banner');
    banner.textContent = `${speaker.userName || 'Alguém'} está transmitindo…`;
    banner.classList.remove('hidden');
  }
  function hideTalkBanner() { $('#talk-banner').classList.add('hidden'); }

  // ----------------------------------------------------------------------- //
  // Busca inteligente
  // ----------------------------------------------------------------------- //
  function setupSearch() {
    $('#search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#search-input').value.trim();
      if (!q) return;
      const box = $('#search-results');
      box.innerHTML = '<div class="empty">Buscando…</div>';
      try {
        const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (!results.length) { box.innerHTML = '<div class="empty">Nenhum resultado encontrado.</div>'; return; }
        box.innerHTML = '';
        for (const tx of results) {
          const hit = el('div', 'search-hit');
          hit.innerHTML = `
            <div class="hit-meta">${PRIORITY_EMOJI[tx.priority] || ''} ${esc(tx.userName)} · ${esc(tx.channelName)} · ${fmtTime(tx.startedAt)}</div>
            <div>${esc(tx.transcript)}</div>`;
          box.appendChild(hit);
        }
      } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    });
  }

  // ----------------------------------------------------------------------- //
  // Livro de Ocorrências
  // ----------------------------------------------------------------------- //
  async function refreshOccurrences() {
    const occs = await api('/api/occurrences');
    const open = occs.filter((o) => o.status !== 'resolvido').length;
    $('#occ-open-count').textContent = open ? `${open} aberta(s)` : '';
    const box = $('#occurrences');
    box.innerHTML = '';
    if (!occs.length) { box.appendChild(el('div', 'empty', 'Nenhuma ocorrência registrada.')); return; }
    for (const o of occs) box.appendChild(renderOccurrence(o));
  }

  function renderOccurrence(o) {
    // Alterar status exige coordenador ou acima (RBAC — o backend também impõe).
    const canManage = ['coordenador', 'diretor', 'admin'].includes(state.user.role);
    const card = el('div', 'occ-card');
    card.innerHTML = `
      <div class="occ-title">${PRIORITY_EMOJI[o.priority] || ''} ${esc(o.title)}</div>
      <div class="occ-cat">${esc(o.category)} · ${fmtTime(o.openedAt)}</div>
      ${o.responsible ? `<div class="occ-resp">Responsável informado: ${esc(o.responsible)}</div>` : ''}
      <div style="margin-top:8px"><span class="occ-status ${o.status}">${esc(o.status.replace('_', ' '))}</span></div>
      ${canManage ? `
      <div class="occ-actions">
        <button data-st="aberto">Aberto</button>
        <button data-st="em_andamento">Em andamento</button>
        <button data-st="resolvido">Resolvido</button>
      </div>` : ''}`;
    card.querySelectorAll('[data-st]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/api/occurrences/${o.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.st }) });
          refreshOccurrences();
        } catch (e) { toast(e.message); }
      }),
    );
    return card;
  }

  // ----------------------------------------------------------------------- //
  // Painel de estatísticas
  // ----------------------------------------------------------------------- //
  async function refreshStats() {
    const s = await api('/api/transmissions/stats');
    const box = $('#stats');
    box.innerHTML = `
      <div class="stat"><div class="num">${s.total}</div><div class="lbl">Transmissões</div></div>
      <div class="stat"><div class="num">${s.today}</div><div class="lbl">Hoje</div></div>`;
  }

  // ----------------------------------------------------------------------- //
  // Boot
  // ----------------------------------------------------------------------- //
  (async function boot() {
    await initAuth();
    // Sessão persistida: valida o token antes de entrar.
    if (state.token) {
      try {
        const user = await api('/api/auth/me');
        state.user = user;
        localStorage.setItem('comunica_user', JSON.stringify(user));
        enterApp();
      } catch { /* token inválido/expirado — permanece na tela de login */ }
    }
  })();
})();
