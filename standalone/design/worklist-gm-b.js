// Lifecycle: living. Arctic worklist adapter. Forecast/guidance remain read-only.
// One indexed snapshot, one filtered order, and viewport-only row DOM.
// Keep the warning count's meaning visible; retain the shared warning computation.
const wlBaseHealth=updateHealth
updateHealth=function(){wlBaseHealth();const label=healthWarnings.length.toLocaleString('en-US')+' data warnings';$('health-chip').textContent=label;$('health-chip').setAttribute('aria-label',label)}
updateHealth()
const wl={status:'all',suppliers:[],categories:[],custom:false,metric:'',sort:'urgency',dir:1,columns:[],selected:new Set(),focus:0,drawer:false,group:'status',collapsed:new Set(),source:null,dataset:null,cache:new WeakMap(),views:[],entries:[],height:44,frame:0}
const wlColumns=[['product','Product',240],['status','Status',124],['hand','On hand',96],['incoming','On order',96],['monthly','Monthly sales',140],['days','Days left',132],['qty','Order qty',96],['value','Order value',124],['lasts','Order lasts',112],['pattern','Sales pattern',120],['excess','Excess value',124],['last','Last sold',112],['due','Order by',104],['runout','Runs out',104],['supplier','Supplier',160],['category','Product type',160],['lead','Lead time',96],['stockouts','Stock-outs',104],['risk','Run-out risk',124]]
wl.columns=wlColumns.map(c=>c[0])
const WL_DETAILED_COLUMNS=wl.columns.slice()
const wlRoot=node('section',null,'worklist');wlRoot.id='worklist';wlRoot.setAttribute('aria-label','Replenishment worklist')
const wlSummary=node('div',null,'work-summary'),wlViews=node('div',null,'work-views'),wlTabs=node('div',null,'work-tabs'),wlSaved=node('div',null,'work-saved'),wlFilters=node('div',null,'work-filters'),wlActive=node('div',null,'work-active'),wlBulk=node('div',null,'work-bulk'),wlScroll=node('div',null,'work-scroll'),wlHead=node('div',null,'work-head'),wlCanvas=node('div',null,'work-canvas'),wlFoot=node('div',null,'work-footer')
wlSummary.id='work-summary';wlTabs.setAttribute('role','group');wlTabs.setAttribute('aria-label','Product views');wlScroll.id='work-scroll';wlScroll.tabIndex=0;wlScroll.setAttribute('role','table');wlScroll.setAttribute('aria-label','Products');wlHead.setAttribute('role','row');wlCanvas.setAttribute('role','rowgroup');wlScroll.append(wlHead,wlCanvas);wlViews.append(wlTabs,wlSaved);wlRoot.append(wlSummary,wlViews,wlActive,wlBulk,wlScroll,wlFoot);document.querySelector('.layout').prepend(wlRoot)
const wlSearch=document.querySelector('label.search');wlSaved.append(wlSearch);$('search').placeholder='Search products';$('search').setAttribute('aria-label','Search products, SKU, supplier or product type');wlSearch.querySelector('span').textContent='';wlSearch.querySelector('span').className='work-search-icon'
const wlLeadNote=node('p',null,'work-lead-note');wlLeadNote.hidden=true;wlBulk.after(wlLeadNote)
// One header menu owns occasional actions and diagnostics.
document.querySelector('.tools-body').append($('health-chip'));$('tools').querySelector('summary').textContent='Import / settings';$('tools').querySelector('summary').setAttribute('aria-label','Import / settings — Main menu')
wlFoot.setAttribute('aria-live','polite');wlFoot.append(node('span',null,'work-result'),document.querySelector('.gm-by'));document.body.classList.add('table-mode')
const wlStatus=[['order','Order now'],['running-low','Soon'],['healthy','OK'],['all','All'],['overstocked','Overstock'],['no-sales','No sales'],['needs-data','Needs data']]
const wlRank={order:0,'running-low':1,'needs-data':2,healthy:3,overstocked:4,'no-sales':5}
const wlBtn=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b}
const wlClose=wlBtn('Close',()=>wlCloseDrawer(),'drawer-close');wlClose.id='close-detail';document.querySelector('.selection-nav>div').append(wlClose);$('main').setAttribute('aria-label','Product detail');$('main').setAttribute('role','region');$('main').hidden=true
const WL_SIMPLE_COLUMNS=['product','status','hand','qty','due','risk']
const WL_NUMERIC=['hand','incoming','monthly','days','qty','value','lasts','excess','lead','stockouts']
function wlNormalize(columns){return ['product',...new Set((Array.isArray(columns)?columns:[]).filter(k=>k!=='product'&&wlColumns.some(c=>c[0]===k)))]}
// Shown columns = chosen columns minus ones that add nothing right now:
// Status inside a single-status tab (the tab already says it) and money columns when no product has a cost.
function wlAnyCost(){if(wl.costSource!==currentRows){wl.costSource=currentRows;wl.anyCost=currentRows.some(r=>wlMeta(r)?.hasCost)}return wl.anyCost}
// Stock-outs also hides when no product has a flagged month (same 'adds nothing' rule as costs).
function wlAnyStockout(){if(wl.stockoutSource!==currentRows){wl.stockoutSource=currentRows;wl.anyStockout=currentRows.some(r=>wlValue(r,'stockouts')>0)}return wl.anyStockout}
function wlVisible(){const anyCost=wlAnyCost(),anyStockout=wl.columns.includes('stockouts')&&wlAnyStockout();return wl.columns.map(k=>wlColumns.find(c=>c[0]===k)).filter(c=>c&&!(c[0]==='status'&&wl.status!=='all'&&wl.mode!=='simple')&&!(['value','excess'].includes(c[0])&&!anyCost)&&!(c[0]==='stockouts'&&!anyStockout))}
function wlLegacyMode(columns,simple=false){if(simple)return 'simple';const keys=wlNormalize(columns);if(['product,status,hand,incoming,qty,due,runout','product,status,hand,incoming,monthly,qty,value,due,runout'].includes(keys.join(',')))return 'simple';return keys.join(',')===WL_SIMPLE_COLUMNS.join(',')||keys.join(',')===WL_SIMPLE_COLUMNS.filter(k=>!['monthly','value'].includes(k)).join(',')?'simple':wlColumns.every(c=>keys.includes(c[0])||['monthly','value','lasts','pattern','excess','last','stockouts','risk'].includes(c[0]))?'detailed':'custom'}
function wlMode(mode){wl.mode=['simple','detailed','custom'].includes(mode)?mode:'detailed';wl.simple=wl.mode==='simple';document.body.dataset.tableDetail=wl.mode}
function wlMoney(n){if(!Number.isFinite(n))return '—';const label=typeof settings.currency==='string'?settings.currency:'';return (label?label+' ':'')+n.toLocaleString('en-US',{maximumFractionDigits:0})}
// Display-only decision metadata. No forecast or order outputs are mutated.
function wlDecision(i,g){
 const resolved=resolveOrderSettings(i,settings),asof=data.as_of,history=(data.months||[]).map((month,n)=>({month,value:i.monthly_sales?.[n]})).filter(x=>Number.isFinite(x.value)&&monthEndOrdinal(x.month)!==null&&monthEndOrdinal(x.month)<=dateOrdinal(asof)),recent=history.slice(-6),annual=history.slice(-12),monthly=recent.length?recent.reduce((n,x)=>n+x.value,0)/recent.length:null,rate=Number.isFinite(g.monthly_demand)?g.monthly_demand:monthly,cost=resolved.values.unit_cost,hasCost=Number.isFinite(cost)&&cost>=0,mean=annual.length?annual.reduce((n,x)=>n+x.value,0)/annual.length:0,cv=mean>0?Math.sqrt(annual.reduce((n,x)=>n+(x.value-mean)**2,0)/annual.length)/mean:null,last=history.filter(x=>x.value>0).at(-1)?.month||null
 const window=Number.isFinite(g.lead_days)?(g.lead_days+Math.ceil(resolved.settings.months_of_cover*30))/30:null,excess=hasCost&&Number.isFinite(i.on_hand)&&Number.isFinite(i.on_order)&&Number.isFinite(g.safety_stock)&&rate!==null&&window!==null?Math.max(0,i.on_hand+i.on_order-(g.safety_stock+rate*window))*cost:null
 return {monthly,value:hasCost&&Number.isFinite(g.quantity)?g.quantity*cost:null,lasts:rate>0&&Number.isFinite(g.quantity)?g.quantity/rate:null,pattern:annual.length<4||cv===null?null:cv<.5?'Steady':cv<1?'Variable':'Erratic',excess:excess>0?excess:null,last,hasCost,custom:resolved.custom}
}
function wlDecisionText(r,key){const m=wlMeta(r),v=m[key];return key==='monthly'?(v===null?'—':v.toLocaleString('en-US',{maximumFractionDigits:1})+' '+r.item.unit):['value','excess'].includes(key)?wlMoney(v):key==='lasts'?(v===null?'—':'~'+v.toFixed(1)+' mo'):key==='last'?(v?new Date(v+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}):'Never'):v??'—'}
function wlReadStorage(){try{const saved=JSON.parse(localStorage.getItem(wl.key));if(!saved||typeof saved!=='object'||Array.isArray(saved))return {};const safe={group:saved.group,simple:saved.simple===true,mode:saved.mode};for(const key of ['columns','customColumns','detailColumns','customOrder','collapsed'])if(Array.isArray(saved[key]))safe[key]=saved[key];if(Array.isArray(saved.views))safe.views=saved.views.filter(v=>v&&typeof v==='object'&&typeof v.name==='string'&&v.state&&typeof v.state==='object'&&!Array.isArray(v.state));return safe}catch{return {}}}
function wlStore(){try{localStorage.setItem(wl.key,JSON.stringify({columns:wl.columns,views:wl.views,group:wl.group,simple:wl.simple,mode:wl.mode,customColumns:wl.customColumns,customOrder:wl.customOrder,collapsed:[...wl.collapsed]}))}catch{wlMessage('Views could not be saved. Changes still work in this tab.')}}
function wlMessage(text){wlFoot.querySelector('.work-result').textContent=text}
function wlSnapshot(){return {status:wl.status,suppliers:[...wl.suppliers],categories:[...wl.categories],custom:wl.custom,metric:wl.metric,q:$('search').value,sort:wl.sort,dir:wl.dir,columns:[...wl.columns],mode:wl.mode,customColumns:wl.customColumns,customOrder:wl.customOrder,group:wl.group||'status'}}
function wlApply(s){
 wl.status=wlStatus.some(c=>c[0]===s.status)?s.status:'all';wl.suppliers=Array.isArray(s.suppliers)?s.suppliers.filter(x=>typeof x==='string').slice(0,20000):[];wl.categories=Array.isArray(s.categories)?s.categories.filter(x=>typeof x==='string').slice(0,20000):[];wl.custom=s.custom===true;wl.metric=['units','suppliers','runout'].includes(s.metric)?s.metric:'';wl.sort=['urgency',...wlColumns.map(c=>c[0])].includes(s.sort)?s.sort:'urgency';wl.dir=s.dir===-1?-1:1;wl.group=['status','supplier','category','none'].includes(s.group)?s.group:'status';$('search').value=String(s.q||'').slice(0,512)
 if(Array.isArray(s.columns)){wl.columns=wlNormalize(s.columns);wlMode(s.mode||wlLegacyMode(s.columns,s.simple));if(wl.mode==='detailed')wl.columns=WL_DETAILED_COLUMNS.slice();if(wl.mode==='simple')wl.columns=WL_SIMPLE_COLUMNS.slice();if(Array.isArray(s.customColumns))wl.customColumns=wlNormalize(s.customColumns);if(Array.isArray(s.customOrder))wl.customOrder=wlNormalize([...s.customOrder,...wlColumns.map(c=>c[0])])}
}
function wlHash(){if(document.querySelector('.product-page')||new URLSearchParams(location.hash.slice(1)).has('product'))return;const p=new URLSearchParams();p.set('view',wl.status);p.set('state',JSON.stringify(wlSnapshot()));if(selectedSku)p.set('sku',selectedSku);if(wl.drawer)p.set('detail','1');const h='#'+p.toString();if(location.hash!==h)history.replaceState(null,'',h)}
function wlRestore(hash){const storedGroup=wl.group;const p=new URLSearchParams(hash.slice(1));try{wlApply(JSON.parse((p.get('state')||'{}').slice(0,65536)))}catch{wlApply({})}if(!p.has('state'))wl.group=storedGroup;if(p.has('view'))wl.status=wlStatus.some(c=>c[0]===p.get('view'))?p.get('view'):'all';if(p.has('status'))wl.status=p.get('status')==='ok'?'healthy':p.get('status');if(p.has('q'))$('search').value=p.get('q').slice(0,512);wl.drawer=p.get('detail')==='1'||(p.has('sku')&&!p.has('state'));if(rowMap.has(p.get('sku')))selectedSku=p.get('sku')}
function wlMeta(row){return wl.cache.get(row)}
function wlRefresh(){
 if(wl.source===currentRows)return
 wl.source=currentRows;wl.cache=new WeakMap();wl.facets={supplier:new Map(),category:new Map()};wl.counts=new Map(wlStatus.map(c=>[c[0],0]));let orders=0,runout=0,value=0,missingCost=0,costed=0;const units=new Map(),suppliers=new Set()
 for(const r of currentRows){
  const i=r.item,g=r.guidance,days=g.runout_date?Math.ceil((new Date(g.runout_date+A3_DATE_SUFFIX)-new Date(data.as_of+A3_DATE_SUFFIX))/86400000):null
  const m={...wlDecision(i,g),search:[i.name,i.sku,i.category||'',i.supplier||''].join(' ').toLocaleLowerCase(),supplier:gmMeta(i.supplier),category:gmMeta(i.category),days,due:g.order_by==='now'?'0000-00-00':g.order_by||'9999-12-31'};wl.cache.set(r,m)
  wl.counts.set(r.bucket,(wl.counts.get(r.bucket)||0)+1)
  for(const k of ['supplier','category'])wl.facets[k].set(m[k],(wl.facets[k].get(m[k])||0)+1)
  if(r.bucket==='order'){orders++;units.set(i.unit,(units.get(i.unit)||0)+(g.quantity||0));if(m.hasCost&&m.value!==null){value+=m.value;costed++}else missingCost++;if(m.supplier)suppliers.add(m.supplier)}
  if(days!==null&&days<=7)runout++
 }
 wl.counts.set('all',currentRows.length);wl.summary={orders,units,value,missingCost,costed,suppliers:suppliers.size,runout}
 if(wl.dataset!==data){wl.dataset=data;wl.key='stock-runway.worklist.v1:'+gmSettingsKey(data);const saved=wlReadStorage();wl.columns=wlNormalize(saved.columns||wlColumns.map(c=>c[0]));wl.customColumns=wlNormalize(saved.customColumns||saved.detailColumns||saved.columns||wlColumns.map(c=>c[0]));wl.customOrder=wlNormalize([...(saved.customOrder||wl.customColumns),...wlColumns.map(c=>c[0])]);wl.views=Array.isArray(saved.views)?saved.views.filter(v=>typeof v.name==='string'&&v.state).slice(0,100):[];wl.selected.clear();wl.group=['status','category','supplier','none'].includes(saved.group)?saved.group:'status';wlMode(saved.mode||(saved.columns?wlLegacyMode(saved.columns,saved.simple):decisionInitialMode()));if(wl.mode==='simple')wl.columns=WL_SIMPLE_COLUMNS.slice();if(wl.mode==='detailed')wl.columns=WL_DETAILED_COLUMNS.slice();wl.collapsed=new Set(Array.isArray(saved.collapsed)?saved.collapsed.filter(x=>typeof x==='string').slice(0,20006):[])}
}
function wlClear(){localOrders.filter='all';wlApply({columns:wl.columns,mode:wl.mode,group:wl.group});wl.focus=0;buildList()}
function wlSetStatus(s){wl.status=s;wl.metric='';buildList()}
function wlPopover(label,id,content){const d=node('details',null,'work-popover');d.id=id;const s=node('summary',label);d.append(s,content);d.addEventListener('toggle',()=>{if(d.open&&d.id==='work-view')$('tools').open=false;if(d.open)for(const other of document.querySelectorAll('.work-popover[open]'))if(other!==d&&!other.contains(d)&&!d.contains(other))other.open=false});return d}
function wlFacet(key,label){
 const content=node('div',null,'work-popover-body'),search=node('input');search.type='search';search.placeholder='Find '+label.toLowerCase();search.setAttribute('aria-label',search.placeholder);search.maxLength=512;content.append(search)
 const options=node('div',null,'work-options');content.append(options)
 for(const [value,count]of [...wl.facets[key]].sort((a,b)=>Number(!a[0])-Number(!b[0])||a[0].localeCompare(b[0]))){const l=node('label'),check=node('input');check.type='checkbox';check.checked=wl[key==='supplier'?'suppliers':'categories'].includes(value);check.addEventListener('change',()=>{const k=key==='supplier'?'suppliers':'categories';wl[k]=check.checked?[...wl[k],value]:wl[k].filter(x=>x!==value);buildList({controls:false});});l.dataset.search=value.toLocaleLowerCase();l.append(check,node('span',value||(key==='supplier'?'Supplier not assigned':'No product type')),node('small',String(count)));options.append(l)}
 search.addEventListener('input',()=>{for(const l of options.children)l.hidden=!l.dataset.search.includes(search.value.toLocaleLowerCase())})
 return wlPopover(label+' ▾','filter-'+key,content)
}
// Presentation-only totals: incomplete costs must never look like a complete order value.
function wlSummaryNumbers(s,partial=false){const qty=[...s.units].map(([u,q])=>orderAmount(q)+' '+u).join(' · ')||'—';return [[s.orders,'To order','order'],[s.costed&&(!s.missingCost||partial)?wlMoney(s.value):qty,s.costed&&(!s.missingCost||partial)?'Order value'+(s.missingCost?' (known costs) · cost missing for '+s.missingCost+(s.missingCost===1?' product':' products'):''):'To order (qty)','order'],[s.runout,'Running out within 7 days','runout']]}
function wlRenderControls(){
 // Rebuilding controls must not dismiss the menu or lose the chosen section.
 const open=[...wlRoot.querySelectorAll('.work-popover[open]')].map(e=>e.id),focused=document.activeElement?.closest('[data-group],[data-density]'),focusKey=focused?.dataset.group?'[data-group="'+focused.dataset.group+'"]':focused?.dataset.density?'[data-density="'+focused.dataset.density+'"]':null
 const s=wl.summary
 wlSummary.replaceChildren(...wlSummaryNumbers(s,sourceName==='demo').map(([n,label,metric])=>{const b=wlBtn('',()=>{wlClear();if(metric==='order')wlSetStatus('order');else{wl.metric='runout';buildList()}});b.append(node('strong',typeof n==='number'?n.toLocaleString('en-US'):String(n)),node('span',label));if(metric==='runout')b.title='Includes products already out of stock';return b}))
 wlTabs.replaceChildren(...wlStatus.filter(([k])=>['order','running-low','healthy','all'].includes(k)).map(([k,t])=>{const b=wlBtn('',()=>wlSetStatus(k));b.append(node('span',t),node('small',wl.counts.get(k).toLocaleString('en-US')));b.dataset.view=k;b.setAttribute('aria-pressed',String(wl.status===k));return b}))
 for(const child of [...wlSaved.children])if(child!==wlSearch)child.remove();const save=wlBtn('Save this view',()=>{const name=prompt('View name');if(!name?.trim())return;if(wl.views.length>=100){wlMessage('Delete a saved view before adding another.');return}wl.views.push({name:name.trim().slice(0,80),state:wlSnapshot()});wlStore();wlRenderControls()},'work-save')
 const body=node('div',null,'work-popover-body work-view-body'),section=(title,content)=>{const s=node('section',null,'work-view-section');s.append(node('h3',title),content);body.append(s);return s}
 const grouping=node('div',null,'work-grouping');grouping.setAttribute('role','group');grouping.setAttribute('aria-label','Group by')
 for(const [key,label]of [['none','None'],['status','Status'],['category','Product type'],['supplier','Supplier']]){
  if(!['status','none'].includes(key)&&![...wl.facets[key].keys()].some(Boolean))continue
  const b=wlBtn(label,()=>{wl.group=key;wlStore();buildList()});b.dataset.group=key;b.setAttribute('aria-pressed',String(wl.group===key));grouping.append(b)
 }
 section('Summary',wlBtn('Weekly summary',()=>{$('work-view').open=false;weeklySummaryOpen()}))
 section('Group by',grouping)
 section('Ordered by you',localOrderFilters())
 // Presets never overwrite the last custom layout.
 const density=node('div',null,'work-density');density.setAttribute('role','group');density.setAttribute('aria-label','Table detail')
 for(const [key,label]of [['simple','Simple'],['detailed','Detailed'],['custom','Custom']]){const b=wlBtn(label,()=>wlSetMode(key));b.dataset.density=key;b.setAttribute('aria-pressed',String(wl.mode===key));density.append(b)}
 section('Columns',density).append(wlColumnPanel())
 wlFilters.replaceChildren();for(const [key,label]of [['supplier','Supplier'],['category','Product type']])if([...wl.facets[key].keys()].some(Boolean))wlFilters.append(wlFacet(key,label));section('Filter',wlFilters)
 const saved=node('div');saved.id='saved-views';saved.append(save)
 wl.views.forEach((v,index)=>{const line=node('div',null,'saved-view-row');line.append(wlBtn(v.name,()=>{wlApply(v.state);wlStore();buildList()}),wlBtn('Rename',()=>{const name=prompt('Rename view',v.name);if(name?.trim()){v.name=name.trim().slice(0,80);wlStore();wlRenderControls()}}),wlBtn('Delete',()=>{wl.views.splice(index,1);wlStore();wlRenderControls()}));saved.append(line)});section('Saved views',saved)
 const view=wlPopover('View','work-view',body);view.querySelector('summary').prepend(node('span',null,'work-view-icon'));wlSaved.append(view)
 // Less common filters stay reachable from the single header menu.
 document.querySelector('#work-extra-actions')?.remove();const more=node('div',null,'work-extra-actions');more.id='work-extra-actions';const custom=wlBtn('Custom settings',()=>{$('tools').open=false;wl.custom=!wl.custom;buildList()});custom.id='filter-custom';custom.setAttribute('aria-pressed',String(wl.custom));more.append(custom)
 for(const [key,label]of wlStatus.filter(([key])=>!['order','running-low','healthy','all'].includes(key)))if(wl.counts.get(key)>0){const b=wlBtn(label+' · '+wl.counts.get(key),()=>{$('tools').open=false;wlSetStatus(key)});b.dataset.view=key;b.setAttribute('aria-pressed',String(wl.status===key));more.append(b)}
 document.querySelector('.tools-body').append(more)
 if(!$('download-excel')){const excel=wlBtn('Download Excel',()=>wlExcel(currentRows));excel.id='download-excel';$('copy-po').after(excel)}
 const transfer=node('div',null,'work-transfer');transfer.append(wlBtn('Export views',()=>wlDownload(JSON.stringify({version:1,views:wl.views,columns:wl.columns},null,2)+'\n','inventory-manager-views.json','application/json')));const input=node('input');input.type='file';input.accept='.json,application/json';input.id='views-file';input.setAttribute('aria-label','Import saved views');input.addEventListener('change',async()=>{try{const f=input.files[0];if(!f)return;if(f.size>262144)throw Error('File is too large');const v=JSON.parse(await f.text());if(v.version!==1||!Array.isArray(v.views)||v.views.length>100||v.views.some(x=>typeof x.name!=='string'||!x.name.trim()||!x.state))throw Error('Invalid views file');wl.views=v.views.map(x=>({name:x.name.slice(0,80),state:x.state}));if(Array.isArray(v.columns)){wl.columns=wlNormalize(v.columns);wl.customColumns=[...wl.columns];wlMode('custom')}wlStore();buildList();wlMessage('Views imported for this dataset.')}catch(e){wlMessage('Could not import views: '+e.message)}});input.hidden=true;transfer.append(wlBtn('Import views',()=>input.click()),input);more.append(transfer)
 for(const id of open){const d=$(id);if(d)d.open=true}if(focusKey&&view.open)view.querySelector(focusKey)?.focus({preventScroll:true})
 wlRenderLeadNote()
 let stockoutNote=wlRoot.querySelector('.stockout-active-note');if(!stockoutNote){stockoutNote=node('p',null,'work-lead-note stockout-active-note');wlSummary.after(stockoutNote)}stockoutNote.hidden=!settings.stockout_adjust;stockoutNote.textContent='Out-of-stock correction ON · order quantities use corrected sales; chart history stays recorded.'
 let note=wlRoot.querySelector('.local-order-summary');if(!note){note=node('p',null,'local-order-summary');wlSummary.after(note)}note.textContent=localOrderSummary();note.hidden=!note.textContent
 // Narrow view tabs scroll horizontally; keep the active count fully in view.
 if(matchMedia('(max-width:1023px)').matches&&wlTabs.querySelector('[aria-pressed=true]')){const active=wlTabs.querySelector('[aria-pressed=true]'),a=active.getBoundingClientRect(),t=wlTabs.getBoundingClientRect();if(a.right>t.right)wlTabs.scrollLeft+=a.right-t.right;else if(a.left<t.left)wlTabs.scrollLeft-=t.left-a.left}
}
function wlRenderLeadNote(){
 const assumed=currentRows.filter(r=>r.guidance.used_default_lead),days=[...new Set(assumed.map(r=>r.guidance.lead_days))];wlLeadNote.hidden=!assumed.length;wlLeadNote.replaceChildren();if(!assumed.length)return
 wlLeadNote.append(node('span','Delivery time assumed'+(days.length===1?' ('+days[0]+' days)':'')+' for '+assumed.length+(assumed.length===1?' product':' products')+' · '),wlBtn('Set in Settings',()=>gmOpenSettings()))
}
function wlRenderActive(){wlActive.replaceChildren();const chip=(text,fn)=>wlActive.append(wlBtn(text+' ×',fn));if($('search').value)chip('Search: '+$('search').value,()=>{$('search').value='';buildList()});for(const [key,label]of [['suppliers','Supplier'],['categories','Product type']])for(const v of wl[key])chip(label+': '+(v||'Not assigned'),()=>{wl[key]=wl[key].filter(x=>x!==v);buildList()});if(localOrders.filter!=='all')chip(localOrders.filter==='late'?'Late orders':'Ordered by you',()=>{localOrders.filter='all';buildList()});if(wl.custom)chip('Custom settings',()=>{wl.custom=false;buildList()});if(wl.metric)chip(({units:'Positive order quantity',suppliers:'Assigned supplier',runout:'Out of stock or running out within 7 days'})[wl.metric],()=>{wl.metric='';buildList()});if(wlActive.children.length)wlActive.append(wlBtn('Clear all',wlClear));wlActive.hidden=!wlActive.children.length}
// Cache per item object + as-of month; detection is pure, so 1,000 rows stay fast on every render.
const wlStockoutCache=new WeakMap()
function wlStockoutCount(i){const key=data.as_of.slice(0,7),hit=wlStockoutCache.get(i);if(hit&&hit[0]===key)return hit[1];const n=detectStockoutMonths(i,key).flagged.length;wlStockoutCache.set(i,[key,n]);return n}
function wlValue(r,k){
 // Optional detectors/lookups must stay lazy: the sort comparator and Excel
 // request one column, not every column. Keep the same values and cache rules.
 if(k==='stockouts')return wlStockoutCount(r.item)
 if(k==='incoming')return localOrderIncoming(r.item)
 const m=wlMeta(r),g=r.guidance,i=r.item
 return ({product:i.name,status:wlRank[r.bucket],hand:i.on_hand,days:m.days,qty:g.quantity,due:m.due,runout:g.runout_date||'9999-12-31',supplier:m.supplier,category:m.category,lead:g.lead_days,monthly:m.monthly,value:m.value,lasts:m.lasts,pattern:m.pattern,excess:m.excess,last:m.last})[k]
}
function wlCompare(a,b){let d;if(wl.sort==='urgency')d=wlRank[a.bucket]-wlRank[b.bucket]||wlMeta(a).due.localeCompare(wlMeta(b).due);else{const x=wlValue(a,wl.sort),y=wlValue(b,wl.sort);d=x==null?y==null?0:1:y==null?-1:typeof x==='number'?x-y:String(x).localeCompare(String(y))}return d*wl.dir||a.item.sku.localeCompare(b.item.sku)}
buildList=function({controls=true}={}){
 const started=performance.now();wlRefresh();const q=$('search').value.trim().toLocaleLowerCase(),ss=new Set(wl.suppliers),cs=new Set(wl.categories)
 filteredRows=currentRows.filter(r=>{const m=wlMeta(r);return (localOrders.filter==='all'||!!localOrderFor(r.item.sku)&&(localOrders.filter!=='late'||localOrderLate(localOrderFor(r.item.sku))))&&(wl.status==='all'||r.bucket===wl.status)&&(!q||m.search.includes(q))&&(!ss.size||ss.has(m.supplier))&&(!cs.size||cs.has(m.category))&&(!wl.custom||m.custom)&&(!wl.metric||wl.metric==='units'&&r.guidance.quantity>0||wl.metric==='suppliers'&&!!m.supplier||wl.metric==='runout'&&m.days!==null&&m.days<=7)}).sort(wlCompare)
 if(!['status','none'].includes(wl.group)&&![...wl.facets[wl.group].keys()].some(Boolean))wl.group='status'
 const groups=new Map();for(const r of filteredRows){
  const value=wl.group==='status'?r.bucket:wlMeta(r)[wl.group],id=wl.group+':'+JSON.stringify(value)
  if(!groups.has(id))groups.set(id,{id,group:value,rows:[],units:new Map(),orders:0,rank:Infinity,due:'9999-12-31'})
  const section=groups.get(id);section.rows.push(r);section.rank=Math.min(section.rank,wlRank[r.bucket]);if(wlMeta(r).due<section.due)section.due=wlMeta(r).due
  if(['order','running-low'].includes(r.bucket)&&r.guidance.quantity>0){section.orders++;section.units.set(r.item.unit,(section.units.get(r.item.unit)||0)+r.guidance.quantity)}
 }
 wl.sections=wl.group==='none'?[{id:'none',group:'',rows:filteredRows,units:new Map(),orders:0}]:[...groups.values()].sort((a,b)=>wl.group==='status'?wlRank[a.group]-wlRank[b.group]:Number(!a.group)-Number(!b.group)||a.rank-b.rank||a.due.localeCompare(b.due)||a.group.localeCompare(b.group))
 filteredRows=wl.sections.flatMap(s=>s.rows);wlIndex()
 wl.focus=Math.max(0,Math.min(wl.focus,filteredRows.length-1));if(controls)wlRenderControls();wlRenderActive();wlLayout();wlScroll.scrollTop=0;wlRenderRows();wlRenderBulk();updateNavigation();wlMessage(`${filteredRows.length.toLocaleString('en-US')} of ${currentRows.length.toLocaleString('en-US')} products · ${sourceName==='sample'?'Sample data':sourceName==='demo'?'Synthetic demo data — fictional products':'Local CSV — stays on this device'}`);wlHash();document.body.dataset.filterMs=String(performance.now()-started)
}
// Reorder the chosen sequence, retaining auto-hidden columns and Product's lock.
function wlMoveHeader(key,target,after=false){
 if(key==='product'||target==='product'||key===target)return false
 const next=wl.columns.filter(k=>k!==key),at=next.indexOf(target);if(at<1)return false
 next.splice(at+(after?1:0),0,key);wl.columns=next;const all=wlNormalize([...(wl.customOrder||[]),...next,...wlColumns.map(c=>c[0])]).filter(k=>k!==key),position=all.indexOf(target);all.splice(position+(after?1:0),0,key);wl.customOrder=all;wlCommitColumns();wlMessage(wlColumns.find(c=>c[0]===key)[1]+' moved. Column layout saved.');return true
}
function wlHeaderTarget(x,y){const h=document.elementFromPoint(x,y)?.closest('.work-head [data-column]');return h&&h.dataset.column!=='product'?{key:h.dataset.column,after:x>h.getBoundingClientRect().left+h.offsetWidth/2}:null}
function wlHeaderIndicator(target){for(const h of wlHead.querySelectorAll('[data-drop]'))delete h.dataset.drop;if(target)wlHead.querySelector('[data-column="'+target.key+'"]')?.setAttribute('data-drop',target.after?'after':'before')}
function wlBindHeader(h,key){
 let pointer=null
 h.draggable=key!=='product';h.title=key==='product'?'Product stays first':'Drag to reorder · Alt+Left/Right to move'
 h.addEventListener('keydown',e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key)||wl.phone)return;e.preventDefault();e.stopPropagation();const keys=wlVisible().map(c=>c[0]),index=keys.indexOf(key),right=e.key==='ArrowRight',target=keys[index+(right?1:-1)];if(target&&wlMoveHeader(key,target,right))wlHead.querySelector('[data-column="'+key+'"] button')?.focus({preventScroll:true})})
 h.addEventListener('pointerdown',e=>{if(wl.phone||key==='product'||e.button!==0)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,moving:false};wl.headerPointer={...pointer,key};wl.headerDrag=null})
 // The document listeners below also cover mouse/pen moves outside the source cell.
 h.addEventListener('pointercancel',()=>{pointer=null;if(!wl.headerNative){wl.headerPointer=null;wl.headerDrag=null;wlHeaderIndicator(null);wl.suppressHeaderClick=false}})
 h.addEventListener('dragstart',e=>{if(wl.phone||key==='product'||!wl.headerPointer){e.preventDefault();return}wl.headerDrag=key;wl.headerNative=true;wl.suppressHeaderClick=true;e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move'})
 h.addEventListener('dragover',e=>{if(!wl.headerDrag||key==='product')return;e.preventDefault();e.dataTransfer.dropEffect='move';const p=wl.headerPointer;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>=6){p.moving=true;wlHeaderIndicator(wlHeaderTarget(e.clientX,e.clientY))}})
 h.addEventListener('drop',e=>{if(!wl.headerDrag)return;e.preventDefault();const source=wl.headerDrag,p=wl.headerPointer,target=p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>=6?wlHeaderTarget(e.clientX,e.clientY):null;wl.headerDrag=null;wl.headerNative=false;wl.headerPointer=null;pointer=null;wlHeaderIndicator(null);if(target)wlMoveHeader(source,target.key,target.after);setTimeout(()=>{wl.suppressHeaderClick=false},0)})
 h.addEventListener('dragend',()=>{pointer=null;wl.headerPointer=null;wl.headerDrag=null;wl.headerNative=false;wlHeaderIndicator(null);setTimeout(()=>{wl.suppressHeaderClick=false},0)})
}
function wlCloseHeaderColumns(){wl.columnPopup?.remove();wl.columnPopup=null;wl.headerTools?.querySelector('button').setAttribute('aria-expanded','false')}
document.addEventListener('pointermove',e=>{const p=wl.headerPointer;if(!p||p.id!==e.pointerId||wl.phone)return;if(Math.hypot(e.clientX-p.x,e.clientY-p.y)>=6)p.moving=true;if(p.moving){wl.headerDrag=p.key;wl.suppressHeaderClick=true;wlHeaderIndicator(wlHeaderTarget(e.clientX,e.clientY))}})
document.addEventListener('pointerup',e=>{const p=wl.headerPointer;if(!p||p.id!==e.pointerId)return;wl.headerPointer=null;if(p.moving&&!wl.headerNative){const target=wlHeaderTarget(e.clientX,e.clientY);wl.headerDrag=null;wlHeaderIndicator(null);if(target)wlMoveHeader(p.key,target.key,target.after);setTimeout(()=>{wl.suppressHeaderClick=false},0)}})
function wlHeaderTools(){
 if(!wl.headerTools){const tools=node('div',null,'work-header-tools'),button=wlBtn('+',()=>{const open=button.getAttribute('aria-expanded')!=='true';wlCloseHeaderColumns();if(open){$('work-view').open=false;wl.columnPopup=wlColumnPanel(true);wl.columnPopup.id='header-column-checklist';wlRoot.append(wl.columnPopup);const rect=button.getBoundingClientRect();wl.columnPopup.style.top=rect.bottom+'px';wl.columnPopup.style.right=Math.max(16,innerWidth-rect.right)+'px';button.setAttribute('aria-expanded','true');wl.columnPopup.querySelector('input:not(:disabled),button')?.focus()}},'work-add-columns');button.setAttribute('aria-label','Add or remove columns');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','header-column-checklist');tools.append(button);wl.headerTools=tools}return wl.headerTools
}
document.addEventListener('click',e=>{if(wl.columnPopup&&!e.composedPath().includes(wl.columnPopup)&&!e.composedPath().includes(wl.headerTools))wlCloseHeaderColumns()})
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&wl.columnPopup){e.preventDefault();e.stopImmediatePropagation();wlCloseHeaderColumns();wl.headerTools.querySelector('button').focus()}},true)

