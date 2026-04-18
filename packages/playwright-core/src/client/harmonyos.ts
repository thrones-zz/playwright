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

import { EventEmitter } from './eventEmitter';
import { ChannelOwner } from './channelOwner';
import { TimeoutSettings } from './timeoutSettings';

import type * as types from './types';
import type * as api from '../../types/types';
import type * as channels from '@protocol/channels';
import type { Playwright } from './playwright';

export interface ArkUINode {
  id: string;
  type: string;
  text?: string;
  resourceId?: string;
  clickable?: boolean;
  enabled?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  children?: ArkUINode[];
}

export interface ArkUISelector {
  type?: string;
  text?: string | RegExp;
  resourceId?: string;
  clickable?: boolean;
  enabled?: boolean;
}

export class HarmonyOS extends ChannelOwner<channels.HarmonyOSChannel> implements api.HarmonyOS {
  _playwright!: Playwright;
  readonly _timeoutSettings: TimeoutSettings;

  static from(harmonyos: channels.HarmonyOSChannel): HarmonyOS {
    return (harmonyos as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.HarmonyOSInitializer) {
    super(parent, type, guid, initializer);
    this._timeoutSettings = new TimeoutSettings(this._platform);
  }

  setDefaultTimeout(timeout: number) {
    this._timeoutSettings.setDefaultTimeout(timeout);
  }

  async devices(options: { port?: number } = {}): Promise<HarmonyOSDevice[]> {
    const { devices } = await this._channel.devices(options);
    return devices.map(d => HarmonyOSDevice.from(d));
  }
}

export class HarmonyOSDevice extends ChannelOwner<channels.HarmonyOSDeviceChannel> implements api.HarmonyOSDevice {
  readonly _timeoutSettings: TimeoutSettings;
  private _webViews = new Map<string, HarmonyOSWebView>();
  private _harmonyos: HarmonyOS;
  _shouldCloseConnectionOnClose = false;

