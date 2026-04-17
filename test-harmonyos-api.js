/**
 * 直接测试 HarmonyOS API 模块
 */
const path = require('path');

// 直接加载 harmonyos 模块
const harmonyosModule = require('./packages/playwright-core/lib/server/harmonyos/harmonyos.js');

console.log('🔍 HarmonyOS 模块验证\n');
console.log('='.repeat(50));

// 检查导出的类
console.log('\n1. 模块导出检查:');
console.log('   HarmonyOS:', typeof harmonyosModule.HarmonyOS === 'function' ? '✅' : '❌');
console.log('   HarmonyOSDevice:', typeof harmonyosModule.HarmonyOSDevice === 'function' ? '✅' : '❌');
console.log('   HdcBackend:', typeof harmonyosModule.HdcBackend === 'function' ? '✅' : '❌');

// 检查客户端 API
const clientModule = require('./packages/playwright-core/lib/client/harmonyos.js');
console.log('\n2. 客户端 API 检查:');
console.log('   HarmonyOS:', typeof clientModule.HarmonyOS === 'function' ? '✅' : '❌');
console.log('   HarmonyOSDevice:', typeof clientModule.HarmonyOSDevice === 'function' ? '✅' : '❌');
console.log('   HarmonyOSWebView:', typeof clientModule.HarmonyOSWebView === 'function' ? '✅' : '❌');
console.log('   ArkUIElement:', typeof clientModule.ArkUIElement === 'function' ? '✅' : '❌');
console.log('   ArkUIRecorder:', typeof clientModule.ArkUIRecorder === 'function' ? '✅' : '❌');

// 检查 ArkUI 模块
const arkuiModule = require('./packages/playwright-core/lib/server/harmonyos/arkui.js');
console.log('\n3. ArkUI Inspector 检查:');
console.log('   ArkUIInspector:', typeof arkuiModule.ArkUIInspector === 'function' ? '✅' : '❌');

// 检查 Recorder 模块
const recorderModule = require('./packages/playwright-core/lib/server/harmonyos/arkuiRecorder.js');
console.log('\n4. 录制器检查:');
console.log('   ArkUIRecorder:', typeof recorderModule.ArkUIRecorder === 'function' ? '✅' : '❌');

// 检查 Dispatcher
const dispatcherModule = require('./packages/playwright-core/lib/server/dispatchers/harmonyosDispatcher.js');
console.log('\n5. Dispatcher 检查:');
console.log('   HarmonyOSDispatcher:', typeof dispatcherModule.HarmonyOSDispatcher === 'function' ? '✅' : '❌');
console.log('   HarmonyOSDeviceDispatcher:', typeof dispatcherModule.HarmonyOSDeviceDispatcher === 'function' ? '✅' : '❌');

// 测试 HdcBackend 实例化
console.log('\n6. HdcBackend 初始化:');
try {
  const backend = new harmonyosModule.HdcBackend();
  console.log('   ✅ HdcBackend 实例化成功');
  
  // 测试 devices 方法
  console.log('\n7. 设备发现:');
  backend.devices({}).then(devices => {
    console.log(`   发现 ${devices.length} 个设备`);
    if (devices.length > 0) {
      const device = devices[0];
      console.log(`   设备: ${device.serial}`);
    }
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ 验证完成！');
  }).catch(e => {
    console.log('   设备发现失败:', e.message);
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ 模块加载验证完成（需要 HDC 连接设备）');
  });
} catch (e) {
  console.log('   ❌ HdcBackend 初始化失败:', e.message);
}
