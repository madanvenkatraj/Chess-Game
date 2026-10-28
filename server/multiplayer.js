// multiplayer.js — online multiplayer client for window.ChessNet.
// Primary transport: WebSocket /ws. Fallback: SSE /sse + POST /send (proxy-safe).
// No game rules here — the server validates every move.
(function (root) {
  'use strict';

  var mode = 'none';            // none | ws | sse
  var ws = null;
  var sse = null;
  var sid = null;
  var requestId = 0;
  var pending = {};
  var handlers = {};
  var heartbeatTimer = null;
  var reconnectTimer = null;
  var closedByUs = false;
  var connectionState = 'disconnected'; // disconnected | connecting | connected
  var session = { code: null, seat: null, name: 'Player' };
  var queue = [];

  function on(type, fn) { handlers[type] = fn; }
  function emit(type, payload) { if (handlers[type]) handlers[type](payload); }

  function connect() {
    if (connectionState === 'connecting' || connectionState === 'connected') return;
    closedByUs = false;
    connectionState = 'connecting';
    emit('connection', { state: connectionState });
    if (mode === 'none' || mode === 'ws') connectWs();
    else connectSse();
  }

  function connectWs() {
    mode = 'ws';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { ws = new WebSocket(proto + '//' + location.host + '/ws'); }
    catch (e) { connectSse(); return; }
    ws.onopen = function () {
      connectionState = 'connected';
      emit('connection', { state: connectionState });
      flushQueue();
      startHeartbeat();
    };
    ws.onclose = function (e) {
      stopTimers();
      // Upgrade refused (proxy/CDN) or immediate close → fall back to SSE.
      if (!closedByUs && (e.code === 1006 || e.code === 1015)) { connectSse(); return; }
      connectionState = 'disconnected';
      emit('connection', { state: connectionState });
      if (!closedByUs) reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = function () { /* onclose follows */ };
    ws.onmessage = function (e) { route(JSON.parse(e.data)); };
  }

  function connectSse() {
    mode = 'sse';
    sid = 'c' + Date.now() + Math.floor(Math.random() * 1e6).toString(36);
    try { sse = new EventSource('/sse?sid=' + sid); }
    catch (e) { scheduleSseRetry(); return; }
    sse.onopen = function () {
      connectionState = 'connected';
      emit('connection', { state: connectionState });
      flushQueue();
      startHeartbeat();
    };
    sse.onmessage = function (e) { route(JSON.parse(e.data)); };
    sse.onerror = function () {
      stopTimers();
      if (!closedByUs) scheduleSseRetry();
    };
  }

  function scheduleSseRetry() {
    connectionState = 'disconnected';
    emit('connection', { state: connectionState });
    reconnectTimer = setTimeout(connectSse, 1500);
  }

  function route(msg) {
    if (msg.id && pending[msg.id]) {
      var resolve = pending[msg.id];
      delete pending[msg.id];
      resolve(msg);
      return;
    }
    emit(msg.type, msg);
  }

  function startHeartbeat() {
    stopTimers();
    heartbeatTimer = setInterval(function () {
      if (session.code) send('heartbeat', { code: session.code });
      else send('ping', {});
    }, 4000);
  }
  function stopTimers() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (reconnectTimer && closedByUs) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function postSend(frame) {
    return fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ sid: sid }, frame))
    });
  }

  function send(type, data) {
    return new Promise(function (resolve) {
      var id = 'r' + (++requestId);
      var frame = { id: id, type: type, data: data || {} };
      var timer = setTimeout(function () {
        if (pending[id]) { delete pending[id]; resolve({ ok: false, error: 'Request timed out.' }); }
      }, 8000);
      function resolveMsg(msg) { clearTimeout(timer); resolve(msg); }
      pending[id] = resolveMsg;
      var wire = JSON.stringify(frame);
      if (connectionState === 'connected') {
        if (mode === 'ws' && ws && ws.readyState === 1) ws.send(wire);
        else if (mode === 'sse') { postSend(frame).catch(function () { /* retried via timeout */ }); }
        else { queue.push(frame); }
      } else {
        queue.push(frame);
      }
    });
  }

  function flushQueue() {
    var q = queue;
    queue = [];
    q.forEach(function (frame) {
      var wire = JSON.stringify(frame);
      if (mode === 'ws' && ws && ws.readyState === 1) ws.send(wire);
      else if (mode === 'sse') postSend(frame).catch(function () { /* ignore */ });
    });
  }

  function close() {
    closedByUs = true;
    stopTimers();
    session = { code: null, seat: null, name: 'Player' };
    queue = [];
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
    if (sse) { try { sse.close(); } catch (e) { /* ignore */ } sse = null; }
    connectionState = 'disconnected';
    mode = 'none';
    sid = null;
  }

  root.ChessNet = {
    connect: connect,
    close: close,
    send: send,
    on: on,
    session: function () { return session; },
    setSession: function (s) { session = s; },
    state: function () { return connectionState; },
    transport: function () { return mode; }
  };
})(window);
