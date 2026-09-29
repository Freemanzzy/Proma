export const MOBILE_JS = String.raw`(function(){
  function start(){
    if (window.innerWidth >= 768 && (window.screen?.width ?? window.innerWidth) >= 768) return;
  var body=document.body;
  var rightPanelTimer=0;
  var viewport=window.visualViewport;
  function setIfChanged(element,key,value,write){
    if(element.dataset[key]===value)return false;
    element.dataset[key]=value;
    write();
    return true;
  }
  function webRemoteToast(message){
    var toast=document.querySelector('[data-web-remote-toast]');
    if(!toast){toast=document.createElement('div');toast.dataset.webRemoteToast='true';toast.setAttribute('role','status');document.body.appendChild(toast)}
    toast.textContent=message;toast.dataset.visible='true';window.clearTimeout(toast.__timer);toast.__timer=window.setTimeout(function(){delete toast.dataset.visible},2200);
  }
  function setNotifyState(button,on){
    var state=on?'on':'off';
    setIfChanged(button,'notifyState',state,function(){button.innerHTML=on?ICONS.bellCheck:ICONS.bell; button.setAttribute('aria-label',on?'通知已开启':'开启通知'); button.setAttribute('aria-pressed',String(on))});
  }
  function syncMenuButton(){
    var menuButton=document.querySelector('[data-web-remote-mobile-menu]'); if(!menuButton)return;
    var open=body.dataset.webRemoteSidebarOpen==='true'; var state=open?'close':'menu';
    setIfChanged(menuButton,'iconState',state,function(){menuButton.innerHTML=open?ICONS.menuClose:ICONS.menu;menuButton.setAttribute('aria-label',open?'收起侧栏':'打开侧栏');menuButton.setAttribute('aria-expanded',String(open))});
  }
  function syncRightPanel(){
    var panelToggle=document.querySelector('[data-web-remote-panel-toggle]');var isOpen=body.dataset.webRemoteRightOpen==='true';
    if(panelToggle){var iconState=isOpen?'close':'files';var label=isOpen?'折叠右侧工作区（文件）':'打开文件面板';setIfChanged(panelToggle,'iconState',iconState,function(){panelToggle.innerHTML=isOpen?ICONS.close:ICONS.files});if(panelToggle.getAttribute('aria-label')!==label)panelToggle.setAttribute('aria-label',label)}
    var panel=document.querySelector('[data-web-remote-panel="right"]'); if(!panel)return;
    var open=body.dataset.webRemoteRightOpen==='true';
    if(open){
      if(rightPanelTimer){window.clearTimeout(rightPanelTimer);rightPanelTimer=0}
      if(panel.dataset.webRemotePanelRendered!=='true')panel.dataset.webRemotePanelRendered='true';
      if(panel.style.display!=='flex')panel.style.display='flex';
      if(panel.style.visibility!=='visible')panel.style.visibility='visible';
      if(panel.style.pointerEvents)panel.style.pointerEvents='';
      if(panel.dataset.webRemotePanelOpen!=='true')window.requestAnimationFrame(function(){window.requestAnimationFrame(function(){if(body.dataset.webRemoteRightOpen==='true'&&panel.dataset.webRemotePanelOpen!=='true')panel.dataset.webRemotePanelOpen='true'})});
    } else if(panel.dataset.webRemotePanelRendered==='true'){
      if(panel.dataset.webRemotePanelOpen)delete panel.dataset.webRemotePanelOpen;
      if(panel.style.pointerEvents!=='none')panel.style.pointerEvents='none';
      if(!rightPanelTimer)rightPanelTimer=window.setTimeout(function(){rightPanelTimer=0;if(body.dataset.webRemoteRightOpen!=='true'){delete panel.dataset.webRemotePanelRendered;if(panel.style.display!=='none')panel.style.display='none';if(panel.style.visibility!=='hidden')panel.style.visibility='hidden'}},210);
    }
  }
  function syncKeyboardViewport(){
    if(!viewport)return;
    var focused=document.activeElement;
    var editable=focused instanceof HTMLElement && (focused.matches('input,textarea,[contenteditable="true"]'));
    var inset=Math.max(0,Math.round(window.innerHeight-viewport.height-viewport.offsetTop));
    var keyboardInset=editable&&inset>80?inset+'px':'0px';
    setIfChanged(body,'keyboardInset',keyboardInset,function(){body.style.setProperty('--web-remote-keyboard-inset',keyboardInset)});
    if(editable&&inset>80){try{focused.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'})}catch{};window.setTimeout(function(){window.scrollTo(0,0)},0)}
  }
  var ICONS={bellCheck:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m15 5 2 2 4-4"/></svg>',menuClose:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>',chevron:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',menu:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',refresh:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',files:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',close:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',bell:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'};
  window.addEventListener('proma-web-remote-open-preview',function(){body.dataset.webRemoteRightOpen='true';var toggle=document.querySelector('[data-web-remote-panel-toggle]');if(toggle){toggle.innerHTML=ICONS.close;toggle.setAttribute('aria-label','折叠右侧工作区（文件）')}});
  document.addEventListener('focusin',syncKeyboardViewport,true);
  document.addEventListener('focusout',function(){window.setTimeout(syncKeyboardViewport,80)},true);
  if(viewport){viewport.addEventListener('resize',syncKeyboardViewport);viewport.addEventListener('scroll',syncKeyboardViewport)}
  function ensure(){
    syncKeyboardViewport();
    if (!document.querySelector('[data-web-remote-mobile-menu]')) {
      var menu=document.createElement('button'); menu.type='button'; menu.innerHTML=ICONS.menu; menu.setAttribute('aria-label','打开侧栏'); menu.dataset.webRemoteMobileMenu='true';
      menu.addEventListener('click',function(){if(body.dataset.webRemoteSidebarOpen==='true')delete body.dataset.webRemoteSidebarOpen;else body.dataset.webRemoteSidebarOpen='true'}); document.body.appendChild(menu);
    }
    if (!document.querySelector('[data-web-remote-mobile-overlay]')) {
      var overlay=document.createElement('div'); overlay.dataset.webRemoteMobileOverlay='true'; overlay.addEventListener('click',function(){delete body.dataset.webRemoteSidebarOpen; delete body.dataset.webRemoteRightOpen}); document.body.appendChild(overlay);
    }
    if (!document.querySelector('[data-web-remote-panel-toggle]')) {
      var panelToggle=document.createElement('button'); panelToggle.type='button'; panelToggle.dataset.webRemotePanelToggle='true'; panelToggle.innerHTML=ICONS.files; panelToggle.setAttribute('aria-label','打开文件面板');
      var suppressClick=false;
      var togglePanel=function(){var open=body.dataset.webRemoteRightOpen==='true'; if(open){delete body.dataset.webRemoteRightOpen;panelToggle.dataset.iconState='files';panelToggle.innerHTML=ICONS.files;panelToggle.setAttribute('aria-label','打开文件面板')}else{body.dataset.webRemoteRightOpen='true';panelToggle.dataset.iconState='close';panelToggle.innerHTML=ICONS.close;panelToggle.setAttribute('aria-label','折叠右侧工作区（文件）')}};
      window.__PROMA_TOGGLE_PANEL=togglePanel;
      panelToggle.addEventListener('click',function(){if(window.__PROMA_PANEL_TOUCH_HANDLED){window.__PROMA_PANEL_TOUCH_HANDLED=false;return}if(suppressClick){suppressClick=false;return}togglePanel()});
      panelToggle.addEventListener('touchend',function(event){event.preventDefault();suppressClick=true;togglePanel();window.setTimeout(function(){suppressClick=false},700)},{passive:false});
      panelToggle.addEventListener('pointerup',function(event){if(event.pointerType==='touch'){event.preventDefault();suppressClick=true;togglePanel();window.setTimeout(function(){suppressClick=false},700)}},{passive:false}); document.body.appendChild(panelToggle);
    }
    if (!document.querySelector('[data-web-remote-mobile-topbar]')) {
      var topbar=document.createElement('div'); topbar.dataset.webRemoteMobileTopbar='true';
      var title=document.createElement('button'); title.type='button'; title.dataset.webRemoteMobileTopbarTitle='true'; title.setAttribute('aria-haspopup','menu'); title.setAttribute('aria-expanded','false'); topbar.appendChild(title); document.body.appendChild(topbar);
    }
    var topbar=document.querySelector('[data-web-remote-mobile-topbar]');
    if(topbar&&!topbar.querySelector('[data-web-remote-refresh]')){
      var refresh=document.createElement('button'); refresh.type='button'; refresh.dataset.webRemoteRefresh='true'; refresh.innerHTML=ICONS.refresh; refresh.setAttribute('aria-label','刷新页面'); refresh.addEventListener('click',function(){window.location.reload()}); topbar.appendChild(refresh);
    }
    function syncHistoryMedia(){
      var walker=document.createTreeWalker(document.body,4);
      var nodes=[];var current;
      while((current=walker.nextNode()))if((current.nodeValue||'').includes('[[proma-web-remote-'))nodes.push(current);
      nodes.forEach(function(node){
        var text=node.nodeValue||'';var pattern=/\[\[proma-web-remote-(media|text):([A-Za-z0-9_-]+)\]\]([^\[]*)/g;var match;var fragment=document.createDocumentFragment();var offset=0;var found=false;
        while((match=pattern.exec(text))){
          found=true;if(match.index>offset)fragment.appendChild(document.createTextNode(text.slice(offset,match.index)));
          var kind=match[1];var payload;try{payload=JSON.parse(atob(match[2].replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(match[2].length/4)*4,'=')))}catch{fragment.appendChild(document.createTextNode(kind==='media'?'[图片标记无法解析，请在桌面查看]':'[原文标记无法解析，请在桌面查看]'));offset=pattern.lastIndex;continue}
          var holder=document.createElement('span');holder.dataset.webRemoteHistoryMedia='true';holder.dataset.mediaKind=kind;holder.dataset.mediaState='idle';holder.style.cssText='display:inline-flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:100%;vertical-align:middle';
          if(kind==='media'&&typeof payload.inlineData==='string'){
            var inlineImage=document.createElement('img');inlineImage.dataset.webRemoteInlineImage='true';inlineImage.alt='历史图片';inlineImage.style.cssText='display:block;max-width:100%;height:auto;border-radius:8px';inlineImage.src='data:'+(payload.mime||'image/*')+';base64,'+payload.inlineData;
            inlineImage.addEventListener('load',function(){holder.dataset.mediaState='loaded'},{once:true});inlineImage.addEventListener('error',function(){holder.dataset.mediaState='failed';inlineImage.alt='小图显示失败'},{once:true});holder.appendChild(inlineImage);holder.dataset.mediaState='loaded';fragment.appendChild(holder);offset=pattern.lastIndex;continue;
          }
          var button=document.createElement('button');button.type='button';button.style.cssText='padding:8px 12px;border:1px solid rgba(127,127,127,.35);border-radius:10px;background:var(--background,#fff);color:var(--foreground,#222);font-size:14px;line-height:1.35;max-width:100%;white-space:normal;text-align:left';
          var kb=Math.max(0,Number(payload.bytes)||0)/1024;button.textContent=kind==='media'?'图片 · '+(kb>=1024?(kb/1024).toFixed(1)+' MB':kb.toFixed(1)+' KB')+' · 点按加载':'点按查看完整内容（原文 '+(kb>=1024?(kb/1024).toFixed(1)+' MB':kb.toFixed(1)+' KB')+'）';
          button.addEventListener('click',async function(){
            if(holder.dataset.mediaState==='loading')return;
            holder.dataset.mediaState='loading';button.disabled=true;button.textContent='正在加载…';
            try{
              var invoke=window.__PROMA_WEB_REMOTE_INVOKE;if(typeof invoke!=='function')throw new Error('连接尚未就绪，请重试');
              var result=await invoke('web-remote:get-history-media',Object.assign({},payload,{kind:kind}));
              if(kind==='text'){
                if(typeof result?.text!=='string')throw new Error('原文内容为空');
                var expanded=document.createElement('span');expanded.dataset.webRemoteExpandedText='true';expanded.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';expanded.textContent=result.text;holder.replaceChildren(expanded);holder.dataset.mediaState='expanded';return;
              }
              if(typeof result?.data!=='string'||typeof result?.mime!=='string')throw new Error('图片数据为空');
              var image=document.createElement('img');image.dataset.webRemoteExpandedImage='true';image.alt='历史图片';image.style.cssText='display:block;max-width:100%;height:auto;border-radius:8px';image.src='data:'+result.mime+';base64,'+result.data;
              image.addEventListener('error',function(){holder.dataset.mediaState='failed';button.disabled=false;button.textContent='图片显示失败，点按重试';image.remove()},{once:true});
              image.addEventListener('load',function(){holder.dataset.mediaState='loaded'},{once:true});holder.appendChild(image);button.textContent='图片已加载 · 点按重试';button.disabled=false;holder.dataset.mediaState='loaded';
            }catch(error){holder.dataset.mediaState='failed';button.disabled=false;button.textContent=(kind==='media'?'图片加载失败，点按重试':'原文加载失败，点按重试')+'（'+String(error?.reason||error?.message||error)+'）'}
          });holder.appendChild(button);fragment.appendChild(holder);offset=pattern.lastIndex;
        }
        if(found){if(offset<text.length)fragment.appendChild(document.createTextNode(text.slice(offset)));node.parentNode?.replaceChild(fragment,node)}
      });
    }
    function syncEarlierHistory(){
      var meta=window.__PROMA_WEB_REMOTE_HISTORY_META;
      var button=document.querySelector('[data-web-remote-load-earlier]');
      var activeSession=document.querySelector('[data-session-switch-id].agent-session-item-active');
      var activeId=activeSession&&activeSession.getAttribute('data-session-switch-id');
      if(!meta||!meta.hasEarlier||!meta.startIndex||(meta.sessionId&&activeId&&meta.sessionId!==activeId)){
        if(button)setIfChanged(button,'historyState','hidden',function(){button.hidden=true});
        return;
      }
      if(!button){
        button=document.createElement('button');
        button.type='button';
        button.dataset.webRemoteLoadEarlier='true';
        button.style.cssText='position:fixed;z-index:2147483000;left:50%;top:calc(env(safe-area-inset-top) + 68px);transform:translateX(-50%);padding:7px 13px;border:1px solid rgba(127,127,127,.3);border-radius:999px;background:var(--background,#fff);color:var(--foreground,#222);font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
        document.body.appendChild(button);
      }
      setIfChanged(button,'visibilityState','visible',function(){button.hidden=false});
      setIfChanged(button,'historyState',String(meta.startIndex),function(){button.textContent='加载更早（已省略 '+meta.omittedCount+' 条）'});
      if(!button.dataset.loadEarlierBound){
        setIfChanged(button,'loadEarlierBound','true',function(){});
        button.addEventListener('click',async function(){
          var currentMeta=window.__PROMA_WEB_REMOTE_HISTORY_META;
          if(!currentMeta||!currentMeta.hasEarlier||button.dataset.loading==='true')return;
          setIfChanged(button,'loading','true',function(){button.textContent='正在加载…'});
          try{
            var requested=new URLSearchParams(location.search).get('session');
            var sessionButton=document.querySelector('button[aria-label^="会话菜单："]');
            var title=sessionButton?sessionButton.getAttribute('aria-label').replace(/^会话菜单：/,''):'';
            var sessionId=currentMeta.sessionId||requested;
            var sessions=await window.electronAPI?.listAgentSessions?.();
            var session=(sessions||[]).find(function(item){return sessionId?item.id===sessionId:item.title===title});
            var load=window.__PROMA_WEB_REMOTE_LOAD_EARLIER;
            if(session&&typeof load==='function')await load(session.id,currentMeta.startIndex);
          }catch(error){
            console.error('[Web Remote] 加载更早消息失败',error);
            webRemoteToast('加载更早消息失败，请重试');
          }finally{
            var latest=window.__PROMA_WEB_REMOTE_HISTORY_META;
            setIfChanged(button,'loading','false',function(){button.textContent=latest&&latest.hasEarlier?'加载更早（已省略 '+latest.omittedCount+' 条）':'加载更早的消息'});
            syncEarlierHistory();
          }
        });
      }
    }
    syncEarlierHistory();
    syncHistoryMedia();
    syncRightPanel();
    var topbar=document.querySelector('[data-web-remote-mobile-topbar]');
    if (topbar && !topbar.querySelector('[data-web-remote-notification-entry]')) {
      var notify=document.createElement('button'); notify.type='button'; notify.dataset.webRemoteNotificationEntry='true'; setNotifyState(notify,false); if('Notification' in window&&Notification.permission==='granted'){fetch('/api/push/subscription',{credentials:'include'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.subscribed)setNotifyState(notify,true)}).catch(function(){});}
      notify.addEventListener('click',async function(){
        if(notify.dataset.notifyState==='on'){webRemoteToast('通知已开启：会话完成、出错或需要你确认时会推送');return;}
        try {
          if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) { alert('请先将 /app/ 添加到主屏幕，再开启通知。'); return; }
          if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { alert('此浏览器暂不支持 Web Push 通知。'); return; }
          var permission=await Notification.requestPermission(); if(permission!=='granted'){alert('未获得通知权限；可在系统设置中重新开启。');return;}
          var registration=await navigator.serviceWorker.register('/app/sw.js',{scope:'/app/'}); await navigator.serviceWorker.ready;
          var keyResponse=await fetch('/api/push/key',{credentials:'include'}); if(!keyResponse.ok)throw new Error('无法读取推送公钥'); var key=(await keyResponse.json()).publicKey;
          var applicationServerKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),function(c){return c.charCodeAt(0)});
          var subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey});
          var saved=await fetch('/api/push/subscription',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON(),label:/Android/i.test(navigator.userAgent)?'Android 手机':'iPhone'})}); if(!saved.ok)throw new Error('订阅登记失败'); setNotifyState(notify,true); webRemoteToast('通知已开启');
        } catch(error) { var msg=(error&&error.message)||String(error); if((error&&error.name==='NotAllowedError')||/denied|not allowed/i.test(msg)){alert('系统拒绝了推送订阅。请在「设置 → 通知 → Proma」开启通知后再试；iOS 模拟器不支持网页推送，请在真机上开启。');} else {alert('开启通知失败：'+msg);} }
      }); topbar.appendChild(notify);
    }
    var topbar=document.querySelector('[data-web-remote-mobile-topbar]');
    var title=topbar && topbar.querySelector('[data-web-remote-mobile-topbar-title]');
    var menu=document.querySelector('[data-web-remote-mobile-menu]'); var panelToggle=document.querySelector('[data-web-remote-panel-toggle]');
    if (topbar && menu && panelToggle) {
      if (menu.parentElement !== topbar) topbar.insertBefore(menu, topbar.firstChild);
      if (panelToggle.parentElement !== topbar) topbar.appendChild(panelToggle);
      if (title && title.parentElement !== topbar) topbar.insertBefore(title, panelToggle);
      var refresh=topbar.querySelector('[data-web-remote-refresh]'); if(refresh&&refresh.nextSibling!==panelToggle)topbar.insertBefore(refresh,panelToggle);
    }
    if (!window.__PROMA_PUSH_PRESENCE_INSTALLED) {
      window.__PROMA_PUSH_PRESENCE_INSTALLED=true;
      var reportPresence=function(){
        var button=document.querySelector('button[aria-label^="会话菜单："]'); var titleText=button?button.getAttribute('aria-label').replace(/^会话菜单：/,''):'';
        var requested=new URLSearchParams(location.search).get('session');
        Promise.resolve(window.electronAPI?.listAgentSessions?.()).then(function(items){
          var session=(items||[]).find(function(item){return requested?item.id===requested:item.title===titleText});
          fetch('/api/push/presence',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session?.id||null,visible:document.visibilityState==='visible'&&!!session})}).catch(function(){});
        }).catch(function(){});
      };
      document.addEventListener('visibilitychange',reportPresence); window.setInterval(reportPresence,5000); window.addEventListener('popstate',reportPresence);
      var requestedSession=new URLSearchParams(location.search).get('session');
      if(requestedSession){var tries=0;var selectRequested=function(){Promise.resolve(window.electronAPI?.listAgentSessions?.()).then(function(items){var session=(items||[]).find(function(item){return item.id===requestedSession});if(!session)return;var candidates=Array.from(document.querySelectorAll('button,[role="button"], [data-web-remote-sidebar] *'));var target=candidates.find(function(node){return node.innerText?.trim()===session.title});if(target){target.click();history.replaceState(null,'',location.pathname);setTimeout(reportPresence,800)}else if(tries++<40)setTimeout(selectRequested,250)}).catch(function(){})};setTimeout(selectRequested,500)}
    }
    if (title) {
      var selectedTab=document.querySelector('[data-web-remote-panel="right"] [role="tab"][aria-selected="true"]');
      var sessionButton=document.querySelector('button[aria-label^="会话菜单："]');
      var nextTitle=body.dataset.webRemoteRightOpen==='true' ? ((selectedTab && selectedTab.innerText.trim()) || '工作区') : ((sessionButton && sessionButton.innerText.trim()) || 'Proma');
      setIfChanged(title,'label',nextTitle,function(){title.replaceChildren(document.createTextNode(nextTitle)); title.insertAdjacentHTML('beforeend',ICONS.chevron)});
      var tabButtons=Array.from(document.querySelectorAll('[data-web-remote-panel="right"] [role="tablist"][aria-label="右侧工作区"] [role="tab"]')).filter(function(tab){return !tab.hasAttribute('data-web-remote-simulator-tab')});
      var menu=document.querySelector('[data-web-remote-mobile-tab-menu]');
      if(menu){var signature=tabButtons.map(function(tab){return (tab.innerText||'').trim()+':'+tab.getAttribute('aria-selected')+':'+!!tab.parentElement?.querySelector('button[aria-label*="关闭"]')}).join('|');setIfChanged(menu,'signature',signature,function(){menu.replaceChildren();tabButtons.forEach(function(tab){var row=document.createElement('div');row.style.display='flex';var choose=document.createElement('button');choose.type='button';choose.setAttribute('role','menuitem');choose.dataset.active=String(tab.getAttribute('aria-selected')==='true');choose.textContent=(tab.innerText||'').trim();choose.addEventListener('click',function(){tab.click();menu.hidden=true;body.dataset.webRemoteRightOpen='true';title.setAttribute('aria-expanded','false')});row.appendChild(choose);var close=tab.parentElement?.querySelector('button[aria-label*="关闭"]');if(close){var closeButton=document.createElement('button');closeButton.type='button';closeButton.setAttribute('aria-label','关闭 '+choose.textContent);closeButton.textContent='×';closeButton.style.width='44px';closeButton.addEventListener('click',function(event){event.stopPropagation();close.click();});row.appendChild(closeButton)}menu.appendChild(row)});});}
      if(!title.__menuBound){title.__menuBound=true;title.addEventListener('click',function(){var current=document.querySelector('[data-web-remote-mobile-tab-menu]');if(!current){current=document.createElement('div');current.dataset.webRemoteMobileTabMenu='true';current.setAttribute('role','menu');current.hidden=true;document.body.appendChild(current)}current.hidden=!current.hidden;title.setAttribute('aria-expanded',String(!current.hidden));ensure()});}
    }
    syncRightPanel();
    document.querySelectorAll('[data-web-remote-memory-path]').forEach(function(path){if(!path.dataset.pathBound){path.dataset.pathBound='true';path.addEventListener('click',function(){var expanded=path.dataset.expanded==='true';path.dataset.expanded=String(!expanded);path.textContent=expanded?path.dataset.pathDisplay:path.dataset.pathOriginal})}if(path.dataset.expanded==='true')return;var current=path.textContent||'';if(current===path.dataset.pathDisplay)return;var parts=current.split(/[\\/]+/).filter(Boolean);path.dataset.pathOriginal=current;path.dataset.pathDisplay=parts.length>2?'…/'+parts.slice(-2).join('/'):current;path.title=current;path.textContent=path.dataset.pathDisplay});
    var settingsOpen=Array.from(document.querySelectorAll('h1,h2,h3')).some(function(node){return /通用设置|模型配置/.test(node.innerText)});
    var notice=document.querySelector('[data-web-remote-settings-notice]');
    if (settingsOpen && !notice) {
      notice=document.createElement('div'); notice.dataset.webRemoteSettingsNotice='true'; notice.innerHTML='<span>设置请在电脑端操作</span><button type="button">返回</button>'; notice.querySelector('button').addEventListener('click',function(){var buttons=Array.from(document.querySelectorAll('button'));var back=buttons.reverse().find(function(button){return button.innerText.trim()==='返回'});if(back)back.click()}); document.body.appendChild(notice);
    } else if (!settingsOpen && notice) notice.remove();
    document.querySelectorAll('img[alt="用户头像"]').forEach(function(img){img.addEventListener('error',function(){img.style.display='none'},{once:true});});
  }
  var lastTouchAt=0;
  document.addEventListener('touchstart',function(){lastTouchAt=Date.now()},true);
  ['mouseover','mouseout','mouseenter','mouseleave','pointerover','pointerout','pointerenter','pointerleave'].forEach(function(type){
    document.addEventListener(type,function(event){
      if(event.pointerType==='touch'||Date.now()-lastTouchAt<800){event.stopPropagation();if(event.stopImmediatePropagation)event.stopImmediatePropagation()}
    },true);
  });
  document.addEventListener('click',function(event){
    var target=event.target;
    if (!(target instanceof Element)) return;
    if (window.__PROMA_SKIP_NEXT_CLICK && target.closest('button')) { window.__PROMA_SKIP_NEXT_CLICK=false; event.stopPropagation(); return; }
    if (target.closest('[data-web-remote-sidebar="left"]')) { delete body.dataset.webRemoteSidebarOpen; }
    var rightPanelTrigger=target.closest('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"],button[aria-label="项目记忆"],button[aria-label="日程"]');
    if (rightPanelTrigger) { window.setTimeout(function(){body.dataset.webRemoteRightOpen='true'}, 0); }
    if (target.closest('button[aria-label="打开设置"]')) { window.setTimeout(function(){delete body.dataset.webRemoteRightOpen}, 0); }
    if (target.closest('[data-web-remote-panel-toggle]')) return;
    if (target.closest('button[aria-label="打开文件面板"]')) { body.dataset.webRemoteRightOpen='true'; }
    if (target.closest('button[aria-label="折叠右侧工作区"]')) { delete body.dataset.webRemoteRightOpen; }
  }, true);
  var forwardMobileControl=function(target){
    if (!(target instanceof Element)) return false;
    var control=target.closest('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"],button[aria-label="项目记忆"],button[aria-label="日程"],button[aria-label="打开设置"],button[aria-label*="中新建会话"]');
    if (!control) return false;
    delete body.dataset.webRemoteSidebarOpen; control.click(); window.__PROMA_SKIP_NEXT_CLICK=true; window.setTimeout(function(){window.__PROMA_SKIP_NEXT_CLICK=false},700);
    if (control.matches('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"],button[aria-label="项目记忆"],button[aria-label="日程"]')) window.setTimeout(function(){body.dataset.webRemoteRightOpen='true'},0);
    return true;
  };
  document.addEventListener('touchstart',function(event){
    if (forwardMobileControl(event.target)) event.preventDefault();
  }, {capture:true,passive:false});
  document.addEventListener('touchend',function(event){
    var target=event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-web-remote-panel-toggle]') && typeof window.__PROMA_TOGGLE_PANEL==='function') {
      window.__PROMA_PANEL_TOUCH_HANDLED=true; window.__PROMA_TOGGLE_PANEL(); return;
    }
    forwardMobileControl(target);
  }, true);
  try { ensure(); new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true}); new MutationObserver(syncRightPanel).observe(body,{attributes:true,attributeFilter:['data-web-remote-right-open']}); new MutationObserver(syncMenuButton).observe(body,{attributes:true,attributeFilter:['data-web-remote-sidebar-open']}); syncMenuButton(); } catch(error) { window.__PROMA_WEB_REMOTE_PATCH_ERROR=String(error); console.error('[Web Remote mobile patch] 初始化失败',error); }
  var hiddenAt=0; var lifecycleReady=false; var recovering=false;
  window.setTimeout(function(){lifecycleReady=true},3000);
  function recover(){
    if (recovering) return;
    recovering=true;
    var callback=window.__PROMA_WEB_REMOTE_RECOVER;
    if (typeof callback!=='function') { recovering=false; window.location.reload(); return; }
    Promise.resolve().then(function(){return callback()}).catch(function(){ window.location.reload(); }).finally(function(){ recovering=false; });
  }
  document.addEventListener('visibilitychange',function(){
    if (!lifecycleReady) return;
    if (document.visibilityState==='hidden') { hiddenAt=Date.now(); return; }
    if (hiddenAt && Date.now()-hiddenAt>=5000) recover();
    hiddenAt=0;
  });
    window.addEventListener('proma-web-remote-reconnected',recover);
  }
  var bootAttempts=0;
  function boot(){
    if (window.innerWidth < 768 || (window.screen?.width ?? window.innerWidth) < 768) { start(); return; }
    if (bootAttempts++<100) window.setTimeout(boot,50);
  }
  boot();
  window.setTimeout(start,1000);
})();`
