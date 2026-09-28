import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'

const NODE_COMPRESSION_PROBE = String.raw`
const http=require('node:http');
const {WebSocketServer,WebSocket}=require('ws');
const payload='SYNTHETIC_COMPRESSIBLE_FRAME_'.repeat(4096);
const writes=[];
const server=http.createServer();
const wss=new WebSocketServer({noServer:true,perMessageDeflate:{threshold:16*1024,serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:2}});
server.on('upgrade',(request,socket,head)=>{
 const write=socket.write;
 socket.write=function(chunk,...args){if(typeof chunk==='string'||Buffer.isBuffer(chunk)||ArrayBuffer.isView(chunk))writes.push(Buffer.from(chunk));return write.call(this,chunk,...args)};
 wss.handleUpgrade(request,socket,head,(client)=>wss.emit('connection',client,request));
});
wss.on('connection',(client)=>client.on('message',()=>client.send(payload)));
server.listen(0,'127.0.0.1',()=>{
 const client=new WebSocket('ws://127.0.0.1:'+server.address().port);
 client.on('error',(error)=>{console.error(error);process.exitCode=1;server.close()});
 client.on('open',()=>client.send('request'));
 client.on('message',(message)=>{
  const wire=Buffer.concat(writes);const headerEnd=wire.indexOf(Buffer.from('\r\n\r\n'));
  if(headerEnd<0){console.error('missing handshake header');process.exitCode=1;client.terminate();server.close();return}
  const handshake=wire.subarray(0,headerEnd).toString('utf8');const frame=wire.subarray(headerEnd+4);const marker=frame[1]&0x7f;
  const headerBytes=marker<126?2:marker===126?4:10;const compressedBytes=marker<126?marker:marker===126?frame.readUInt16BE(2):Number(frame.readBigUInt64BE(2));
  console.log(JSON.stringify({extensions:handshake.match(/sec-websocket-extensions:[^\r\n]+/i)?.[0]||'',rsv1:(frame[0]&0x40)!==0,wirePayloadBytes:compressedBytes,originalPayloadBytes:Buffer.byteLength(message.toString()),frameHeaderBytes:headerBytes}));
  client.terminate();for(const peer of wss.clients)peer.terminate();wss.close(()=>server.close());
 });
});
`

test('大于 16 KB 的 WebSocket 帧协商 permessage-deflate 并在网络线上使用压缩 RSV1', () => {
  const result = spawnSync('node', ['-e', NODE_COMPRESSION_PROBE], { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 })
  if (result.status !== 0) throw new Error(`Node WebSocket 压缩探针失败：${result.stderr || result.error?.message || result.status}`)
  const evidence = JSON.parse(result.stdout.trim()) as { extensions: string; rsv1: boolean; wirePayloadBytes: number; originalPayloadBytes: number; frameHeaderBytes: number }
  console.info(`[WebSocket 压缩实帧] ${evidence.extensions}; payload=${evidence.originalPayloadBytes}B; wire=${evidence.wirePayloadBytes}B; RSV1=${evidence.rsv1}`)
  expect(evidence.extensions).toMatch(/sec-websocket-extensions:\s*permessage-deflate/i)
  expect(evidence.originalPayloadBytes).toBeGreaterThan(16 * 1024)
  expect(evidence.rsv1).toBe(true)
  expect(evidence.wirePayloadBytes).toBeLessThan(evidence.originalPayloadBytes / 20)
})
