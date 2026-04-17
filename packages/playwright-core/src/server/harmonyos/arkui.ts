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

import { debug } from 'debug';

const kArkUIDebug = debug('pw:arkui');

// HarmonyOS uitest JSON format interfaces
interface UITestAttributes {
  accessibilityId?: string;
  type: string;
  id?: string;
  key?: string;
  text?: string;
  originalText?: string;
  hint?: string;
  description?: string;
  bundleName?: string;
  bounds?: string;
  clickable?: string;
  longClickable?: string;
  enabled?: string;
  focused?: string;
  scrollable?: string;
  selected?: string;
  visible?: string;
  [key: string]: any;
}

interface UITestNode {
  attributes: UITestAttributes;
  children?: UITestNode[];
}

export interface ArkUINode {
  id: string;
  accessibilityId?: string;
  type: string;
  text?: string;
  resourceId?: string;
  key?: string;
  bundleName?: string;
  clickable?: boolean;
  longClickable?: boolean;
  scrollable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  visible?: boolean;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  children?: ArkUINode[];
  attributes?: Record<string, any>;
}

export interface ArkUISelector {
  type?: string;
  text?: string | RegExp;
  accessibilityId?: string;
  resourceId?: string;
  key?: string;
  clickable?: boolean;
  enabled?: boolean;
  depth?: { min?: number; max?: number };
  index?: number;
}

export type ArkUIAction =
  | { type: 'click'; x?: number; y?: number }
  | { type: 'longClick'; duration?: number; x?: number; y?: number }
  | { type: 'doubleClick'; x?: number; y?: number }
  | { type: 'input'; text: string }
  | { type: 'swipe'; startX: number; startY: number; endX: number; endY: number; duration?: number }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; percent?: number }
  | { type: 'pressKey'; key: string };

// Key code mapping for HarmonyOS
const KEY_CODES: Record<string, number> = {
  'home': 3,
  'back': 4,
  'enter': 66,
  'delete': 67,
  'volumeup': 24,
  'volumedown': 25,
  'power': 26,
};

/**
 * ArkUI Inspector - 获取和分析 HarmonyOS 原生 UI 界面
 * 使用鸿蒙原生 uitest 工具
 */
export class ArkUIInspector {
  private shellExecutor: (command: string) => Promise<Buffer>;
  private _cachedLayout: UITestNode | null = null;
  private _cacheTime: number = 0;
  private _cacheTimeout: number = 1000; // 1 second cache

  constructor(shellExecutor: (command: string) => Promise<Buffer>) {
    this.shellExecutor = shellExecutor;
  }

  /**
   * 获取当前页面 UI 树
   * 使用鸿蒙 uitest dumpLayout 命令，输出 JSON 格式
   */
  async getPageSource(): Promise<ArkUINode> {
    kArkUIDebug('Getting page source via uitest dumpLayout...');

    try {
      // Check cache first
      const now = Date.now();
      if (this._cachedLayout && (now - this._cacheTime) < this._cacheTimeout) {
        kArkUIDebug('Using cached layout');
        return this._convertUITestToArkUI(this._cachedLayout);
      }

      // Execute uitest dumpLayout - writes JSON to file
      await this.shellExecutor('uitest dumpLayout -p /data/local/tmp/layout.json');
      const result = await this.shellExecutor('shell:cat /data/local/tmp/layout.json');

      const jsonStr = result.toString();
      const json = JSON.parse(jsonStr) as UITestNode;

      // Cache the result
      this._cachedLayout = json;
      this._cacheTime = now;

      return this._convertUITestToArkUI(json);
    } catch (e) {
      kArkUIDebug('uitest dumpLayout failed:', e);
      throw new Error(`Failed to get UI tree: ${e}. Make sure Developer Mode is enabled.`);
    }
  }

  /**
   * 转换 uitest JSON 格式为内部 ArkUINode 格式
   */
  private _convertUITestToArkUI(node: UITestNode): ArkUINode {
    const attrs = node.attributes;

    // Parse bounds: "[x1,y1][x2,y2]" -> {left, top, right, bottom, width, height}
    let bounds: ArkUINode['bounds'] | undefined;
    if (attrs.bounds) {
      const match = attrs.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (match) {
        const left = parseInt(match[1]);
        const top = parseInt(match[2]);
        const right = parseInt(match[3]);
        const bottom = parseInt(match[4]);
        bounds = {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
        };
      }
    }

    // Convert string boolean to boolean
    const strToBool = (val?: string): boolean | undefined => {
      if (val === undefined) return undefined;
      return val === 'true';
    };

    const arkNode: ArkUINode = {
      id: attrs.accessibilityId || attrs.id || `node_${Date.now()}_${Math.random()}`,
      accessibilityId: attrs.accessibilityId,
      type: attrs.type,
      text: attrs.text || attrs.originalText,
      resourceId: attrs.id,
      key: attrs.key,
      bundleName: attrs.bundleName,
      clickable: strToBool(attrs.clickable),
      longClickable: strToBool(attrs.longClickable),
      scrollable: strToBool(attrs.scrollable),
      enabled: strToBool(attrs.enabled),
      focused: strToBool(attrs.focused),
      selected: strToBool(attrs.selected),
      visible: strToBool(attrs.visible),
      bounds,
      attributes: { ...attrs },
    };

    // Recursively convert children
    if (node.children && node.children.length > 0) {
      arkNode.children = node.children.map(child => this._convertUITestToArkUI(child));
    }

    return arkNode;
  }

