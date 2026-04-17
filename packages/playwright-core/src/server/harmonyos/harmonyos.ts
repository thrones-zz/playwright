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
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as stream from 'stream';

import debug from 'debug';
import { createGuid } from '@utils/crypto';
import { Progress, ProgressController } from '../progress';
import { SdkObject } from '../instrumentation';
import { ArkUIInspector, ArkUISelector, ArkUINode } from './arkui';
import { ArkUIRecorder, RecorderOptions } from './arkuiRecorder';

import type * as channels from '@protocol/channels';

const kHarmonyOSDebug = debug('pw:harmonyos');

// Default paths for temporary files on device
const DEVICE_TEMP_DIR = '/data/local/tmp';
const DEVICE_LAYOUT_FILE = `${DEVICE_TEMP_DIR}/layout.json`;
const DEVICE_SCREENSHOT_FILE = `${DEVICE_TEMP_DIR}/screen.png`;

export interface Backend {
  devices(options: channels.HarmonyOSDevicesOptions): Promise<DeviceBackend[]>;
}

export interface DeviceBackend {
  serial: string;
  status: string;
  model: string;
  osVersion: string;
  close(): Promise<void>;
  init(): Promise<void>;
  runCommand(command: string): Promise<Buffer>;
  open(command: string): Promise<SocketBackend>;
  receiveFile(remotePath: string, localPath: string): Promise<void>;
}

export interface SocketBackend extends EventEmitter {
  write(data: Buffer): Promise<void>;
  close(): void;
}

export class HarmonyOS extends SdkObject {
  private _backend: Backend;
  private _devices = new Map<string, HarmonyOSDevice>();

  constructor(parent: SdkObject, backend: Backend) {
    super(parent, 'harmonyos');
    this._backend = backend;
    this.attribution = { playwright: parent.attribution.playwright };
  }

  async devices(progress: Progress, options: channels.HarmonyOSDevicesOptions): Promise<HarmonyOSDevice[]> {
    const devices = (await progress.race(this._backend.devices(options))).filter(d => d.status === 'device');
    const newSerials = new Set<string>();
    for (const d of devices) {
      newSerials.add(d.serial);
      if (this._devices.has(d.serial))
        continue;
      await progress.race(HarmonyOSDevice.create(this, d, options).then(device => this._devices.set(d.serial, device)));
    }
    for (const d of this._devices.keys()) {
      if (!newSerials.has(d))
        this._devices.delete(d);
    }
    return [...this._devices.values()];
  }

  _deviceClosed(device: HarmonyOSDevice) {
    this._devices.delete(device.serial);
  }
}

export class HarmonyOSDevice extends SdkObject {
  readonly _backend: DeviceBackend;
  readonly model: string;
  readonly serial: string;
  readonly osVersion: string;
  private _options: channels.HarmonyOSDevicesOptions;
  private _webViews = new Map<string, channels.HarmonyOSWebView>();
  private _pollingWebViews: NodeJS.Timeout | undefined;
  private _isClosed = false;
  private _inspector: ArkUIInspector | null = null;

  static Events = {
    WebViewAdded: 'webViewAdded',
    WebViewRemoved: 'webViewRemoved',
    Close: 'close',
  };

  constructor(harmonyos: HarmonyOS, backend: DeviceBackend, model: string, osVersion: string, options: channels.HarmonyOSDevicesOptions) {
    super(harmonyos, 'harmonyos-device');
    this._backend = backend;
    this.model = model;
    this.serial = backend.serial;
    this.osVersion = osVersion;
    this._options = options;
    this.attribution = { playwright: harmonyos.attribution.playwright };
  }

  static async create(harmonyos: HarmonyOS, backend: DeviceBackend, options: channels.HarmonyOSDevicesOptions): Promise<HarmonyOSDevice> {
    await backend.init();
    
    // Try to get device info from uitest
    let model = 'Unknown';
    let osVersion = 'Unknown';
    
    try {
      // Use uitest to get device info (HarmonyOS native way)
      const modelResult = await backend.runCommand(`shell:getprop hw.product.model`);
      const versionResult = await backend.runCommand(`shell:getprop hw.os.version`);
      
      if (modelResult.toString().trim()) {
        model = modelResult.toString().trim();
      }
      if (versionResult.toString().trim()) {
        osVersion = versionResult.toString().trim();
      }
    } catch (e) {
      kHarmonyOSDebug('Failed to get device info from uitest, trying fallback:', e);
      
      // Fallback to standard getprop
      try {
        const modelResult = await backend.runCommand(`shell:getprop ro.product.model`);
        const versionResult = await backend.runCommand(`shell:getprop ro.build.version.release`);
        
        if (modelResult.toString().trim()) {
          model = modelResult.toString().trim();
        }
        if (versionResult.toString().trim()) {
          osVersion = versionResult.toString().trim();
        }
      } catch (e2) {
        kHarmonyOSDebug('Fallback also failed:', e2);
      }
    }
    
    const device = new HarmonyOSDevice(harmonyos, backend, model, osVersion, options);
    await device._init();
    return device;
  }

