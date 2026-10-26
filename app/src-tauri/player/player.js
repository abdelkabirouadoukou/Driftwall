/*
 * Driftwall YouTube bridge.
 *
 * Runs inside the page served by the local player server (player_server.rs)
 * and is embedded by the app window as an <iframe>. The app talks to it with
 * postMessage; this file wraps YouTube's IFrame API.
 *
 *   app  -> player: init | load | play | pause | volume | tint
 *   player -> app : ready | state | error
 */
(function () {
  'use strict';

  var parentOrigin = null; // learnt from the first message, never guessed
  var player = null;
  var ready = false;
  var queue = [];
  var apiRequested = false;

  function send(message) {
    if (parentOrigin && window.parent !== window) {
      window.parent.postMessage(message, parentOrigin);
    }
  }

  function snapshot(stateCode) {
    var title = '';
    var muted = false;
    try {
      title = (player.getVideoData() || {}).title || '';
      muted = !!player.isMuted();
    } catch (e) {
      /* player not fully ready yet */
    }
    return { type: 'state', state: stateCode, title: title, muted: muted };
  }

  function createPlayer() {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        autoplay: 1,
        // The app draws its own, colour-matched toolbar.
        controls: 0,
        fs: 0,
        iv_load_policy: 3,
        disablekb: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: function () {
          ready = true;
          send({ type: 'ready' });
          var pending = queue;
          queue = [];
          pending.forEach(handle);
        },
        onStateChange: function (event) {
          send(snapshot(event.data));
        },
        onError: function (event) {
          send({ type: 'error', code: event.data });
        },
      },
    });
  }

  function loadApi() {
    if (apiRequested) return;
    apiRequested = true;
    window.onYouTubeIframeAPIReady = createPlayer;
    var script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = function () {
      send({ type: 'error', code: -1 });
    };
    document.head.appendChild(script);
  }

  function handle(message) {
    switch (message.type) {
      case 'load':
        player.unMute();
        if (typeof message.volume === 'number') player.setVolume(message.volume);
        player.loadVideoById({
          videoId: String(message.videoId),
          startSeconds: Number(message.start) || 0,
        });
        break;
      case 'play':
        player.playVideo();
        break;
      case 'pause':
        player.pauseVideo();
        break;
      case 'volume':
        player.unMute();
        player.setVolume(Number(message.value) || 0);
        break;
    }
  }

  window.addEventListener('message', function (event) {
    // Only the window that embeds us may drive the player.
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'init') {
      parentOrigin = event.origin;
      loadApi();
      return;
    }
    if (message.type === 'tint') {
      if (typeof message.color === 'string' && /^#[0-9a-f]{6}$/i.test(message.color)) {
        document.body.style.backgroundColor = message.color;
      }
      return;
    }
    if (!ready) {
      queue.push(message);
      return;
    }
    handle(message);
  });
})();
