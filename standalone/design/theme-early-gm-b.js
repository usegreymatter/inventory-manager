// Runs synchronously in <head>, before styles and before the app module.
(()=>{
 const key='stock-runway.theme',root=document.documentElement;
 let choice='system';
 try{const saved=localStorage.getItem(key);if(['system','light','dark'].includes(saved))choice=saved}catch{}
 const media=matchMedia('(prefers-color-scheme: dark)');
 function apply(){
  const theme=choice==='system'?(media.matches?'dark':'light'):choice;
  root.dataset.theme=theme;root.dataset.themePreference=choice;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0f1113':'#f5f8fd');
  const select=document.getElementById('theme-choice');if(select)select.value=choice;
 }
 window.stockRunwayTheme={get:()=>choice,set(value){if(!['system','light','dark'].includes(value))return;choice=value;try{localStorage.setItem(key,value)}catch{}apply()}};
 media.addEventListener('change',()=>{if(choice==='system')apply()});
 window.addEventListener('storage',e=>{if(e.key!==key&&e.key!==null)return;choice=['light','dark'].includes(e.newValue)?e.newValue:'system';apply()});
 apply();
})();
