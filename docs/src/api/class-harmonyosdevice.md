# class: HarmonyOSDevice
* since: v1.50

HarmonyOSDevice represents a connected HarmonyOS device.

## method: HarmonyOSDevice.serial
* since: v1.50
- returns: <[string]>

Returns the device serial number.

## method: HarmonyOSDevice.model
* since: v1.50
- returns: <[string]>

Returns the device model.

## method: HarmonyOSDevice.osVersion
* since: v1.50
- returns: <[string]>

Returns the device OS version.

## method: HarmonyOSDevice.webViews
* since: v1.50
- returns: <[Array]<[HarmonyOSWebView]>>

Returns the list of webviews available on the device.

## async method: HarmonyOSDevice.screenshot
* since: v1.50
- returns: <[Buffer]>

Captures a screenshot of the device screen.

## async method: HarmonyOSDevice.shell
* since: v1.50
- `command` <[string]>
- returns: <[Buffer]>

Executes a shell command on the device and returns the output.

## async method: HarmonyOSDevice.close
* since: v1.50

Closes the connection to the device.

## event: HarmonyOSDevice.close
* since: v1.50
- argument: <[HarmonyOSDevice]>

Emitted when the device is disconnected.

## event: HarmonyOSDevice.webview
* since: v1.50
- argument: <[HarmonyOSWebView]>

Emitted when a new webview is added.
