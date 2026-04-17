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
   * 输入文本到元素
   */
  async inputText(text: string): Promise<void> {
    await this._device.shell(`uinput -T "${text}"`);
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
