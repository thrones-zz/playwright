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

import { Dispatcher, DispatcherScope } from './dispatcher';
import { HarmonyOS, HarmonyOSDevice } from '../harmonyos/harmonyos';
import type * as channels from '@protocol/channels';
import type { Progress } from '@protocol/progress';
import type { ArkUINode } from '../harmonyos/arkui';
import type { RecorderOptions } from '../harmonyos/arkuiRecorder';

export class HarmonyOSDispatcher extends Dispatcher<HarmonyOS, channels.HarmonyOSChannel, DispatcherScope> implements channels.HarmonyOSChannel {
  _type_HarmonyOS: boolean;

  constructor(scope: DispatcherScope, harmonyos: HarmonyOS) {
    super(scope, harmonyos, 'HarmonyOS', {});
    this._type_HarmonyOS = true;
  }

  async devices(params: channels.HarmonyOSDevicesParams, progress: Progress): Promise<channels.HarmonyOSDevicesResult> {
    const devices = await this._object.devices(progress, params);
    return { devices: devices.map(d => HarmonyOSDeviceDispatcher.from(this.parentScope(), d)) };
  }
}

export class HarmonyOSDeviceDispatcher extends Dispatcher<HarmonyOSDevice, channels.HarmonyOSDeviceChannel, DispatcherScope> implements channels.HarmonyOSDeviceChannel {
  _type_HarmonyOSDevice: boolean;
  _type_EventTarget: boolean;

  static from(scope: DispatcherScope, device: HarmonyOSDevice): HarmonyOSDeviceDispatcher {
    return new HarmonyOSDeviceDispatcher(scope, device);
  }

  constructor(scope: DispatcherScope, device: HarmonyOSDevice) {
    super(scope, device, 'HarmonyOSDevice', { model: device.model, serial: device.serial, osVersion: device.osVersion });
    this._type_HarmonyOSDevice = true;
    this._type_EventTarget = true;
    device.on(HarmonyOSDevice.Events.Close, () => this._dispatchEvent('close'));
  }

  async screenshot(params: channels.HarmonyOSDeviceScreenshotParams, progress: Progress): Promise<channels.HarmonyOSDeviceScreenshotResult> {
    const binary = await this._object.screenshot(progress);
    return { binary };
  }

  async shell(params: channels.HarmonyOSDeviceShellParams, progress: Progress): Promise<channels.HarmonyOSDeviceShellResult> {
    const result = await this._object.shell(progress, params.command);
    return { result };
  }

  async getPageSource(params: channels.HarmonyOSDeviceGetPageSourceParams, progress: Progress): Promise<channels.HarmonyOSDeviceGetPageSourceResult> {
    const source = await this._object.getPageSource(progress);
    return { source: arkuiNodeToChannel(source) };
  }

  async findElement(params: channels.HarmonyOSDeviceFindElementParams, progress: Progress): Promise<channels.HarmonyOSDeviceFindElementResult> {
    const element = await this._object.findElement(progress, params.selector);
    return { element: element ? arkuiNodeToChannel(element) : undefined };
  }

  async findElements(params: channels.HarmonyOSDeviceFindElementsParams, progress: Progress): Promise<channels.HarmonyOSDeviceFindElementsResult> {
    const elements = await this._object.findElements(progress, params.selector);
    return { elements: elements.map(arkuiNodeToChannel) };
  }

  recorder(_params: { language?: string }, _progress: Progress): { createRecorder(): any } {
    const recorder = this._object.recorder({ language: _params.language as any });
    return {
      createRecorder: () => recorder,
    };
  }

  async sendFile(params: channels.HarmonyOSDeviceSendFileParams, progress: Progress): Promise<channels.HarmonyOSDeviceSendFileResult> {
    await (this._object as any).sendFile(params.localPath, params.remotePath);
    return undefined as any;
  }

  async connectWebViewCDP(params: channels.HarmonyOSDeviceConnectWebViewCDPParams, progress: Progress): Promise<channels.HarmonyOSDeviceConnectWebViewCDPResult> {
    const client = await this._object.connectWebViewCDP(params.socketName);
    return { clientId: params.socketName };
  }

  async webViewEvaluate(params: channels.HarmonyOSDeviceWebViewEvaluateParams, progress: Progress): Promise<channels.HarmonyOSDeviceWebViewEvaluateResult> {
    const result = await this._object.webViewEvaluate(params.socketName, params.expression);
    return { result };
  }

  async webViewScreenshot(params: channels.HarmonyOSDeviceWebViewScreenshotParams, progress: Progress): Promise<channels.HarmonyOSDeviceWebViewScreenshotResult> {
    const binary = await this._object.webViewScreenshot(params.socketName);
    return { binary };
  }

  async close(params: channels.HarmonyOSDeviceCloseParams, progress: Progress): Promise<channels.HarmonyOSDeviceCloseResult> {
    await this._object.close(progress);
  }
}

function arkuiNodeToChannel(node: ArkUINode): channels.ArkUINode {
  return {
    id: node.id,
    type: node.type,
    text: node.text,
    resourceId: node.resourceId,
    clickable: node.clickable,
    enabled: node.enabled,
    bounds: node.bounds ? { x: node.bounds.left, y: node.bounds.top, width: node.bounds.width, height: node.bounds.height } : undefined,
    children: node.children?.map(arkuiNodeToChannel),
  };
}
