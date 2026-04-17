/**
 * Playwright HarmonyOS 功能验证
 */
const { _harmonyos } = require('./packages/playwright-core');

async function main() {
  console.log('🔍 Playwright HarmonyOS 功能验证\n');
  console.log('='.repeat(50));

  // 1. API 检查
  console.log('\n1. 检查 API...');
  console.log('   devices():', typeof _harmonyos.devices === 'function' ? '✅' : '❌');
  console.log('   setDefaultTimeout():', typeof _harmonyos.setDefaultTimeout === 'function' ? '✅' : '❌');

  // 2. 设备发现
  console.log('\n2. 设备发现...');
  try {
    const devices = await _harmonyos.devices();
    console.log(`   发现 ${devices.length} 个设备`);

    if (devices.length === 0) {
      console.log('   ⚠️ 未发现设备（连接 HarmonyOS 设备后重试）');
      return;
    }

    const device = devices[0];
    console.log(`   序列号: ${device.serial()}`);
    console.log(`   型号: ${device.model()}`);
    console.log(`   系统: ${device.osVersion()}`);

    // 3. 功能测试
    console.log('\n3. 功能测试...');

    // Shell
    try {
      const result = await device.shell('echo "hello"');
      console.log(`   ✅ shell(): "${result.toString().trim()}"`);
    } catch (e) {
      console.log(`   ❌ shell(): ${e.message}`);
    }

    // 截图
    try {
      const screenshot = await device.screenshot();
      console.log(`   ✅ screenshot(): ${(screenshot.length / 1024).toFixed(1)} KB`);
      require('fs').writeFileSync('test-screenshot.png', screenshot);
    } catch (e) {
      console.log(`   ❌ screenshot(): ${e.message}`);
    }

    // waitFor
    try {
      const hasWaitFor = typeof device.waitFor === 'function';
      console.log(`   ${hasWaitFor ? '✅' : '❌'} waitFor()`);
    } catch (e) {
      console.log(`   ❌ waitFor(): ${e.message}`);
    }

    // recorder
    try {
      const recorder = device.recorder({ language: 'typescript' });
      console.log(`   ✅ recorder(): 支持 ${typeof recorder.start === 'function' ? 'start/stop/generateCode' : '部分'}`);
    } catch (e) {
      console.log(`   ❌ recorder(): ${e.message}`);
    }

    await device.close();

    console.log('\n' + '='.repeat(50));
    console.log('\n✅ 验证完成！');

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
  }
}

main();
