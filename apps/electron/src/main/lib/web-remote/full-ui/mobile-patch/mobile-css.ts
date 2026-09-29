export const MOBILE_CSS = String.raw`@media (max-width: 767px) {
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
  [data-web-remote-panel="right"] [role="tablist"][aria-label="右侧工作区"], [data-web-remote-panel="right"] [data-web-remote-mobile-hide="true"], [data-web-remote-simulator-tab="true"], [data-web-remote-simulator-entry="true"] { display:none!important; }
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
  [data-web-remote-panel="right"] [data-web-remote-memory-detail][data-selected="true"] { display:flex!important; flex-direction:column!important; height:100%; min-height:0!important; overflow:hidden; }
  [data-web-remote-panel="right"] [data-web-remote-split="memory"] { min-height:0!important; height:100%; }
  [data-web-remote-panel="right"] [data-web-remote-memory-detail][data-selected="true"] > :last-child { flex:1 1 auto; min-height:0!important; overflow-y:auto!important; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
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
@media (max-width: 767px) { [data-shortcut-keycaps], .session-quick-switch-keycap, kbd { display:none!important; } }
@media (max-width: 767px) { [data-web-remote-panel="right"] [data-web-remote-memory-path] { direction:rtl; text-align:left; } [data-web-remote-panel="right"] [data-web-remote-memory-path]::before { content:"\\200E"; } }
[data-web-remote-toast] { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 96px); z-index:10010; max-width:calc(100vw - 32px); padding:10px 14px; border-radius:12px; background:hsl(var(--foreground)/.9); color:hsl(var(--background)); font-size:14px; line-height:1.4; opacity:0; pointer-events:none; transform:translate(-50%,8px); transition:opacity .18s ease,transform .18s ease; }
[data-web-remote-toast][data-visible="true"] { opacity:1; transform:translate(-50%,0); }
[data-web-remote-notification-entry][data-notify-state="on"] { color:hsl(142 71% 36%); }
@media (prefers-reduced-motion: reduce) { [data-web-remote-sidebar="left"], [data-web-remote-mobile-overlay], [data-web-remote-panel="right"], [data-web-remote-mobile-topbar] button, [data-web-remote-sidebar="left"] button, [data-web-remote-panel="right"] button { transition:none!important; } }
@media (min-width: 768px) { [data-web-remote-mobile-menu], [data-web-remote-mobile-overlay], [data-web-remote-panel-toggle], [data-web-remote-refresh] { display:none!important; } }@media (max-width: 767px) { [data-web-remote-history-bar] { position:fixed; z-index:2147483000; left:50%; transform:translateX(-50%); display:flex; gap:6px; align-items:center; max-width:calc(100vw - 32px); pointer-events:none; } [data-web-remote-history-bar][hidden] { display:none!important; } [data-web-remote-history-bar] button { pointer-events:auto; white-space:nowrap; height:28px; padding:0 11px; border:1px solid hsl(var(--border)); border-radius:999px; background:hsl(var(--background)/.94); color:hsl(var(--muted-foreground)); font-size:12px; line-height:26px; box-shadow:0 1px 4px rgba(0,0,0,.08); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); } [data-web-remote-history-bar] button[hidden] { display:none!important; } [data-web-remote-history-bar] [data-web-remote-data-saver][aria-pressed="true"] { color:hsl(var(--primary)); border-color:hsl(var(--primary)/.5); } }
`
