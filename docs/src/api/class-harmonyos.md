# class: HarmonyOS
* since: v1.50
* not поддерживает酿

HarmonyOS class exposes methods to connect to existing HarmonyOS devices.

```js
const { _harmonyos } = require('playwright');

(async () => {
  const devices = await _harmonyos.devices();
  console.log('devices:', devices);
})();
```

## async method: HarmonyOS.devices
* since: v1.50
- returns: <[Array]<[HarmonyOSDevice]>>

Returns the list of detected HarmonyOS devices.

### option: HarmonyOS.devices.options
* since: v1.50
- `host` <[string]>

Optional host to establish HDC server connection. Defaults to `127.0.0.1`.

- `port` <[int]>

Optional port to establish HDC server connection. Defaults to `8712`.