  /**
   * 清除布局缓存
   */
  clearCache(): void {
    this._cachedLayout = null;
    this._cacheTime = 0;
  }

  async findElement(selector: ArkUISelector): Promise<ArkUINode | null> {
    const root = await this.getPageSource();
    return this._findMatchingNode(root, selector, 0);
  }

  async findElements(selector: ArkUISelector): Promise<ArkUINode[]> {
    const root = await this.getPageSource();
    const results: ArkUINode[] = [];
    this._findAllMatchingNodes(root, selector, 0, results);
    return results;
  }

  async performAction(element: ArkUINode, action: ArkUIAction): Promise<void> {
    // Clear cache after any action as UI may have changed
    this.clearCache();

    const point = this._getElementCenter(element);

    switch (action.type) {
      case 'click':
        await this._click(point, action.x, action.y);
        break;
      case 'longClick':
        await this._longClick(point, action.duration, action.x, action.y);
        break;
      case 'doubleClick':
        await this._doubleClick(point, action.x, action.y);
        break;
      case 'input':
        await this._inputText(action.text);
        break;
      case 'swipe':
        await this._swipe(action.startX, action.startY, action.endX, action.endY, action.duration);
        break;
      case 'scroll':
        await this._scroll(action.direction, action.percent);
        break;
      case 'pressKey':
        await this._pressKey(action.key);
        break;
    }
  }

  async waitFor(selector: ArkUISelector, options: { timeout?: number; state?: 'visible' | 'gone' } = {}): Promise<ArkUINode | null> {
    const timeout = options.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      this.clearCache(); // Clear cache before each search
      const element = await this.findElement(selector);

      if (element && options.state === 'gone') {
        await this._delay(200);
        continue;
      }

      if (element || options.state === 'gone') {
        return element;
      }

      await this._delay(200);
    }

