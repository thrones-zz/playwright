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
import * as http from 'http';
import * as https from 'https';
import { WebViewCDPClient, connectToWebView } from './webview';
import debug from 'debug';

const kBrowserDebug = debug('pw:harmonyos:browser');

/**
 * 海泰浏览器包名
 */
export const HITA_BROWSER_PACKAGE = 'com.hitakashi.browser';

/**
 * 海泰浏览器默认启动参数
 */
export interface BrowserLaunchOptions {
  headless?: boolean;
  args?: string[];
  userDataDir?: string;
  timeout?: number;
}

/**
 * 海泰浏览器实例
 */
export class HarmonyOSBrowser extends EventEmitter {
  private _connection: any;
  private _webView: any;
  private _socketName: string;
  private _isRunning = false;
  private _closed = false;

  constructor(connection: any, socketName: string) {
    super();
    this._connection = connection;
    this._socketName = socketName;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get socketName(): string {
    return this._socketName;
  }

  get webView() {
    return this._webView;
  }

  /**
   * 导航到 URL
   */
  async navigate(url: string): Promise<void> {
    if (this._webView) {
      await this._webView.navigate(url);
    }
  }

  /**
   * 执行 JavaScript
   */
  async evaluate(expression: string): Promise<any> {
    if (this._webView) {
      return await this._webView.evaluate(expression);
    }
    throw new Error('Browser not running');
  }

  /**
   * 截图
   */
  async screenshot(): Promise<Buffer> {
    if (this._webView) {
      return await this._webView.screenshot();
    }
    throw new Error('Browser not running');
  }

  /**
   * 等待加载完成
   */
  async waitForLoad(timeout: number = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ready = await this.evaluate('document.readyState');
      if (ready === 'complete') return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Page load timeout');
  }

  /**
   * 获取页面标题
   */
  async title(): Promise<string> {
    return await this.evaluate('document.title');
  }

  /**
   * 获取当前 URL
   */
  async url(): Promise<string> {
    return await this.evaluate('window.location.href');
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._isRunning = false;

    try {
      if (this._webView) {
        this._webView.close();
      }
      if (this._connection) {
        await this._connection.shell(`am force-stop ${HITA_BROWSER_PACKAGE}`);
        this._connection.close();
      }
    } catch (e) {
      kBrowserDebug('Error closing browser:', e);
    }

    this.emit('close');
  }
}

/**
 * HTTP Request API 实现
 */
export class HarmonyOSRequest {
  private _url: string;
  private _method: string = 'GET';
  private _headers: Record<string, string> = {};
  private _body?: string;
  private _response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: Buffer;
  };

  constructor(requestUrl: string) {
    this._url = requestUrl;
  }

  method(method: string): this {
    this._method = method;
    return this;
  }

  headers(headers: Record<string, string>): this {
    this._headers = { ...this._headers, ...headers };
    return this;
  }

  postData(data: string): this {
    this._body = data;
    if (!this._headers['Content-Type']) {
      this._headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return this;
  }

  async send(): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this._url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port) : (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: this._method,
        headers: this._headers,
      };

      const req = httpModule.request(options, (res) => {
        const chunks: Buffer[] = [];
        
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers: Record<string, string> = {};
          
          Object.entries(res.headers).forEach(([k, v]) => {
            headers[k] = Array.isArray(v) ? v.join(', ') : (v || '');
          });

          this._response = {
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers,
            body,
          };

          resolve({
            status: () => this._response!.status,
            statusText: () => this._response!.statusText,
            headers: () => this._response!.headers,
            body: () => this._response!.body,
            text: () => this._response!.body.toString('utf8'),
            json: () => {
              try {
                return JSON.parse(this._response!.body.toString('utf8'));
              } catch (e) {
                throw new Error('Response is not valid JSON');
              }
            },
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (this._body) {
        req.write(this._body);
      }
      req.end();
    });
  }

  static async get(requestUrl: string, headers?: Record<string, string>): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new HarmonyOSRequest(requestUrl).headers(headers || {}).send();
  }

  static async post(requestUrl: string, data?: string, headers?: Record<string, string>): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new HarmonyOSRequest(requestUrl).method('POST').headers(headers || {}).postData(data || '').send();
  }

  static async put(requestUrl: string, data?: string, headers?: Record<string, string>): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new HarmonyOSRequest(requestUrl).method('PUT').headers(headers || {}).postData(data || '').send();
  }

  static async delete(requestUrl: string, headers?: Record<string, string>): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new HarmonyOSRequest(requestUrl).method('DELETE').headers(headers || {}).send();
  }

  static async patch(requestUrl: string, data?: string, headers?: Record<string, string>): Promise<{
    status(): number;
    statusText(): string;
    headers(): Record<string, string>;
    body(): Buffer;
    text(): string;
    json(): any;
  }> {
    return new HarmonyOSRequest(requestUrl).method('PATCH').headers(headers || {}).postData(data || '').send();
  }
}

/**
 * 创建 HarmonyOS Request 实例
 */
export function createRequest(requestUrl: string): HarmonyOSRequest {
  return new HarmonyOSRequest(requestUrl);
}
