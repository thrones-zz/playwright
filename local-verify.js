/**
 * Playwright HarmonyOS 本地功能验证
 */
const { _harmonyos } = require('./packages/playwright-core');
const fs = require('fs');
const path = require('path');

async function verify() {
  console.log('🔍 Playwright HarmonyOS 本地验证\n');
  console.log('='.repeat(50));

  try {
    // 1. 检查 API 存在
    console.log('\n1. API 检查...');
    console.log('   ✅ _harmonyos 模块加载成功');
    console.log('   devices():', typeof _harmonyos.devices);
    console.log('   setDefaultTimeout():', typeof _harmonyos.setDefaultTimeout);

    // 2. 设备发现
    console.log('\n2. 设备发现...');
    const devices = await _harmonyos.devices();
    console.log(`   发现 ${devices.length} 个设备`);

    if (devices.length === 0) {
      console.log('   ⚠️ 未发现设备');
      console.log('   运行 hdc list targets 检查连接');
      return;
    }

    const device = devices[0];
    console.log(`   ✅ 设备: ${device.model()} (${device.serial()})`);

    // 3. Shell 执行
    console.log('\n3. Shell 执行测试...');
    try {
      const result = await device.shell('echo "test"');
      console.log(`   ✅ shell() 成功: "${result.toString().trim()}"`);
    } catch (e) {
      console.log('   ⚠️ shell() 失败:', e.message);
    }

    // 4. 截图
    console.log('\n4. 截图测试...');
    try {
      const screenshot = await device.screenshot();
      console.log(`   ✅ screenshot() 成功: ${(screenshot.length / 1024).toFixed(1)} KB`);
      fs.writeFileSync('verify-screenshot.png', screenshot);
      console.log('   已保存: verify-screenshot.png');
    } catch (e) {
      console.log('   ⚠️ screenshot() 失败:', e.message);
    }

    // 5. WebView
    console.log('\n5. WebView 检查...');
    const webViews = device.webViews();
    console.log(`   发现 ${webViews.length} 个 WebView`);

    if (webViews.length > 0) {
      const wv = webViews[0];
      console.log(`   Socket: ${wv.socketName()}`);
      console.log(`   Package: ${wv.package()}`);

      // 6. WebView JS 执行
      console.log('\n6. WebView JS 执行测试...');
      try {
        const title = await device.webViewEvaluate(wv.socketName(), 'document.title');
        console.log(`   ✅ webViewEvaluate() 成功: "${title || '(空)'}"`);
      } catch (e) {
        console.log('   ⚠️ webViewEvaluate() 失败:', e.message);
      }

      // 7. WebView 截图
      console.log('\n7. WebView 截图测试...');
      try {
        const wvScreenshot = await device.webViewScreenshot(wv.socketName());
        console.log(`   ✅ webViewScreenshot() 成功: ${(wvScreenshot.length / 1024).toFixed(1)} KB`);
      } catch (e) {
        console.log('   ⚠️ webViewScreenshot() 失败:', e.message);
      }
    }

    // 8. 方法存在性检查
    console.log('\n8. 方法存在性检查...');
    const methods = [
      'waitFor', 'scroll', 'swipe', 'pressKey',
      'webViewNavigate', 'webViewGoBack', 'webViewReload',
      'mockResponse', 'recorder'
    ];
    methods.forEach(m => {
      const exists = typeof device[m] === 'function';
      console.log(`   ${exists ? '✅' : '❌'} ${m}()`);
    });

    // 9. 关闭设备
    console.log('\n9. 关闭连接...');
    await device.close();
    console.log('   ✅ 设备已关闭');

    console.log('\n' + '='.repeat(50));
    console.log('\n✅ 本地验证完成！');

  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error(error.stack);
  }
}

verify();
