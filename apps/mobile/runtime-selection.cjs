const path = require('node:path');
function selectNativeRuntime({development, backend = 'service'}) {
  if (!['service', 'emulator'].includes(backend)) throw new Error('Unknown development backend');
  if (!development && backend !== 'service') throw new Error('Release bundles cannot connect to Firebase Emulator');
  return path.join(__dirname, 'src/platform', development && backend === 'emulator' ? 'development/emulatorRuntime.ts' : 'firebase/productionRuntime.ts');
}
module.exports = {selectNativeRuntime};
