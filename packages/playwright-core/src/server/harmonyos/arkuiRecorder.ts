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

import { HarmonyOSDevice } from './harmonyos';
import { ArkUIInspector, ArkUINode, ArkUISelector } from './arkui';
import { EventEmitter } from 'events';
import { debug } from 'debug';

const kRecorderDebug = debug('pw:arkui:recorder');

export interface RecorderAction {
  name: string;
  selector: ArkUISelector;
  timestamp: number;
  elementInfo?: {
    type: string;
    text?: string;
    resourceId?: string;
  };
  // 操作额外参数
  text?: string;          // input 操作
  duration?: number;      // longClick 操作
  direction?: string;    // swipe 操作
  percent?: number;      // scroll 操作
  position?: { x: number; y: number }; // 指定位置
}

export interface RecorderOptions {
  outputFile?: string;
  language?: 'javascript' | 'typescript' | 'python' | 'java' | 'csharp';
  testName?: string;
  generateComments?: boolean;
}

export type RecorderEvent = 
  | { type: 'action'; action: RecorderAction }
  | { type: 'screenshot'; data: Buffer; timestamp: number }
  | { type: 'pageSource'; tree: ArkUINode; timestamp: number };

/**
 * ArkUI Recorder - 录制用户操作并生成测试代码
 */
export class ArkUIRecorder extends EventEmitter {
  private device: HarmonyOSDevice;
  private inspector: ArkUIInspector;
  private actions: RecorderAction[] = [];
  private isRecording = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private previousPageSource: ArkUINode | null = null;
  private options: RecorderOptions;

  constructor(device: HarmonyOSDevice, options: RecorderOptions = {}) {
    super();
    this.device = device;
    this.inspector = new ArkUIInspector(async (cmd: string) => {
      return await device.runShell(cmd);
    });
    this.options = {
      language: 'typescript',
      generateComments: true,
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this.isRecording) {
      throw new Error('Recorder is already running');
    }

    kRecorderDebug('Starting recorder...');
    this.isRecording = true;
    this.actions = [];

    try {
      this.previousPageSource = await this.inspector.getPageSource();
      this.emit('pageSource', { type: 'pageSource', tree: this.previousPageSource, timestamp: Date.now() });
    } catch (e) {
      kRecorderDebug('Failed to get initial page source:', e);
    }

    this.pollInterval = setInterval(async () => {
      await this.checkPageChanges();
    }, 500);
  }

  async stop(): Promise<RecorderAction[]> {
    if (!this.isRecording) {
      throw new Error('Recorder is not running');
    }

    kRecorderDebug('Stopping recorder...');
    this.isRecording = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    return this.actions;
  }

  recordAction(action: RecorderAction): void {
    if (!this.isRecording) return;
    this.actions.push({ ...action, timestamp: Date.now() });
    this.emit('action', { type: 'action', action });
    kRecorderDebug('Recorded action:', action);
  }

  async playback(): Promise<void> {
    kRecorderDebug('Playback ' + this.actions.length + ' actions...');

    for (const action of this.actions) {
      await this._executeAction(action);
      await this._delay(300);
    }
  }

  generateCode(): string {
    const { language, testName } = this.options;
    
    switch (language) {
      case 'typescript':
        return this._generateTypeScript();
      case 'javascript':
        return this._generateJavaScript();
      case 'python':
        return this._generatePython();
      case 'java':
        return this._generateJava();
      case 'csharp':
        return this._generateCSharp();
      default:
        return this._generateTypeScript();
    }
  }

  async save(outputPath?: string): Promise<string> {
    const path = outputPath || this.options.outputFile || 'recording.json';
    
    const data = {
      device: {
        model: this.device.model,
        serial: this.device.serial,
        osVersion: this.device.osVersion,
      },
      actions: this.actions,
      generatedAt: new Date().toISOString(),
    };

    require('fs').writeFileSync(path, JSON.stringify(data, null, 2));
    kRecorderDebug('Saved recording to:', path);
    
    return path;
  }

  private async checkPageChanges(): Promise<void> {
    if (!this.isRecording) return;

    try {
      const currentPageSource = await this.inspector.getPageSource();
      this.emit('pageSource', { type: 'pageSource', tree: currentPageSource, timestamp: Date.now() });
      this.previousPageSource = currentPageSource;
    } catch (e) {
      kRecorderDebug('Page change check failed:', e);
    }
  }