function wlLayout(){wl.phone=matchMedia('(max-width:1023px)').matches;wl.height=wl.phone?104:64;wl.offsets=[];let total=0;for(const entry of wl.entries){wl.offsets.push(total);entry.wlHeight=wl.height;if(!entry.row&&wl.group==='supplier'){const p=supplierMinimumContext(entry.group,entry.rows);if(supplierMinimums.accepted.has(entry.group)||entry.orders&&(p.gapValue||p.gapQty))entry.wlHeight=wl.phone?248:120}total+=entry.wlHeight}wl.totalHeight=total;const cols=wlVisible().map(c=>c[0]==='status'&&wl.status!=='all'&&wl.mode!=='simple'?[c[0],c[1],44]:c);wl.template='44px '+cols.map(c=>c[0]==='product'?`minmax(${c[2]}px, 360px)`:c[2]+'px').join(' ')+' 44px';wlScroll.style.setProperty('--work-columns',wl.template);wlScroll.style.setProperty('--work-min',88+cols.reduce((n,c)=>n+c[2],0)+'px');wlCanvas.style.height=wl.totalHeight+'px';wlScroll.setAttribute('aria-rowcount',String(filteredRows.length+1));wlHead.replaceChildren();const cell=node('div',null,'work-cell');const c=node('input');c.type='checkbox';c.setAttribute('aria-label','Select all filtered products');c.id='work-select-all';c.checked=!!filteredRows.length&&filteredRows.every(r=>wl.selected.has(r.item.sku));c.indeterminate=!c.checked&&filteredRows.some(r=>wl.selected.has(r.item.sku));c.addEventListener('change',()=>{for(const r of filteredRows)if(c.checked)wl.selected.add(r.item.sku);else wl.selected.delete(r.item.sku);wlRenderRows();wlRenderBulk()});cell.append(c);wlHead.append(cell);for(const [key,label]of cols){const h=node('div',null,'work-cell '+(WL_NUMERIC.includes(key)?'numeric':''));h.dataset.column=key;h.setAttribute('role','columnheader');h.setAttribute('aria-sort',wl.sort===key?wl.dir===1?'ascending':'descending':'none');const sort=wlBtn((key==='status'&&wl.status!=='all'&&wl.mode!=='simple'?'':label)+(wl.sort===key?(wl.dir===1?' ↑':' ↓'):''),()=>{if(wl.suppressHeaderClick)return;wl.dir=wl.sort===key?-wl.dir:1;wl.sort=key;buildList();wlHead.querySelector('[data-column="'+key+'"] button')?.focus({preventScroll:true})});sort.setAttribute('aria-label','Sort by '+label);if(key!=='product')sort.setAttribute('aria-keyshortcuts','Alt+ArrowLeft Alt+ArrowRight');h.append(sort);h.dataset.column=key;wlBindHeader(h,key);wlHead.append(h)}wlHead.append(wlHeaderTools());if(wl.phone)wlCloseHeaderColumns();let hint=wlFoot.querySelector('.work-overflow-hint');if(!hint){hint=node('span','Scroll table for more columns →','work-overflow-hint');wlFoot.insertBefore(hint,wlFoot.lastChild)}hint.hidden=wl.phone||wlScroll.scrollWidth<=wlScroll.clientWidth}
function wlStatusCell(r){const e=node('span',null,'work-status');e.dataset.bucket=r.bucket;const label=wlStatus.find(c=>c[0]===r.bucket)?.[1]||bucketNames[r.bucket];e.setAttribute('aria-label',label);e.setAttribute('role','img');e.append(node('i',null,'dot'));if(wl.status==='all'||wl.mode==='simple')e.append(node('span',label));return e}
function wlRow(r,index){const m=wlMeta(r),g=r.guidance,i=r.item,e=node('div',null,'work-row');e.dataset.sku=i.sku;e.dataset.bucket=r.bucket;e.setAttribute('role','row');e.setAttribute('aria-rowindex',String(index+2));e.setAttribute('aria-selected',String(wl.selected.has(i.sku)));e.dataset.focus=String(index===wl.focus);e.dataset.current=String(wl.drawer&&selectedSku===i.sku);e.tabIndex=index===wl.focus?0:-1;const select=node('label',null,'work-check'),c=node('input');c.type='checkbox';c.checked=wl.selected.has(i.sku);c.setAttribute('aria-label','Select '+i.name);c.addEventListener('change',()=>{if(c.checked)wl.selected.add(i.sku);else wl.selected.delete(i.sku);wlRenderRows();wlRenderBulk()});select.append(c);e.append(select)
 for(const [key]of wlVisible()){const cell=node('div',null,'work-cell '+(WL_NUMERIC.includes(key)?'numeric':''));cell.dataset.column=key;cell.setAttribute('role','cell');if(key==='product'){const b=wlBtn('',()=>wlOpen(r));b.className='work-product';b.append(node('span',i.name,'work-name'),node('small',null,'work-sku'));b.querySelector('.work-sku').append(node('span',i.sku,'work-sku-code'));if(i.input_warnings?.length){const marker=node('span','Input warning'+(i.input_warnings.length===1?'':'s'),'input-warning-marker');marker.dataset.inputWarningMarker=i.sku;b.querySelector('.work-sku').append(marker)}const pill=localOrderPill(i.sku);if(pill)b.querySelector('.work-sku').append(pill);cell.append(b)}else if(key==='status')cell.append(wlStatusCell(r));else{const value=wlValue(r,key);cell.textContent=['monthly','value','lasts','pattern','excess','last'].includes(key)?wlDecisionText(r,key):key==='runout'?(!g.runout_date?'—':m.days<=0?'Now':shortDate(g.runout_date)):key==='due'?(g.order_by==='now'?'Today':g.order_by?shortDate(g.order_by):'—'):key==='days'?(m.days===null?'—':m.days<0?`Overdue · ${-m.days} d`:String(m.days)):key==='supplier'?(m.supplier||'Not assigned'):key==='category'?(m.category||'—'):value==null?'—':typeof value==='number'?orderAmount(value):String(value);if(key==='lead'&&value!=null)cell.append(' d');if(['supplier','category'].includes(key))cell.title=cell.textContent;if(key==='days'&&m.days<0)cell.dataset.overdue='true'}e.append(cell)}
 if(wl.phone){const detail=wlBtn('',()=>wlOpen(r),'work-phone-summary');detail.append(wlStatusCell(r),node('span',r.bucket==='needs-data'?'Check product data':!['order','running-low'].includes(r.bucket)?'No order needed now':`Order ${g.quantity==null?'—':orderAmount(g.quantity)} ${i.unit} · ${g.order_by==='now'?'Today':g.order_by?'Order by '+shortDate(g.order_by):'No order date'}`),node('small',[(wl.columns.includes('monthly')?'Sales '+wlDecisionText(r,'monthly')+'/mo':null),(wl.columns.includes('value')?'Value '+wlDecisionText(r,'value'):null)].filter(Boolean).join(' · ')||m.supplier||'Supplier not assigned'));e.append(detail)}
 e.addEventListener('click',event=>{if(!event.target.closest('button,input,label'))wlOpen(r)});return e}
