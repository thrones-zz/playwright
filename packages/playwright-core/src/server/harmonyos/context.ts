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
import { HarmonyOSDevice } from './harmonyos';

/**
 * HarmonyOS Browser Context
 * 实现上下文隔离，支持多标签页管理
 */
export class HarmonyOSContext extends EventEmitter {
  private _device: HarmonyOSDevice;
  private _pages: HarmonyOSPage[] = [];
  private _isClosed = false;
  private _storage: Record<string, any> = {};
  private _cookies: any[] = [];
  private _viewport: { width: number; height: number } | null = null;

  constructor(device: HarmonyOSDevice) {
    super();
    this._device = device;
  }

  get device(): HarmonyOSDevice {
    return this._device;
  }

  get pages(): HarmonyOSPage[] {
    return [...this._pages];
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  /**
   * 设置视口大小
   */
  setViewport(viewport: { width: number; height: number }): void {
    this._viewport = viewport;
  }

  /**
   * 添加页面到上下文
   */
  addPage(page: HarmonyOSPage): void {
    this._pages.push(page);
    page.on('close', () => this._removePage(page));
    this.emit('page', page);
  }

  private _removePage(page: HarmonyOSPage): void {
    const index = this._pages.indexOf(page);
    if (index !== -1) {
      this._pages.splice(index, 1);
    }
  }

  /**
   * 创建新页面
   */
  async newPage(): Promise<HarmonyOSPage> {
    if (this._isClosed) {
      throw new Error('Context is closed');
    }

    // 通过浏览器启动新页面
    const browser = await this._device.launchBrowser();
    const socketName = browser.socketName;

    const page = new HarmonyOSPage(this, socketName);
    this.addPage(page);

    return page;
  }

  /**
   * 关闭上下文
   */
  async close(): Promise<void> {
    if (this._isClosed) return;
    this._isClosed = true;

    // 关闭所有页面
    await Promise.all(this._pages.map(page => page.close()));
    this._pages = [];
    
    this.emit('close');
  }

  /**
   * 获取所有 cookies
   */
  async cookies(): Promise<any[]> {
    return [...this._cookies];
  }

  /**
   * 设置 cookies
   */
  async addCookies(cookies: any[]): Promise<void> {
    this._cookies.push(...cookies);
  }

  /**
   * 清除 cookies
   */
  async clearCookies(): Promise<void> {
    this._cookies = [];
  }

  /**
   * 获取存储状态
   */
  async storageState(): Promise<{ cookies: any[]; storage: Record<string, any> }> {
    return {
      cookies: this._cookies,
      storage: this._storage,
    };
  }

  /**
   * 设置存储状态
   */
  async setStorageState(state: { cookies?: any[]; storage?: Record<string, any> }): Promise<void> {
    if (state.cookies) {
      this._cookies = state.cookies;
    }
    if (state.storage) {
      this._storage = state.storage;
    }
  }
}

/**
 * HarmonyOS Page
 * 模拟 Playwright Page API
 */
export class HarmonyOSPage extends EventEmitter {
  private _context: HarmonyOSContext;
  private _socketName: string;
  private _isClosed = false;
  private _url = '';

  constructor(context: HarmonyOSContext, socketName: string) {
    super();
    this._context = context;
    this._socketName = socketName;
  }

  get context(): HarmonyOSContext {
    return this._context;
  }

  get socketName(): string {
    return this._socketName;
  }

  get url(): string {
    return this._url;
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  /**
   * 导航到 URL
   */
  async goto(url: string): Promise<void> {
    await this._context.device.webViewNavigate(this._socketName, url);
    this._url = url;
    this.emit('navigate', { url });
  }

  /**
   * 执行 JavaScript
   */
  async evaluate(expression: string): Promise<any> {
    return await this._context.device.webViewEvaluate(this._socketName, expression);
  }

  /**
   * 截图
   */
  async screenshot(): Promise<Buffer> {
    return await this._context.device.webViewScreenshot(this._socketName);
  }

  /**
   * 获取标题
   */
  async title(): Promise<string> {
    try {
      return await this.evaluate('document.title') || '';
    } catch {
      return '';
    }
  }

  /**
   * 等待加载
   */
  async waitForLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    const timeout = 30000;
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const ready = await this.evaluate('document.readyState');
      if (state === 'load' && ready === 'complete') return;
      if (state === 'domcontentloaded' && ready !== 'loading') return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Load timeout');
  }

