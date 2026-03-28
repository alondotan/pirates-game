const DEV_URL = 'ws://localhost:3001';
const PROD_URL = import.meta.env.VITE_WS_URL || DEV_URL;
const SERVER_URL = import.meta.env.DEV ? DEV_URL : PROD_URL;

export class Connection {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(SERVER_URL);
      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };
      this.ws.onerror = () => reject(new Error('Connection failed'));
      this.ws.onclose = () => {
        this.connected = false;
        const handler = this.handlers.get('_close');
        if (handler) handler();
      };
      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        const handler = this.handlers.get(msg.type);
        if (handler) handler(msg);
      };
    });
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  off(type) {
    this.handlers.delete(type);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
