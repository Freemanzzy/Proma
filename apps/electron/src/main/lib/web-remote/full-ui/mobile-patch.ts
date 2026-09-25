export function renderWebRemoteMobilePatch(): string {
  return `<style id="proma-web-remote-mobile-style">
@media (max-width: 767px) {
  html, body, #root { width:100%; min-width:0; max-width:100%; overflow-x:hidden; }
  html, body, #root, .shell-bg.h-screen { height:100dvh!important; min-height:0!important; }
  [data-web-remote-main="true"] { padding-bottom:env(safe-area-inset-bottom); box-sizing:border-box; }
  body { overscroll-behavior-x:none; }
  [data-web-remote-app-content="true"] { position:relative; width:100vw!important; max-width:100vw; padding-top:56px!important; }
  [data-web-remote-sidebar="left"] { position:fixed!important; inset:0 auto 0 0; z-index:10001!important; width:min(86vw,340px)!important; max-width:340px; transform:translateX(-105%); transition:transform .18s ease; box-shadow:none; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-sidebar="left"] { box-shadow:12px 0 32px rgba(0,0,0,.25); }
  [data-web-remote-sidebar="left"] > * { width:100%!important; max-width:none!important; }
  [data-web-remote-sidebar="left"] [class*="cursor-col-resize"], [data-web-remote-sidebar="left"] .sidebar-window-drag-strip { pointer-events:none!important; }
  [data-web-remote-sidebar-divider="true"] { display:none!important; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-sidebar="left"] { transform:translateX(0); }
  [data-web-remote-main="true"] { width:100%!important; min-width:0!important; max-width:100vw; }
  [data-web-remote-panel="right"] { position:fixed!important; inset:56px 0 0!important; z-index:10002!important; display:none!important; width:100vw!important; max-width:none!important; height:calc(100dvh - 56px)!important; background:hsl(var(--background)); }
  body[data-web-remote-right-open="true"] [data-web-remote-panel="right"] { display:flex!important; }
  [data-web-remote-panel="right"] > * { width:100%!important; max-width:none!important; min-width:0!important; }
  [data-web-remote-panel="right"] > [aria-hidden="true"] { display:none!important; }
  body[data-web-remote-right-open="true"] [data-web-remote-panel="right"] [class*="opacity-0"] { opacity:1!important; pointer-events:auto!important; }
  [data-web-remote-panel="right"] [role="tablist"], [data-web-remote-panel="right"] [class*="overflow-x-auto"] { overflow-x:auto!important; white-space:nowrap; scrollbar-width:none; }
  [data-web-remote-panel="right"] button, [data-web-remote-panel="right"] [role="button"] { min-height:42px; }
  [data-web-remote-sidebar="left"] button[aria-label="打开设置"] { display:none!important; }
  [data-web-remote-mobile-topbar] { position:fixed; inset:0 0 auto; z-index:10004; display:flex; align-items:center; gap:8px; height:56px; padding:max(7px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) 7px max(8px,env(safe-area-inset-left)); background:hsl(var(--background)/.94); border-bottom:1px solid hsl(var(--border)); backdrop-filter:blur(12px); }
  [data-web-remote-mobile-topbar] [data-web-remote-mobile-menu], [data-web-remote-mobile-topbar] [data-web-remote-panel-toggle] { position:static!important; flex:none; box-shadow:none; }
  [data-web-remote-mobile-topbar-title] { min-width:0; flex:1; overflow:hidden; text-align:center; text-overflow:ellipsis; white-space:nowrap; font-size:15px; font-weight:650; color:hsl(var(--foreground)); }
  [data-web-remote-settings-notice] { position:fixed; inset:56px 12px auto; z-index:10005; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid hsl(var(--border)); border-radius:14px; background:hsl(var(--background)); color:hsl(var(--foreground)); box-shadow:0 8px 26px rgba(0,0,0,.2); font-size:14px; }
  [data-web-remote-settings-notice] button { min-height:36px; padding:6px 12px; border-radius:9px; background:hsl(var(--primary)); color:hsl(var(--primary-foreground)); }
  [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay], [data-web-remote-panel-toggle] { display:block; }
  [data-web-remote-panel-toggle] { position:fixed; top:max(8px, env(safe-area-inset-top)); right:max(8px, env(safe-area-inset-right)); z-index:10003; min-width:42px; height:42px; padding:0 10px; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); box-shadow:0 3px 12px rgba(0,0,0,.16); font-size:14px; }
  [data-web-remote-mobile-menu] { position:fixed; top:max(8px, env(safe-area-inset-top)); left:max(8px, env(safe-area-inset-left)); z-index:10003; width:42px; height:42px; padding:0; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); box-shadow:0 3px 12px rgba(0,0,0,.16); font-size:22px; line-height:1; }
  [data-web-remote-mobile-overlay] { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.38); }
  body:not([data-web-remote-sidebar-open="true"]) [data-web-remote-mobile-overlay] { display:none; }
  [data-web-remote-main="true"] input, [data-web-remote-main="true"] textarea, [data-web-remote-main="true"] [contenteditable="true"] { font-size:16px!important; }
  [data-web-remote-input-toolbar="true"] { height:auto!important; min-height:48px; flex-wrap:wrap!important; align-items:flex-start!important; gap:8px!important; }
  [data-web-remote-input-toolbar="true"] > :first-child { flex:1 1 100%!important; min-width:0; flex-wrap:wrap!important; overflow:visible!important; }
  [data-web-remote-input-toolbar="true"] > :first-child > * { min-height:40px; }
  [data-web-remote-input-toolbar="true"] > :last-child { flex:1 1 100%; justify-content:flex-end; }
  [data-web-remote-input-toolbar="true"] button, [data-web-remote-input-toolbar="true"] [role="button"] { min-height:40px!important; min-width:40px; }
  [data-web-remote-input-toolbar="true"] [data-radix-popper-content-wrapper] { max-width:calc(100vw - 16px); }
  [data-web-remote-input-toolbar="true"] [data-radix-popper-content-wrapper] > * { max-width:calc(100vw - 16px); }
  [data-web-remote-main="true"] [contenteditable="true"] { max-width:100%; overflow-x:hidden; }
  [data-web-remote-main="true"] kbd, [data-web-remote-main="true"] [data-shortcut], [data-web-remote-main="true"] [class*="shortcut"] { display:none!important; }
  img[alt="用户头像"] { display:none!important; }
}
@media (min-width: 768px) { [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay], [data-web-remote-panel-toggle] { display:none!important; } }
</style>
<script nonce="__PROMA_NONCE__">
(function(){
  function start(){
    if (window.innerWidth >= 768 && (window.screen?.width ?? window.innerWidth) >= 768) return;
  var body=document.body;
  function ensure(){
    if (!document.querySelector('[data-web-remote-mobile-menu]')) {
      var menu=document.createElement('button'); menu.type='button'; menu.textContent='☰'; menu.setAttribute('aria-label','打开侧栏'); menu.dataset.webRemoteMobileMenu='true';
      menu.addEventListener('click',function(){body.dataset.webRemoteSidebarOpen='true'}); document.body.appendChild(menu);
    }
    if (!document.querySelector('[data-web-remote-mobile-overlay]')) {
      var overlay=document.createElement('div'); overlay.dataset.webRemoteMobileOverlay='true'; overlay.addEventListener('click',function(){delete body.dataset.webRemoteSidebarOpen; delete body.dataset.webRemoteRightOpen}); document.body.appendChild(overlay);
    }
    if (!document.querySelector('[data-web-remote-panel-toggle]')) {
      var panelToggle=document.createElement('button'); panelToggle.type='button'; panelToggle.dataset.webRemotePanelToggle='true'; panelToggle.textContent='文件'; panelToggle.setAttribute('aria-label','打开文件面板');
      var suppressClick=false;
      var togglePanel=function(){var open=body.dataset.webRemoteRightOpen==='true'; if(open){delete body.dataset.webRemoteRightOpen; panelToggle.textContent='文件'; panelToggle.setAttribute('aria-label','打开文件面板')}else{body.dataset.webRemoteRightOpen='true'; panelToggle.textContent='×'; panelToggle.setAttribute('aria-label','折叠右侧工作区')}};
      window.__PROMA_TOGGLE_PANEL=togglePanel;
      panelToggle.addEventListener('click',function(){if(window.__PROMA_PANEL_TOUCH_HANDLED){window.__PROMA_PANEL_TOUCH_HANDLED=false;return}if(suppressClick){suppressClick=false;return}togglePanel()});
      panelToggle.addEventListener('touchend',function(event){event.preventDefault();suppressClick=true;togglePanel();window.setTimeout(function(){suppressClick=false},700)},{passive:false});
      panelToggle.addEventListener('pointerup',function(event){if(event.pointerType==='touch'){event.preventDefault();suppressClick=true;togglePanel();window.setTimeout(function(){suppressClick=false},700)}},{passive:false}); document.body.appendChild(panelToggle);
    }
    if (!document.querySelector('[data-web-remote-mobile-topbar]')) {
      var topbar=document.createElement('div'); topbar.dataset.webRemoteMobileTopbar='true';
      var title=document.createElement('div'); title.dataset.webRemoteMobileTopbarTitle='true'; topbar.appendChild(title); document.body.appendChild(topbar);
    }
    var topbar=document.querySelector('[data-web-remote-mobile-topbar]');
    var title=topbar && topbar.querySelector('[data-web-remote-mobile-topbar-title]');
    var menu=document.querySelector('[data-web-remote-mobile-menu]'); var panelToggle=document.querySelector('[data-web-remote-panel-toggle]');
    if (topbar && menu && panelToggle) {
      if (menu.parentElement !== topbar) topbar.insertBefore(menu, topbar.firstChild);
      if (panelToggle.parentElement !== topbar) topbar.appendChild(panelToggle);
      if (title && title.parentElement !== topbar) topbar.insertBefore(title, panelToggle);
    }
    if (title) {
      var selectedTab=document.querySelector('[data-web-remote-panel="right"] [role="tab"][aria-selected="true"]');
      var sessionButton=document.querySelector('button[aria-label^="会话菜单："]');
      var nextTitle=body.dataset.webRemoteRightOpen==='true' ? ((selectedTab && selectedTab.innerText.trim()) || '工作区') : ((sessionButton && sessionButton.innerText.trim()) || 'Proma');
      if (title.textContent!==nextTitle) title.textContent=nextTitle;
    }
    var settingsOpen=Array.from(document.querySelectorAll('h1,h2,h3')).some(function(node){return /通用设置|模型配置/.test(node.innerText)});
    var notice=document.querySelector('[data-web-remote-settings-notice]');
    if (settingsOpen && !notice) {
      notice=document.createElement('div'); notice.dataset.webRemoteSettingsNotice='true'; notice.innerHTML='<span>设置请在电脑端操作</span><button type="button">返回</button>'; notice.querySelector('button').addEventListener('click',function(){var buttons=Array.from(document.querySelectorAll('button'));var back=buttons.reverse().find(function(button){return button.innerText.trim()==='返回'});if(back)back.click()}); document.body.appendChild(notice);
    } else if (!settingsOpen && notice) notice.remove();
    document.querySelectorAll('img[alt="用户头像"]').forEach(function(img){img.addEventListener('error',function(){img.style.display='none'},{once:true});});
  }
  document.addEventListener('click',function(event){
    var target=event.target;
    if (!(target instanceof Element)) return;
    if (window.__PROMA_SKIP_NEXT_CLICK && target.closest('button')) { window.__PROMA_SKIP_NEXT_CLICK=false; event.stopPropagation(); return; }
    if (target.closest('[data-web-remote-sidebar="left"]')) { window.setTimeout(function(){delete body.dataset.webRemoteSidebarOpen}, 0); }
    var rightPanelTrigger=target.closest('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"]');
    if (rightPanelTrigger) { window.setTimeout(function(){body.dataset.webRemoteRightOpen='true'}, 0); }
    if (target.closest('button[aria-label="打开设置"]')) { window.setTimeout(function(){delete body.dataset.webRemoteRightOpen}, 0); }
    if (target.closest('[data-web-remote-panel-toggle]')) return;
    if (target.closest('button[aria-label="打开文件面板"]')) { body.dataset.webRemoteRightOpen='true'; }
    if (target.closest('button[aria-label="折叠右侧工作区"]')) { delete body.dataset.webRemoteRightOpen; }
  }, true);
  var forwardMobileControl=function(target){
    if (!(target instanceof Element)) return false;
    var control=target.closest('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"],button[aria-label="打开设置"],button[aria-label*="中新建会话"]');
    if (!control) return false;
    delete body.dataset.webRemoteSidebarOpen; control.click(); window.__PROMA_SKIP_NEXT_CLICK=true; window.setTimeout(function(){window.__PROMA_SKIP_NEXT_CLICK=false},700);
    if (control.matches('button[aria-label="Todo"],button[aria-label="定时任务"],button[aria-label="MCP/Skills"]')) window.setTimeout(function(){body.dataset.webRemoteRightOpen='true'},0);
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
  try { ensure(); new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true}); } catch(error) { window.__PROMA_WEB_REMOTE_PATCH_ERROR=String(error); console.error('[Web Remote mobile patch] 初始化失败',error); }
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
})();
</script>`
}