  /**
   * 等待 URL
   */
  async waitForURL(url: string | RegExp, options: { timeout?: number } = {}): Promise<void> {
    const timeout = options.timeout || 30000;
    const start = Date.now();
    const pattern = url instanceof RegExp ? url : new RegExp(url);
    
    while (Date.now() - start < timeout) {
      const currentUrl = this._url;
      if (pattern.test(currentUrl)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Wait for URL timeout: ${url}`);
  }

  /**
   * 后退
   */
  async goBack(): Promise<void> {
    await this.evaluate('window.history.back()');
  }

  /**
   * 前进
   */
  async goForward(): Promise<void> {
    await this.evaluate('window.history.forward()');
  }

  /**
   * 刷新
   */
  async reload(): Promise<void> {
    await this.evaluate('window.location.reload()');
  }

  /**
   * 点击元素
   */
  async click(selector: string): Promise<void> {
    await this.evaluate(`
      document.querySelector('${selector.replace(/'/g, "\\'")}')?.click()
    `);
  }

  /**
   * 填写表单
   */
  async fill(selector: string, value: string): Promise<void> {
    await this.evaluate(`
      (document.querySelector('${selector.replace(/'/g, "\\'")}') || {}).value = '${value.replace(/'/g, "\\'")}'
    `);
  }

  /**
   * 拖拽
   */
  async dragAndDrop(source: string, target: string, options: { timeout?: number } = {}): Promise<void> {
    const timeout = options.timeout || 30000;
    
    // 获取源和目标元素的位置
    const sourceBounds = await this.evaluate(`
      (() => {
        const el = document.querySelector('${source.replace(/'/g, "\\'")}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
      })()
    `);

    const targetBounds = await this.evaluate(`
      (() => {
        const el = document.querySelector('${target.replace(/'/g, "\\'")}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
      })()
    `);

    if (!sourceBounds || !targetBounds) {
      throw new Error('Source or target element not found');
    }

    // 使用 JavaScript 模拟拖拽
    await this.evaluate(`
      (() => {
        const source = document.querySelector('${source.replace(/'/g, "\\'")}');
        const target = document.querySelector('${target.replace(/'/g, "\\'")}');
        if (!source || !target) return;
        
        // 创建拖拽事件
        const createDragEvent = (type, x, y) => {
          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: new DataTransfer()
          });
          return event;
        };
        
        // 触发拖拽事件
        source.dispatchEvent(createDragEvent('dragstart', ${sourceBounds.x}, ${sourceBounds.y}));
        target.dispatchEvent(createDragEvent('dragover', ${targetBounds.x}, ${targetBounds.y}));
        target.dispatchEvent(createDragEvent('drop', ${targetBounds.x}, ${targetBounds.y}));
        source.dispatchEvent(createDragEvent('dragend', ${sourceBounds.x}, ${sourceBounds.y}));
      })()
    `);
  }

  /**
   * 获取内容
   */
  async content(): Promise<string> {
    return await this.evaluate('document.documentElement.outerHTML');
  }

  /**
   * 关闭页面
   */
  async close(): Promise<void> {
    if (this._isClosed) return;
    this._isClosed = true;
    this.emit('close');
  }
}

/**
 * 创建设备上下文
 */
export async function createContext(device: HarmonyOSDevice): Promise<HarmonyOSContext> {
  return new HarmonyOSContext(device);
}

/**
 * 创建设备页面
 */
export async function createPage(context: HarmonyOSContext): Promise<HarmonyOSPage> {
  return context.newPage();
}