  async _init() {
    await this._refreshWebViews();
    const poll = () => {
      this._pollingWebViews = setTimeout(() => this._refreshWebViews()
        .then(poll)
        .catch(() => {
          this._close().catch(() => {});
        }), 500);
    };
    poll();
  }

  /**
   * Execute shell command via HDC
   */
  async shell(progress: Progress, command: string): Promise<Buffer> {
    return await progress.race(this._shell(command));
  }

  private async _shell(command: string): Promise<Buffer> {
    return await this._backend.runCommand(`shell:${command}`);
  }

  /**
   * Take screenshot using HarmonyOS uitest tool
   * Command: uitest screenCap -p <path>
   */
  async screenshot(progress: Progress): Promise<Buffer> {
    return await progress.race(this._takeScreenshot());
  }

  private async _takeScreenshot(): Promise<Buffer> {
    try {
      // Use HarmonyOS uitest to capture screen
      await this._backend.runCommand(`shell:uitest screenCap -p ${DEVICE_SCREENSHOT_FILE}`);
      
      // Read the screenshot file via HDC file transfer
      const chunks: Buffer[] = [];
      
      // Execute HDC file recv command
      const tempLocal = path.join(os.tmpdir(), `playwright_screenshot_${Date.now()}.png`);
      await this._backend.receiveFile(DEVICE_SCREENSHOT_FILE, tempLocal);
      
      // Read the file
      const data = await fs.promises.readFile(tempLocal);
      
      // Cleanup temp file
      try {
        await fs.promises.unlink(tempLocal);
      } catch {}
      
      return data;
    } catch (e) {
      kHarmonyOSDebug('Screenshot failed:', e);
      throw new Error(`Failed to take screenshot: ${e}`);
    }
  }

  /**
   * Get ArkUI Inspector for native UI automation
   * Uses HarmonyOS uitest tool
   */
  inspector(): ArkUIInspector {
    if (!this._inspector) {
      this._inspector = new ArkUIInspector(async (cmd: string) => {
        return await this._backend.runCommand(`shell:${cmd}`);
      });
    }
    return this._inspector;
  }

  /**
   * Get page UI tree using uitest dumpLayout
   */
  async getPageSource(progress: Progress): Promise<ArkUINode> {
    return await progress.race(this.inspector().getPageSource());
  }

  /**
   * Find ArkUI element by selector
   */
  async findElement(progress: Progress, selector: ArkUISelector): Promise<ArkUINode | null> {
    return await progress.race(this.inspector().findElement(selector));
  }

  /**
   * Find all matching ArkUI elements
   */
  async findElements(progress: Progress, selector: ArkUISelector): Promise<ArkUINode[]> {
    return await progress.race(this.inspector().findElements(selector));
  }

  /**
   * Create recorder for UI action recording
   */
  recorder(options?: RecorderOptions): ArkUIRecorder {
    return new ArkUIRecorder(this, options);
  }

  /**
   * Clear inspector cache (call after external UI changes)
   */
  clearInspectorCache(): void {
    if (this._inspector) {
      this._inspector.clearCache();
    }
  }

  /**
   * Direct shell command execution (without progress)
   */
  async runShell(command: string): Promise<Buffer> {
    return await this._backend.runCommand(`shell:${command}`);
  }

  async close(progress: Progress) {
    await progress.race(this._close());
  }

  private async _close() {
    if (this._isClosed)
      return;
    this._isClosed = true;
    if (this._pollingWebViews)
      clearTimeout(this._pollingWebViews);
    await this._backend.close();
    this.emit(HarmonyOSDevice.Events.Close);
  }

  webViews(): channels.HarmonyOSWebView[] {
    return [...this._webViews.values()];
  }

