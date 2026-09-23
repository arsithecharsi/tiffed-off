/* Slice & Spite — WebRTC networking via PeerJS (public cloud broker).
   Host creates a peer with id "slice-spite-<CODE>"; guest connects to it.
   Exposes window.Net with host()/join()/send()/on()/close(). */
(function () {
  const PREFIX = "slice-spite-";
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    return s;
  }

  const Net = {
    peer: null,
    conn: null,
    code: null,
    isHost: false,
    handlers: {},          // type -> [fn]
    onOpen: null,          // fn(code) — signaling ready (host: code allocated)
    onConnect: null,       // fn() — data channel open
    onClose: null,         // fn(reason)
    _closedByUs: false,

    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    off(type) { delete this.handlers[type]; },
    _dispatch(msg) {
      const list = this.handlers[msg.t];
      if (list) list.forEach((fn) => fn(msg));
    },
    send(msg) {
      if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (e) {} }
    },
    connected() { return !!(this.conn && this.conn.open); },

    _wireConn(conn) {
      this.conn = conn;
      conn.on("data", (d) => { if (d && d.t) this._dispatch(d); });
      conn.on("open", () => { if (this.onConnect) this.onConnect(); });
      if (conn.open) setTimeout(() => { if (this.onConnect) this.onConnect(); }, 0);
      conn.on("close", () => { if (!this._closedByUs && this.onClose) this.onClose("closed"); });
      conn.on("error", () => { if (!this._closedByUs && this.onClose) this.onClose("error"); });
    },

    host(cb) {
      this.close();
      this._closedByUs = false;
      this.isHost = true;
      const tryCode = () => {
        this.code = makeCode();
        const peer = new Peer(PREFIX + this.code, { debug: 1 });
        this.peer = peer;
        peer.on("open", () => { if (this.onOpen) this.onOpen(this.code); });
        peer.on("connection", (conn) => {
          if (this.conn && this.conn.open) { conn.close(); return; } // one guest only
          this._wireConn(conn);
        });
        peer.on("error", (err) => {
          if (err.type === "unavailable-id") { peer.destroy(); tryCode(); }
          else if (cb) cb(err);
        });
      };
      tryCode();
    },

    join(code, cb) {
      this.close();
      this._closedByUs = false;
      this.isHost = false;
      this.code = code.toUpperCase().trim();
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      peer.on("open", () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true });
        this._wireConn(conn);
      });
      peer.on("error", (err) => { if (cb) cb(err); });
    },

    rejoin() {
      // guest-side reconnect into the same room (host just waits for us)
      if (this.isHost) return;
      this._closedByUs = false;
      try {
        if (this.peer && !this.peer.destroyed) {
          const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
          this._wireConn(conn);
        } else {
          this.join(this.code);
        }
      } catch (e) {}
    },

    close() {
      // Note: does NOT clear message handlers — wireNetFlow() resets them itself,
      // because host()/join() call close() after handlers are already registered.
      this._closedByUs = true;
      if (this.conn) { try { this.conn.close(); } catch (e) {} this.conn = null; }
      if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
    },
  };

  window.Net = Net;
})();
