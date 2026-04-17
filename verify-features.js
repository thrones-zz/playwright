const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Playwright HarmonyOS 功能验证\n');
console.log('='.repeat(50));

// 1. 检查编译输出
console.log('\n1. 编译文件检查:');
const libPath = 'packages/playwright-core/lib/server/harmonyos';
const files = ['harmonyos.js', 'arkui.js', 'arkuiRecorder.js', 'webview.js'];
files.forEach(f => {
  const exists = fs.existsSync(path.join(libPath, f));
  const size = exists ? fs.statSync(path.join(libPath, f)).size : 0;
  console.log(`   ${exists ? '✅' : '❌'} ${f}: ${size > 0 ? (size/1024).toFixed(1) + ' KB' : '不存在'}`);
});

// 2. 检查客户端编译
console.log('\n2. 客户端模块:');
const clientFile = 'packages/playwright-core/lib/client/harmonyos.js';
const clientExists = fs.existsSync(clientFile);
console.log(`   ${clientExists ? '✅' : '❌'} harmonyos.js: ${clientExists ? (fs.statSync(clientFile).size/1024).toFixed(1) + ' KB' : '不存在'}`);

// 3. 检查分发器
console.log('\n3. 分发器:');
const dispFile = 'packages/playwright-core/lib/server/dispatchers/harmonyosDispatcher.js';
const dispExists = fs.existsSync(dispFile);
console.log(`   ${dispExists ? '✅' : '❌'} harmonyosDispatcher.js: ${dispExists ? (fs.statSync(dispFile).size/1024).toFixed(1) + ' KB' : '不存在'}`);

// 4. 检查源码
console.log('\n4. 源码文件:');
const srcFiles = [
  'packages/playwright-core/src/client/harmonyos.ts',
  'packages/playwright-core/src/server/harmonyos/harmonyos.ts',
  'packages/playwright-core/src/server/harmonyos/arkui.ts',
  'packages/playwright-core/src/server/harmonyos/arkuiRecorder.ts'
];
srcFiles.forEach(f => {
  const exists = fs.existsSync(f);
  const lines = exists ? fs.readFileSync(f, 'utf8').split('\n').length : 0;
  console.log(`   ${exists ? '✅' : '❌'} ${path.basename(f)}: ${lines} 行`);
});

// 5. 检查类型定义
console.log('\n5. 类型定义 (.d.ts):');
const typeFiles = ['arkui.d.ts', 'arkuiRecorder.d.ts', 'harmonyos.d.ts'];
typeFiles.forEach(f => {
  const exists = fs.existsSync(path.join(libPath, f));
  console.log(`   ${exists ? '✅' : '❌'} ${f}`);
});

// 6. 功能方法检查
console.log('\n6. 核心功能方法:');
const harmonyosSrc = fs.readFileSync('packages/playwright-core/src/client/harmonyos.ts', 'utf8');
const methods = [
  ['devices()', /devices\s*\(/],
  ['screenshot()', /screenshot\s*\(/],
  ['shell()', /shell\s*\(/],
  ['getPageSource()', /getPageSource\s*\(/],
  ['findElement()', /findElement\s*\(/],
  ['waitFor()', /waitFor\s*\(/],
  ['recorder()', /recorder\s*\(/]
];
methods.forEach(([name, regex]) => {
  const found = regex.test(harmonyosSrc);
  console.log(`   ${found ? '✅' : '❌'} ${name}`);
});

// 7. ArkUIElement 方法
console.log('\n7. ArkUIElement 方法:');
const elementMethods = [
  ['click()', /async\s+click\s*\(/],
  ['longClick()', /longClick\s*\(/],
  ['inputText()', /inputText\s*\(/],
  ['scroll()', /scroll\s*\(/],
  ['swipe()', /swipe\s*\(/],
  ['pressKey()', /pressKey\s*\(/]
];
elementMethods.forEach(([name, regex]) => {
  const found = regex.test(harmonyosSrc);
  console.log(`   ${found ? '✅' : '❌'} ${name}`);
});

// 8. 文件传输
console.log('\n8. 文件传输:');
const serverSrc = fs.readFileSync('packages/playwright-core/src/server/harmonyos/harmonyos.ts', 'utf8');
const transferMethods = [
  ['receiveFile()', /receiveFile\s*\(/],
  ['sendFile()', /sendFile\s*\(/]
];
transferMethods.forEach(([name, regex]) => {
  const found = regex.test(serverSrc);
  console.log(`   ${found ? '✅' : '❌'} ${name}`);
});

console.log('\n' + '='.repeat(50));
console.log('\n✅ 功能验证完成！');
