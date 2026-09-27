export function renderWebRemoteMobilePatch(): string {
  return `<style id="proma-web-remote-mobile-style">
@media (max-width: 767px) {
  html, body, #root { width:100%; min-width:0; max-width:100%; overflow-x:hidden; }
  html, body, #root, .shell-bg.h-screen { height:100dvh!important; min-height:0!important; }
  [data-web-remote-main="true"] { padding-bottom:calc(env(safe-area-inset-bottom) + var(--web-remote-keyboard-inset, 0px)); box-sizing:border-box; }
  body { overscroll-behavior-x:none; }
  [data-web-remote-app-content="true"] { position:relative; width:100vw!important; max-width:100vw; padding-top:56px!important; }
  [data-web-remote-sidebar="left"] { position:fixed!important; inset:0 auto 0 0; z-index:10001!important; width:min(86vw,340px)!important; max-width:340px; transform:translateX(-105%); transition:transform .18s cubic-bezier(.2,.8,.2,1); box-shadow:none; will-change:transform; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-sidebar="left"] { box-shadow:12px 0 32px rgba(0,0,0,.25); }
  [data-web-remote-sidebar="left"] > * { width:100%!important; max-width:none!important; }
  [data-web-remote-sidebar="left"] [class*="cursor-col-resize"], [data-web-remote-sidebar="left"] .sidebar-window-drag-strip { pointer-events:none!important; }
  [data-web-remote-sidebar-divider="true"] { display:none!important; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-sidebar="left"] { transform:translateX(0); }
  [data-web-remote-main="true"] { width:100%!important; min-width:0!important; max-width:100vw; }
  [data-web-remote-panel="right"] { position:fixed!important; inset:56px 0 0!important; z-index:10002!important; display:none!important; width:100vw!important; max-width:none!important; height:calc(100dvh - 56px)!important; background:hsl(var(--background)); opacity:0; transform:translateX(100%); transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease; pointer-events:none; visibility:hidden; }
  [data-web-remote-panel="right"][data-web-remote-panel-rendered="true"] { display:flex!important; }
  [data-web-remote-panel="right"][data-web-remote-panel-open="true"] { opacity:1; transform:translateX(0); pointer-events:auto; visibility:visible; }
  [data-web-remote-panel="right"] > * { width:100%!important; max-width:none!important; min-width:0!important; }
  [data-web-remote-panel="right"] > [aria-hidden="true"] { display:none!important; }
  [data-web-remote-panel="right"] [class*="cursor-col-resize"], [data-web-remote-panel="right"] [class*="cursor-row-resize"] { display:none!important; pointer-events:none!important; }
  body[data-web-remote-right-open="true"] [data-web-remote-panel="right"] [class*="opacity-0"] { opacity:1!important; pointer-events:auto!important; }
  [data-web-remote-panel="right"] [role="tablist"], [data-web-remote-panel="right"] [class*="overflow-x-auto"] { overflow-x:auto!important; white-space:nowrap; scrollbar-width:none; }
  [data-web-remote-panel="right"] button, [data-web-remote-panel="right"] [role="button"] { min-height:42px; }
  [data-web-remote-sidebar="left"] button[aria-label="打开设置"] { display:none!important; }
  [data-web-remote-mobile-topbar] { position:fixed; inset:0 0 auto; z-index:10004; display:flex; align-items:center; gap:8px; height:56px; padding:max(7px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) 7px max(8px,env(safe-area-inset-left)); background:hsl(var(--background)/.94); border-bottom:1px solid hsl(var(--border)); backdrop-filter:blur(12px); }
  [data-web-remote-mobile-topbar] [data-web-remote-mobile-menu], [data-web-remote-mobile-topbar] [data-web-remote-panel-toggle], [data-web-remote-mobile-topbar] [data-web-remote-refresh] { position:static!important; flex:none; box-shadow:none; }
  [data-web-remote-notification-entry] { position:static!important; min-height:38px; padding:7px 10px; border:1px solid hsl(var(--border)); border-radius:10px; background:hsl(var(--background)); color:hsl(var(--foreground)); font-size:12px; }
  [data-web-remote-mobile-topbar-title] { min-width:0; flex:1; overflow:hidden; text-align:center; text-overflow:ellipsis; white-space:nowrap; font-size:15px; font-weight:650; color:hsl(var(--foreground)); }
  [data-web-remote-settings-notice] { position:fixed; inset:56px 12px auto; z-index:10005; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid hsl(var(--border)); border-radius:14px; background:hsl(var(--background)); color:hsl(var(--foreground)); box-shadow:0 8px 26px rgba(0,0,0,.2); font-size:14px; }
  [data-web-remote-settings-notice] button { min-height:36px; padding:6px 12px; border-radius:9px; background:hsl(var(--primary)); color:hsl(var(--primary-foreground)); }
  [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay], [data-web-remote-panel-toggle], [data-web-remote-refresh] { display:block; }
  [data-web-remote-refresh] { min-width:42px; height:42px; padding:0 10px; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); font-size:13px; }
  [data-web-remote-mobile-topbar] button, [data-web-remote-sidebar="left"] button, [data-web-remote-panel="right"] button, [data-web-remote-sidebar="left"] [role="button"], [data-web-remote-panel="right"] [role="button"] { -webkit-tap-highlight-color:transparent; touch-action:manipulation; }
  [data-web-remote-mobile-topbar] button:active, [data-web-remote-sidebar="left"] button:active, [data-web-remote-panel="right"] button:active, [data-web-remote-sidebar="left"] [role="button"]:active, [data-web-remote-panel="right"] [role="button"]:active { transform:scale(.97); }
  [data-web-remote-sidebar="left"] .agent-session-item-active { background-color:hsl(var(--accent)/.18); }
  [data-web-remote-panel-toggle] { position:fixed; top:max(8px, env(safe-area-inset-top)); right:max(8px, env(safe-area-inset-right)); z-index:10003; min-width:42px; height:42px; padding:0 10px; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); box-shadow:0 3px 12px rgba(0,0,0,.16); font-size:14px; }
  [data-web-remote-mobile-menu] { position:fixed; top:max(8px, env(safe-area-inset-top)); left:max(8px, env(safe-area-inset-left)); z-index:10003; width:42px; height:42px; padding:0; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); box-shadow:0 3px 12px rgba(0,0,0,.16); font-size:22px; line-height:1; }
  [data-web-remote-mobile-overlay] { position:fixed; inset:0; z-index:10000; display:block!important; background:rgba(0,0,0,.38); opacity:0; visibility:hidden; pointer-events:none; transition:opacity .18s ease,visibility .18s; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-mobile-overlay] { opacity:1; visibility:visible; pointer-events:auto; }
  [data-web-remote-main="true"] input, [data-web-remote-main="true"] textarea, [data-web-remote-main="true"] [contenteditable="true"] { font-size:16px!important; }
  [data-web-remote-input-toolbar="true"] { height:auto!important; min-height:48px; flex-wrap:wrap!important; align-items:flex-start!important; gap:8px!important; }
  [data-web-remote-input-toolbar="true"] > :first-child { flex:1 1 100%!important; min-width:0; flex-wrap:wrap!important; overflow:visible!important; }
  [data-web-remote-input-toolbar="true"] > :first-child > * { min-height:40px; }
  [data-web-remote-input-toolbar="true"] > :last-child { flex:1 1 100%; justify-content:flex-end; }
  [data-web-remote-input-toolbar="true"] button, [data-web-remote-input-toolbar="true"] [role="button"] { min-height:40px!important; min-width:40px; }
  [data-web-remote-input-toolbar="true"] [data-radix-popper-content-wrapper] { max-width:calc(100vw - 16px); }
  [data-web-remote-input-toolbar="true"] [data-radix-popper-content-wrapper] > * { max-width:calc(100vw - 16px); }
  [data-web-remote-main="true"] [contenteditable="true"] { max-width:100%; overflow-x:hidden; }
  [data-web-remote-main="true"] kbd, [data-web-remote-main="true"] [data-shortcut], [data-web-remote-main="true"] [class*="shortcut"], [data-web-remote-panel="right"] kbd, [data-web-remote-panel="right"] [data-shortcut], [data-web-remote-panel="right"] [class*="shortcut"] { display:none!important; }
  [data-web-remote-panel="right"] [role="tablist"][aria-label="右侧工作区"], [data-web-remote-panel="right"] [data-web-remote-mobile-hide="true"] { display:none!important; }
  [data-web-remote-panel="right"] [data-web-remote-split="memory"] { min-height:0!important; }
  [data-web-remote-mobile-topbar-title] { display:flex; align-items:center; justify-content:center; gap:6px; border:0; background:transparent; cursor:pointer; }
  [data-web-remote-mobile-tab-menu] { position:fixed; z-index:10010; top:56px; left:12px; right:12px; max-height:65dvh; overflow:auto; padding:6px; border:1px solid hsl(var(--border)); border-radius:14px; background:hsl(var(--background)); box-shadow:0 12px 32px rgba(0,0,0,.28); }
  [data-web-remote-mobile-tab-menu] button { display:flex; align-items:center; width:100%; min-height:44px; gap:10px; padding:8px 10px; text-align:left; border-radius:9px; }
  [data-web-remote-mobile-tab-menu] [data-active="true"] { background:hsl(var(--accent)); }
  [data-web-remote-memory-list], [data-web-remote-memory-detail] { min-width:0; }
  [data-web-remote-memory-detail][data-selected="false"] { display:none!important; }
  [data-web-remote-memory-list][data-selected="false"] { display:none!important; }
  [data-web-remote-memory-detail] [data-web-remote-memory-path] { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  [data-web-remote-split="detail"] { min-width:0!important; width:100%!important; max-width:100%!important; }
  [data-web-remote-mobile-back] { min-height:40px!important; padding:6px 10px!important; }
  [data-web-remote-panel="right"] input, [data-web-remote-panel="right"] textarea, [data-web-remote-panel="right"] [contenteditable="true"] { font-size:16px!important; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-toolbar] { display:flex; flex-wrap:nowrap; overflow-x:auto; gap:8px; width:100%; }
  [data-web-remote-panel="right"] [data-web-remote-skills-toolbar] { display:flex; flex-wrap:wrap!important; gap:8px!important; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-search] { flex:1 1 100%!important; width:100%!important; height:40px!important; }
  [data-web-remote-panel="right"] [data-web-remote-skills-toolbar] > button { min-height:40px; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-toolbar] > * { flex:none; min-height:40px; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-hide], [data-web-remote-panel="right"] button[aria-label*="分屏"], [data-web-remote-panel="right"] [role="button"][aria-label*="附加文件夹"] { display:none!important; }
  [data-web-remote-split="memory"] { display:block!important; min-height:0!important; }
  [data-web-remote-split="memory"] > * { height:100%; min-height:0; }
  [data-web-remote-memory-detail] [data-web-remote-mobile-back] { display:flex!important; }
  [data-web-remote-memory-list] button { min-height:42px; }
  [data-web-remote-automation-form] { flex-direction:column!important; overflow:auto!important; }
  [data-web-remote-automation-form] > * { width:100%!important; min-width:0!important; flex:0 0 auto!important; }
  [data-web-remote-automation-form] > :first-child { min-height:60vh!important; }
  [data-web-remote-automation-form] > :last-child { border-left:0!important; border-top:1px solid hsl(var(--border)); }
  [data-web-remote-panel="right"] [role="button"] { min-height:42px; }
  [data-web-remote-panel="right"] [data-web-remote-memory-list][data-selected="false"], [data-web-remote-panel="right"] [data-web-remote-memory-detail][data-selected="false"], [data-web-remote-split="memory"] > *:has([data-web-remote-memory-list][data-selected="false"]), [data-web-remote-split="memory"] > *:has([data-web-remote-memory-detail][data-selected="false"]) { display:none!important; }
  [data-web-remote-panel="right"] [data-web-remote-memory-detail][data-selected="true"] { display:block!important; height:100%; }
  [data-web-remote-panel="right"] [data-web-remote-memory-path] { cursor:pointer; }
  [data-web-remote-memory-detail] .live-markdown-external-scroll .ink-mde, [data-web-remote-memory-detail] .live-markdown-external-scroll .cm-editor { font-size:16px!important; }
  [data-web-remote-memory-detail] .live-markdown-external-scroll h1 { font-size:21px!important; line-height:1.4!important; }
  [data-web-remote-memory-detail] .live-markdown-external-scroll h2 { font-size:19px!important; line-height:1.45!important; }
  [data-web-remote-memory-detail] .live-markdown-external-scroll h3, [data-web-remote-memory-detail] .live-markdown-external-scroll p, [data-web-remote-memory-detail] .live-markdown-external-scroll li { font-size:16px!important; line-height:1.65!important; }
  [data-web-remote-preview] [data-web-remote-mobile-back] { display:flex!important; }
  [data-web-remote-panel="right"] .skills-embedded-card-grid, [data-web-remote-panel="right"] .mcp-section-grid { grid-template-columns:minmax(0,1fr)!important; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-toolbar] { padding-bottom:4px; }
  [data-web-remote-panel="right"] [data-web-remote-mobile-long-path] { font-size:12px; }
  [data-web-remote-panel="right"] [data-web-remote-long-path] { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  [data-web-remote-panel="right"] [data-web-remote-long-path][data-expanded="true"] { white-space:normal; overflow-wrap:anywhere; }
  img[alt="用户头像"] { display:none!important; }
}
@media (max-width: 767px) { [data-web-remote-mobile-menu], [data-web-remote-panel-toggle], [data-web-remote-refresh], [data-web-remote-notification-entry] { display:inline-flex!important; align-items:center; justify-content:center; width:40px!important; min-width:40px!important; height:40px!important; min-height:40px!important; padding:0!important; border-radius:12px!important; font-size:0!important; line-height:0!important; } [data-web-remote-mobile-topbar] svg { display:block; flex:none; } }
@media (max-width: 767px) { [data-web-remote-automation-title="true"] { flex-direction:column!important; align-items:flex-start!important; gap:2px!important; } [data-web-remote-automation-title="true"] > :first-child { white-space:normal!important; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; } [data-web-remote-automation-title="true"] > :last-child { max-width:100%; } }
@media (prefers-reduced-motion: reduce) { [data-web-remote-sidebar="left"], [data-web-remote-mobile-overlay], [data-web-remote-panel="right"], [data-web-remote-mobile-topbar] button, [data-web-remote-sidebar="left"] button, [data-web-remote-panel="right"] button { transition:none!important; } }
@media (min-width: 768px) { [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay], [data-web-remote-panel-toggle], [data-web-remote-refresh] { display:none!important; } }
</style>
<script nonce="__PROMA_NONCE__">
(function(){
  function start(){
    if (window.innerWidth >= 768 && (window.screen?.width ?? window.innerWidth) >= 768) return;
  var body=document.body;
  var rightPanelTimer=0;
  var viewport=window.visualViewport;
  function syncRightPanel(){
    var panelToggle=document.querySelector('[data-web-remote-panel-toggle]');var isOpen=body.dataset.webRemoteRightOpen==='true';
    if(panelToggle){var iconState=isOpen?'close':'files';var label=isOpen?'折叠右侧工作区（文件）':'打开文件面板';if(panelToggle.dataset.iconState!==iconState){panelToggle.dataset.iconState=iconState;panelToggle.innerHTML=isOpen?ICONS.close:ICONS.files}if(panelToggle.getAttribute('aria-label')!==label)panelToggle.setAttribute('aria-label',label)}
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
    body.style.setProperty('--web-remote-keyboard-inset',editable&&inset>80?inset+'px':'0px');
    if(editable&&inset>80){try{focused.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'})}catch{};window.setTimeout(function(){window.scrollTo(0,0)},0)}
  }
  var ICONS={chevron:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',menu:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',refresh:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',files:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',close:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',bell:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'};
  window.addEventListener('proma-web-remote-open-preview',function(){body.dataset.webRemoteRightOpen='true';var toggle=document.querySelector('[data-web-remote-panel-toggle]');if(toggle){toggle.innerHTML=ICONS.close;toggle.setAttribute('aria-label','折叠右侧工作区（文件）')}});
  document.addEventListener('focusin',syncKeyboardViewport,true);
  document.addEventListener('focusout',function(){window.setTimeout(syncKeyboardViewport,80)},true);
  if(viewport){viewport.addEventListener('resize',syncKeyboardViewport);viewport.addEventListener('scroll',syncKeyboardViewport)}
  function ensure(){
    syncKeyboardViewport();
    if (!document.querySelector('[data-web-remote-mobile-menu]')) {
      var menu=document.createElement('button'); menu.type='button'; menu.innerHTML=ICONS.menu; menu.setAttribute('aria-label','打开侧栏'); menu.dataset.webRemoteMobileMenu='true';
      menu.addEventListener('click',function(){body.dataset.webRemoteSidebarOpen='true'}); document.body.appendChild(menu);
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
    syncRightPanel();
    var topbar=document.querySelector('[data-web-remote-mobile-topbar]');
    if (topbar && !topbar.querySelector('[data-web-remote-notification-entry]')) {
      var notify=document.createElement('button'); notify.type='button'; notify.dataset.webRemoteNotificationEntry='true'; notify.innerHTML=ICONS.bell; notify.setAttribute('aria-label','开启通知');
      notify.addEventListener('click',async function(){
        try {
          if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) { alert('请先将 /app/ 添加到主屏幕，再开启通知。'); return; }
          if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { alert('此浏览器暂不支持 Web Push 通知。'); return; }
          var permission=await Notification.requestPermission(); if(permission!=='granted'){alert('未获得通知权限；可在系统设置中重新开启。');return;}
          var registration=await navigator.serviceWorker.register('/app/sw.js',{scope:'/app/'}); await navigator.serviceWorker.ready;
          var keyResponse=await fetch('/api/push/key',{credentials:'include'}); if(!keyResponse.ok)throw new Error('无法读取推送公钥'); var key=(await keyResponse.json()).publicKey;
          var applicationServerKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),function(c){return c.charCodeAt(0)});
          var subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey});
          var saved=await fetch('/api/push/subscription',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON(),label:/Android/i.test(navigator.userAgent)?'Android 手机':'iPhone'})}); if(!saved.ok)throw new Error('订阅登记失败'); notify.textContent='通知已开启'; notify.disabled=true;
        } catch(error) { alert('开启通知失败：'+(error&&error.message||String(error))); }
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
      if (title.dataset.label!==nextTitle) { title.dataset.label=nextTitle; title.replaceChildren(document.createTextNode(nextTitle)); title.insertAdjacentHTML('beforeend',ICONS.chevron); }
      var tabButtons=Array.from(document.querySelectorAll('[data-web-remote-panel="right"] [role="tablist"][aria-label="右侧工作区"] [role="tab"]'));
      var menu=document.querySelector('[data-web-remote-mobile-tab-menu]');
      if(menu){var signature=tabButtons.map(function(tab){return (tab.innerText||'').trim()+':'+tab.getAttribute('aria-selected')+':'+!!tab.parentElement?.querySelector('button[aria-label*="关闭"]')}).join('|');if(menu.dataset.signature!==signature){menu.dataset.signature=signature;menu.replaceChildren();tabButtons.forEach(function(tab){var row=document.createElement('div');row.style.display='flex';var choose=document.createElement('button');choose.type='button';choose.setAttribute('role','menuitem');choose.dataset.active=String(tab.getAttribute('aria-selected')==='true');choose.textContent=(tab.innerText||'').trim();choose.addEventListener('click',function(){tab.click();menu.hidden=true;body.dataset.webRemoteRightOpen='true';title.setAttribute('aria-expanded','false')});row.appendChild(choose);var close=tab.parentElement?.querySelector('button[aria-label*="关闭"]');if(close){var closeButton=document.createElement('button');closeButton.type='button';closeButton.setAttribute('aria-label','关闭 '+choose.textContent);closeButton.textContent='×';closeButton.style.width='44px';closeButton.addEventListener('click',function(event){event.stopPropagation();close.click();});row.appendChild(closeButton)}menu.appendChild(row)});}}
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
  try { ensure(); new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true}); new MutationObserver(syncRightPanel).observe(body,{attributes:true,attributeFilter:['data-web-remote-right-open']}); } catch(error) { window.__PROMA_WEB_REMOTE_PATCH_ERROR=String(error); console.error('[Web Remote mobile patch] 初始化失败',error); }
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
