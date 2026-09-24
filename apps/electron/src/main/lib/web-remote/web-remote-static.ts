export function renderWebRemoteStatic(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111827"><title>Proma Web Remote</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#111827;color:#f3f4f6}*{box-sizing:border-box}body{margin:0;max-width:900px;margin-inline:auto;padding:16px}button,input,textarea{font:inherit;border-radius:8px;border:1px solid #374151;background:#1f2937;color:inherit;padding:10px}button{cursor:pointer;background:#2563eb;border:0}.muted{color:#9ca3af}.card{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:12px;margin:10px 0}.row{display:flex;gap:8px;align-items:center;justify-content:space-between}.messages{min-height:50vh;max-height:65vh;overflow:auto}.message{white-space:pre-wrap;margin:8px 0;padding:8px;border-radius:8px;background:#111827}.assistant{border-left:3px solid #60a5fa}.user{border-left:3px solid #34d399}.tool{border-left:3px solid #f59e0b}.hidden{display:none}#pair{max-width:400px;margin:10vh auto}
</style></head><body>
<section id="pair" class="card"><h1>Proma Web Remote</h1><p class="muted">输入桌面端生成的 6 位配对码。</p><input id="code" inputmode="numeric" maxlength="6" placeholder="配对码"><input id="label" placeholder="设备名称（可选）"><button id="pairBtn">配对</button><p id="pairError" class="muted"></p></section>
<section id="app" class="hidden"><div class="row"><h1>Proma</h1><button id="refresh">刷新</button></div><div id="sessions"></div><section id="detail" class="hidden"><div class="row"><h2 id="title"></h2><div><button id="stop">中止</button><button id="back">返回</button></div></div><div id="messages" class="messages"></div><div class="row"><textarea id="input" rows="2" placeholder="发送消息"></textarea><button id="send">发送</button></div></section></section>
<script>
const $=id=>document.getElementById(id);let sessions=[],current=null,ws=null;
function show(id){$('pair').classList.toggle('hidden',id!=='pair');$('app').classList.toggle('hidden',id==='pair')}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});if(r.status===401){show('pair')}if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.status);return r.json()}
async function load(){sessions=await api('/api/sessions');$('sessions').innerHTML=sessions.map(s=>'<div class="card row"><div><b>'+esc(s.title)+'</b><div class="muted">'+esc(s.workspaceId||'未分组')+' · '+(s.running?'运行中':'空闲')+(s.hasPendingPermission?' · 待审批':'')+'</div></div><button data-id="'+esc(s.id)+'">打开</button></div>').join('');document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>openSession(b.dataset.id));}
async function openSession(id){current=sessions.find(s=>s.id===id);if(!current)return;$('title').textContent=current.title;$('detail').classList.remove('hidden');$('sessions').classList.add('hidden');render(await api('/api/sessions/'+encodeURIComponent(id)+'/messages'));connect();}
function render(ms){$('messages').innerHTML=ms.map(m=>'<div class="message '+m.role+'"><b>'+esc(m.role)+'</b> '+esc(m.text||m.toolResult||m.toolInput||'')+'</div>').join('');$('messages').scrollTop=$('messages').scrollHeight}
function connect(){if(ws)ws.close();ws=new WebSocket(location.origin.replace('http','ws')+'/api/stream');ws.onopen=()=>ws.send(JSON.stringify({type:'subscribe',sessionIds:[current.id]}));ws.onmessage=e=>{const x=JSON.parse(e.data);if(x.type==='text_delta')$('messages').insertAdjacentHTML('beforeend','<div class="message assistant">'+esc(x.text)+'</div>');if(x.type==='permission_request'&&confirm(x.request.description+'\n\n允许？'))resolve(x.request.requestId,'allow');else if(x.type==='permission_request')resolve(x.request.requestId,'deny');if(x.type==='refresh_required')load();};}
async function resolve(id,behavior){await api('/api/permissions/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({behavior})});}
$('pairBtn').onclick=async()=>{try{await api('/api/pair',{method:'POST',body:JSON.stringify({code:$('code').value,label:$('label').value})});show('app');await load();}catch(e){$('pairError').textContent=e.message}};
$('refresh').onclick=()=>load();$('back').onclick=()=>{$('detail').classList.add('hidden');$('sessions').classList.remove('hidden');if(ws)ws.close()};$('stop').onclick=()=>current&&api('/api/sessions/'+encodeURIComponent(current.id)+'/stop',{method:'POST'});$('send').onclick=async()=>{if(!current)return;const v=$('input').value.trim();if(!v)return; $('input').value='';await api('/api/sessions/'+encodeURIComponent(current.id)+'/send',{method:'POST',body:JSON.stringify({message:v})});};
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
(async()=>{try{await load();show('app')}catch{show('pair')}})();
</script></body></html>`
}
