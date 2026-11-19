// Lifecycle: living. Arctic-only metadata browsing; no forecasting or status rules.
// A flat, variable-height index virtualises BOTH headers and products. Only the
// viewport + 216px overscan is mounted. The active header is a sticky duplicate,
// pushed away by the next header; search/controls live outside the scrollport.
const gmBrowse={dataset:null,key:null,group:'status',status:'all',sections:[],entries:[],height:0,collapsed:new Set(),source:null,search:new WeakMap(),health:new Set(),options:[],frame:0}
const gmBrowseList=$('sku-list'),gmBrowseControls=node('div',null,'browse-controls'),gmGroupControl=node('div',null,'group-control'),gmStatusControl=node('div',null,'status-control')
gmGroupControl.setAttribute('role','group');gmGroupControl.setAttribute('aria-label','Group by')
gmStatusControl.setAttribute('role','group');gmStatusControl.setAttribute('aria-label','Filter by status')
gmBrowseControls.append(gmGroupControl,gmStatusControl);gmBrowseList.before(gmBrowseControls)
const gmFilterFooter=node('div',null,'browse-result');gmFilterFooter.setAttribute('role','status');gmBrowseList.after(gmFilterFooter)
const gmCanvas=node('div',null,'browse-canvas'),gmSticky=node('div',null,'browse-sticky')
gmBrowseList.replaceChildren(gmSticky,gmCanvas);gmBrowseList.setAttribute('aria-label','Products');gmBrowseList.tabIndex=0
$('search').placeholder='Search name, SKU, product type or supplier';$('search').setAttribute('aria-label',$('search').placeholder)
$('search').maxLength=512
$('prev-sku').title='Previous product · K / ↑';$('next-sku').title='Next product · J / ↓'
gmBKeys.textContent='Keyboard: J / K or ↑ / ↓ products · ← / → collapse / expand section · G group by · 1 All, 2 Order now, 3 OK, 4 Soon, 5 Needs data · / search · Esc clear filters.'
const gmMeta=value=>typeof value==='string'?value.trim():''
const gmStatusOptions=[['all','All'],['order',STRINGS.order_now],['ok',STRINGS.oK],['running-low',STRINGS.soon],['needs-data',STRINGS.needs_data]]
function gmBrowseHash(){
  const params=new URLSearchParams();if(selectedSku)params.set('sku',selectedSku)
  params.set('group',gmBrowse.group);params.set('status',gmBrowse.status)
  if($('search').value)params.set('q',$('search').value.slice(0,512))
  if(gmBrowse.collapsed.size)params.set('closed',JSON.stringify([...gmBrowse.collapsed]))
  const hash='#'+params.toString();if(location.hash!==hash)history.replaceState(null,'',hash)
}
function gmReadBrowseHash(hash){
  const params=new URLSearchParams(hash.slice(1))
  gmBrowse.group=['status','category','supplier'].includes(params.get('group'))?params.get('group'):'status'
  gmBrowse.status=gmStatusOptions.some(([key])=>key===params.get('status'))?params.get('status'):'all'
  $('search').value=(params.get('q')||'').slice(0,512)
  if(params.has('closed'))try{const closed=JSON.parse((params.get('closed')||'[]').slice(0,65536));gmBrowse.collapsed=new Set(Array.isArray(closed)?closed.filter(x=>typeof x==='string').slice(0,20000):[])}catch{gmBrowse.collapsed.clear()}
}
function gmClearBrowse(){gmBrowse.status='all';$('search').value='';buildList()}
function gmBrowseButton(text,pressed,action){const b=node('button',text);b.type='button';b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',action);return b}
function gmBrowseIndex(){
  gmBrowse.entries=[];let y=0
  for(const section of gmBrowse.sections){
    section.top=y;gmBrowse.entries.push({section,y,header:true});y+=72
    if(!gmBrowse.collapsed.has(section.id))for(const row of section.rows){gmBrowse.entries.push({section,row,y,header:false});y+=72}
  }
  gmBrowse.height=y;gmCanvas.style.height=y+'px'
}
function gmSectionHeading(section,sticky=false){
  const h=node('div',null,'group-title browse-heading');h.dataset.section=section.id;if(sticky)h.dataset.sticky='true'
  const title=node('button',`${gmBrowse.collapsed.has(section.id)?'›':'⌄'} ${section.label} · ${section.rows.length.toLocaleString('en-US')}`,'group-label')
  title.type='button';title.title=section.label;title.dataset.collapse=section.id;title.setAttribute('aria-expanded',String(!gmBrowse.collapsed.has(section.id)))
  title.setAttribute('aria-label',`${section.label}, ${section.rows.length} products`)
  h.append(title)
  if(section.units.size)h.append(node('span',[...section.units].map(([unit,qty])=>`${orderAmount(qty)} ${unit}`).join(' · ')+' to order','group-quantity'))
  if(gmBrowse.group==='supplier'&&!section.missing){
    const copy=node('button','Copy order','supplier-copy');copy.type='button';copy.dataset.copySupplier=section.id;copy.disabled=!section.orderRows.some(r=>r.guidance.quantity>0);copy.setAttribute('aria-label','Copy order for '+section.label);h.append(copy)
  }
  return h
}
function gmProductButton(row){
  const b=node('button',null,'sku-button');b.type='button';b.dataset.sku=row.item.sku;b.dataset.bucket=row.bucket
  b.setAttribute('aria-pressed',String(row.item.sku===selectedSku));b.setAttribute('aria-label',`${row.item.name}, ${bucketNames[row.bucket]}, ${row.guidance.quantity==null?STRINGS.unknown_9:orderAmount(row.guidance.quantity)+' '+row.item.unit}`)
  const name=node('span');name.title=row.item.name;name.append(node('span',row.item.name,'sku-name'),node('span',row.item.sku,'sku-code'))
  if(gmBrowse.health.has(row.item.sku)){const dot=node('i',null,'health-dot');dot.setAttribute('aria-hidden','true');name.querySelector('.sku-code').append(dot)}
  const quantity=['healthy','overstocked','no-sales'].includes(row.bucket)?'No order needed':row.guidance.status==='needs-data'?STRINGS.copy_7:`${orderAmount(row.guidance.quantity)} ${row.item.unit}`
  b.append(node('i',null,'dot'),name,node('span',quantity,'sku-qty'));buttonMap.set(row.item.sku,b)
  if(row.item.sku===selectedSku)activeButton=b
  return b
}
function gmVirtualStart(y){
  const entries=gmBrowse.entries;let lo=0,hi=entries.length
  while(lo<hi){const mid=(lo+hi)>>>1;if(entries[mid].y+72<y)lo=mid+1;else hi=mid}
  return lo
}
function gmRenderVirtual(){
  const top=gmBrowseList.scrollTop,height=gmBrowseList.clientHeight||320,fragment=document.createDocumentFragment()
  buttonMap=new Map();activeButton=null
  for(let i=gmVirtualStart(Math.max(0,top-216));i<gmBrowse.entries.length;i++){
    const entry=gmBrowse.entries[i];if(entry.y>top+height+216)break
    const el=entry.header?gmSectionHeading(entry.section):gmProductButton(entry.row)
    el.style.position='absolute';el.style.top=entry.y+'px';fragment.append(el)
  }
  if(!filteredRows.length)fragment.append(node('p',STRINGS.no_matches,'empty-list'))
  gmCanvas.replaceChildren(fragment)
  let section=null,next=null
  for(const s of gmBrowse.sections){if(s.top<=top)section=s;else{next=s;break}}
  gmSticky.replaceChildren();gmSticky.hidden=!section||section.top>=top
  if(!gmSticky.hidden){gmSticky.append(gmSectionHeading(section,true));gmSticky.style.transform=`translateY(${next?Math.min(0,next.top-top-72):0}px)`}
}
function gmRevealSku(sku){
  const section=gmBrowse.sections.find(s=>s.rows.some(r=>r.item.sku===sku));if(!section)return
  if(gmBrowse.collapsed.delete(section.id))gmBrowseIndex()
  const entry=gmBrowse.entries.find(e=>e.row?.item.sku===sku);if(!entry)return
  const top=gmBrowseList.scrollTop,height=gmBrowseList.clientHeight||320
  if(entry.y<top+72)gmBrowseList.scrollTop=Math.max(0,entry.y-72)
  else if(entry.y+72>top+height)gmBrowseList.scrollTop=entry.y+72-height
  gmRenderVirtual()
}
const gmBrowseSelect=selectItem
selectItem=function(row,{hash=true,reveal=false}={}){
  if(!row)return
  gmBrowseSelect(row,{hash:false,reveal:false})
  if(reveal)gmRevealSku(row.item.sku)
  if(hash)gmBrowseHash()
}
const gmBrowsePanel=chartPanel
chartPanel=function(row){
  const panel=gmBrowsePanel(row),parts=[]
  if(gmMeta(row.item.category))parts.push(gmMeta(row.item.category))
  if(gmMeta(row.item.supplier))parts.push('Supplier: '+gmMeta(row.item.supplier))
  if(parts.length)panel.querySelector('.product-heading h1').after(node('p',parts.join(' · '),'product-meta'))
  return panel
}
buildList=function(){
  const started=performance.now(),query=$('search').value.trim().toLocaleLowerCase()
  if(gmBrowse.source!==currentRows){
    gmBrowse.source=currentRows;gmBrowse.search=new WeakMap()
    if(gmBrowse.dataset!==data){gmBrowse.dataset=data;gmBrowse.key='stock-runway.browse.v1:'+gmSettingsKey(data);try{const saved=JSON.parse(localStorage.getItem(gmBrowse.key)||'{}');gmBrowse.collapsed=new Set(Array.isArray(saved.closed)?saved.closed.filter(x=>typeof x==='string').slice(0,20006):[])}catch{gmBrowse.collapsed.clear()}}
    gmBrowse.health=new Set(healthWarnings.map(w=>w.sku))
    gmBrowse.options=[['status','Status'],...['category','supplier'].filter(key=>currentRows.some(r=>gmMeta(r.item[key]))).map(key=>[key,key==='category'?'Product type':'Supplier'])]
  }
  if(!gmBrowse.options.some(([key])=>key===gmBrowse.group))gmBrowse.group='status'
  const matches=currentRows.filter(row=>{
    if(!gmBrowse.search.has(row.item))gmBrowse.search.set(row.item,[row.item.name,row.item.sku,gmMeta(row.item.category),gmMeta(row.item.supplier)].join(' ').toLocaleLowerCase())
    return gmBrowse.search.get(row.item).includes(query)
  }),counts=new Map(gmStatusOptions.map(([key])=>[key,0]))
  for(const row of matches)counts.set(groupFor(row),counts.get(groupFor(row))+1)
  counts.set('all',matches.length)
  gmGroupControl.hidden=gmBrowse.options.length===1;gmGroupControl.replaceChildren(node('span','Group by','browse-label'),...gmBrowse.options.map(([key,label])=>gmBrowseButton(label,key===gmBrowse.group,()=>{gmBrowse.group=key;buildList()})))
  gmStatusControl.replaceChildren(...gmStatusOptions.filter(([key])=>!['running-low','needs-data'].includes(key)||counts.get(key)>0||gmBrowse.status===key).map(([key,label])=>{
    const b=gmBrowseButton(`${label} · ${counts.get(key).toLocaleString('en-US')}`,key===gmBrowse.status,()=>{gmBrowse.status=key;buildList()});b.dataset.status=key;return b
  }))
  const sections=new Map()
  for(const row of matches){
    const status=groupFor(row);if(gmBrowse.status!=='all'&&gmBrowse.status!==status)continue
    const value=gmBrowse.group==='status'?status:gmMeta(row.item[gmBrowse.group]),missing=!value
    const label=gmBrowse.group==='status'?browseGroups.find(([key])=>key===value)[1]:value||(gmBrowse.group==='category'?'No product type':'Supplier not assigned')
    // Prefix avoids collisions with a real supplier literally named the missing label.
    const id=gmBrowse.group+':'+(missing?'missing:':'value:'+value)
    if(!sections.has(id))sections.set(id,{id,label,missing,rows:[],orderRows:[],units:new Map()})
    const section=sections.get(id);section.rows.push(row)
    if(status==='order'){
      section.orderRows.push(row)
      if(row.guidance.quantity>0)section.units.set(row.item.unit,(section.units.get(row.item.unit)||0)+row.guidance.quantity)
    }
  }
  for(const section of sections.values())section.rows.sort((a,b)=>Number(groupFor(b)==='order')-Number(groupFor(a)==='order')||a.item.name.localeCompare(b.item.name)||a.item.sku.localeCompare(b.item.sku))
  gmBrowse.sections=[...sections.values()].sort((a,b)=>gmBrowse.group==='status'?['order','running-low','needs-data','ok'].indexOf(a.id.split(':').at(-1))-['order','running-low','needs-data','ok'].indexOf(b.id.split(':').at(-1)):Number(a.missing)-Number(b.missing)||Number(!!b.orderRows.length)-Number(!!a.orderRows.length)||a.label.localeCompare(b.label))
  filteredRows=gmBrowse.sections.flatMap(s=>s.rows);gmBrowseIndex();gmBrowseList.scrollTop=0;gmRenderVirtual()
  gmFilterFooter.replaceChildren();gmFilterFooter.hidden=!query&&gmBrowse.status==='all'
  if(!gmFilterFooter.hidden){
    gmFilterFooter.append(node('span',`Showing ${filteredRows.length.toLocaleString('en-US')} of ${currentRows.length.toLocaleString('en-US')} · `))
    const clear=node('button','Clear');clear.type='button';clear.addEventListener('click',gmClearBrowse);gmFilterFooter.append(clear)
  }
  if(filteredRows.length&&!filteredRows.some(r=>r.item.sku===selectedSku))selectItem(filteredRows[0])
  else updateNavigation()
  gmBrowseHash();document.body.dataset.filterMs=String(performance.now()-started)
}
function gmCollapseSection(section,collapse){
  if(collapse)gmBrowse.collapsed.add(section.id);else gmBrowse.collapsed.delete(section.id)
  const focused=document.activeElement?.dataset.collapse
  try{localStorage.setItem(gmBrowse.key,JSON.stringify({closed:[...gmBrowse.collapsed]}))}catch{}
  gmBrowseIndex();gmRenderVirtual();gmBrowseHash()
  if(focused)gmBrowseList.querySelector(`[data-collapse="${CSS.escape(focused)}"]`)?.focus()
}
async function gmCopySupplier(section){
  // Exactly the same formatter as the global Copy order. Only membership changes.
  const text=purchaseOrderText(section.orderRows,currentToday)
  try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(text);$('copy-status').textContent='Copied order for '+section.label}
  catch{$('copy-fallback').hidden=false;$('po-text').value=text;$('tools').open=true;$('po-text').focus();$('po-text').select();$('copy-status').textContent='Copy the selected order for '+section.label}
}
gmBrowseList.addEventListener('click',e=>{
  const collapse=e.target.closest('[data-collapse]'),copy=e.target.closest('[data-copy-supplier]')
  const section=gmBrowse.sections.find(s=>s.id===(collapse?.dataset.collapse||copy?.dataset.copySupplier));if(!section)return
  if(collapse){const state=!gmBrowse.collapsed.has(section.id);gmCollapseSection(section,state);gmBrowseList.querySelector(`[data-collapse="${CSS.escape(section.id)}"]`)?.focus()}
  if(copy)gmCopySupplier(section)
})
gmBrowseList.addEventListener('scroll',()=>{if(gmBrowse.frame)return;gmBrowse.frame=requestAnimationFrame(()=>{gmBrowse.frame=0;gmRenderVirtual()})},{passive:true})
new ResizeObserver(()=>gmRenderVirtual()).observe(gmBrowseList)
// Capture only our keys, leaving dialogs, chart gestures, settings and text entry alone.
document.addEventListener('keydown',e=>{
  if(document.body.classList.contains('table-mode'))return
  if(document.querySelector('dialog[open]')||e.altKey||e.ctrlKey||e.metaKey)return
  if(e.key==='Escape'&&document.querySelector('.chart-tooltip:not([hidden])'))return
  if(e.key==='Escape'&&(e.target===$('search')||!e.target.closest('input,textarea,select,[contenteditable=true],#tools'))){e.preventDefault();e.stopImmediatePropagation();gmClearBrowse();$('search').blur();return}
  if(e.target.closest('input,textarea,select,[contenteditable=true],#tools'))return
  const keys=['j','k','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','g','G','1','2','3','4','5','/'];if(!keys.includes(e.key))return
  e.preventDefault();e.stopImmediatePropagation()
  if(e.key==='/'){$('sidebar').dataset.open='true';$('browse-toggle').setAttribute('aria-expanded','true');$('search').focus();return}
  if(['j','k','ArrowDown','ArrowUp'].includes(e.key)){navigateSku(['j','ArrowDown'].includes(e.key)?1:-1);return}
  if(['ArrowLeft','ArrowRight'].includes(e.key)){
    const focused=e.target.closest('[data-collapse]'),section=gmBrowse.sections.find(s=>focused?s.id===focused.dataset.collapse:s.rows.some(r=>r.item.sku===selectedSku))
    if(section)gmCollapseSection(section,e.key==='ArrowLeft');return
  }
  if(e.key.toLowerCase()==='g'){gmBrowse.group=gmBrowse.options[(gmBrowse.options.findIndex(([key])=>key===gmBrowse.group)+1)%gmBrowse.options.length][0];buildList();return}
  gmBrowse.status=gmStatusOptions[Number(e.key)-1][0];buildList()
},true)
window.addEventListener('hashchange',e=>{
  if(document.body.classList.contains('table-mode'))return
  e.stopImmediatePropagation();gmReadBrowseHash(location.hash)
  const sku=hashSku();if(rowMap.has(sku))selectedSku=sku
  buildList();const row=filteredRows.find(r=>r.item.sku===selectedSku);if(row)selectItem(row,{hash:false,reveal:!gmBrowse.sections.some(s=>gmBrowse.collapsed.has(s.id)&&s.rows.includes(row))})
},true)
buildList() // Initialise dataset caches before restoring collapsed URL sections.
gmReadBrowseHash(gmBInitialHash)
const gmInitialSku=new URLSearchParams(gmBInitialHash.slice(1)).get('sku')
if(rowMap.has(gmInitialSku))selectedSku=gmInitialSku
buildList();selectItem(rowMap.get(selectedSku),{reveal:!gmBrowse.collapsed.size})