  static from(device: channels.HarmonyOSDeviceChannel): HarmonyOSDevice {
    return (device as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.HarmonyOSDeviceInitializer) {
    super(parent, type, guid, initializer);
    this._harmonyos = parent as HarmonyOS;
    this._timeoutSettings = new TimeoutSettings(this._platform, this._harmonyos._timeoutSettings);
    this._channel.on('webViewAdded', ({ webView }) => this._onWebViewAdded(webView));
    this._channel.on('webViewRemoved', ({ socketName }) => this._onWebViewRemoved(socketName));
    this._channel.on('close', () => this._didClose());
  }

  private _onWebViewAdded(webView: channels.HarmonyOSWebView) {
    const view = new HarmonyOSWebView(this, webView);
    this._webViews.set(webView.socketName, view);
    this.emit('webview', view);
  }

  private _onWebViewRemoved(socketName: string) {
    const view = this._webViews.get(socketName);
    this._webViews.delete(socketName);
    if (view)
      view.emit('close');
  }

  setDefaultTimeout(timeout: number) {
    this._timeoutSettings.setDefaultTimeout(timeout);
  }

  serial(): string {
    return this._initializer.serial;
  }

  model(): string {
    return this._initializer.model;
  }

  osVersion(): string {
    return this._initializer.osVersion;
  }

  webViews(): HarmonyOSWebView[] {
    return [...this._webViews.values()];
  }

  async screenshot(): Promise<Buffer> {
    const { binary } = await this._channel.screenshot();
    return binary;
  }

  async shell(command: string): Promise<Buffer> {
    const { result } = await this._channel.shell({ command });
    return result;
  }

  /**
   * 获取当前页面 UI 树 (ArkUI Inspector)
   */
  async getPageSource(): Promise<ArkUINode> {
    const { source } = await this._channel.getPageSource();
    return source;
  }

  /**
   * 查找第一个匹配的 ArkUI 元素
   */
  async findElement(selector: ArkUISelector): Promise<ArkUIElement | null> {
    const { element } = await this._channel.findElement({ selector: toSelectorChannel(selector) });
    if (!element) return null;
    return new ArkUIElement(this, element);
  }

  /**
   * 查找所有匹配的 ArkUI 元素
   */
  async findElements(selector: ArkUISelector): Promise<ArkUIElement[]> {
    const { elements } = await this._channel.findElements({ selector: toSelectorChannel(selector) });
    return (elements || []).map((e: ArkUINode) => new ArkUIElement(this, e));
  }

  /**
   * 创建录制器
   */
  recorder(options?: { language?: string }): ArkUIRecorder {
    return new ArkUIRecorder(this, options);
  }

  /**
   * 创建定位器 - Playwright 风格的元素定位
   * @param selector 基础选择器（可以是组件类型如 'Button' 或 'Text'）
   * @returns ArkUILocator 实例，支持链式调用
   *
   * @example
   * // 基础用法
   * await device.locator('Button').first().click();
   *
   * // 链式调用
   * await device.locator('Button').getByText('提交').click();
   *
   * // 按角色定位
   * await device.locator().getByRole('button', { name: '确认' }).click();
   *
   * // 过滤
   * const buttons = await device.locator('Button').filter({ hasText: '取消' }).all();
   */
  locator(selector?: string | ArkUISelector): ArkUILocator {
    const sel: ArkUISelector = typeof selector === 'string'
      ? { type: selector }
      : (selector || {});
    return new ArkUILocator(this, sel);
  }

  /**
   * 通过文本内容定位元素
   * @param text 要匹配的文本（支持正则表达式或字符串）
   * @param options { exact?: boolean } 是否精确匹配
   * @returns ArkUILocator 实例
   *
   * @example
   * await device.getByText('确定').click();
   * await device.getByText(/^取消$/).click(); // 精确匹配
   * await device.getByText('提交', { exact: false }).click();
   */
  getByText(text: string | RegExp, options: { exact?: boolean } = {}): ArkUILocator {
    const selector: ArkUISelector = {
      text: options.exact ? new RegExp(`^${text}$`) : (text instanceof RegExp ? text : new RegExp(text, 'i'))
    };
    return new ArkUILocator(this, selector);
  }

  /**
   * 通过 ARIA 角色定位元素
   * @param role ARIA 角色 (button, checkbox, radio, textbox, switch, link, menuitem 等)
   * @param options { name?: string | RegExp, exact?: boolean } 角色名称和匹配选项
   * @returns ArkUILocator 实例
   *
   * @example
   * await device.getByRole('button', { name: '提交' }).click();
   * await device.getByRole('checkbox').nth(0).click();
   * await device.getByRole('link', { name: '了解更多' }).click();
   */
  getByRole(role: string, options: { name?: string | RegExp; exact?: boolean } = {}): ArkUILocator {
    // ARIA 角色到 ArkUI 组件类型的映射
    const roleToType: Record<string, string> = {
      'button': 'Button',
      'checkbox': 'Checkbox',
      'radio': 'Radio',
      'radiobutton': 'Radio',
      'textbox': 'TextInput',
      'searchbox': 'Search',
      'search': 'Search',
      'switch': 'Toggle',
      'toggle': 'Toggle',
      'tab': 'Tabs',
      'tablist': 'TabContent',
      'menuitem': 'MenuItem',
      'menu': 'Menu',
      'link': 'NavigationButton',
      'navigation': 'Navigation',
      'dialog': 'Dialog',
      'alertdialog': 'AlertDialog',
      'listbox': 'ListContainer',
      'option': 'ListItem',
      'listitem': 'ListItem',
      'img': 'Image',
      'image': 'Image',
      'heading': 'Text',
      'label': 'Text',
      'slider': 'Slider',
      'progressbar': 'Progress',
      'progress': 'Progress',
      'text': 'Text',
      'textarea': 'TextArea',
      'richeditor': 'RichEditor',
    };

    const normalizedRole = role.toLowerCase();
    const selector: ArkUISelector = {};

    if (roleToType[normalizedRole]) {
      selector.type = roleToType[normalizedRole];
    }

    if (options.name) {
      selector.text = options.exact
        ? new RegExp(`^${options.name}$`)
        : (options.name instanceof RegExp ? options.name : new RegExp(String(options.name), 'i'));
    }

    return new ArkUILocator(this, selector);
  }

  /**
   * 等待元素出现或消失
   * @param selector 元素选择器
   * @param options.wait 等待时间(毫秒)，默认 30000
   * @param options.state 等待状态: 'attached' | 'visible' | 'detached' | 'hidden'
   */
  async waitFor(selector: ArkUISelector, options: { wait?: number; state?: 'attached' | 'visible' | 'detached' | 'hidden' } = {}): Promise<ArkUIElement | null> {
    const timeout = options.wait || 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = await this.findElement(selector);
      if (element && (options.state === 'visible' || options.state === 'attached' || !options.state)) {
        return element;
      }
      if (!element && (options.state === 'detached' || options.state === 'hidden')) {
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return null;
  }

  /**
   * 发送本地文件到设备
   * @param localPath 本地文件路径
   * @param remotePath 设备目标路径
   */
  async sendFile(localPath: string, remotePath: string): Promise<void> {
    await this._channel.sendFile({ localPath, remotePath });
  }

  /**
   * 连接到 WebView CDP
   * @param socketName WebView DevTools socket 名称
   */
  async connectWebViewCDP(socketName: string): Promise<string> {
    const { clientId } = await this._channel.connectWebViewCDP({ socketName });
    return clientId;
  }

  /**
   * 在 WebView 中执行 JavaScript
   * @param socketName WebView DevTools socket 名称
   * @param expression JavaScript 表达式
   */
  async webViewEvaluate(socketName: string, expression: string): Promise<any> {
    const { result } = await this._channel.webViewEvaluate({ socketName, expression });
    return result;
  }

  /**
   * 获取 WebView 页面内容
   * @param socketName WebView DevTools socket 名称
   */
  async webViewGetContent(socketName: string): Promise<string> {
    return await this.webViewEvaluate(socketName, 'document.documentElement.outerHTML') as string;
  }

  /**
   * WebView 截图
   * @param socketName WebView DevTools socket 名称
   */
  async webViewScreenshot(socketName: string): Promise<Buffer> {
    const { binary } = await this._channel.webViewScreenshot({ socketName });
    return binary;
  }

  /**
   * 元素截图
   * @param socketName WebView DevTools socket 名称
   * @param selector CSS 选择器
   */
  async captureElement(socketName: string, selector: string): Promise<Buffer> {
    // 通过 JS 执行获取元素截图
    const bounds = await this.webViewEvaluate(socketName, `
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `) as { x: number; y: number; width: number; height: number } | null;

    if (!bounds) {
      throw new Error(`Element not found: ${selector}`);
    }

    // 获取完整截图
    return await this.webViewScreenshot(socketName);
  }

  /**
   * 点击元素
   * @param socketName WebView DevTools socket 名称
   * @param selector CSS 选择器
   */
  async clickElement(socketName: string, selector: string): Promise<void> {
    await this.webViewEvaluate(socketName, `
      document.querySelector('${selector.replace(/'/g, "\\'")}')?.click()
    `);
  }

  /**
   * 等待元素出现
   * @param socketName WebView DevTools socket 名称
   * @param selector CSS 选择器
   * @param timeout 超时时间(毫秒)
   */
  async waitForElement(socketName: string, selector: string, timeout: number = 30000): Promise<void> {
    const safeSelector = selector.replace(/'/g, "\\'");
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const exists = await this.webViewEvaluate(socketName, `
        !!document.querySelector('${safeSelector}')
      `);
      if (exists) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Element not found: ${selector}`);
  }

  /**
   * 模拟网络响应
   * @param socketName WebView DevTools socket 名称
   * @param urlPattern URL 模式
   * @param response 模拟响应
   */
  async mockResponse(socketName: string, urlPattern: string, response: {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  }): Promise<void> {
    await this.webViewEvaluate(socketName, `
      (() => {
        const originalFetch = window.fetch;
        window.fetch = async (url, options) => {
          const urlStr = typeof url === 'string' ? url : url.url;
          if (urlStr.includes('${urlPattern}')) {
            return new Response(${response.body ? `'${response.body}'` : 'null'}, {
              status: ${response.status || 200},
              headers: ${JSON.stringify(response.headers || {})}
            });
          }
          return originalFetch(url, options);
        };
      })()
    `);
  }

  /**
   * 页面导航
   * @param socketName WebView DevTools socket 名称
   * @param url 目标 URL
   */
  async webViewNavigate(socketName: string, url: string): Promise<void> {
    await this.webViewEvaluate(socketName, `window.location.href = '${url}'`);
  }

  /**
   * 后退一页
   * @param socketName WebView DevTools socket 名称
   */
  async webViewGoBack(socketName: string): Promise<void> {
    await this.webViewEvaluate(socketName, 'window.history.back()');
  }

  /**
   * 前进一页
   * @param socketName WebView DevTools socket 名称
   */
  async webViewGoForward(socketName: string): Promise<void> {
    await this.webViewEvaluate(socketName, 'window.history.forward()');
  }

  /**
   * 刷新页面
   * @param socketName WebView DevTools socket 名称
   */
  async webViewReload(socketName: string): Promise<void> {
    await this.webViewEvaluate(socketName, 'window.location.reload()');
  }

  /**
   * 启动海泰浏览器
   * @param options 启动选项
   */
  async launchBrowser(options: {
    headless?: boolean;
    args?: string[];
    timeout?: number;
  } = {}): Promise<{
    socketName: string;
    package: string;
  }> {
    return await this._channel.launchBrowser(options);
  }

  /**
   * HTTP GET 请求
   * @param url 请求 URL
   * @param headers 请求头
   */
  async httpGet(url: string, headers?: Record<string, string>): Promise<{
    status: number;
    body: string;
    json: any;
    raw: Buffer;
  }> {
    const result = await this._channel.get({ url, headers });
    return {
      status: result.status,
      body: result.body.toString(),
      json: JSON.parse(result.body.toString()),
      raw: result.body,
    };
  }

  /**
   * HTTP POST 请求
   * @param url 请求 URL
   * @param data 请求数据
   * @param headers 请求头
   */
  async httpPost(url: string, data?: string, headers?: Record<string, string>): Promise<{
    status: number;
    body: string;
    json: any;
    raw: Buffer;
  }> {
    const result = await this._channel.post({ url, data, headers });
    return {
      status: result.status,
      body: result.body.toString(),
      json: JSON.parse(result.body.toString()),
      raw: result.body,
    };
  }

  /**
   * HTTP 请求 (通用)
   * @param url 请求 URL
   * @param options 请求选项
   */
  async httpRequest(url: string, options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}): Promise<{
    status: number;
    body: string;
    json: any;
    raw: Buffer;
    headers: Record<string, string>;
  }> {
    const result = await this._channel.request({ url, ...options });
    return {
      status: result.status,
      body: result.body.toString(),
      json: JSON.parse(result.body.toString()),
      raw: result.body,
      headers: result.headers,
    };
  }

  async close() {
    await this._channel.close();
  }

  _didClose() {
    this.emit('close', this);
  }
}

export class HarmonyOSWebView extends EventEmitter {
  private _device: HarmonyOSDevice;
  private _data: channels.HarmonyOSWebView;

  constructor(device: HarmonyOSDevice, data: channels.HarmonyOSWebView) {
    super(device._platform);
    this._device = device;
    this._data = data;
  }

  socketName(): string {
    return this._data.socketName;
  }

  package(): string {
    return this._data.package;
  }

  title(): string {
    return this._data.title;
  }

  url(): string {
    return this._data.url;
  }
}

/**
 * ArkUI Element - 表示 HarmonyOS 原生 UI 元素
 */
export class ArkUIElement {
  private _device: HarmonyOSDevice;
  private _node: ArkUINode;

  constructor(device: HarmonyOSDevice, node: ArkUINode) {
    this._device = device;
    this._node = node;
  }

  get id(): string { return this._node.id; }
  get type(): string { return this._node.type; }
  get text(): string | undefined { return this._node.text; }
  get resourceId(): string | undefined { return this._node.resourceId; }
  get clickable(): boolean { return !!this._node.clickable; }
  get enabled(): boolean { return !!this._node.enabled; }
  get bounds() { return this._node.bounds; }

  /**
   * 点击元素
   */
  async click(): Promise<void> {
    const center = this._getCenter();
    await this._device.shell(`uinput -c ${center.x} ${center.y}`);
  }

  /**
   * 长按元素
   */
  async longClick(duration: number = 1000): Promise<void> {
    const center = this._getCenter();
    await this._device.shell(`uinput -c ${center.x} ${center.y} -d ${duration}`);
  }

  /**
   * 双击元素
   */
  async dblclick(): Promise<void> {
    const center = this._getCenter();
    await this._device.shell(`uinput -c ${Math.round(center.x)} ${Math.round(center.y)}`);
    await new Promise(r => setTimeout(r, 100));
    await this._device.shell(`uinput -c ${Math.round(center.x)} ${Math.round(center.y)}`);
  }

  /**
   * 输入文本到元素
   */
  async inputText(text: string): Promise<void> {
    await this._device.shell(`uinput -T "${text}"`);
  }

  /**
   * 滚动元素视图
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', percent: number = 80): Promise<void> {
    const center = this._getCenter();
    if (!this._node.bounds) throw new Error('Element has no bounds');
    const distance = (Math.max(this._node.bounds.width, this._node.bounds.height) * percent) / 100;
    let sx = center.x, sy = center.y, ex = center.x, ey = center.y;
    switch (direction) {
      case 'up': sy = center.y + distance / 2; ey = center.y - distance / 2; break;
      case 'down': sy = center.y - distance / 2; ey = center.y + distance / 2; break;
      case 'left': sx = center.x + distance / 2; ex = center.x - distance / 2; break;
      case 'right': sx = center.x - distance / 2; ex = center.x + distance / 2; break;
    }
    await this._device.shell(`uinput -m ${Math.round(sx)} ${Math.round(sy)} ${Math.round(ex)} ${Math.round(ey)}`);
  }

  /**
   * 从元素滑动到目标位置
   */
  async swipe(endX: number, endY: number, duration: number = 300): Promise<void> {
    const start = this._getCenter();
    await this._device.shell(`uinput -m ${Math.round(start.x)} ${Math.round(start.y)} ${Math.round(endX)} ${Math.round(endY)} ${duration}`);
  }

  /**
   * 按键操作
   */
  async pressKey(key: string): Promise<void> {
    await this._device.shell(`uinput -k ${key}`);
  }

  /**
   * 获取元素中心点
   */
  private _getCenter(): { x: number; y: number } {
    if (!this._node.bounds) {
      throw new Error('Element has no bounds');
    }
    return {
      x: this._node.bounds.x + this._node.bounds.width / 2,
      y: this._node.bounds.y + this._node.bounds.height / 2
    };
  }

  toString(): string {
    return `ArkUIElement(${this._node.type}${this._node.text ? ` "${this._node.text}"` : ''})`;
  }
}

/**
 * 转换选择器为协议格式
 */
function toSelectorChannel(selector: ArkUISelector): channels.ArkUISelector {
  return {
    type: selector.type,
    text: selector.text instanceof RegExp ? selector.text.source : selector.text,
    resourceId: selector.resourceId,
    clickable: selector.clickable,
    enabled: selector.enabled,
  };
}

/**
 * ArkUI Locator - Playwright 风格的定位器 API
 * 支持链式调用: locator('Button').getByText('提交').click()
 */
export class ArkUILocator {
  private _device: HarmonyOSDevice;
  private _selector: ArkUISelector;
  private _filterStack: ArkUISelector[] = [];

  constructor(device: HarmonyOSDevice, selector: ArkUISelector) {
    this._device = device;
    this._selector = selector;
  }

  /**
   * 获取当前选择器
   */
  _getSelector(): ArkUISelector {
    return { ...this._selector };
  }

  /**
   * 获取累积的选择器（应用于所有 filter）
   */
  _getComposedSelector(): ArkUISelector[] {
    return [this._selector, ...this._filterStack];
  }

  /**
   * 通过文本内容过滤定位器
   * @param text 要匹配的文本（支持正则表达式或字符串）
   * @param options 选项 { exact: boolean }
   */
  getByText(text: string | RegExp, options: { exact?: boolean } = {}): ArkUILocator {
    const newLocator = new ArkUILocator(this._device, this._getSelector());
    newLocator._filterStack = [...this._filterStack];
    newLocator._filterStack.push({
      text: options.exact ? new RegExp(`^${text}$`) : (text instanceof RegExp ? text : new RegExp(text, 'i'))
    } as ArkUISelector);
    return newLocator;
  }

  /**
   * 通过 ARIA 角色过滤定位器
   * @param role ARIA 角色
   * @param options 选项 { name?: string | RegExp, exact?: boolean }
   */
  getByRole(role: string, options: { name?: string | RegExp; exact?: boolean } = {}): ArkUILocator {
    const newLocator = new ArkUILocator(this._device, this._getSelector());
    newLocator._filterStack = [...this._filterStack];

    // ARIA 角色到 ArkUI 组件类型的映射
    const roleToType: Record<string, string> = {
      'button': 'Button',
      'checkbox': 'Checkbox',
      'radio': 'Radio',
      'textbox': 'TextInput',
      'searchbox': 'Search',
      'switch': 'Toggle',
      'tab': 'Tabs',
      'tablist': 'TabContent',
      'menuitem': 'MenuItem',
      'link': 'NavigationButton',
      'dialog': 'Dialog',
      'alertdialog': 'AlertDialog',
      'menu': 'Menu',
      'listbox': 'ListContainer',
      'option': 'ListItem',
      'img': 'Image',
      'heading': 'Text',
      'label': 'Text',
      'slider': 'Slider',
      'progressbar': 'Progress',
    };

    const selector: ArkUISelector = {};
    if (roleToType[role.toLowerCase()]) {
      selector.type = roleToType[role.toLowerCase()];
    }

    // 如果有 name 选项，通过文本匹配
    if (options.name) {
      selector.text = options.exact
        ? new RegExp(`^${options.name}$`)
        : (options.name instanceof RegExp ? options.name : new RegExp(options.name, 'i'));
    }

    newLocator._filterStack.push(selector);
    return newLocator;
  }

  /**
   * 通过占位符文本过滤定位器
   */
  getByPlaceholder(placeholder: string | RegExp, options: { exact?: boolean } = {}): ArkUILocator {
    return this.getByText(placeholder, options);
  }

  /**
   * 通过标签文本过滤定位器
   */
  getByLabel(label: string | RegExp, options: { exact?: boolean } = {}): ArkUILocator {
    return this.getByText(label, options);
  }

  /**
   * 通过 accessibilityId 过滤定位器
   */
  getByAccessibilityId(accessibilityId: string): ArkUILocator {
    const newLocator = new ArkUILocator(this._device, this._getSelector());
    newLocator._filterStack = [...this._filterStack];
    newLocator._filterStack.push({ accessibilityId });
    return newLocator;
  }

  /**
   * 进一步过滤定位器
   */
  filter(options: { hasText?: string | RegExp; has?: ArkUISelector }): ArkUILocator {
    const newLocator = new ArkUILocator(this._device, this._getSelector());
    newLocator._filterStack = [...this._filterStack];

    if (options.hasText) {
      newLocator._filterStack.push({
        text: options.hasText instanceof RegExp ? options.hasText : new RegExp(options.hasText, 'i')
      } as ArkUISelector);
    }

    if (options.has) {
      newLocator._filterStack.push(options.has);
    }

    return newLocator;
  }

  /**
   * 获取第一个匹配的元素
   */
  async first(): Promise<ArkUIElement | null> {
    const elements = await this.all();
    return elements.length > 0 ? elements[0] : null;
  }

  /**
   * 获取最后一个匹配的元素
   */
  async last(): Promise<ArkUIElement | null> {
    const elements = await this.all();
    return elements.length > 0 ? elements[elements.length - 1] : null;
  }

  /**
   * 获取第 N 个匹配的元素（从 0 开始）
   */
  async nth(index: number): Promise<ArkUIElement | null> {
    const elements = await this.all();
    return index >= 0 && index < elements.length ? elements[index] : null;
  }

  /**
   * 获取所有匹配的元素
   */
  async all(): Promise<ArkUIElement[]> {
    const selectors = this._getComposedSelector();

    // 如果只有一个选择器，直接查询
    if (selectors.length === 1) {
      return await this._device.findElements(selectors[0]);
    }

    // 多重过滤：先按第一个选择器查询，再逐个过滤
    let elements = await this._device.findElements(selectors[0]);

    // 逐个应用后续选择器过滤
    for (let i = 1; i < selectors.length; i++) {
      const filterSelector = selectors[i];
      elements = elements.filter(el => {
        if (filterSelector.text) {
          const text = el.text || '';
          if (filterSelector.text instanceof RegExp) {
            if (!filterSelector.text.test(text)) return false;
          } else if (typeof filterSelector.text === 'string') {
            if (!text.toLowerCase().includes(filterSelector.text.toLowerCase())) return false;
          }
        }
        if (filterSelector.accessibilityId) {
          if (el.id !== filterSelector.accessibilityId) return false;
        }
        return true;
      });
    }

    return elements;
  }

  /**
   * 计算匹配元素的数量
   */
  async count(): Promise<number> {
    const elements = await this.all();
    return elements.length;
  }

  /**
   * 点击第一个匹配的元素
   */
  async click(options?: { timeout?: number; noWaitAfter?: boolean }): Promise<void> {
    const element = await this.first();
    if (!element) {
      throw new Error(`Element not found for locator: ${JSON.stringify(this._selector)}`);
    }
    await element.click();
  }

  /**
   * 双击第一个匹配的元素
   */
  async dblclick(options?: { timeout?: number }): Promise<void> {
    const element = await this.first();
    if (!element) {
      throw new Error(`Element not found for locator: ${JSON.stringify(this._selector)}`);
    }
    await element.dblclick();
  }

  /**
   * 长按第一个匹配的元素
   */
  async clickAndHold(duration: number = 1000): Promise<void> {
    const element = await this.first();
    if (!element) {
      throw new Error(`Element not found for locator: ${JSON.stringify(this._selector)}`);
    }
    await element.longClick(duration);
  }

  /**
   * 输入文本到第一个匹配的元素
   */
  async fill(text: string, options?: { timeout?: number }): Promise<void> {
    const element = await this.first();
    if (!element) {
      throw new Error(`Element not found for locator: ${JSON.stringify(this._selector)}`);
    }
    await element.inputText(text);
  }

  /**
   * 聚焦第一个匹配的元素
   */
  async focus(): Promise<void> {
    // ArkUI 不需要显式聚焦
  }

  /**
   * 悬停第一个匹配的元素
   */
  async hover(): Promise<void> {
    // ArkUI 不支持 hover
  }

  /**
   * 等待元素可见
   */
  async waitFor(options: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' } = {}): Promise<void> {
    const timeout = options.timeout || 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const count = await this.count();

      if (options.state === 'attached' || options.state === 'visible') {
        if (count > 0) return;
      } else if (options.state === 'detached' || options.state === 'hidden') {
        if (count === 0) return;
      } else {
        if (count > 0) return;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`Timeout waiting for locator: ${JSON.stringify(this._selector)}`);
  }

  /**
   * 获取元素的文本内容
   */
  async textContent(): Promise<string | null> {
    const element = await this.first();
    return element?.text || null;
  }

  /**
   * 获取元素的内部文本
   */
  async innerText(): Promise<string | null> {
    return this.textContent();
  }

  /**
   * 获取元素的 HTML 内容
   */
  async innerHTML(): Promise<string | null> {
    return null; // ArkUI 不支持 HTML
  }

  /**
   * 检查元素是否可见
   */
  async isVisible(): Promise<boolean> {
    const element = await this.first();
    return element !== null;
  }

  /**
   * 检查元素是否可用
   */
  async isEnabled(): Promise<boolean> {
    const element = await this.first();
    return element?.enabled || false;
  }

  /**
   * 检查元素是否可点击
   */
  async isDisabled(): Promise<boolean> {
    const element = await this.first();
    return element ? !element.enabled : true;
  }

  /**
   * 截图
   */
  async screenshot(options?: { timeout?: number }): Promise<Buffer> {
    return await this._device.screenshot();
  }

  /**
   * 滚动到元素
   */
  async scrollIntoViewIfNeeded(): Promise<void> {
    // ArkUI 自动处理滚动
  }

  /**
   * 按回车键
   */
  async press(key: 'Enter' | 'Backspace' | 'Delete' | 'Tab' | 'Escape' | 'Home' | 'End'): Promise<void> {
    const element = await this.first();
    if (element) {
      await element.pressKey(key.toLowerCase());
    }
  }

  /**
   * 滚动
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', percent: number = 80): Promise<void> {
    const element = await this.first();
    if (element) {
      await element.scroll(direction, percent);
    }
  }

  /**
   * 获取元素属性
   */
  async getAttribute(name: string): Promise<string | null> {
    const element = await this.first();
    if (!element) return null;

    switch (name) {
      case 'text':
      case 'textContent':
        return element.text || null;
      case 'type':
        return element.type;
      case 'id':
      case 'resourceId':
        return element.resourceId || null;
      case 'enabled':
        return String(element.enabled);
      case 'clickable':
        return String(element.clickable);
      default:
        return null;
    }
  }

  toString(): string {
    const filters = this._filterStack.map(f => {
      const parts: string[] = [];
      if (f.type) parts.push(`type=${f.type}`);
      if (f.text) parts.push(`text=${f.text}`);
      if (f.accessibilityId) parts.push(`accessibilityId=${f.accessibilityId}`);
      return parts.join(', ');
    }).join(' -> ');

    return `Locator(${JSON.stringify(this._selector)}${filters ? ' -> ' + filters : ''})`;
  }
}

/**
 * ArkUI Recorder - 录制回放客户端
 */
export class ArkUIRecorder {
  private device: HarmonyOSDevice;
  private actions: any[] = [];
  private isRecording = false;
  private language: string;

  constructor(device: HarmonyOSDevice, options?: { language?: string }) {
    this.device = device;
    this.language = options?.language || 'javascript';
  }

  async start(): Promise<void> {
    this.isRecording = true;
    this.actions = [];
    console.log('🎬 Recording started...');
  }

  async stop(): Promise<any[]> {
    this.isRecording = false;
    console.log(`🎬 Recording stopped. ${this.actions.length} actions captured.`);
    return this.actions;
  }

  recordAction(action: { name: string; selector: ArkUISelector; elementInfo?: any }): void {
    if (!this.isRecording) return;
    this.actions.push({ ...action, timestamp: Date.now() });
    console.log(`  📝 ${action.name}:`, action.elementInfo?.text || action.elementInfo?.type);
  }

  async playback(): Promise<void> {
    console.log(`▶️ Playing back ${this.actions.length} actions...`);
    for (const action of this.actions) {
      const elements = await this.device.findElements(action.selector);
      if (elements.length > 0) {
        const el = elements[0];
        switch (action.name) {
          case 'click':
            await el.click();
            break;
          case 'input':
            await el.inputText(action.text || '');
            break;
        }
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('✅ Playback complete!');
  }

  generateCode(): string {
    const lines: string[] = [
      '// HarmonyOS ArkUI Test',
      `// Generated at: ${new Date().toISOString()}`,
      `// Device: ${this.device.model()} (${this.device.serial()})`,
      '',
    ];

    if (this.language === 'javascript') {
      lines.push("const { _harmonyos } = require('playwright');");
      lines.push('');
      lines.push('async function runTest() {');
      lines.push("  const devices = await _harmonyos.devices();");
      lines.push('  const device = devices[0];');
      lines.push('');
      
      for (const action of this.actions) {
        const selectorStr = JSON.stringify(action.selector);
        lines.push(`  // ${action.name}: ${action.elementInfo?.text || action.elementInfo?.type}`);
        lines.push(`  const els = await device.findElements(${selectorStr});`);
        lines.push('  if (els.length > 0) {');
        if (action.name === 'click') {
          lines.push('    await els[0].click();');
        } else if (action.name === 'input') {
          lines.push(`    await els[0].inputText('${action.text || ''}');`);
        }
        lines.push('  }');
        lines.push('');
      }
      
      lines.push('}');
      lines.push('runTest().catch(console.error);');
    }

    return lines.join('\n');
  }
}

/**
 * HarmonyOS Context (Client-side)
 */
export class HarmonyOSContext {
  private _channel: any;
  private _pages: HarmonyOSPage[] = [];

  constructor(channel: any) {
    this._channel = channel;
  }

  get pages(): HarmonyOSPage[] {
    return [...this._pages];
  }

  async newPage(): Promise<HarmonyOSPage> {
    const browser = await this._channel.launchBrowser({});
    const page = new HarmonyOSPage(this._channel, browser.socketName);
    this._pages.push(page);
    return page;
  }

  async close(): Promise<void> {
    for (const page of this._pages) {
      await page.close();
    }
    this._pages = [];
  }

  async cookies(): Promise<any[]> {
    return [];
  }

  async storageState(): Promise<any> {
    return { cookies: [], storage: {} };
  }
}

/**
 * HarmonyOS Page (Client-side)
 */
export class HarmonyOSPage {
  private _channel: any;
  private _socketName: string;
  private _url = '';

  constructor(channel: any, socketName: string) {
    this._channel = channel;
    this._socketName = socketName;
  }

  get url(): string {
    return this._url;
  }

  async goto(url: string): Promise<void> {
    await this._channel.webViewNavigate({ socketName: this._socketName, url });
    this._url = url;
  }

  async evaluate(expression: string): Promise<any> {
    return await this._channel.webViewEvaluate({ socketName: this._socketName, expression });
  }

  async screenshot(): Promise<Buffer> {
    const { binary } = await this._channel.webViewScreenshot({ socketName: this._socketName });
    return binary;
  }

  async title(): Promise<string> {
    return await this.evaluate('document.title');
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`document.querySelector('${selector.replace(/'/g, "\\'")}')?.click()`);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.evaluate(`(document.querySelector('${selector.replace(/'/g, "\\'")}') || {}).value = '${value.replace(/'/g, "\\'")}'`);
  }

  async dragAndDrop(source: string, target: string): Promise<void> {
    await this._channel.dragAndDrop({
      socketName: this._socketName,
      sourceSelector: source,
      targetSelector: target
    });
  }

  async waitForLoad(state: 'load' | 'domcontentloaded' = 'load'): Promise<void> {
    const timeout = 30000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ready = await this.evaluate('document.readyState');
      if (ready === 'complete') return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Load timeout');
  }

  async close(): Promise<void> {
    this._socketName = '';
  }
}
