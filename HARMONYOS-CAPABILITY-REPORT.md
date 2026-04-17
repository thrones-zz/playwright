# Playwright HarmonyOS 能力分析报告

## 📊 平台能力对比

### 1. 浏览器引擎支持

| 平台 | Chromium | Firefox | WebKit | 特殊引擎 |
|------|----------|---------|--------|----------|
| Windows/Linux/macOS | ✅ 完整 | ✅ 完整 | ✅ 完整 | - |
| Android | ✅ Play商店 | ❌ | ❌ | Chrome |
| HarmonyOS | ⚠️ ArkWeb | ❌ | ❌ | ArkWeb 6.x |

### 2. Playwright API 实现对比

| API | Win/Lin | Android | HarmonyOS | 说明 |
|-----|---------|---------|-----------|------|
| launch() | ✅ | ✅ | ❌ | 无独立浏览器 |
| page.goto() | ✅ | ✅ | ⚠️ | 需手动 CDP |
| page.click() | ✅ | ✅ | ✅ | 通过 uinput |
| page.type() | ✅ | ✅ | ✅ | 通过 uinput |
| page.screenshot() | ✅ | ✅ | ✅ | uitest |
| page.evaluate() | ✅ | ✅ | ⚠️ | 需 CDP 连接 |
| page.route() | ✅ | ✅ | ❌ | 未实现 |
| locator API | ✅ | ✅ | ⚠️ | 部分支持 |
| tracing | ✅ | ⚠️ | ❌ | 未实现 |
| video recording | ✅ | ✅ | ❌ | 未实现 |

## 🔬 实际能力测试结果

### ✅ 已验证可用

| 功能 | 命令/方法 | 状态 |
|------|----------|------|
| 设备连接 | `hdc list targets` | ✅ |
| Shell 执行 | `hdc shell` | ✅ |
| 截图 | `uitest screenCap` | ✅ |
| UI 树 | `uitest dumpLayout` | ✅ |
| 按键 | `input keyevent` | ✅ |
| WebView Socket | `/proc/net/unix` | ✅ |
| 文件传输 | `hdc file recv` | ✅ |

### ⚠️ 部分支持

| 功能 | 状态 | 说明 |
|------|------|------|
| CDP 连接 | ⚠️ | Socket 存在但端口转发有限制 |
| JS 执行 | ⚠️ | 需建立 CDP 会话 |
| 网络拦截 | ⚠️ | 无 Fetch API |
| 自动等待 | ⚠️ | 需手动轮询 |

### ❌ 不支持

| 功能 | 说明 |
|------|------|
| 浏览器 launch | 无独立 Chromium 进程 |
| PDF 生成 | 无 PDF 渲染器 |
| Service Worker | 未适配 |
| WebRTC | 未适配 |
| 地理位置模拟 | 无 Geolocation API |

## 🎯 HarmonyOS 特有能力

### ArkUI Inspector
```bash
# 获取 UI 树
uitest dumpLayout -p /data/local/tmp/layout.json

# 输出格式
{
  "attributes": {
    "type": "Button",
    "text": "确认",
    "bounds": "[100,200][300,300]"
  }
}
```

### uinput 输入
```bash
# 点击
uinput -T -c 150 250

# 滑动
uinput -T -m 100 200 300 400 500

# 按键
input keyevent 4  # BACK
input keyevent 3  # HOME
```

### WebView DevTools
```bash
# Socket 路径
/proc/net/unix | grep webview
# @webview_devtools_remote_20549

# CDP 连接 (需 fport)
hdc fport tcp:9222 localabstract:webview_devtools_remote_20549
curl http://127.0.0.1:9222/json
```

## 📉 能力差距分析

### P0 - 高优先级

| 差距 | 影响 | 解决方案 |
|------|------|----------|
| 无 CDP 会话管理 | 无法执行 JS | 实现 WebSocket CDP Client |
| 网络拦截缺失 | 无法 Mock | 实现 Fetch/Bridge API |
| PDF 生成 | 常用功能 | 依赖 ArkWeb 支持 |

### P1 - 中优先级

| 差距 | 影响 | 解决方案 |
|------|------|----------|
| 元素截图 | 调试友好 | captureNode |
| 自动等待 | 稳定性 | 实现 Playwright 风格的 waitFor |
| 地理位置模拟 | LBS 测试 | uitest 位置模拟 |
| 权限管理 | 安全测试 | HarmonyOS permission API |

### P2 - 低优先级

| 差距 | 影响 | 解决方案 |
|------|------|----------|
| 传感器模拟 | 游戏测试 | 依赖系统 API |
| 通知监控 | 推送测试 | Notification API |
| 视频录制 | 视频测试 | MediaRecorder API |

## 🏗️ 架构对比

### Windows/Linux
```
Playwright API
    ↓
Browser Process (Chromium/Firefox/WebKit)
    ↓
Pages/Contexts
```

### Android
```
Playwright API
    ↓
Android Driver (adb)
    ↓
Android Device
    ↓
WebView (Chrome)
```

### HarmonyOS
```
Playwright API
    ↓
HarmonyOS Driver (HDC)
    ↓
HarmonyOS Device
    ├── ArkWeb/WebView
    │   └── CDP DevTools
    └── Native UI
        └── uitest/uinput
```

## 📈 改进路线图

### Phase 1: 基础能力 (当前)
- ✅ HDC 连接
- ✅ Shell 执行
- ✅ 截图
- ✅ UI 树获取
- ✅ 基础元素操作

### Phase 2: WebView 集成 (计划)
- [ ] CDP WebSocket 连接
- [ ] JS 执行
- [ ] 网络拦截
- [ ] 元素截图

### Phase 3: 高级特性 (规划)
- [ ] PDF 生成
- [ ] 地理位置模拟
- [ ] 性能监控
- [ ] 多设备并发

## 🎯 总结

HarmonyOS Playwright 支持当前处于 **Phase 1** 水平：

**优势：**
- 原生 UI 自动化能力强 (uitest)
- 触摸操作支持完善
- 文件传输便捷

**劣势：**
- 无独立浏览器引擎
- CDP 能力受限
- 网络拦截缺失

**适用场景：**
- HarmonyOS 原生应用测试
- UI 自动化测试
- 设备功能验证

**不适用场景：**
- Web 应用端到端测试 (WebView 限制)
- 网络条件模拟
- 复杂浏览器交互

---
生成时间: 2026-04-17
Playwright 版本: 1.60.0-next