  private async _refreshWebViews() {
    // HarmonyOS/ArkWeb DevTools socket naming patterns
    const patterns = [
      'webview_devtools_remote',     // Android/WebView compatible
      'arkweb_devtools_remote',      // ArkWeb (HarmonyOS)
      'ohos_webview_devtools',       // OpenHarmony variant
      'webview_devtools_',          // Alternative pattern
    ];

    const socketNames = new Set<string>();

    for (const pattern of patterns) {
      try {
        const cmd = `shell:cat /proc/net/unix | grep ${pattern}`;
        kHarmonyOSDebug(`Searching for sockets: ${pattern}`);
        
        const sockets = (await this._backend.runCommand(cmd)).toString().split('\n');

        for (const line of sockets) {
          if (!line.trim())
            continue;

          // Extract socket name from line
          const matchSocketName = line.match(/@([^\s]+)/);
          if (!matchSocketName)
            continue;

          const socketName = matchSocketName[1].trim();
          if (!socketName.includes(pattern))
            continue;

          socketNames.add(socketName);
          kHarmonyOSDebug(`Found socket: ${socketName}`);

          if (this._webViews.has(socketName))
            continue;

          // Extract PID from socket name
          let pid = -1;
          const matchPid = socketName.match(/_(\d+)$/);
          if (matchPid) {
            pid = parseInt(matchPid[1], 10);
          }

          // Get package info
          const pkg = pid > 0 ? await this._getPackageFromPid(pid) : '';

          const webView: channels.HarmonyOSWebView = {
            socketName,
            package: pkg || 'unknown',
            title: '',
            url: '',
          };

          this._onWebViewAdded(webView);
        }
      } catch (e) {
        kHarmonyOSDebug(`Failed to search for ${pattern}:`, e);
      }
    }

    // Remove closed WebViews
    for (const socketName of this._webViews.keys()) {
      if (!socketNames.has(socketName)) {
        this._onWebViewRemoved(socketName);
      }
    }
  }

  private async _getPackageFromPid(pid: number): Promise<string> {
    if (pid <= 0)
      return '';

    try {
      const procs = (await this._backend.runCommand(`shell:ps -ef | grep ${pid}`)).toString().split('\n');
      
      for (const proc of procs) {
        const match = proc.match(new RegExp(`\\b${pid}\\b.*\\s+([\\w.]+)$`));
        if (match) {
          const name = match[1].trim();
          if (!['grep', 'sh', 'cat', 'ps'].includes(name)) {
            return name;
          }
        }
      }
    } catch (e) {
      kHarmonyOSDebug('Failed to get package from PID:', e);
    }
    return '';
  }

  async connectToWebView(socketName: string): Promise<SocketBackend> {
    return await this._backend.open(`localabstract:${socketName}`);
  }

  private _onWebViewAdded(webView: channels.HarmonyOSWebView) {
    this._webViews.set(webView.socketName, webView);
    this.emit(HarmonyOSDevice.Events.WebViewAdded, { webView });
  }

  private _onWebViewRemoved(socketName: string) {
    this._webViews.delete(socketName);
    this.emit(HarmonyOSDevice.Events.WebViewRemoved, { socketName });
  }
}

// HDC Backend Implementation
export class HdcBackend implements Backend {
  private _host: string;
  private _port: number;

  constructor(host?: string, port?: number) {
    this._host = host || '127.0.0.1';
    this._port = port || 8712; // Default HDC port
  }

  async devices(options: channels.HarmonyOSDevicesOptions = {}): Promise<DeviceBackend[]> {
    const host = options.host || this._host;
    const port = options.port || this._port;
    
    try {
      const result = await runHdcCommand('list targets', host, port);
      const lines = result.toString().trim().split('\n').filter(l => l.trim() && !l.startsWith('['));
      
      if (lines.length === 0) {
        kHarmonyOSDebug('No devices found via list targets');
        return [];
      }
      
      return lines.map(line => new HdcDevice(line.trim(), host, port));
    } catch (e) {
      kHarmonyOSDebug('Failed to list devices:', e);
      return [];
    }
  }
}

class HdcDevice implements DeviceBackend {
  serial: string;
  status: string;
  model: string = 'Unknown';
  osVersion: string = 'Unknown';
  private _host: string;
  private _port: number;
  private _closed = false;

  constructor(serial: string, host: string, port: number) {
    this.serial = serial;
    this.status = 'device';
    this._host = host;
    this._port = port;
  }

  async init() {
    // Device initialization
    kHarmonyOSDebug(`Initializing device: ${this.serial}`);
  }

  async close() {
    this._closed = true;
  }

