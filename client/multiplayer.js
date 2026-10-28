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
  var pendingTimeouts = {};
  var handlers = {};
  var heartbeatTimer = null;
  var reconnectTimer = null;
  var closedByUs = false;
  var connectionState = 'disconnected'; // disconnected | connecting | connected
  var session = { code: null, seat: null, name: 'Player' };
  var queue = [];

  function on(type, fn) {
    handlers[type] = fn;
    return function () { if (handlers[type] === fn) delete handlers[type]; };
  }
  function emit(type, payload) { if (handlers[type]) handlers[type](payload); }
  function getConnectionState() { return connectionState; }

  function connect() {
    if (connectionState === 'connecting' || connectionState === 'connected') return;
    closedByUs = false;
    connectionState = 'connecting';
    emit('connection', { state: connectionState });
    // Use the server-supported SSE + POST transport as the primary path. The
    // minimal WebSocket implementation may upgrade but is not reliably usable
    // behind preview proxies, leaving the browser disconnected indefinitely.
    connectSse();
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
      // Any unexpected WebSocket close should try the proxy-safe SSE transport
      // before reconnecting WebSocket; infrastructure can close with varied codes.
      if (!closedByUs) {
        connectionState = 'connecting';
        emit('connection', { state: connectionState });
        if (sse) { try { sse.close(); } catch (ignore) {} sse = null; }
        connectSse();
        return;
      }
      connectionState = 'disconnected';
      emit('connection', { state: connectionState });
    };
    ws.onerror = function () { /* onclose follows */ };
    ws.onmessage = function (e) { route(JSON.parse(e.data)); };
  }

  function connectSse() {
    mode = 'sse';
    sid = 'c' + Date.now() + Math.floor(Math.random() * 1e6).toString(36);
    try { sse = new EventSource('/sse?sid=' + sid); }
    catch (e) { scheduleSseRetry(); return; }
    var sessionReady = false;
    sse.onopen = function () {
      sessionReady = true;
      connectionState = 'connected';
      emit('connection', { state: connectionState });
      flushQueue();
      startHeartbeat();
    };
    sse.onmessage = function (e) {
      var message;
      try { message = JSON.parse(e.data); } catch (err) { return; }
      if (message && message.type === 'hello') return;
      route(message);
    };
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
      if (msg.type === 'created' || msg.type === 'joined' || msg.type === 'join-failed') emit(msg.type, msg);
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
    }).then(function (response) {
      return response.json().then(function (body) {
        if (body && body.reply) route(body.reply);
        return body;
      });
    });
  }

  function send(type, data) {
    return new Promise(function (resolve) {
      var id = 'r' + (++requestId);
      var frame = { id: id, type: type, data: data || {} };
      function resolveMsg(msg) {
        if (pendingTimeouts[id]) { clearTimeout(pendingTimeouts[id]); delete pendingTimeouts[id]; }
        resolve(msg);
      }
      function armTimeout(frameId) {
        if (pendingTimeouts[frameId]) clearTimeout(pendingTimeouts[frameId]);
        pendingTimeouts[frameId] = setTimeout(function () {
          if (pending[frameId]) { delete pending[frameId]; delete pendingTimeouts[frameId]; resolve({ ok: false, error: 'Request timed out.' }); }
        }, 8000);
      }
      pending[id] = resolveMsg;
      var wire = JSON.stringify(frame);
      if (connectionState === 'connected') {
        armTimeout(id);
        if (mode === 'ws' && ws && ws.readyState === 1) ws.send(wire);
        else if (mode === 'sse' && sid) { postSend(frame).catch(function () { /* retried via timeout */ }); }
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
      if (pending[frame.id] && !pendingTimeouts[frame.id]) {
        pendingTimeouts[frame.id] = setTimeout(function () {
          if (pending[frame.id]) {
            var resolve = pending[frame.id];
            delete pending[frame.id];
            delete pendingTimeouts[frame.id];
            resolve({ ok: false, error: 'Request timed out.' });
          }
        }, 8000);
      }
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
