/**
 * 直接测试 HarmonyOS 模块
 */
const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔍 HarmonyOS 模块直接验证\n');
console.log('='.repeat(50));

// 1. HDC 连接测试
console.log('\n1. HDC 连接...');
try {
  const hdcList = execSync('hdc list targets', { encoding: 'utf8' });
  console.log('   ✅ HDC 连接成功');
  console.log('   输出:', hdcList.trim().split('\n')[0]);
} catch (e) {
  console.log('   ⚠️ HDC 连接失败');
}

// 2. WebView Socket 测试
console.log('\n2. WebView Socket...');
try {
  const sockets = execSync('hdc shell "cat /proc/net/unix | grep webview"', { encoding: 'utf8' });
  const lines = sockets.trim().split('\n').filter(l => l.includes('@'));
  console.log(`   发现 ${lines.length} 个 WebView`);
  if (lines.length > 0) {
    const match = lines[0].match(/@([^@\s]+)/);
    if (match) console.log('   Socket:', match[1]);
  }
} catch (e) {
  console.log('   ⚠️ WebView Socket 扫描失败');
}

// 3. 截图测试
console.log('\n3. 截图测试...');
try {
  execSync('hdc shell "uitest screenCap -p /data/local/tmp/test.png"', { encoding: 'utf8', timeout: 10000 });
  execSync('hdc file recv /data/local/tmp/test.png /tmp/harmony-test.png', { encoding: 'utf8', timeout: 10000 });
  const stat = fs.statSync('/tmp/harmony-test.png');
  console.log(`   ✅ 截图成功: ${(stat.size / 1024).toFixed(1)} KB`);
} catch (e) {
  console.log('   ⚠️ 截图失败');
}

// 4. UI 树测试
console.log('\n4. UI 树获取...');
try {
  execSync('hdc shell "uitest dumpLayout -p /data/local/tmp/layout.json"', { encoding: 'utf8', timeout: 10000 });
  execSync('hdc file recv /data/local/tmp/layout.json /tmp/layout.json', { encoding: 'utf8', timeout: 10000 });
  const content = fs.readFileSync('/tmp/layout.json', 'utf8');
  const size = fs.statSync('/tmp/layout.json').size;
  console.log(`   ✅ UI 树获取成功: ${size} bytes`);
} catch (e) {
  console.log('   ⚠️ UI 树获取失败');
}

// 5. 设备信息
console.log('\n5. 设备信息...');
try {
  const model = execSync('hdc shell "getprop hw.product.model"', { encoding: 'utf8' }).trim();
  const version = execSync('hdc shell "getprop hw.os.version"', { encoding: 'utf8' }).trim();
  console.log(`   型号: ${model || 'Unknown'}`);
  console.log(`   版本: ${version || 'Unknown'}`);
} catch (e) {
  console.log('   ⚠️ 获取设备信息失败');
}

// 6. 源码检查
console.log('\n6. 源码检查...');
const srcFiles = [
  'packages/playwright-core/src/server/harmonyos/harmonyos.ts',
  'packages/playwright-core/src/server/harmonyos/webview.ts',
  'packages/playwright-core/src/server/harmonyos/arkui.ts',
  'packages/playwright-core/src/client/harmonyos.ts',
];

srcFiles.forEach(f => {
  const exists = fs.existsSync(f);
  const lines = exists ? fs.readFileSync(f, 'utf8').split('\n').length : 0;
  console.log(`   ${exists ? '✅' : '❌'} ${f.split('/').pop()}: ${lines} 行`);
});

// 7. 方法检查
console.log('\n7. 方法检查...');
const baseDir = '/storage/Users/currentUser/playwright/packages/playwright-core/src';
const methodChecks = [
  ['webViewEvaluate', `${baseDir}/server/harmonyos/webview.ts`],
  ['setRequestHandler', `${baseDir}/server/harmonyos/webview.ts`],
  ['mockResponse', `${baseDir}/server/harmonyos/webview.ts`],
  ['webViewNavigate', `${baseDir}/client/harmonyos.ts`],
  ['webViewGoBack', `${baseDir}/client/harmonyos.ts`],
  ['waitFor', `${baseDir}/client/harmonyos.ts`],
];

methodChecks.forEach(([method, file]) => {
  const content = fs.readFileSync(file, 'utf8');
  const exists = content.includes(`${method}`);
  console.log(`   ${exists ? '✅' : '❌'} ${method}()`);
});

console.log('\n' + '='.repeat(50));
console.log('\n✅ 验证完成！');
