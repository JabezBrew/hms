/**
 * WebSocket client for real-time HMS notifications.
 *
 * Provides auto-reconnect with exponential backoff, JWT authentication,
 * and event handling for nursing alerts and vital signs.
 *
 * Usage:
 *   import { AlertWebSocket } from '@/lib/websocket';
 *
 *   const ws = new AlertWebSocket(token, { wardId: '123' });
 *   ws.on('alert.new', (alert) => console.log('New alert:', alert));
 *   ws.connect();
 */

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8001';

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const RECONNECT_MULTIPLIER = 1.5;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Base WebSocket client with auto-reconnect and event handling.
 */
class BaseWebSocket {
  constructor(path, token, options = {}) {
    this.path = path;
    this.token = token;
    this.options = options;
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isIntentionalClose = false;
  }

  /**
   * Build the WebSocket URL.
   */
  getUrl() {
    const url = `${WS_BASE_URL}${this.path}`;

    // Optional legacy fallback for backends that still require query param token auth.
    if (this.options.useQueryTokenFallback && this.token) {
      const params = new URLSearchParams({ token: this.token });
      return `${url}?${params.toString()}`;
    }

    return url;
  }

  /**
   * Build requested subprotocols.
   * Default auth transport is subprotocols: ['hms.jwt', '<access_token>'].
   */
  getProtocols() {
    const protocols = [];
    if (this.options.baseProtocol) {
      protocols.push(this.options.baseProtocol);
    }
    if (this.token) {
      protocols.push('hms.jwt', this.token);
    }
    return protocols.length > 0 ? protocols : undefined;
  }

  /**
   * Connect to the WebSocket server.
   */
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isIntentionalClose = false;

    try {
      const protocols = this.getProtocols();
      this.ws = protocols ? new WebSocket(this.getUrl(), protocols) : new WebSocket(this.getUrl());
      this.setupEventHandlers();
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect() {
    this.isIntentionalClose = true;
    this.clearTimers();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Set up WebSocket event handlers.
   */
  setupEventHandlers() {
    this.ws.onopen = () => {
      console.log('[WebSocket] Connected to', this.path);
      this.reconnectAttempts = 0;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.startPingInterval();
      this.emit('connection.open', { path: this.path });
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected:', event.code, event.reason);
      this.clearTimers();
      this.emit('connection.close', { code: event.code, reason: event.reason });

      if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      this.emit('connection.error', { error });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };
  }

  /**
   * Handle incoming WebSocket messages.
   */
  handleMessage(data) {
    const { type, ...payload } = data;

    // Handle pong responses
    if (type === 'pong') {
      return;
    }

    // Emit the event to listeners
    this.emit(type, payload);
  }

  /**
   * Send a message to the server.
   */
  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send - not connected');
    }
  }

  /**
   * Register an event listener.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove an event listener.
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event to all listeners.
   */
  emit(event, data) {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[WebSocket] Error in ${event} handler:`, error);
      }
    });

    // Also emit to wildcard listeners
    this.listeners.get('*')?.forEach((callback) => {
      try {
        callback({ type: event, ...data });
      } catch (error) {
        console.error('[WebSocket] Error in wildcard handler:', error);
      }
    });
  }

  /**
   * Schedule a reconnection attempt.
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocket] Max reconnect attempts reached');
      this.emit('connection.failed', { attempts: this.reconnectAttempts });
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(
        `[WebSocket] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
      );
      this.connect();
    }, this.reconnectDelay);

    // Increase delay for next attempt (exponential backoff)
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_DELAY
    );
  }

  /**
   * Start sending ping messages to keep connection alive.
   */
  startPingInterval() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000); // Every 30 seconds
  }

  /**
   * Clear all timers.
   */
  clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Get the current connection state.
   */
  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * WebSocket client for nursing alerts.
 *
 * Events:
 * - alert.new: New alert created
 * - alert.acknowledged: Alert acknowledged
 * - alert.escalated: Alert severity increased
 * - connection.open: Connected to server
 * - connection.close: Disconnected from server
 * - connection.error: Connection error
 * - connection.failed: Max reconnect attempts reached
 */
export class AlertWebSocket extends BaseWebSocket {
  constructor(token, options = {}) {
    const path = options.wardId
      ? `/ws/alerts/ward/${options.wardId}/`
      : '/ws/alerts/';
    super(path, token, options);
  }

  /**
   * Subscribe to alerts for a specific ward.
   */
  subscribeToWard(wardId) {
    this.send({ type: 'subscribe_ward', ward_id: wardId });
  }

  /**
   * Unsubscribe from alerts for a specific ward.
   */
  unsubscribeFromWard(wardId) {
    this.send({ type: 'unsubscribe_ward', ward_id: wardId });
  }
}

/**
 * WebSocket client for patient vital signs.
 *
 * Events:
 * - vitals.new: New vital signs recorded
 * - vitals.critical: Critical vital signs detected
 * - connection.open: Connected to server
 * - connection.close: Disconnected from server
 */
export class VitalsWebSocket extends BaseWebSocket {
  constructor(patientId, token, options = {}) {
    super(`/ws/vitals/${patientId}/`, token, options);
    this.patientId = patientId;
  }
}

/**
 * WebSocket client for referral notifications.
 *
 * Events:
 * - notification.new: New referral notification
 * - connection.open: Connected to server
 * - connection.close: Disconnected from server
 * - connection.error: Connection error
 * - connection.failed: Max reconnect attempts reached
 */
export class NotificationWebSocket extends BaseWebSocket {
  constructor(token, options = {}) {
    super('/ws/notifications/', token, options);
  }
}

/**
 * WebSocket client for admin dashboard invalidations.
 *
 * Events:
 * - dashboard.invalidate
 * - connection.open
 * - connection.close
 * - connection.error
 * - connection.failed
 */
export class AdminDashboardWebSocket extends BaseWebSocket {
  constructor(token, options = {}) {
    super('/ws/dashboards/admin/', token, options);
  }
}

export default {
  AlertWebSocket,
  VitalsWebSocket,
  NotificationWebSocket,
  AdminDashboardWebSocket,
};
