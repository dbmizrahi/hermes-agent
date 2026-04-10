import { WS_BASE } from '@/config/api';

type MessageHandler = (data: unknown) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 30000;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private shouldReconnect = true;
  public onConnectionStateChange?: (state: string) => void;

  constructor(path: string) {
    this.url = `${WS_BASE}${path}`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 2000;
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handlers.forEach((h) => h(data));
      } catch {
        this.handlers.forEach((h) => h(event.data));
      }
    };

    this.ws.onclose = (event) => {
      // Don't reconnect if server closed with specific codes
      if (event.code === 4004 || event.code === 4003 || event.code === 1008) {
        this.shouldReconnect = false;
        return;
      }
      
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
          this.connect();
        }, this.reconnectDelay);
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        // Max attempts reached — stop trying
        this.shouldReconnect = false;
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  subscribe(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
