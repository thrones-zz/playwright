/**
 * WebView CDP 功能测试
 */
const { _harmonyos } = require('./packages/playwright-core');

async function testWebViewCDP() {
  console.log('🔍 WebView CDP 功能测试\n');
  console.log('='.repeat(50));

  try {
    // 1. 发现设备
    console.log('\n1. 设备发现...');
    const devices = await _harmonyos.devices();
    if (devices.length === 0) {
      console.log('   ⚠️ 未发现设备');
      return;
    }
    const device = devices[0];
    console.log(`   ✅ 设备: ${device.model()} (${device.serial()})`);

    // 2. WebView 列表
    console.log('\n2. WebView 发现...');
    const webViews = device.webViews();
    console.log(`   发现 ${webViews.length} 个 WebView`);

    if (webViews.length === 0) {
      console.log('   ⚠️ 无 WebView（打开浏览器应用后重试）');
    } else {
      webViews.forEach((wv, i) => {
        console.log(`   [${i+1}] ${wv.package()}`);
        console.log(`       Socket: ${wv.socketName()}`);
      });

      // 3. 获取第一个 WebView socket
      const targetSocket = webViews[0].socketName;
      console.log(`\n3. 测试 WebView: ${targetSocket}`);

      // 4. WebView 截图
      console.log('\n4. WebView 截图测试...');
      try {
        const screenshot = await device.webViewScreenshot(targetSocket);
        console.log(`   ✅ WebView 截图成功: ${(screenshot.length / 1024).toFixed(1)} KB`);
        require('fs').writeFileSync('test-webview-screenshot.png', screenshot);
      } catch (e) {
        console.log(`   ⚠️ WebView 截图失败: ${e.message}`);
      }

      // 5. 获取 HTML 内容
      console.log('\n5. 获取页面内容...');
      try {
        const html = await device.webViewGetContent(targetSocket);
        console.log(`   ✅ 获取内容成功: ${html.length} 字符`);
        console.log(`   内容预览: ${html.substring(0, 100)}...`);
      } catch (e) {
        console.log(`   ⚠️ 获取内容失败: ${e.message}`);
      }

      // 6. JS 执行
      console.log('\n6. JavaScript 执行测试...');
      try {
        const title = await device.webViewEvaluate(targetSocket, 'document.title');
        console.log(`   ✅ JS 执行成功: title = "${title}"`);
      } catch (e) {
        console.log(`   ⚠️ JS 执行失败: ${e.message}`);
      }
    }

    await device.close();
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ WebView CDP 测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
  }
}

testWebViewCDP();
