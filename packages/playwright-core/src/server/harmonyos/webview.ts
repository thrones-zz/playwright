/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import * as stream from 'stream';
import debug from 'debug';
import { wsReceiver, wsSender } from '../../utilsBundle';

const kWebViewDebug = debug('pw:harmonyos:webview');

export interface SocketBackend extends EventEmitter {
  write(data: Buffer): Promise<void>;
  close(): void;
}

/**
 * CDP Message
 */
export interface CDPMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

interface CDPSession {
  sessionId: string;
}

/**
 * WebView CDP Client
 * 
 * Handles Chrome DevTools Protocol communication with HarmonyOS WebView
 */
export class WebViewCDPClient extends EventEmitter {
  private _socket: SocketBackend;
  private _receiver: stream.Writable;
  private _lastId = 0;
  private _callbacks = new Map<number, { fulfill: (result: any) => void; reject: (error: Error) => void }>();
  private _eventHandlers = new Map<string, Set<(params: any) => void>>();
  private _closed = false;

  constructor(socket: SocketBackend) {
    super();
    this._socket = socket;
    this._receiver = new wsReceiver() as stream.Writable;

    this._socket.on('data', (data: Buffer) => {
      this._receiver._write(data, 'binary', () => {});
    });

    this._receiver.on('message', message => {
      try {
        const msg: CDPMessage = JSON.parse(message);
        this._handleMessage(msg);
      } catch (e) {
        kWebViewDebug('Failed to parse CDP message:', e);
      }
    });

    this._socket.on('close', () => {
      this._closed = true;
      this.emit('close');
    });
  }

