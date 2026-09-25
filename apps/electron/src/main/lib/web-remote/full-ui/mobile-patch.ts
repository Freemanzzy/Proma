export function renderWebRemoteMobilePatch(): string {
  return `<style id="proma-web-remote-mobile-style">
@media (max-width: 767px) {
  html, body, #root { width:100%; min-width:0; max-width:100%; overflow-x:hidden; }
  body { overscroll-behavior-x:none; }
  [data-web-remote-app-content="true"] { position:relative; width:100vw!important; max-width:100vw; }
  [data-web-remote-sidebar="left"] { position:fixed!important; inset:0 auto 0 0; z-index:10001!important; width:min(86vw,340px)!important; max-width:340px; transform:translateX(-105%); transition:transform .18s ease; box-shadow:12px 0 32px rgba(0,0,0,.25); }
  [data-web-remote-sidebar="left"] > * { width:100%!important; max-width:none!important; }
  [data-web-remote-sidebar-divider="true"] { display:none!important; }
  body[data-web-remote-sidebar-open="true"] [data-web-remote-sidebar="left"] { transform:translateX(0); }
  [data-web-remote-main="true"] { width:100%!important; min-width:0!important; max-width:100vw; }
  [data-web-remote-panel="right"] { position:fixed!important; inset:0; z-index:10002!important; display:none!important; width:100vw!important; max-width:none!important; background:hsl(var(--background)); }
  body[data-web-remote-right-open="true"] [data-web-remote-panel="right"] { display:flex!important; }
  [data-web-remote-panel="right"] > * { width:100%!important; max-width:none!important; min-width:0!important; }
  [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay] { display:block; }
  [data-web-remote-mobile-menu] { position:fixed; top:max(8px, env(safe-area-inset-top)); left:max(8px, env(safe-area-inset-left)); z-index:10003; width:42px; height:42px; padding:0; border:1px solid hsl(var(--border)); border-radius:12px; background:hsl(var(--background)/.92); color:hsl(var(--foreground)); box-shadow:0 3px 12px rgba(0,0,0,.16); font-size:22px; line-height:1; }
  [data-web-remote-mobile-overlay] { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.38); }
  body:not([data-web-remote-sidebar-open="true"]) [data-web-remote-mobile-overlay] { display:none; }
  [data-web-remote-main="true"] input, [data-web-remote-main="true"] textarea, [data-web-remote-main="true"] [contenteditable="true"] { font-size:16px!important; }
  [data-web-remote-main="true"] [contenteditable="true"] { max-width:100%; overflow-x:hidden; }
  [data-web-remote-main="true"] kbd, [data-web-remote-main="true"] [data-shortcut], [data-web-remote-main="true"] [class*="shortcut"] { display:none!important; }
  img[alt="用户头像"] { display:none!important; }
}
@media (min-width: 768px) { [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay] { display:none!important; } }
</style>
<script nonce="__PROMA_NONCE__">
(function(){
  if (window.__PROMA_WEB_REMOTE__ !== true || window.innerWidth >= 768) return;
  var body=document.body;
  function ensure(){
    if (!document.querySelector('[data-web-remote-mobile-menu]')) {
      var menu=document.createElement('button'); menu.type='button'; menu.textContent='☰'; menu.setAttribute('aria-label','打开侧栏'); menu.dataset.webRemoteMobileMenu='true';
      menu.addEventListener('click',function(){body.dataset.webRemoteSidebarOpen='true'}); document.body.appendChild(menu);
    }
    if (!document.querySelector('[data-web-remote-mobile-overlay]')) {
      var overlay=document.createElement('div'); overlay.dataset.webRemoteMobileOverlay='true'; overlay.addEventListener('click',function(){delete body.dataset.webRemoteSidebarOpen; delete body.dataset.webRemoteRightOpen}); document.body.appendChild(overlay);
    }
    document.querySelectorAll('img[alt="用户头像"]').forEach(function(img){img.addEventListener('error',function(){img.style.display='none'},{once:true});});
  }
  document.addEventListener('click',function(event){
    var target=event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-web-remote-sidebar="left"]')) { delete body.dataset.webRemoteSidebarOpen; }
    if (target.closest('button[aria-label="打开文件面板"]')) { body.dataset.webRemoteRightOpen='true'; }
    if (target.closest('button[aria-label="折叠右侧工作区"]')) { delete body.dataset.webRemoteRightOpen; }
  }, true);
  ensure(); new MutationObserver(ensure).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`
}