  private async _executeAction(action: RecorderAction): Promise<void> {
    const inspector = this.inspector;

    switch (action.name) {
      case 'click': {
        const element = await inspector.findElement(action.selector);
        if (element) {
          await inspector.performAction(element, { type: 'click' });
        }
        break;
      }
      case 'longClick': {
        const element = await inspector.findElement(action.selector);
        if (element) {
          await inspector.performAction(element, { type: 'longClick', duration: action.duration });
        }
        break;
      }
      case 'input': {
        const element = await inspector.findElement(action.selector);
        if (element) {
          await inspector.performAction(element, { type: 'input', text: action.text || '' });
        }
        break;
      }
      case 'swipe': {
        await inspector.performAction(null as any, { 
          type: 'scroll', 
          direction: (action.direction as any) || 'down',
          percent: action.percent 
        });
        break;
      }
    }
  }

  private _formatSelector(selector: ArkUISelector): string {
    const parts: string[] = [];
    if (selector.type) parts.push('type: \'' + selector.type + '\'');
    if (selector.text) parts.push('text: \'' + selector.text + '\'');
    if (selector.resourceId) parts.push('resourceId: \'' + selector.resourceId + '\'');
    if (selector.clickable !== undefined) parts.push('clickable: ' + selector.clickable);
    if (selector.enabled !== undefined) parts.push('enabled: ' + selector.enabled);
    return '{ ' + parts.join(', ') + ' }';
  }

  private _getTestName(): string {
    return this.options.testName || 'HarmonyOSTest';
  }