  runCommand(command: string): Promise<Buffer> {
    if (this._closed)
      throw new Error('Device is closed');
    return runHdcCommand(command, this._host, this._port, this.serial);
  }

  async open(command: string): Promise<SocketBackend> {
    if (this._closed)
      throw new Error('Device is closed');
    return await openHdcSocket(command, this._host, this._port, this.serial);
  }

  async receiveFile(remotePath: string, localPath: string): Promise<void> {
    if (this._closed)
      throw new Error('Device is closed');
    
    // Use HDC file recv command
    // Note: This is a simplified implementation
    // In production, you might want to use a more robust file transfer method
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this._host, port: this._port }, () => {
        // Send transport target if needed
        socket.write(Buffer.from(`transport:${this.serial}\n`));
        
        // Send file recv command
        const cmd = `file recv ${remotePath} ${localPath}\n`;
        socket.write(Buffer.from(cmd));
        
        // Collect response
        const chunks: Buffer[] = [];
        socket.on('data', (data) => {
          chunks.push(data);
        });
        socket.on('end', () => {
          socket.destroy();
          const response = Buffer.concat(chunks).toString();
          if (response.includes('FileTransfer finish')) {
            resolve();
          } else {
            reject(new Error(`File transfer failed: ${response}`));
          }
        });
        socket.on('error', reject);
      });
      socket.on('error', reject);
      socket.setTimeout(30000, () => {
        socket.destroy();
        reject(new Error('File transfer timeout'));
      });
    });
  }

  async sendFile(localPath: string, remotePath: string): Promise<void> {
    if (this._closed)
      throw new Error('Device is closed');

    const fs = require('fs');
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    const fileSize = fs.statSync(localPath).size;

    if (fileSize < 10 * 1024 * 1024) {
      const buffer = fs.readFileSync(localPath);
      const base64 = buffer.toString('base64');
      await this.runCommand(`shell:echo -n "" > ${remotePath}`);
      const chunkSize = 32 * 1024;
      for (let i = 0; i < base64.length; i += chunkSize) {
        const chunk = base64.slice(i, i + chunkSize);
        const escaped = chunk.replace(/'/g, "'\\''");
        await this.runCommand(`shell:echo -n '${escaped}' >> ${remotePath}.b64`);
      }
      await this.runCommand(`shell:cat ${remotePath}.b64 | base64 -d > ${remotePath}`);
      await this.runCommand(`shell:rm ${remotePath}.b64`);
    } else {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: this._host, port: this._port }, () => {
          socket.write(Buffer.from(`transport:${this.serial}\n`));
          socket.write(Buffer.from(`file send ${localPath} ${remotePath}\n`));
          socket.on('data', (data) => {
            if (data.toString().includes('FileTransfer finish')) socket.end();
          });
          socket.on('end', () => { socket.destroy(); resolve(); });
          socket.on('error', reject);
        });
        socket.on('error', reject);
        socket.setTimeout(120000, () => { socket.destroy(); reject(new Error('File send timeout')); });
      });
    }
  }
}

async function runHdcCommand(command: string, host: string, port: number, serial?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      if (serial) {
        const transportCmd = Buffer.from(`transport:${serial}\n`);
        socket.write(transportCmd);
      }
      const cmdBuffer = Buffer.from(`${command}\n`);
      socket.write(cmdBuffer);

      // Read response
      const chunks: Buffer[] = [];
      socket.on('data', (data) => {
        chunks.push(data);
      });
      socket.on('end', () => {
        socket.destroy();
        resolve(Buffer.concat(chunks));
      });
      socket.on('error', reject);
    });
    socket.on('error', reject);
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('HDC command timeout'));
    });
  });
}

async function openHdcSocket(command: string, host: string, port: number, serial?: string): Promise<SocketBackend> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      if (serial) {
        socket.write(Buffer.from(`transport:${serial}\n`));
      }
      socket.write(Buffer.from(`${command}\n`));
    });

    const socketWrapper: SocketBackend = new EventEmitter() as SocketBackend;
    socketWrapper.write = (data: Buffer) => new Promise((res, rej) => {
      socket.write(data, (err) => {
        if (err) rej(err);
        else res();
      });
    });
    socketWrapper.close = () => {
      socket.destroy();
    };

    socket.on('data', (data) => socketWrapper.emit('data', data));
    socket.on('close', () => socketWrapper.emit('close'));
    socket.on('connect', () => resolve(socketWrapper));
    socket.on('error', reject);
  });
}
