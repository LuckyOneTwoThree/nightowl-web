/**
 * macOS 本地构建的 ad-hoc 签名。
 *
 * 项目没有 Apple Developer ID，electron-builder 在 identity=null 时会完全跳过签名。
 * Apple Silicon 上未签名的 .app 无法启动（内核只允许已签名/临时签名的 arm64 可执行文件），
 * 因此这里在打包后、生成 dmg/zip 前做一次 ad-hoc 签名：
 *   - 本机可直接运行，朋友下载解压后去掉 quarantine 也能打开；
 *   - 不去申请证书、不做公证，Release 里会明确写「未签名」的打开方式；
 *   - 若以后配置了 Developer ID，electron-builder 的正式签名会在 afterPack 之后覆盖它。
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' }
  );
};