  private _generateTypeScript(): string {
    const lines: string[] = [];
    const { generateComments } = this.options;
    const testName = this._getTestName();

    lines.push('/**');
    lines.push(' * HarmonyOS ArkUI Test');
    lines.push(' * Generated at: ' + new Date().toISOString());
    lines.push(' * Device: ' + this.device.model + ' (' + this.device.serial + ')');
    lines.push(' */');
    lines.push('');
    lines.push("import { test, expect, _harmonyos } from '@playwright/test';");
    lines.push('');
    lines.push("test.describe('HarmonyOS UI Tests', () => {");
    lines.push('');
    lines.push("  let device: Awaited<ReturnType<typeof _harmonyos.devices>>[0];");
    lines.push('');
    lines.push('  test.beforeEach(async () => {');
    lines.push('    const devices = await _harmonyos.devices();');
    lines.push('    expect(devices.length).toBeGreaterThan(0);');
    lines.push('    device = devices[0];');
    lines.push('  });');
    lines.push('');
    lines.push("  test('" + testName + "', async () => {");

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const actionNum = i + 1;
      
      if (generateComments) {
        const comment = action.elementInfo?.text || action.elementInfo?.type || action.name;
        lines.push('');
        lines.push('    // Action ' + actionNum + ': ' + action.name + ' - ' + comment);
      }

      switch (action.name) {
        case 'click':
          lines.push('    const clickEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('    if (clickEl' + actionNum + ') {');
          lines.push('      await clickEl' + actionNum + '.click();');
          lines.push('    }');
          break;
          
        case 'longClick':
          lines.push('    const longClickEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('    if (longClickEl' + actionNum + ') {');
          lines.push('      await longClickEl' + actionNum + '.longClick(' + (action.duration || 1000) + ');');
          lines.push('    }');
          break;
          
        case 'input':
          lines.push('    const inputEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('    if (inputEl' + actionNum + ') {');
          lines.push('      await inputEl' + actionNum + ".inputText('" + (action.text || '') + "');");
          lines.push('    }');
          break;
          
        case 'swipe':
          lines.push('    await device.inspector().performAction(null, {');
          lines.push("      type: 'scroll',");
          lines.push("      direction: '" + (action.direction || 'down') + "',");
          lines.push('      percent: ' + (action.percent || 80));
          lines.push('    });');
          break;
      }
    }

    lines.push('  });');
    lines.push('});');

    return lines.join('\n');
  }

  private _generateJavaScript(): string {
    const lines: string[] = [];
    const { generateComments } = this.options;
    const testName = this._getTestName();

    lines.push('/**');
    lines.push(' * HarmonyOS ArkUI Test');
    lines.push(' * Generated at: ' + new Date().toISOString());
    lines.push(' * Device: ' + this.device.model + ' (' + this.device.serial + ')');
    lines.push(' */');
    lines.push('');
    lines.push("const { _harmonyos } = require('playwright');");
    lines.push('');
    lines.push('async function ' + testName + '() {');
    lines.push('  console.log("Starting HarmonyOS test...");');
    lines.push('');
    lines.push('  const devices = await _harmonyos.devices();');
    lines.push('  if (devices.length === 0) {');
    lines.push('    throw new Error("No devices found");');
    lines.push('  }');
    lines.push('');
    lines.push('  const device = devices[0];');

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const actionNum = i + 1;
      
      if (generateComments) {
        const comment = action.elementInfo?.text || action.elementInfo?.type || action.name;
        lines.push('');
        lines.push('  // Action ' + actionNum + ': ' + action.name + ' - ' + comment);
      }

      switch (action.name) {
        case 'click':
          lines.push('  const clickEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('  if (clickEl' + actionNum + ') {');
          lines.push('    await clickEl' + actionNum + '.click();');
          lines.push('  }');
          break;
          
        case 'longClick':
          lines.push('  const longClickEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('  if (longClickEl' + actionNum + ') {');
          lines.push('    await longClickEl' + actionNum + '.longClick(' + (action.duration || 1000) + ');');
          lines.push('  }');
          break;
          
        case 'input':
          lines.push('  const inputEl' + actionNum + ' = await device.findElement(' + this._formatSelector(action.selector) + ');');
          lines.push('  if (inputEl' + actionNum + ') {');
          lines.push("    await inputEl" + actionNum + ".inputText('" + (action.text || '') + "');");
          lines.push('  }');
          break;
          
        case 'swipe':
          lines.push('  await device.inspector().performAction(null, {');
          lines.push("    type: 'scroll',");
          lines.push("    direction: '" + (action.direction || 'down') + "',");
          lines.push('    percent: ' + (action.percent || 80));
          lines.push('  });');
          break;
      }
    }

    lines.push('');
    lines.push('  console.log("Test completed!");');
    lines.push('}');
    lines.push('');
    lines.push(testName + '().catch(err => {');
    lines.push('  console.error("Test failed:", err);');
    lines.push('  process.exit(1);');
    lines.push('});');

    return lines.join('\n');
  }

  private _generatePython(): string {
    const lines: string[] = [];
    const testName = this._getTestName();

    lines.push('# -*- coding: utf-8 -*-');
    lines.push('"""');
    lines.push('HarmonyOS ArkUI Test');
    lines.push('Generated at: ' + new Date().toISOString());
    lines.push('Device: ' + this.device.model + ' (' + this.device.serial + ')');
    lines.push('"""');
    lines.push('');
    lines.push('from playwright.sync_api import sync_playwright, expect');
    lines.push('');
    lines.push('');
    lines.push('def ' + testName + '():');
    lines.push('    """HarmonyOS UI Test"""');
    lines.push('    print("Starting HarmonyOS test...")');
    lines.push('');
    lines.push('    with sync_playwright() as p:');
    lines.push('        devices = p.harmonyos.devices()');
    lines.push('        assert len(devices) > 0, "No devices found"');
    lines.push('        device = devices[0]');

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const actionNum = i + 1;
      const selectorStr = this._selectorToPython(action.selector);

      lines.push('');
      lines.push('        # Action ' + actionNum + ': ' + action.name);

      switch (action.name) {
        case 'click':
          lines.push('        el = device.find_element(' + selectorStr + ')');
          lines.push('        el.click()');
          break;
        case 'longClick':
          lines.push('        el = device.find_element(' + selectorStr + ')');
          lines.push('        el.long_click()');
          break;
        case 'input':
          lines.push('        el = device.find_element(' + selectorStr + ')');
          lines.push("        el.fill('" + (action.text || '') + "')");
          break;
        case 'swipe':
          lines.push('        device.inspector().scroll("' + (action.direction || 'down') + '")');
          break;
      }
    }

    lines.push('');
    lines.push('        print("Test completed!")');
    lines.push('');
    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    try:');
    lines.push('        ' + testName + '()');
    lines.push('    except Exception as e:');
    lines.push('        print(f"Test failed: {e}")');
    lines.push('        raise');

    return lines.join('\n');
  }

  private _selectorToPython(selector: ArkUISelector): string {
    const parts: string[] = [];
    if (selector.type) parts.push('type="' + selector.type + '"');
    if (selector.text) parts.push('text="' + selector.text + '"');
    if (selector.resourceId) parts.push('resource_id="' + selector.resourceId + '"');
    if (selector.clickable !== undefined) parts.push('clickable=' + selector.clickable);
    return parts.join(', ');
  }

  private _generateJava(): string {
    const lines: string[] = [];
    const testName = this._getTestName();

    lines.push('package com.example.playwright;');
    lines.push('');
    lines.push('import com.microsoft.playwright.*;');
    lines.push('import java.nio.file.Paths;');
    lines.push('');
    lines.push('/**');
    lines.push(' * HarmonyOS ArkUI Test');
    lines.push(' * Generated at: ' + new Date().toISOString());
    lines.push(' * Device: ' + this.device.model + ' (' + this.device.serial + ')');
    lines.push(' */');
    lines.push('');
    lines.push('public class ' + testName + ' {');
    lines.push('    public static void main(String[] args) {');
    lines.push('        try (Playwright playwright = Playwright.create()) {');
    lines.push('            System.out.println("Starting HarmonyOS test...");');
    lines.push('');
    lines.push('            java.util.List<HarmonyOSDevice> devices = playwright.harmonyos().devices();');
    lines.push('            if (devices.isEmpty()) {');
    lines.push('                throw new RuntimeException("No devices found");');
    lines.push('            }');
    lines.push('');
    lines.push('            HarmonyOSDevice device = devices.get(0);');

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const actionNum = i + 1;
      const selectorStr = this._selectorToJava(action.selector);

      lines.push('');
      lines.push('            // Action ' + actionNum + ': ' + action.name);

      switch (action.name) {
        case 'click':
          lines.push('            ArkUIElement clickEl' + actionNum + ' = device.findElement(' + selectorStr + ');');
          lines.push('            if (clickEl' + actionNum + ' != null) {');
          lines.push('                clickEl' + actionNum + '.click();');
          lines.push('            }');
          break;
        case 'input':
          lines.push('            ArkUIElement inputEl' + actionNum + ' = device.findElement(' + selectorStr + ');');
          lines.push('            if (inputEl' + actionNum + ' != null) {');
          lines.push('                inputEl' + actionNum + ".inputText(\"" + (action.text || '') + "\");");
          lines.push('            }');
          break;
        case 'swipe':
          lines.push('            device.inspector().scroll("' + (action.direction || 'down') + '");');
          break;
      }
    }

    lines.push('');
    lines.push('            System.out.println("Test completed!");');
    lines.push('        }');
    lines.push('    }');
    lines.push('}');

    return lines.join('\n');
  }

  private _selectorToJava(selector: ArkUISelector): string {
    const parts: string[] = [];
    if (selector.type) parts.push('type: "' + selector.type + '"');
    if (selector.text) parts.push('text: "' + selector.text + '"');
    if (selector.resourceId) parts.push('resourceId: "' + selector.resourceId + '"');
    return 'new ArkUISelector(' + parts.join(', ') + ')';
  }

  private _generateCSharp(): string {
    const lines: string[] = [];
    const testName = this._getTestName();

    lines.push('using Microsoft.Playwright;');
    lines.push('');
    lines.push('/// <summary>');
    lines.push('/// HarmonyOS ArkUI Test');
    lines.push('/// Generated at: ' + new Date().toISOString());
    lines.push('/// Device: ' + this.device.model + ' (' + this.device.serial + ')');
    lines.push('/// </summary>');
    lines.push('public class ' + testName);
    lines.push('{');
    lines.push('    public static async Task Main()');
    lines.push('    {');
    lines.push('        Console.WriteLine("Starting HarmonyOS test...");');
    lines.push('        using var playwright = Microsoft.Playwright.Playwright.Create();');
    lines.push('');
    lines.push('        var devices = await playwright.HarmonyOS.DevicesAsync();');
    lines.push('        if (devices.Count == 0)');
    lines.push('        {');
    lines.push('            throw new Exception("No devices found");');
    lines.push('        }');
    lines.push('');
    lines.push('        var device = devices[0];');

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      const actionNum = i + 1;
      const selectorStr = this._selectorToCSharp(action.selector);

      lines.push('');
      lines.push('        // Action ' + actionNum + ': ' + action.name);

      switch (action.name) {
        case 'click':
          lines.push('        var clickEl' + actionNum + ' = await device.FindElementAsync(' + selectorStr + ');');
          lines.push('        if (clickEl' + actionNum + ' != null)');
          lines.push('        {');
          lines.push('            await clickEl' + actionNum + '.ClickAsync();');
          lines.push('        }');
          break;
        case 'input':
          lines.push('        var inputEl' + actionNum + ' = await device.FindElementAsync(' + selectorStr + ');');
          lines.push('        if (inputEl' + actionNum + ' != null)');
          lines.push('        {');
          lines.push('            await inputEl' + actionNum + ".InputTextAsync(\"" + (action.text || '') + "\");");
          lines.push('        }');
          break;
        case 'swipe':
          lines.push('        await device.Inspector().ScrollAsync("' + (action.direction || 'down') + '");');
          break;
      }
    }

    lines.push('');
    lines.push('        Console.WriteLine("Test completed!");');
    lines.push('    }');
    lines.push('}');

    return lines.join('\n');
  }

  private _selectorToCSharp(selector: ArkUISelector): string {
    const parts: string[] = [];
    if (selector.type) parts.push('Type = "' + selector.type + '"');
    if (selector.text) parts.push('Text = "' + selector.text + '"');
    if (selector.resourceId) parts.push('ResourceId = "' + selector.resourceId + '"');
    return 'new ArkUISelector { ' + parts.join(', ') + ' }';
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