function wlIndex(){
 wl.entries=[];wl.headers=[];let index=0
 for(const section of wl.sections){if(section.id!=='none'){wl.headers.push(wl.entries.length);wl.entries.push(section)}for(const row of section.rows){if(!wl.collapsed.has(section.id))wl.entries.push({row,index});index++}}
}
function wlRevealRow(row){const section=wl.sections.find(s=>s.rows.includes(row));if(section&&wl.collapsed.delete(section.id)){wlIndex();wlStore();wlLayout()}}
function wlToggleGroup(section){
 if(wl.collapsed.has(section.id))wl.collapsed.delete(section.id);else wl.collapsed.add(section.id)
 wlIndex();wlStore();wlLayout();wlScroll.scrollTop=Math.min(wlScroll.scrollTop,Math.max(0,wl.totalHeight-wlScroll.clientHeight));wlRenderRows()
 wlCanvas.querySelector(`[data-collapse="${CSS.escape(section.id)}"]`)?.focus({preventScroll:true})
}
function wlGroupHeader(entry){
 const e=node('div',null,'work-group');e.dataset.group=wl.group;e.setAttribute('role','row')
 const label=wl.group==='status'?(wlStatus.find(([key])=>key===entry.group)?.[1]||entry.group):entry.group||(wl.group==='supplier'?'Supplier not assigned':'No product type')
 const toggle=wlBtn((wl.collapsed.has(entry.id)?'› ':'⌄ ')+label,()=>wlToggleGroup(entry),'work-group-toggle');toggle.dataset.collapse=entry.id;toggle.setAttribute('aria-expanded',String(!wl.collapsed.has(entry.id)));toggle.title=label
 const counts=node('span',entry.rows.length.toLocaleString('en-US')+(entry.rows.length===1?' product · ':' products · ')+entry.orders.toLocaleString('en-US')+' to order','work-group-count')
 e.append(toggle,counts)
 if(entry.units.size)e.append(node('span',[...entry.units].map(([u,q])=>orderAmount(q)+' '+u).join(' · '),'work-group-units'))
 const copy=wlBtn('Copy order',()=>wlCopy(entry.rows),'work-group-copy');copy.disabled=!entry.orders&&!supplierMinimums.accepted.has(entry.group);copy.setAttribute('aria-label','Copy order for '+label);e.append(copy)
 if(wl.group==='supplier'){const draft=wlBtn('Draft email',()=>wlDraftEmail(entry.rows),'work-group-draft');draft.disabled=!entry.orders&&!supplierMinimums.accepted.has(entry.group);draft.setAttribute('aria-label','Draft order email for '+(entry.group||'No supplier – assign first'));e.append(draft);const menu=node('details',null,'local-order-menu'),summary=node('summary','⋯');summary.setAttribute('aria-label','Order actions for '+label);const actions=localOrderActions(entry.rows);actions.prepend(wlBtn('Download Excel',()=>wlExcel(entry.rows)));menu.append(summary,actions);e.append(menu);const minimum=supplierMinimumHeader(entry);if(minimum){e.classList.add('work-group-minimum');e.append(minimum)}}return e
}
function wlEntryAt(y){let lo=0,hi=wl.entries.length-1,result=0;while(lo<=hi){const mid=(lo+hi)>>1;if(wl.offsets[mid]<=y){result=mid;lo=mid+1}else hi=mid-1}return result}
function wlRenderRows(){
 const top=Math.max(0,wlScroll.scrollTop-44),start=Math.max(0,wlEntryAt(top)-4),end=Math.min(wl.entries.length,wlEntryAt(top+wlScroll.clientHeight)+5),f=document.createDocumentFragment()
 for(let k=start;k<end;k++){const entry=wl.entries[k],e=entry.row?wlRow(entry.row,entry.index):wlGroupHeader(entry);e.style.top=wl.offsets[k]+'px';f.append(e)}
 // Keep the current section visible without mounting its offscreen products.
 const y=Math.max(0,wlScroll.scrollTop),headers=wl.headers||[];let lo=0,hi=headers.length-1,active=-1
 while(lo<=hi){const mid=(lo+hi)>>1;if(wl.offsets[headers[mid]]<=y){active=mid;lo=mid+1}else hi=mid-1}
 if(active>=0){const k=headers[active],entry=wl.entries[k],e=wlGroupHeader(entry);for(const old of [...f.children])if(old.querySelector('[data-collapse]')?.dataset.collapse===entry.id)old.remove();e.classList.add('work-group-sticky');e.style.top=Math.min(y,(wl.offsets[headers[active+1]]??Infinity)-entry.wlHeight)+'px';f.append(e)}
 if(!filteredRows.length)f.append(node('p',currentRows.length?'No products match. Choose All, clear filters or try another search.':'No products yet. Import a stock CSV to get started.','work-empty'));wlCanvas.replaceChildren(f)
}
function wlRenderBulk(){const draft=wlBtn('Draft email',()=>wlDraftEmail(wlSelected()));draft.disabled=!wlEmailGroups(wlSelected()).length;wlBulk.hidden=!wl.selected.size;wlBulk.replaceChildren(node('strong',wl.selected.size.toLocaleString('en-US')+' selected'),wlBtn('Copy order',()=>wlCopy(wlSelected())),draft,localOrderActions(wlSelected()),wlBtn('Export CSV',()=>wlExport(wlSelected())),wlBtn('Clear',()=>{wl.selected.clear();wlRenderRows();wlRenderBulk()}));const c=$('work-select-all');if(c){c.checked=!!filteredRows.length&&filteredRows.every(r=>wl.selected.has(r.item.sku));c.indeterminate=!c.checked&&filteredRows.some(r=>wl.selected.has(r.item.sku))}}
function wlSelected(){return currentRows.filter(r=>wl.selected.has(r.item.sku))}
function wlOrderGroups(rows){supplierMinimumSync();const groups=new Map();for(const r of attentionRows(rows)){const supplier=wlMeta(r)?.supplier??gmMeta(r.item.supplier);if(!groups.has(supplier))groups.set(supplier,[]);groups.get(supplier).push(r)}for(const r of rows){const supplier=gmMeta(r.item.supplier);if(supplierMinimums.accepted.has(supplier)&&!groups.has(supplier))groups.set(supplier,[])}return [...groups].sort((a,b)=>Number(!a[0])-Number(!b[0])||a[0].localeCompare(b[0])).map(([supplier,group])=>[supplier,supplierMinimumRows(supplier,group)])}
function wlOrderText(rows){return wlOrderGroups(rows).filter(([,rs])=>rs.some(r=>r.guidance.quantity>0)).map(([s,rs])=>(s||'Supplier not assigned').replace(/[\r\n\u2028\u2029]+/g,' ')+'\n'+purchaseOrderText(rs.filter(r=>!r.minimumAdded),currentToday)+(rs.some(r=>r.minimumAdded)?'\n'+rs.filter(r=>r.minimumAdded).map(r=>[r.item.sku,r.item.name,orderAmount(r.guidance.quantity)+' '+r.item.unit].map(wlEmailLine).join(' · ')+supplierMinimumLabel(r)).join('\n'):'')).join('\n\n')||'No orders needed for the selected products.'}
async function wlCopy(rows){const text=wlOrderText(rows);try{await navigator.clipboard.writeText(text);wlMessage('Order copied, grouped by supplier.')}catch{$('tools').open=true;$('copy-fallback').hidden=false;$('po-text').value=text;$('po-text').focus();$('po-text').select();wlMessage('Select and copy the order text in the menu.')}}
// Local draft only: reuse purchase eligibility and the already-rounded guidance.
function wlEmailGroups(rows){return wlOrderGroups(rows).map(([s,rs])=>[s,rs.filter(r=>r.guidance.quantity>0)]).filter(([,rs])=>rs.length)}
function wlEmailLine(value){return String(value??'').replace(/[\r\n\u2028\u2029]+/g,' ')}
function wlSupplierEmail(supplier,rows){
 if(!supplier)return ''
 const records=data.suppliers,record=Array.isArray(records)?records.find(s=>s&&[s.name,s.supplier,s.id].includes(supplier)):records&&typeof records==='object'?records[supplier]:null
 const candidates=[record?.email,...rows.map(r=>r.item.supplier_email)]
 return candidates.find(email=>typeof email==='string'&&email.length<=320&&/^[^\s@?&#]+@[^\s@?&#]+$/.test(email))||''
}
function wlEmailDraft(supplier,rows){
 const name=wlEmailLine(supplier||'No supplier – assign first'),subject='Purchase order request – '+name+' – '+currentToday
 const lines=rows.map(({item:i,guidance:g,minimumAdded})=>{const date=g.order_by==='now'?currentToday:g.order_by,day=dateOrdinal(date),arrival=day!==null&&Number.isFinite(g.lead_days)&&g.lead_days>=0?ordinalDate(day+g.lead_days):null;return [i.sku,i.name,orderAmount(g.quantity)+' '+i.unit,'Requested delivery: '+(arrival||'To confirm')].map(wlEmailLine).join(' · ')+(minimumAdded?' (added to reach minimum)':'')})
 return {subject,body:['Hello'+(supplier?' '+wlEmailLine(supplier):'')+',','','Please arrange the following order:','',...lines,'','Please confirm availability, pricing and whether you can meet the requested delivery dates.','','Thank you,','[Your name]'].join('\n')}
}
function wlDraftEmail(rows){
 const groups=wlEmailGroups(rows);if(!groups.length)return
 const existing=$('order-email-dialog');if(existing){existing.querySelector('textarea').focus();return}
 wlCloseHeaderColumns()
 const trigger=document.activeElement,dialog=node('dialog',null,'order-email-dialog'),heading=node('div',null,'order-email-heading'),title=node('h2','Draft order email'),close=wlBtn('Close',()=>dialog.close()),supplierLabel=node('label','Supplier'),select=node('select'),subject=node('p',null,'order-email-subject'),label=node('label','Email draft'),text=node('textarea'),status=node('p',null,'order-email-status'),actions=node('div',null,'order-email-actions'),mail=node('a','Open in mail app'),drafts=groups.map(([s,rs])=>wlEmailDraft(s,rs))
 dialog.id='order-email-dialog';title.id='order-email-title';dialog.setAttribute('aria-labelledby',title.id);dialog.setAttribute('aria-describedby','order-email-help');text.id='order-email-body';label.htmlFor=text.id;text.spellcheck=true;select.id='order-email-supplier';supplierLabel.htmlFor=select.id;status.setAttribute('role','status')
 heading.append(title,close)
 groups.forEach(([s],n)=>{const option=node('option',s||'No supplier – assign first');option.value=String(n);select.append(option)})
 let index=0
 const syncLink=()=>{const [supplier,rs]=groups[index];mail.hidden=!supplier;if(supplier)mail.href='mailto:'+encodeURIComponent(wlSupplierEmail(supplier,rs))+'?subject='+encodeURIComponent(drafts[index].subject)+'&body='+encodeURIComponent(text.value);else mail.removeAttribute('href')}
 const show=()=>{subject.textContent='Subject: '+drafts[index].subject;text.value=drafts[index].body;status.textContent=groups[index][0]?'':'No supplier – assign first. You can edit and copy this draft.';syncLink()}
 select.addEventListener('change',()=>{drafts[index].body=text.value;index=Number(select.value);show()});text.addEventListener('input',()=>{drafts[index].body=text.value;syncLink()})
 const copy=wlBtn('Copy',async()=>{try{await navigator.clipboard.writeText(drafts[index].subject+'\n\n'+text.value);status.textContent='Draft copied. Nothing sent.'}catch{text.focus();text.select();status.textContent='Clipboard unavailable. Select and copy the draft below.'}})
 const help=node('p','Review before opening your mail app. Nothing is sent from this page.','product-note');help.id='order-email-help';if(groups.some(([,rs])=>rs.some(r=>r.minimumAdded)))help.append(' Minimum additions are export-only; marking ordered tracks suggested lines only.');actions.append(copy,mail);dialog.append(heading,help)
 const mark=wlBtn(groups.some(([,rs])=>rs.some(r=>r.minimumAdded))?'Mark suggested lines as ordered':'Mark these as ordered',()=>{if(localOrderMark(groups[index][1].filter(r=>!r.minimumAdded))){mark.disabled=true;status.textContent='Marked on this device — not in your ERP.'}else status.textContent=localOrders.error||'Nothing marked. No unmarked purchase quantities in this selection.'});mark.disabled=true
 copy.addEventListener('click',()=>{mark.disabled=!groups[index][1].some(r=>!r.minimumAdded&&!localOrderFor(r.item.sku))});mail.addEventListener('click',()=>{mark.disabled=!groups[index][1].some(r=>!r.minimumAdded&&!localOrderFor(r.item.sku))});select.addEventListener('change',()=>{mark.disabled=true})
 actions.append(wlBtn('Download Excel',()=>wlExcel(groups[index][1])),mark)
 if(groups.length>1)dialog.append(supplierLabel,select)
 dialog.append(subject,label,text,actions,status)
 dialog.addEventListener('close',()=>{dialog.remove();const fallback=document.querySelector('.product-order-action .product-draft-email:not(:disabled)')||document.querySelector('#product-page-close')||wlScroll;(trigger?.isConnected&&!trigger.disabled?trigger:fallback).focus({preventScroll:true})},{once:true})
 // A body-level native dialog remains interactive above the inert product layer.
 document.body.append(dialog);show();dialog.showModal();text.focus()
}
function wlDownload(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function wlCsv(rows){
 // CLI columns verbatim, then the three worklist metadata columns. Arrives-by
 // stays blank to preserve CLI parity. Excel/email separately label a requested
 // delivery (order date + lead time), never a confirmed supplier commitment.
 const cols=['sku','name','unit','status','order_qty','order_by','next_confirmed_delivery','arrives_by','run_out','on_hand','on_order','safety_stock','reorder_point','reason','supplier','category','lead_days']
 const ordered=[...rows].sort((a,b)=>{const x=wlMeta(a).supplier,y=wlMeta(b).supplier;return Number(!x)-Number(!y)||x.localeCompare(y)||wlRank[a.bucket]-wlRank[b.bucket]||wlMeta(a).due.localeCompare(wlMeta(b).due)||a.item.sku.localeCompare(b.item.sku)})
 return [cols,...ordered.map(({item:i,guidance:g,bucket})=>[i.sku,i.name,i.unit,bucket,g.quantity,g.order_by,g.delivery_date,null,g.runout_date,i.on_hand,i.on_order,g.safety_stock,g.reorder_point,g.reason,i.supplier,i.category,g.lead_days])].map(row=>row.map(wlCsvCell).join(',')).join('\r\n')+'\r\n'
}
// Shared by order and set-aside CSV exports; preserve the original cell after
// an apostrophe, including whitespace/BOM before a spreadsheet formula marker.
function wlCsvCell(value){
 let text=String(value??'')
 if(typeof value==='string'&&(/^[=+@\-\t\r]/.test(text)||/^[\s\ufeff]*[=+@\-]/u.test(text)))text="'"+text
 return '"'+text.replace(/"/g,'""')+'"'
}
function wlExport(rows){wlDownload(wlCsv(rows),'inventory-manager-order.csv','text/csv;charset=utf-8')}
const wlSelectBase=selectItem
selectItem=function(row,{hash=true,reveal=false}={}){if(!row)return;const changed=selectedSku!==row.item.sku;wlSelectBase(row,{hash:false,reveal:false});if(wl.drawer){$('main').hidden=false;document.body.classList.add('detail-open');if(changed)$('main').scrollTop=0;wlRenderRows()}if(hash)wlHash()}
function wlOpen(row){if(!row)return;wlRevealRow(row);wl.drawer=true;$('main').hidden=false;document.body.classList.add('detail-open');wl.focus=Math.max(0,filteredRows.indexOf(row));selectItem(row);$('main').scrollTop=0;wlClose.focus({preventScroll:true});wlRenderRows()}
function wlCloseDrawer({focus=true}={}){wl.drawer=false;$('main').hidden=true;document.body.classList.remove('detail-open');wlHash();if(focus)wlScroll.focus({preventScroll:true});wlRenderRows()}
wlScroll.addEventListener('scroll',()=>{if(!wl.frame)wl.frame=requestAnimationFrame(()=>{wl.frame=0;wlRenderRows()})},{passive:true})
// Observer delivery must be read-only: rebuilding phone controls can resize the
// observed scrollport again (cost/clearance totals), causing WebKit loop errors.
// Coalesce writes into the next frame; a height-only change needs rows, not controls.
let wlResizeFrame=0,wlResizeWidth=-1,wlResizeHeight=-1
new ResizeObserver(()=>{
 if(wlResizeFrame)return
 wlResizeFrame=requestAnimationFrame(()=>{
  wlResizeFrame=0
  const width=wlScroll.clientWidth,height=wlScroll.clientHeight
  if(width===wlResizeWidth&&height===wlResizeHeight)return
  const widthChanged=width!==wlResizeWidth
  wlResizeWidth=width;wlResizeHeight=height
  if(widthChanged){const phone=wl.phone;wlLayout();if(phone!==wl.phone||wl.phone)wlRenderControls();if(wl.columnPopup)wlCloseHeaderColumns()}
  wlRenderRows()
 })
}).observe(wlScroll)
document.addEventListener('click',e=>{if(!e.target.isConnected)return;for(const d of document.querySelectorAll('.work-popover[open]'))if(!e.composedPath().includes(d))d.open=false})
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open],.chart-focus,.product-page')||e.metaKey||e.altKey||e.ctrlKey)return;if(e.key==='Escape'){if(document.querySelector('.chart-tooltip:not([hidden])'))return;const open=[...document.querySelectorAll('.work-popover[open]')].at(-1);if(open){open.open=false;open.querySelector('summary').focus()}else if($('tools').open){$('tools').open=false;$('tools').querySelector('summary').focus()}else if(wl.drawer)wlCloseDrawer();else{wlClear();if(document.activeElement===$('search'))$('search').blur()}e.preventDefault();e.stopImmediatePropagation();return}if(e.target.closest('button,input,textarea,select,summary,a[href],[contenteditable=true],#tools,[data-delivery-marker]'))return;if(!['j','k','ArrowDown','ArrowUp','Enter','x','/'].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();if(e.key==='/'){$('search').focus();return}if(['j','k','ArrowDown','ArrowUp'].includes(e.key)){const delta=['j','ArrowDown'].includes(e.key)?1:-1;if(wl.drawer){navigateSku(delta);return}wl.focus=Math.max(0,Math.min(filteredRows.length-1,wl.focus+delta));wlRevealRow(filteredRows[wl.focus]);const n=wl.entries.findIndex(e=>e.row===filteredRows[wl.focus]),y=wl.offsets[n];if(y<wlScroll.scrollTop)wlScroll.scrollTop=y;else if(y+wl.height>wlScroll.scrollTop+wlScroll.clientHeight-44)wlScroll.scrollTop=y+wl.height-wlScroll.clientHeight+44;wlRenderRows();return}const row=filteredRows[wl.focus];if(!row)return;if(e.key==='Enter')wlOpen(row);if(e.key==='x'){if(wl.selected.has(row.item.sku))wl.selected.delete(row.item.sku);else wl.selected.add(row.item.sku);wlRenderRows();wlRenderBulk()}},true)
window.addEventListener('hashchange',e=>{if(new URLSearchParams(location.hash.slice(1)).has('product')||document.querySelector('.product-page'))return;e.stopImmediatePropagation();wlRestore(location.hash);const hash=location.hash;buildList();const sku=new URLSearchParams(hash.slice(1)).get('sku');if(rowMap.has(sku))selectItem(rowMap.get(sku),{hash:false});if(!wl.drawer)wlCloseDrawer()},true)
// Old Arctic browser remains a hidden compatibility surface; its key/hash routes
// are disabled in table mode. The shared chart/settings adapters are unchanged.
gmBKeys.textContent='Keyboard: J / K or ↑ / ↓ rows · Enter details · X select · / search · Esc close or clear.'
wlRefresh();wlRestore(gmBInitialHash);if(!['state','view','status','q'].some(k=>new URLSearchParams(gmBInitialHash.slice(1)).has(k)))wl.status=wl.summary.orders?'order':'all';buildList();if(wl.drawer)wlOpen(rowMap.get(selectedSku));else wlCloseDrawer({focus:false})

function wlSetMode(mode){setDecisionDetail(mode!=='simple',mode);wlMode(mode);wl.columns=mode==='simple'?WL_SIMPLE_COLUMNS.slice():mode==='custom'?wlNormalize(wl.customColumns):WL_DETAILED_COLUMNS.slice();wlStore();buildList()}
function wlSetSimple(on){wlSetMode(on?'simple':'detailed')}
function wlCommitColumns(){setDecisionDetail(true,'custom');const active=document.activeElement,option=active?.closest('.work-column-option'),body=active?.closest('.work-customize'),key=option?.dataset.key;wlMode('custom');wl.customColumns=[...wl.columns];wlStore();wlLayout();wlRenderRows();wlHash();for(const panel of wlRoot.querySelectorAll('.work-customize'))panel.wlRender?.();if(key&&body?.isConnected)body.querySelector('[data-key="'+key+'"] input')?.focus({preventScroll:true});for(const b of wlRoot.querySelectorAll('[data-density]'))b.setAttribute('aria-pressed',String(b.dataset.density==='custom'))}
function wlColumnPanel(compact=false){
 const body=node('div',null,'work-popover-body work-customize'),heading=node('div',null,'work-customize-heading'),list=node('div',null,'work-column-list'),live=node('span',null,'work-column-live');live.setAttribute('aria-live','polite');const done=wlBtn('Done',()=>{if(compact){wlCloseHeaderColumns();wl.headerTools.querySelector('button').focus();return}const d=document.querySelector('#column-customize');if(d){d.open=false;d.querySelector('summary')?.focus()}},'work-customize-done');heading.append(node('strong','Customize columns'),done,wlBtn('Reset',()=>{wlSetMode('detailed');if(compact){wlCloseHeaderColumns();wl.headerTools.querySelector('button').click();wl.columnPopup.querySelector('button').focus()}else{document.querySelector('#column-customize').open=true;document.querySelector('#column-customize .work-customize-heading button').focus()}}));body.append(heading,node('p','Drag to reorder, or use the arrows. Product stays first.'),list,live)
 let drag=null
 const order=()=>wlNormalize([...(wl.mode==='custom'?wl.customOrder:wl.columns),...wlColumns.map(c=>c[0])])
 const move=(key,target,focus='handle')=>{if(key==='product'||target==='product'||key===target)return;const all=order(),from=all.indexOf(key),to=all.indexOf(target);all.splice(from,1);all.splice(to,0,key);wl.customOrder=all;wl.columns=all.filter(k=>wl.columns.includes(k));wlCommitColumns();render();live.textContent=wlColumns.find(c=>c[0]===key)[1]+' moved';list.querySelector('[data-key="'+key+'"] .work-column-'+focus)?.focus({preventScroll:true})}
 const render=()=>{list.replaceChildren();const all=order();for(const [index,key]of all.entries()){
  const line=node('div',null,'work-column-option'),label=node('label'),check=node('input'),handle=wlBtn(key==='product'?'—':'⠿',()=>{},'work-column-handle');line.dataset.key=key;handle.setAttribute('aria-label',key==='product'?'Product is locked':'Drag '+wlColumns.find(c=>c[0]===key)[1]);handle.disabled=key==='product';handle.draggable=key!=='product';handle.addEventListener('keydown',e=>{if(e.key==='ArrowUp'&&index>1){e.preventDefault();move(key,all[index-1])}if(e.key==='ArrowDown'&&index>0&&index<all.length-1){e.preventDefault();move(key,all[index+1])}});check.type='checkbox';check.checked=wl.columns.includes(key);check.disabled=key==='product';check.addEventListener('change',()=>{wl.customOrder=all;wl.columns=all.filter(k=>k===key?check.checked:wl.columns.includes(k));wlCommitColumns();for(const c of wlRoot.querySelectorAll('.work-column-option input'))c.checked=wl.columns.includes(c.closest('[data-key]').dataset.key)});label.append(check,node('span',wlColumns.find(c=>c[0]===key)[1]));
  const up=wlBtn('↑',()=>move(key,all[index-1],'up')),down=wlBtn('↓',()=>move(key,all[index+1],'down'));up.className='work-column-up';down.className='work-column-down';up.setAttribute('aria-label','Move '+wlColumns.find(c=>c[0]===key)[1]+' up');down.setAttribute('aria-label','Move '+wlColumns.find(c=>c[0]===key)[1]+' down');up.disabled=index<2;down.disabled=key==='product'||index===all.length-1;line.append(handle,label,up,down);list.append(line)
  handle.addEventListener('dragstart',e=>{drag=key;e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move'});line.addEventListener('dragover',e=>{if(drag&&key!=='product'){e.preventDefault();e.dataTransfer.dropEffect='move'}});line.addEventListener('drop',e=>{e.preventDefault();if(drag)move(drag,key);drag=null});handle.addEventListener('dragend',()=>{drag=null})
  // Touch/pen use pointer capture; mouse keeps native HTML5 drag and drop.
  let pointer=null;handle.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||key==='product')return;pointer=e.pointerId;handle.setPointerCapture(pointer);line.dataset.dragging='true';e.preventDefault()});handle.addEventListener('pointermove',e=>{if(pointer!==e.pointerId)return;const rect=list.getBoundingClientRect();if(e.clientY<rect.top+32)body.scrollTop-=12;if(e.clientY>Math.min(rect.bottom,body.getBoundingClientRect().bottom)-32)body.scrollTop+=12});handle.addEventListener('pointerup',e=>{if(pointer!==e.pointerId)return;pointer=null;delete line.dataset.dragging;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.work-column-option');if(target)move(key,target.dataset.key)});handle.addEventListener('pointercancel',()=>{pointer=null;delete line.dataset.dragging})
 }};body.wlRender=render;render();if(compact){body.classList.add('work-header-checklist');body.setAttribute('aria-label','Add or remove columns');body.setAttribute('role','region');return body}return wlPopover('Customize columns…','column-customize',body)
}
document.body.dataset.tableDetail=wl.mode