    return null;
  }

  private _getElementCenter(element: ArkUINode): { x: number; y: number } {
    if (!element.bounds) {
      throw new Error('Element has no bounds');
    }
    return {
      x: element.bounds.left + element.bounds.width / 2,
      y: element.bounds.top + element.bounds.height / 2
    };
  }

  /**
   * 点击操作 - 使用鸿蒙 uinput -T 命令
   * uinput -T -c <x> <y>
   */
  private async _click(point: { x: number; y: number }, offsetX?: number, offsetY?: number): Promise<void> {
    const x = offsetX !== undefined ? point.x + offsetX : point.x;
    const y = offsetY !== undefined ? point.y + offsetY : point.y;
    kArkUIDebug(`Click at ${x}, ${y}`);
    await this.shellExecutor(`uinput -T -c ${Math.round(x)} ${Math.round(y)}`);
  }

  /**
   * 长按操作 - 使用鸿蒙 uinput -T -g 命令
   * uinput -T -g <x1> <y1> <x2> <y2> <pressTimeMs> <totalTimeMs>
   * 注：HarmonyOS 长按需要从同一点滑动到同一点
   */
  private async _longClick(point: { x: number; y: number }, duration: number = 1000, offsetX?: number, offsetY?: number): Promise<void> {
    const x = offsetX !== undefined ? point.x + offsetX : point.x;
    const y = offsetY !== undefined ? point.y + offsetY : point.y;
    const rx = Math.round(x);
    const ry = Math.round(y);
    kArkUIDebug(`Long click at ${rx}, ${ry} for ${duration}ms`);
    await this.shellExecutor(`uinput -T -g ${rx} ${ry} ${rx} ${ry} ${duration} ${duration + 100}`);
  }

  /**
   * 双击操作
   */
  private async _doubleClick(point: { x: number; y: number }, offsetX?: number, offsetY?: number): Promise<void> {
    const x = offsetX !== undefined ? point.x + offsetX : point.x;
    const y = offsetY !== undefined ? point.y + offsetY : point.y;
    kArkUIDebug(`Double click at ${x}, ${y}`);
    await this.shellExecutor(`uinput -T -c ${Math.round(x)} ${Math.round(y)}`);
    await this._delay(100);
    await this.shellExecutor(`uinput -T -c ${Math.round(x)} ${Math.round(y)}`);
  }

  /**
   * 文本输入 - 使用鸿蒙 uinput -T -t 命令
   */
  private async _inputText(text: string): Promise<void> {
    kArkUIDebug(`Input text: ${text}`);
    // Escape quotes in text
    const escaped = text.replace(/"/g, '\\"');
    await this.shellExecutor(`uinput -T -t "${escaped}"`);
  }

  /**
   * 滑动操作 - 使用鸿蒙 uinput -T -m 命令
   * uinput -T -m <x1> <y1> <x2> <y2> [duration]
   */
  private async _swipe(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<void> {
    kArkUIDebug(`Swipe from (${startX}, ${startY}) to (${endX}, ${endY})`);
    const cmd = duration
      ? `uinput -T -m ${Math.round(startX)} ${Math.round(startY)} ${Math.round(endX)} ${Math.round(endY)} ${duration}`
      : `uinput -T -m ${Math.round(startX)} ${Math.round(startY)} ${Math.round(endX)} ${Math.round(endY)}`;
    await this.shellExecutor(cmd);
  }

  /**
   * 滚动操作
   */
  private async _scroll(direction: 'up' | 'down' | 'left' | 'right', percent: number = 80): Promise<void> {
    kArkUIDebug(`Scroll ${direction} ${percent}%`);

    // Get screen size from uitest dumpLayout
    this.clearCache();
    const root = await this.getPageSource();
    const screenBounds = this._findScreenBounds(root, true);

    if (!screenBounds) {
      throw new Error('Failed to get screen size');
    }

    const width = screenBounds.width;
    const height = screenBounds.height;
    const centerX = screenBounds.left + width / 2;
    const centerY = screenBounds.top + height / 2;
    const distance = (Math.max(width, height) * percent) / 100;

    let sx = centerX, sy = centerY, ex = centerX, ey = centerY;

    switch (direction) {
      case 'up':
        sy = centerY + distance / 2;
        ey = centerY - distance / 2;
        break;
      case 'down':
        sy = centerY - distance / 2;
        ey = centerY + distance / 2;
        break;
      case 'left':
        sx = centerX + distance / 2;
        ex = centerX - distance / 2;
        break;
      case 'right':
        sx = centerX - distance / 2;
        ex = centerX + distance / 2;
        break;
    }

    await this._swipe(sx, sy, ex, ey);
  }

  /**
   * 从 UI 树中查找屏幕边界
   */
  private _findScreenBounds(node: ArkUINode, isRoot: boolean = false): ArkUINode['bounds'] | null {
    if (node.bounds && (node.type === 'root' || isRoot)) {
      return node.bounds;
    }

    if (node.children) {
      for (const child of node.children) {
        const bounds = this._findScreenBounds(child, false);
        if (bounds) return bounds;
      }
    }

    return null;
  }

  /**
   * 按键操作 - 使用鸿蒙 uinput -T -k 命令
   */
  private async _pressKey(key: string): Promise<void> {
    kArkUIDebug(`Press key: ${key}`);
    const keyCode = KEY_CODES[key.toLowerCase()];
    if (keyCode !== undefined) {
      await this.shellExecutor(`uinput -T -k ${keyCode}`);
    } else {
      // Try as numeric keycode
      const numCode = parseInt(key);
      if (!isNaN(numCode)) {
        await this.shellExecutor(`uinput -T -k ${numCode}`);
      } else {
        throw new Error(`Unknown key: ${key}`);
      }
    }
  }

  private _findMatchingNode(node: ArkUINode, selector: ArkUISelector, depth: number): ArkUINode | null {
    if (this._matchesSelector(node, selector, depth)) {
      return node;
    }

    if (node.children) {
      for (const child of node.children) {
        const result = this._findMatchingNode(child, selector, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  private _findAllMatchingNodes(node: ArkUINode, selector: ArkUISelector, depth: number, results: ArkUINode[]): void {
    if (this._matchesSelector(node, selector, depth)) {
      results.push(node);
    }

    if (node.children) {
      for (const child of node.children) {
        this._findAllMatchingNodes(child, selector, depth + 1, results);
      }
    }
  }

  private _matchesSelector(node: ArkUINode, selector: ArkUISelector, depth: number): boolean {
    if (selector.type && node.type !== selector.type) {
      return false;
    }

    if (selector.text) {
      const nodeText = node.text || '';
      if (selector.text instanceof RegExp) {
        if (!selector.text.test(nodeText)) return false;
      } else {
        if (!nodeText.includes(selector.text)) return false;
      }
    }

    if (selector.accessibilityId && node.accessibilityId !== selector.accessibilityId) {
      return false;
    }

    if (selector.resourceId && node.resourceId !== selector.resourceId) {
      return false;
    }

    if (selector.key && node.key !== selector.key) {
      return false;
    }

    if (selector.clickable !== undefined && node.clickable !== selector.clickable) {
      return false;
    }

    if (selector.enabled !== undefined && node.enabled !== selector.enabled) {
      return false;
    }

    if (selector.depth) {
      if (selector.depth.min !== undefined && depth < selector.depth.min) return false;
      if (selector.depth.max !== undefined && depth > selector.depth.max) return false;
    }

    return true;
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
