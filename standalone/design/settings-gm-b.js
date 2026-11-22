// Lifecycle: living. Arctic settings UI; all validation/resolution stays in the core.
const gmSettingLabels={
  shelf_life_days:['Total shelf life (days)','Global assumption for every product without its own value. Blank disables the global total. Sets a shelf-life order cap; not a safety/compliance control.'],
  arrival_age_days:['Age on arrival (days)','Life already used at delivery. Blank uses 0 when a total shelf life is set.'],
  min_remaining_life_days:['Minimum remaining life (days)','Life the customer still requires. Blank uses 0 when a total shelf life is set.'],
  default_delivery_days:['Default lead time','Lead time — days from order to delivery. Used when the file has no lead time.'],
  supplier_days:['Lead time','Days from order to delivery.'],
  months_of_cover:['Months of cover','How long an order should last after delivery.'],
  review_days:['Review period','How often you place orders, in days.'],
  buffer_days:['Buffer days — extra demand cover','Optional extra days of demand on top of safety stock. Default 0 days; adds units without moving the order deadline.'],
  service_level:['Chance of not running out per order cycle','Model-based chance of avoiding a stock-out in one order cycle; not a guaranteed fill rate.'],
  safety_stock_basis:['Safety stock basis','Sales variation keeps the current buffer. Past forecast misses uses this product’s own historical errors; experimental, falls back with fewer than 8 errors. Not a guaranteed service level.'],
  forecast_method:['Method','Current keeps the existing forecast. Alternative methods are experimental and may change order estimates.'],
  industry_preset:['Industry preset (optional)','Experimental advice only. Suggests a method; does not change ordering settings or apply a method automatically.'],
  stockout_adjust:['Correct for out-of-stock months','Off by default pending Nov actuals. Replace flagged sales months with their trailing non-flagged median for order guidance only.'],
  include_backup_in_orders:['Include safety stock in orders','Extra stock for delays or surprise demand, included by default.'],
  urgent_days:['Order now within N days','Days until you must order, after allowing for lead time.'],
  running_low_days:['Running low within N days','Days until you must order. Uses the order deadline, not the physical run-out date.'],
  overstock_months:['Overstock above N months','Flag stock covering more than this many months.'],
  big_order_months:['Big order above N months','Warn when the suggested order covers more than this many months.'],
  order_cost:['Order cost','Cost of placing one order. Optional EOQ input; blank disables EOQ.'],
  holding_pct:['Holding cost %','Annual cost of keeping stock, as a percentage of unit cost. EOQ input.'],
  minimum_order:['MOQ','Smallest order the supplier accepts.'],
  pack_size:['Pack size','Order in multiples of this quantity.'],
  unit_cost:['Unit cost','What one unit costs you. Optional EOQ input.'],
  profit_suggestion:['Most profitable order (experimental)','Separate order-now simulation for one review period; never replaces the current amount. Needs sale price and unit cost. Off by default.'],
  sale_price:['Sale price','Selling price per unit; same currency as unit cost. Optional profit input.'],
  shelf_life_days:['Shelf life (days)','Usable lifetime from receipt/production; optional simulation input.'],
  arrival_age_days:['Age on arrival (days)','Lifetime already used when stock arrives.'],
  min_remaining_life_days:['Minimum remaining life (days)','Remaining life customers require.'],
  salvage_pct:['Salvage %','Percentage of unit cost recovered from unsold expired units. Default 0.'],
}
const gmExistingInputs={default_delivery_days:'delivery-days',months_of_cover:'cover-months',buffer_days:'buffer-days',service_level:'service-level'}
const gmSettingsSheet=node('dialog',null,'settings-sheet');gmSettingsSheet.id='settings-sheet';gmSettingsSheet.setAttribute('aria-labelledby','settings-sheet-title')
const gmSheetHeader=node('header'),gmSheetTitle=node('h2','Settings');gmSheetTitle.id='settings-sheet-title'
const gmSheetClose=node('button','Close');gmSheetClose.type='button';gmSheetClose.addEventListener('click',()=>gmSettingsSheet.close());gmSheetHeader.append(gmSheetTitle,gmSheetClose)
const gmSheetContent=node('div',null,'settings-sheet-content');gmSheetContent.append(node('p','Changes apply live. Scroll for all settings.','settings-scroll-hint'));gmSettingsSheet.append(gmSheetHeader,gmSheetContent);document.body.append(gmSettingsSheet)
const gmSettingsRoot=$('settings'),gmGlobalContent=node('div'),gmSupplierContent=node('div');gmSupplierContent.hidden=true
const gmOldSummary=gmSettingsRoot.querySelector('summary');gmOldSummary.textContent='Settings';gmSettingsRoot.open=true;gmOldSummary.hidden=true
const gmOldBody=gmSettingsRoot.querySelector('.detail-body'),gmOldInputs=new Map(Object.entries(gmExistingInputs).map(([key,id])=>[key,$(id)]))
const gmStorageStatus=$('storage-status'),gmOldError=$('settings-error'),gmResetAll=$('reset-settings')
// Existing controls retain their tested live listeners and stable IDs.
gmOldBody.replaceChildren();gmGlobalContent.append(gmSettingsRoot);gmSheetContent.append(gmGlobalContent,gmSupplierContent)
const gmSettingsAction=node('button','Settings');gmSettingsAction.id='open-settings';gmSettingsAction.type='button';gmSettingsAction.addEventListener('click',()=>gmOpenSettings());document.querySelector('.tools-body').prepend(gmSettingsAction)
let gmSettingsScope=null,gmSettingsDataset=null,gmDatasetSettingsKey='',gmSheetReturnFocus=null
function gmSettingsKey(dataset){
  // Dataset fingerprint, not a security hash. No CSV contents are persisted.
  const text=JSON.stringify(dataset);let hash=2166136261
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return 'stock-runway.standalone.order-settings.v2:'+text.length+':'+(hash>>>0).toString(16)
}
function gmPortableSettings(){return JSON.parse(JSON.stringify(settings))}
function gmLoadDatasetSettings(){
  if(gmSettingsDataset===data)return
  gmSettingsDataset=data;gmDatasetSettingsKey=gmSettingsKey(data)
  let saved=null
  try{saved=JSON.parse(localStorage.getItem(gmDatasetSettingsKey));if(!saved&&sourceName==='sample')saved=JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{}
  settings=normalizeOrderSettings(saved||DEFAULT_ORDER_SETTINGS);syncSettings();gmSyncFields()
}
function gmSaveField(key,raw,scope,input,error){
  let value=['forecast_method','industry_preset','safety_stock_basis'].includes(key)?raw:input.type==='checkbox'?input.checked:raw===''?null:Number(raw)
  const inherit=scope&&raw==='',clearShelf=!scope&&OPTIONAL_SETTING_FIELDS.includes(key)&&raw===''
  const valid=!input.validity.badInput&&(inherit||clearShelf||(scope?validProductSettingField(key,value,scope.group):validSettingField(key,value)))
  input.setAttribute('aria-invalid',String(!valid));error.hidden=valid
  const range=SETTING_RANGES[key]
  error.textContent=valid?'':['forecast_method','industry_preset','safety_stock_basis'].includes(key)?'Choose a listed option. Previous setting kept.':range?`Enter ${range[2]?'a whole number':'a number'} from ${range[0]} to ${range[1]}. Previous setting kept.`:'Enter 0.000001 to 1000000000000, with at most six decimal places. Previous setting kept.'
  if(!valid)return
  const next=gmPortableSettings()
  if(scope){
    const {group,id}=scope,entries={...next[group]},entry={...(Object.hasOwn(entries,id)?entries[id]:{})}
    if(inherit)delete entry[key];else entry[key]=value
    if(Object.keys(entry).length)Object.defineProperty(entries,id,{value:entry,enumerable:true,configurable:true,writable:true});else delete entries[id]
    next[group]=entries
  }else if(clearShelf)delete next[key];else next[key]=value
  const focused=input.id,openAbout=!!document.querySelector('.about[open]')
  saveSettings(next)
  if(scope?.group==='product_overrides'){
    if(openAbout)document.querySelector('.about').open=true
    const replacement=$(focused);replacement?.focus({preventScroll:true})
  }
}
function gmSettingsField(key,scope=null,existing=null){
  const wrap=node('div',null,'setting-row'),label=node('label'),[title,meaning]=gmSettingLabels[key]
  const id=existing?.id||'setting-'+(scope?.group==='product_overrides'?'product-':scope?'supplier-':'')+key
  label.htmlFor=id;label.append(node('span',title,'setting-title'),node('small',meaning,'setting-meaning'))
  const methodField=['forecast_method','industry_preset','safety_stock_basis'].includes(key)
  let input=existing||node(key==='service_level'||methodField?'select':'input');input.id=id
  if(!existing){
    if(methodField){
      const lib=globalThis.StockRunwayForecastMethods
      const options=key==='safety_stock_basis'?{sales_variation:'Sales variation (default)',forecast_misses:'Past forecast misses (experimental)'}:key==='forecast_method'?Object.fromEntries(['current','recommended','auto',...lib.METHODS.filter(m=>!['current','auto'].includes(m))].map(m=>[m,m==='current'?'Current (default)':m==='recommended'?'Recommended per product':m==='auto'?'Auto by demand type (experimental)':m==='sba'?'Croston-SBA':lib.METHOD_LABELS[m]||m])):{none:'None',...Object.fromEntries(Object.entries(lib.PRESETS).map(([slug,p])=>[slug,p.label||({'distributor':'Distributor','retail':'Retail','spare-parts':'Spare parts','restaurant':'Restaurant','pharmacy':'Pharmacy','seasonal':'Seasonal','ecommerce':'Ecommerce'}[slug]||slug)]))}
      for(const [value,title]of Object.entries(options)){const option=node('option',title);option.value=value;input.append(option)}
    }else if(key==='service_level'){
      if(scope){const option=node('option','Inherit');option.value='';input.append(option)}
      for(const v of [.9,.95,.99]){const option=node('option',`${v*100}%`);option.value=String(v);input.append(option)}
    }else if(['include_backup_in_orders','stockout_adjust','profit_suggestion'].includes(key)){input.type='checkbox';input.setAttribute('role','switch')}
    else{input.type='number';const range=SETTING_RANGES[key]||PROFIT_OPTIONAL_RANGES[key]||[.000001,1e12,false];input.min=scope?.group==='product_overrides'&&key==='shelf_life_days'?0:range[0];input.max=range[1];input.step=range[2]?'1':['minimum_order','pack_size'].includes(key)?'.000001':'any';input.inputMode=range[2]?'numeric':'decimal';if(scope)input.placeholder='Inherit'}
  }
  input.dataset.settingKey=key;if(scope){input.dataset.settingGroup=scope.group;input.dataset.settingId=scope.id}
  const controls=node('div',null,'setting-controls'),reset=node('button','Reset');reset.type='button';reset.setAttribute('aria-label','Reset '+title)
  const error=node('p',null,'setting-error');error.id=id+'-error';error.hidden=true;error.setAttribute('role','alert');input.setAttribute('aria-describedby',id+'-help '+error.id);label.querySelector('small').id=id+'-help'
  if(!existing)input.addEventListener(input.tagName==='SELECT'||input.type==='checkbox'?'change':'input',()=>gmSaveField(key,input.value.trim(),scope,input,error))
  else input.addEventListener('input',()=>{const valid=input.getAttribute('aria-invalid')!=='true';error.hidden=valid;error.textContent=valid?'':$('settings-error').textContent})
  reset.addEventListener('click',()=>{
    const next=gmPortableSettings()
    if(scope){const entries={...next[scope.group]},entry={...(Object.hasOwn(entries,scope.id)?entries[scope.id]:{})};delete entry[key];if(Object.keys(entry).length)Object.defineProperty(entries,scope.id,{value:entry,enumerable:true});else delete entries[scope.id];next[scope.group]=entries}
    else next[key]=key==='big_order_months'?6:DEFAULT_ORDER_SETTINGS[key]
    const about=!!document.querySelector('.about[open]');saveSettings(next);syncSettings();gmSyncFields();error.hidden=true;input.removeAttribute('aria-invalid');if(about)document.querySelector('.about').open=true
  })
  controls.append(input,reset);wrap.append(label,controls,error)
  if(scope?.group==='product_overrides'&&key==='shelf_life_days'){
    const disable=node('button','No shelf-life cap');disable.type='button';disable.dataset.noShelfLife=scope.id
    disable.addEventListener('click',()=>{const next=gmPortableSettings(),entries={...next.product_overrides},entry={...(Object.hasOwn(entries,scope.id)?entries[scope.id]:{})};entry.shelf_life_days=null;Object.defineProperty(entries,scope.id,{value:entry,enumerable:true,configurable:true,writable:true});next.product_overrides=entries;saveSettings(next);gmSyncFields()})
    controls.append(disable);wrap.append(node('small','Blank inherits. 0 or No shelf-life cap explicitly disables the cap for this product, even with a global value. Actual lot expiry warnings remain.','setting-meaning'))
  }
  if(scope?.group==='product_overrides'){
    const effective=resolveOrderSettings(rowMap.get(scope.id)?.item||{},settings),value=effective.values[key],source=effective.sources[key],disabledShelf=key==='shelf_life_days'&&Object.hasOwn(settings.product_overrides[scope.id]||{},key)&&noShelfLife(settings.product_overrides[scope.id][key])
    wrap.append(node('p',`${disabledShelf?'No shelf-life cap':value==null?'Not set':key==='service_level'?value*100+'%':value+(['supplier_days','review_days'].includes(key)?' days':'')} · ${source}`,'setting-source'))
    wrap.lastChild.dataset.provenance=key
  }
  return wrap
}
function gmSettingsGroup(title,keys,advanced=false){
  const group=node(advanced?'details':'section',null,'settings-group');group.append(node(advanced?'summary':'h3',title))
  for(const key of keys)group.append(gmSettingsField(key,null,gmOldInputs.get(key)))
  return group
}
gmOldBody.append(gmSettingsGroup('Ordering',['default_delivery_days','months_of_cover','review_days','buffer_days']),gmSettingsGroup('Safety stock',['service_level','include_backup_in_orders']))
const gmSafetyPreview=node('p',null,'settings-preview');gmSafetyPreview.id='safety-preview';gmSafetyPreview.setAttribute('role','status');gmOldBody.lastChild.append(gmSafetyPreview)
// Product-interface thesis: review concrete global changes before a one-time apply.
// Existing advisory names remain independent and importable; no preset name drives maths.
let gmSettingPresetPending=null,gmSettingPresetUndo=null
const gmIndustryGroup=node('section',null,'settings-group');gmIndustryGroup.id='industry-setting-presets'
gmIndustryGroup.append(node('h3','Industry starting points'),node('p','These presets are setup guides for ordering cadence, verified shelf-life prompts and explanations. They do not change order amounts on their own from General defaults. Confirming explicit ordinary-setting changes (such as a cover floor or resetting custom General settings) can change amounts; review the impact below. Product and supplier overrides stay unchanged.','setting-meaning'))
const gmIndustryButtons=node('div',null,'settings-transfer'),gmIndustryPreview=node('section'),gmIndustryStatus=node('p',null,'settings-preview')
gmIndustryPreview.tabIndex=-1;gmIndustryPreview.id='industry-preset-preview';gmIndustryPreview.hidden=true;gmIndustryPreview.setAttribute('aria-label','Preview industry setting changes');gmIndustryStatus.setAttribute('role','status');gmIndustryStatus.tabIndex=-1
const gmPresetValue=value=>value===undefined?'Not set':String(value)
function gmCloseSettingPreset(){gmSettingPresetPending=null;gmIndustryPreview.hidden=true;gmIndustryPreview.replaceChildren();for(const button of gmIndustryButtons.querySelectorAll('button'))button.setAttribute('aria-pressed','false')}
for(const [slug,preset] of Object.entries(INDUSTRY_SETTING_PRESETS)){
  const button=node('button',preset.label);button.type='button';button.dataset.settingPreset=slug;button.setAttribute('aria-pressed','false')
  button.addEventListener('click',()=>{
    for(const choice of gmIndustryButtons.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(choice===button))
    const before=gmPortableSettings(),preview=previewIndustryPreset(before,slug,data,currentToday)
    gmSettingPresetPending={before,preview,dataset:data};gmIndustryPreview.replaceChildren(node('h4','Preview: '+preset.label),node('p','How often do you place orders? Using your existing '+before.review_days+'-day order interval (review days). Change Ordering settings first if different; presets never change this interval.','setting-meaning'),node('p','Product and supplier overrides and global shelf assumptions stay unchanged. Enter verified shelf life only in the applicable product settings or import shelf/lot/expiry columns. Leave unknown shelf life blank; choose No shelf-life cap for nonperishables. Not a safety/compliance control.','setting-meaning'))
    const impact=node('p',industryPresetImpactText(preview));impact.id='industry-preset-impact';gmIndustryPreview.append(impact)
    if(preview.blocked)gmIndustryPreview.append(node('p',preview.blocked))
    for(const change of preview.changes){const row=node('p');row.append(node('strong',change.setting+': '+gmPresetValue(change.old)+' → '+gmPresetValue(change.new)),node('small',change.why,'setting-meaning'));gmIndustryPreview.append(row)}
    if(!preview.changes.length)gmIndustryPreview.append(node('p','No global settings would change.'))
    const confirm=node('button','Confirm apply'),cancel=node('button','Cancel');confirm.type=cancel.type='button';confirm.id='confirm-setting-preset';cancel.id='cancel-setting-preset';confirm.disabled=!!preview.blocked||!preview.changes.length
    confirm.addEventListener('click',()=>{
      const pending=gmSettingPresetPending
      if(!pending||pending.preview.blocked||pending.dataset!==data||JSON.stringify(pending.before)!==JSON.stringify(gmPortableSettings())){gmCloseSettingPreset();gmIndustryStatus.textContent='Settings or dataset changed. Choose the starting point again to review fresh changes.';gmIndustryStatus.focus();return}
      saveSettings(pending.preview.next);gmSyncFields();gmSettingPresetUndo={before:pending.before,after:JSON.stringify(gmPortableSettings()),dataset:data};gmUndoSettingPreset.disabled=false;gmCloseSettingPreset();gmIndustryStatus.textContent=pending.preview.label+' applied. You can undo until settings or dataset change.';gmIndustryStatus.focus()
    })
    cancel.addEventListener('click',()=>{gmCloseSettingPreset();button.focus()});gmIndustryPreview.append(confirm,cancel);gmIndustryPreview.hidden=false
    gmIndustryPreview.focus()
  });gmIndustryButtons.append(button)
}
const gmUndoSettingPreset=node('button','Undo preset');gmUndoSettingPreset.type='button';gmUndoSettingPreset.id='undo-setting-preset';gmUndoSettingPreset.disabled=true
gmUndoSettingPreset.addEventListener('click',()=>{const previous=gmSettingPresetUndo;if(!previous||previous.dataset!==data||previous.after!==JSON.stringify(gmPortableSettings()))return;saveSettings(previous.before);gmSyncFields();gmSettingPresetUndo=null;gmUndoSettingPreset.disabled=true;gmCloseSettingPreset();gmIndustryStatus.textContent='Previous settings restored exactly.';gmIndustryStatus.focus()})
gmIndustryGroup.append(gmIndustryButtons,gmIndustryPreview,gmUndoSettingPreset,gmIndustryStatus)
const gmForecastGroup=gmSettingsGroup('Forecast method',['forecast_method','industry_preset','safety_stock_basis']);gmForecastGroup.id='forecast-method-settings'
const gmPresetNote=node('p',null,'settings-preview');gmPresetNote.id='forecast-preset-note';gmPresetNote.setAttribute('role','status')
const gmApplyPreset=node('button','Use suggested method');gmApplyPreset.type='button';gmApplyPreset.id='apply-forecast-preset';gmApplyPreset.hidden=true
gmApplyPreset.addEventListener('click',()=>{const preset=globalThis.StockRunwayForecastMethods.PRESETS[settings.industry_preset];if(preset){saveSettings({...gmPortableSettings(),forecast_method:preset.method});gmSyncFields()}})
gmForecastGroup.append(gmPresetNote,gmApplyPreset);gmOldBody.prepend(gmForecastGroup,gmIndustryGroup)
gmOldBody.append(gmSettingsGroup('Global shelf-life assumptions',OPTIONAL_SETTING_FIELDS),gmSettingsGroup('Alerts',['urgent_days','running_low_days','overstock_months','big_order_months']),gmSettingsGroup('Advanced',['stockout_adjust','profit_suggestion','order_cost','holding_pct'],true),gmOldError,gmStorageStatus)
const gmTransfer=node('div',null,'settings-transfer'),gmExport=node('button','Export settings'),gmImport=node('button','Import settings'),gmImportInput=node('input'),gmImportStatus=node('p',null,'setting-error')
gmExport.type=gmImport.type='button';gmExport.id='export-settings';gmImport.id='import-settings';gmImportInput.type='file';gmImportInput.accept='.json,application/json';gmImportInput.hidden=true;gmImportInput.id='settings-file';gmImportStatus.id='import-settings-status';gmImportStatus.setAttribute('role','status')
gmExport.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(validateOrderSettings(gmPortableSettings()),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='inventory-manager-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
gmImport.addEventListener('click',()=>gmImportInput.click())
gmImportInput.addEventListener('change',async()=>{const file=gmImportInput.files[0],dataset=data;if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Settings JSON must be no larger than 2 MiB.');const next=validateOrderSettings(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));if(dataset!==data)throw new Error('Dataset changed. Import again.');saveSettings(next);syncSettings();gmSyncFields();for(const e of gmGlobalContent.querySelectorAll('[aria-invalid]'))e.removeAttribute('aria-invalid');for(const e of gmGlobalContent.querySelectorAll('.setting-row .setting-error'))e.hidden=true;gmOldError.hidden=true;gmImportStatus.textContent='Settings imported.'}catch(error){gmImportStatus.textContent='Could not import settings: '+error.message+' Previous settings kept.'}finally{gmImportInput.value=''}})
gmResetAll.textContent='Reset all';gmResetAll.addEventListener('click',()=>{gmSyncFields();for(const e of gmGlobalContent.querySelectorAll('[aria-invalid]'))e.removeAttribute('aria-invalid');for(const e of gmGlobalContent.querySelectorAll('.setting-row .setting-error'))e.hidden=true;gmImportStatus.textContent=''});gmTransfer.append(gmResetAll,gmExport,gmImport,gmImportInput);gmOldBody.append(gmTransfer,gmImportStatus)
function gmSyncFields(){
  gmUndoSettingPreset.disabled=!gmSettingPresetUndo||gmSettingPresetUndo.dataset!==data||gmSettingPresetUndo.after!==JSON.stringify(gmPortableSettings())
  for(const input of document.querySelectorAll('[data-setting-key]')){
    const key=input.dataset.settingKey,group=input.dataset.settingGroup,id=input.dataset.settingId
    const value=group?(Object.hasOwn(settings[group]||{},id)?settings[group][id][key]:undefined):settings[key]??(key==='big_order_months'?6:undefined)
    if(input.type==='checkbox')input.checked=value===true;else input.value=group==='product_overrides'&&key==='shelf_life_days'&&value!==undefined&&noShelfLife(value)?'0':value??''
  }
  gmUpdateSafetyPreview()
  gmUpdatePresetNote()
}
function gmUpdatePresetNote(){
  const preset=globalThis.StockRunwayForecastMethods.PRESETS[settings.industry_preset]
  gmPresetNote.textContent=preset?`Experimental suggestion: ${globalThis.StockRunwayForecastMethods.METHOD_LABELS[preset.method]||preset.method}. ${preset.note||''} Choosing a preset does not apply a method or tune ordering settings.`:'Opt-in only. Current preserves the existing forecast; industry presets are advisory, not validated recommendations.'
  if(settings.forecast_method==='recommended')gmPresetNote.textContent='Opt-in synthetic-tested selector: each product can use a different method. Method and reason appear in its report. Ranges and probabilities are withheld in this mode, even when Current is picked; no selected-model calibration is claimed. Past forecast misses falls back to Sales variation.'
  gmApplyPreset.hidden=!preset;gmApplyPreset.disabled=!preset||settings.forecast_method===preset.method
  if(preset&&settings.forecast_method===preset.method)gmPresetNote.textContent+=' Suggested method is selected.'
}
function gmUpdateSafetyPreview(){
  const row=rowMap.get(selectedSku);if(!row)return
  const without=orderGuidance(row.item,currentToday,{...settings,include_backup_in_orders:false},data.as_of),withSafety=orderGuidance(row.item,currentToday,{...settings,include_backup_in_orders:true},data.as_of)
  gmSafetyPreview.textContent=`${row.item.name}: ${orderAmount(without.quantity??0)} → ${orderAmount(withSafety.quantity??0)} ${row.item.unit} with safety stock (${settings.include_backup_in_orders?'included':'not included'} in orders).`
}
function gmOpenSettings(supplier=null){
  gmSheetReturnFocus=document.activeElement;gmSettingsScope=supplier?{group:'supplier_overrides',id:supplier}:null
  gmGlobalContent.hidden=!!supplier;gmSupplierContent.hidden=!supplier;gmSheetTitle.textContent=supplier?'Supplier settings':'Settings'
  if(supplier){gmSupplierContent.replaceChildren(node('p',supplier,'setting-title'),node('p','Products inherit these values unless a product setting is present. Blank or Reset inherits the value from file, then the global default.','setting-meaning'));for(const key of OVERRIDE_FIELDS.supplier_overrides)gmSupplierContent.append(gmSettingsField(key,gmSettingsScope))}
  gmSyncFields();$('tools').open=false;gmSettingsSheet.showModal()
}
gmSettingsSheet.addEventListener('close',()=>gmSheetReturnFocus?.isConnected&&gmSheetReturnFocus.focus({preventScroll:true}))
gmSettingsSheet.addEventListener('click',event=>{if(event.target===gmSettingsSheet&&event.clientX<gmSettingsSheet.getBoundingClientRect().left)gmSettingsSheet.close()})
// Preserve settings across product recalculation, not just the four original controls.
saveSettings=function(next){settings=normalizeOrderSettings(next);try{localStorage.setItem(gmDatasetSettingsKey,JSON.stringify(gmPortableSettings()));gmStorageStatus.textContent='Settings saved for this dataset on this device. CSV contents are not saved.'}catch{gmStorageStatus.textContent='Settings could not be saved. Changes still apply in this tab.'}render();gmUndoSettingPreset.disabled=!gmSettingPresetUndo||gmSettingPresetUndo.dataset!==data||gmSettingPresetUndo.after!==JSON.stringify(gmPortableSettings());gmUpdateSafetyPreview();gmUpdatePresetNote()}
const gmSettingsRender=render
render=function(){gmLoadDatasetSettings();return gmSettingsRender()}
const gmSettingsPanel=chartPanel
chartPanel=function(row){
  const panel=gmSettingsPanel(row),body=panel.querySelector('.about .detail-body'),group=node('section',null,'product-settings')
  group.append(node('h3','Product settings'),node('p','Product setting → supplier setting → from file → default. Blank or Reset inherits the next value.','setting-meaning'))
  for(const key of OVERRIDE_FIELDS.product_overrides)group.append(gmSettingsField(key,{group:'product_overrides',id:row.item.sku}))
  body.append(group)
  const meta=panel.querySelector('.product-meta')||node('p',null,'product-meta');if(!meta.isConnected&&!meta.parentNode)panel.querySelector('.product-heading').append(meta)
  if(row.item.supplier){const b=node('button','Settings','supplier-settings-link');b.type='button';b.setAttribute('aria-label','Settings for supplier '+row.item.supplier);b.addEventListener('click',()=>gmOpenSettings(row.item.supplier));meta.append(' · ',b)}
  if(resolveOrderSettings(row.item,settings).custom)meta.append(node('span',' · Custom settings','custom-setting-marker'))
  // Panel is detached; initialise product inputs here rather than document-wide.
  for(const input of group.querySelectorAll('[data-setting-key]')){const value=settings.product_overrides[row.item.sku]?.[input.dataset.settingKey];if(input.type==='checkbox')input.checked=value===true;else input.value=input.dataset.settingKey==='shelf_life_days'&&value!==undefined&&noShelfLife(value)?'0':value??''}
  return panel
}
const gmSettingsHeading=gmSectionHeading
gmSectionHeading=function(section,sticky=false){const h=gmSettingsHeading(section,sticky);if(gmBrowse.group==='supplier'&&!section.missing){const b=node('button','Settings','supplier-settings-link');b.type='button';b.setAttribute('aria-label','Settings for supplier '+section.label);b.addEventListener('click',()=>gmOpenSettings(section.label));h.append(b)}return h}
const gmSettingsProductButton=gmProductButton
gmProductButton=function(row){const b=gmSettingsProductButton(row);if(resolveOrderSettings(row.item,settings).custom){b.dataset.custom='true';b.querySelector('.sku-name').append(node('span',' · Custom','custom-setting-marker'))}return b}
render();gmSyncFields()