  private _handleMessage(msg: CDPMessage) {
    if (msg.id !== undefined) {
      // Response
      const callback = this._callbacks.get(msg.id);
      if (callback) {
        this._callbacks.delete(msg.id);
        if (msg.error) {
          callback.reject(new Error(`CDP Error ${msg.error.code}: ${msg.error.message}`));
        } else {
          callback.fulfill(msg.result);
        }
      }
    } else if (msg.method) {
      // Event
      const handlers = this._eventHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch (e) {
            kWebViewDebug(`Error in handler for ${msg.method}:`, e);
          }
        }
      }
      this.emit(msg.method, msg.params);
    }
  }

  private async _writeSocket(data: string): Promise<void> {
    const frames = wsSender.frame(Buffer.from(data), {
      opcode: 1,
      mask: true,
      fin: true,
      readOnly: true
    });
    for (const frame of frames) {
      await this._socket.write(frame);
    }
  }

  /**
   * Send CDP command and wait for response
   */
  async send(method: string, params: any = {}): Promise<any> {
    if (this._closed)
      throw new Error('WebViewCDPClient is closed');

    const id = ++this._lastId;
    const message = JSON.stringify({ id, method, params });
    kWebViewDebug(`CDP → ${method}`, params);

    return new Promise((fulfill, reject) => {
      this._callbacks.set(id, { fulfill, reject });
      this._writeSocket(message).then(() => {
        // Timeout after 30 seconds
        setTimeout(() => {
          if (this._callbacks.has(id)) {
            this._callbacks.delete(id);
            reject(new Error(`CDP command ${method} timed out`));
          }
        }, 30000);
      }).catch(err => {
        this._callbacks.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Subscribe to CDP event
   */
  addEventListener(method: string, handler: (params: any) => void): void {
    if (!this._eventHandlers.has(method)) {
      this._eventHandlers.set(method, new Set());
    }
    this._eventHandlers.get(method)!.add(handler);
  }

  /**
   * Unsubscribe from CDP event
   */
  removeEventListener(method: string, handler: (params: any) => void): void {
    const handlers = this._eventHandlers.get(method);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._eventHandlers.delete(method);
      }
    }
  }

  /**
   * Close the CDP connection
   */
  close(): void {
    if (this._closed)
      return;
    this._closed = true;
    this._socket.close();
    this._callbacks.clear();
    this._eventHandlers.clear();
  }

  isClosed(): boolean {
    return this._closed;
  }
}

/**
 * WebView - Represents a connected WebView
 */
export class WebView {
  private _client: WebViewCDPClient;
  private _socketName: string;
  private _pkg: string;
  private _pageId: string | null = null;
  private _sessionId: string | null = null;

  constructor(client: WebViewCDPClient, socketName: string, pkg: string) {
    this._client = client;
    this._socketName = socketName;
    this._pkg = pkg;
  }

  get socketName(): string {
    return this._socketName;
  }

  get package(): string {
    return this._pkg;
  }

  /**
   * Get CDP client for direct CDP access
   */
  cdp(): WebViewCDPClient {
    return this._client;
  }

  private async _ensureSession(): Promise<string> {
    if (this._sessionId)
      return this._sessionId;

    if (!this._pageId)
      throw new Error('No page target available');

    const result = await this._client.send('Target.attachToTarget', {
      targetId: this._pageId,
      flatten: true,
    });
    this._sessionId = result.sessionId;
    return this._sessionId!;
  }

  /**
   * Initialize - get target info and set up event listeners
   */
  async init(): Promise<void> {
    // Get all targets
    const { targetInfos } = await this._client.send('Target.getTargets');
    
    // Find the main page target
    const pageTarget = targetInfos.find(
      (t: any) => t.type === 'page' || t.type === 'webview'
    );
    
    if (pageTarget) {
      this._pageId = pageTarget.targetId;
      
      // Subscribe to relevant events
      this._client.addEventListener('Page.loadEventFired', () => {});
      this._client.addEventListener('Page.javascriptDialogOpening', () => {});
      this._client.addEventListener('Runtime.consoleAPICalled', () => {});
    }
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    if (!this._pageId)
      throw new Error('No page target available');

    await this._ensureSession();
    await this._client.send('Page.navigate', { url });
  }

  /**
   * Evaluate JavaScript
   */
  async evaluate(expression: string): Promise<any> {
    if (!this._pageId)
      throw new Error('No page target available');

    await this._ensureSession();
    const result = await this._client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    return result.result?.value ?? result.result;
  }

  /**
   * Get page title
   */
  async title(): Promise<string> {
    if (!this._pageId)
      return '';

    try {
      await this._ensureSession();
      const result = await this._client.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      });

      return result.result?.value ?? '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Get page URL
   */
  async url(): Promise<string> {
    if (!this._pageId)
      return '';

    try {
      await this._ensureSession();
      const result = await this._client.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });

      return result.result?.value ?? '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Take screenshot of the WebView
   */
  async screenshot(): Promise<Buffer> {
    if (!this._pageId)
      throw new Error('No page target available');

    await this._ensureSession();
    const { data } = await this._client.send('Page.captureScreenshot', {});
    return Buffer.from(data, 'base64');
  }

  /**
   * Close the WebView connection
   */
  close(): void {
    this._client.close();
  }
}

/**
 * Connect to a WebView via localabstract socket
 */
export async function connectToWebView(
  openSocket: (command: string) => Promise<SocketBackend>,
  socketName: string,
  pkg: string
): Promise<WebView> {
  kWebViewDebug(`Connecting to WebView: ${socketName} (${pkg})`);

  // Perform HTTP Upgrade to WebSocket
  const socket = await openSocket(`localabstract:${socketName}`);
  
  await socket.write(Buffer.from(`GET /devtools/browser HTTP/1.1\r
Upgrade: WebSocket\r
Connection: Upgrade\r
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r
Sec-WebSocket-Version: 13\r
\r
`));

  // Read HTTP Upgrade response
  await new Promise<void>((resolve, reject) => {
    const handler = (data: Buffer) => {
      const str = data.toString();
      if (str.includes('101 Switching Protocols') || str.includes('HTTP/1.1')) {
        socket.removeListener('data', handler);
        resolve();
      }
    };
    socket.on('data', handler);
    socket.on('error', reject);
  });

  const client = new WebViewCDPClient(socket);
  const webView = new WebView(client, socketName, pkg);
  await webView.init();

  kWebViewDebug(`Connected to WebView: ${socketName}`);
  return webView;
}
