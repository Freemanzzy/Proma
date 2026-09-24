import { WebRemoteAuth, readWebRemoteConfig } from './web-remote-auth'

const auth = new WebRemoteAuth(readWebRemoteConfig())
const command = process.argv[2] ?? 'pair'

if (command === 'pair') {
  const pairing = auth.createPairingCode()
  const config = auth.getConfig()
  const port = Number.isInteger(config.port) ? config.port : 17888
  console.log(`配对码: ${pairing.code}`)
  console.log(`有效期至: ${new Date(pairing.expiresAt).toISOString()}`)
  console.log(`建议命令: tailscale serve --bg --https=443 http://127.0.0.1:${port}`)
} else if (command === 'devices') {
  console.log(JSON.stringify(auth.listDevices(), null, 2))
} else if (command === 'revoke') {
  const deviceId = process.argv[3]
  if (!deviceId || !auth.revokeDevice(deviceId)) {
    console.error('设备不存在或已撤销')
    process.exitCode = 1
  } else {
    console.log(`已撤销设备: ${deviceId}`)
  }
} else {
  console.error('用法: web-remote.sh pair|devices|revoke <deviceId>')
  process.exitCode = 2
}
