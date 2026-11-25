// Lifecycle: living. Offline first-run and print presentation only; no planning maths.
// Synthetic templates use the last six complete months, never a partial current month.
function firstRunTemplate(language='en',today=localToday()){
 const [year,month]=today.split('-').map(Number),months=Array.from({length:6},(_,i)=>new Date(Date.UTC(year,month-7+i,1)).toISOString().slice(0,7))
 const headers=language==='ar'?['اسم المنتج','الكمية','الوحدة','المورد']:['Product name','Stock on hand','Unit','Supplier']
 const rows=[[...headers,...months],...(language==='ar'?[['منتج تجريبي أ',5,'pieces','مورد تجريبي',10,12,11,10,12,11],['منتج تجريبي ب',8,'pieces','مورد تجريبي',4,5,4,5,4,5]]:[['Synthetic sample A',5,'pieces','Synthetic supplier',10,12,11,10,12,11],['Synthetic sample B',8,'pieces','Synthetic supplier',4,5,4,5,4,5]])]
 return '\uFEFF'+rows.map(row=>row.map(wlCsvCell).join(',')).join('\r\n')+'\r\n'
}
function firstRunAgeNotice(source,latest,today){
 const age=latest?dateOrdinal(today)-monthEndOrdinal(latest):null
 if(age===null||age<=45)return ''
 return ['sample','demo'].includes(source)?'Synthetic example data is '+age+' days old, not current stock. Use your own file for your planning snapshot.':'Sales data is '+age+' days old. Refresh your export and check current stock before ordering.'
}
const firstRun=node('section',null,'first-run');firstRun.id='first-run';firstRun.setAttribute('aria-label','Start with your file')
const firstRunActions=node('div',null,'first-run-actions'),firstRunSource=node('span'),firstRunImport=wlBtn('Use your own file',()=>{$('tools').open=true;$('file-panel').open=true;$('csv-file').click()})
firstRunImport.classList.add('primary');firstRunImport.id='use-own-file';firstRunActions.append(firstRunSource,firstRunImport)
const firstRunHint=node('div',null,'first-run-hint');firstRunHint.id='file-needs'
for(const text of ['Product name (product code optional)','Stock on hand, in the same unit as sales','3+ complete sales months (YYYY-MM columns)'])firstRunHint.append(node('div',text))
const firstRunTemplates=node('div',null,'first-run-templates')
for(const [language,label]of [['en','Download a template'],['ar','Arabic-header template (browser app)']]){const button=wlBtn(label,()=>wlDownload(firstRunTemplate(language),'inventory-manager-template-'+language+'.csv','text/csv;charset=utf-8'));button.id='template-'+language;button.title=language==='ar'?'Arabic headers work in the browser app; CLI/MCP need English headers. Use the English template.':'English headers work in the browser app, CLI and MCP.';firstRunTemplates.append(button)}
const firstRunAge=node('p',null,'first-run-age');firstRunAge.id='sales-age-warning';firstRunAge.setAttribute('role','status')
firstRun.append(firstRunActions,firstRunHint,firstRunTemplates,firstRunAge);wlSummary.before(firstRun)
function firstRunSync(){
 firstRunMethodSync()
 const sample=['sample','demo'].includes(sourceName);firstRunSource.textContent=(sourceName==='sample'?'Sample data':sourceName==='demo'?'Synthetic demo':'Local file')+' · v1.3.0-beta';firstRunHint.hidden=!sample;firstRunTemplates.hidden=!sample
 const ageNotice=firstRunAgeNotice(sourceName,data.months?.at(-1),currentToday)
 firstRunAge.hidden=!ageNotice;firstRunAge.textContent=ageNotice
 $('print-order').disabled=analysisIncomplete||!wlEmailGroups(currentRows).length
}
// Keep the complete list: grouping and eligibility come from the same copy/export path.
function printOrder(){
 if(analysisDeny())return
 if(currentToday!==localToday())render()
 const text=wlOrderText(currentRows),groups=wlEmailGroups(currentRows)
 if(!groups.length)return
 const sheet=node('article');sheet.id='print-order-sheet'
 sheet.append(node('h1','Order list · Inventory Manager'),node('p',$('snapshot').textContent),node('p','Draft only. Review stock, existing orders and supplier lead times before buying. Nothing has been sent.'))
 const warnings=[...new Set(groups.flatMap(([,rows])=>rows.flatMap(r=>[...(r.item.input_warnings||[]),...(r.guidance.expiry_warnings||[]),bigOrderWarning(r.guidance,settings),r.guidance.used_default_lead?'Supplier lead time missing: using '+r.guidance.lead_days+' days.':''].filter(Boolean))))]
 if(!firstRunAge.hidden)warnings.unshift(firstRunAge.textContent)
 sheet.append(node('pre',text))
 if(warnings.length){sheet.append(node('h2','Check before ordering'));const list=node('ul');for(const warning of warnings)list.append(node('li',warning));sheet.append(list)}
 document.getElementById('print-order-sheet')?.remove();document.body.append(sheet);document.body.classList.add('order-printing')
 try{window.print()}finally{document.body.classList.remove('order-printing');sheet.remove()}
}
const printOrderButton=wlBtn('Print order',printOrder);printOrderButton.id='print-order';$('copy-po').after(printOrderButton)
// Current and Auto are the low-choice path. The original picker, listeners,
// settings import and every experimental method remain intact behind disclosure.
const methodPicker=$('setting-forecast_method'),methodRow=methodPicker.closest('.setting-row'),methodMore=node('details',null,'more-methods'),methodQuick=node('div',null,'method-quick')
methodMore.id='more-methods';methodMore.append(node('summary','More methods'));methodMore.append(methodRow.querySelector('.setting-controls'));methodRow.append(methodQuick,methodMore)
methodQuick.setAttribute('role','group');methodQuick.setAttribute('aria-label','Forecast method')
for(const [value,label]of [['current','Current (default)'],['auto','Auto (experimental)']]){
 const button=wlBtn(label,()=>{methodPicker.value=value;methodPicker.dispatchEvent(new Event('change',{bubbles:true}))});button.dataset.quickMethod=value;methodQuick.append(button)
}
function firstRunMethodSync(){for(const button of methodQuick.children)button.setAttribute('aria-pressed',String(settings.forecast_method===button.dataset.quickMethod));if(!['current','auto'].includes(settings.forecast_method))methodMore.open=true}
const firstRunFields=gmSyncFields
gmSyncFields=function(...args){const result=firstRunFields(...args);firstRunMethodSync();return result}
const firstRunBuild=buildList
buildList=function(...args){const result=firstRunBuild(...args);firstRunSync();return result}
// Imported rows persist only after an explicit, fresh opt-in for this import.
const deviceDataKey='inventory-manager.device-data.v1',deviceDataLimit=2*1024*1024
let deviceImportedAt=null,deviceRestored=false,deviceHasSaved=false
const deviceControls=node('div',null,'device-data-controls'),deviceLabel=node('label'),deviceRemember=node('input'),deviceNotice=node('p'),deviceForget=wlBtn('Forget saved data',()=>{
 try{localStorage.removeItem(deviceDataKey);deviceHasSaved=false;deviceRemember.checked=false;deviceRestored=false;deviceNotice.textContent='Saved data forgotten. The open file stays in memory until you close or reload this page.';deviceForget.hidden=true;firstRunSync()}
 catch{deviceNotice.textContent='Could not forget saved data. Clear this browser’s site data before sharing this device.'}
})
deviceRemember.type='checkbox';deviceRemember.id='remember-device';deviceForget.id='forget-device-data';deviceNotice.id='device-data-notice';deviceNotice.setAttribute('role','status')
deviceLabel.append(deviceRemember,node('span','Remember this file on this device'));deviceControls.append(deviceLabel,deviceForget,deviceNotice);firstRun.append(deviceControls)
function deviceDataSync(){
 const sample=['sample','demo'].includes(sourceName)
 deviceLabel.hidden=sample
 if(sample){deviceRestored=false;deviceRemember.checked=false}
 else{
  $('snapshot').title='Local file; never uploaded. Imported data is saved only if you opt in.'
  for(const text of $('source-status').childNodes)if(text.nodeType===3)text.textContent=text.textContent.replace(' and is not saved.','.')
 }
 deviceForget.hidden=!deviceHasSaved
 if(deviceRestored)firstRunSource.textContent='Restored from this device · imported '+new Date(deviceImportedAt).toLocaleString()+' · v1.3.0-beta'
}
const deviceFirstRunSync=firstRunSync
firstRunSync=function(){deviceFirstRunSync();deviceDataSync()}
deviceRemember.addEventListener('change',()=>{
 if(!deviceRemember.checked){deviceForget.click();return}
 try{
  if(['sample','demo'].includes(sourceName)||!deviceImportedAt)throw Error('Import your own file first.')
  const encoded=JSON.stringify({version:1,imported_at:deviceImportedAt,name:sourceName,data})
  // At most 2 MiB of UTF-16 code units (~4 MiB browser quota), before setItem.
  if(encoded.length>deviceDataLimit)throw Error('This file is too big to remember on this device. Import it again next time.')
  localStorage.setItem(deviceDataKey,encoded);deviceHasSaved=true;deviceNotice.textContent='Saved data stays in this browser on this device. Forget it before sharing this device.'
 }catch(error){deviceRemember.checked=false;deviceNotice.textContent=error.message?.startsWith('This file is too big')?error.message:'Could not save data in this browser. Import your file again next time.'}
 deviceDataSync()
})
const deviceImportStatus=stockImportStatus
stockImportStatus=function(result,file){
 deviceImportStatus(result,file);deviceImportedAt=new Date().toISOString();deviceRestored=false;deviceRemember.checked=false
 deviceNotice.textContent=deviceHasSaved?'A previously saved file remains on this device. Use Forget saved data to remove it.':'Optional: saves imported data in this browser on this device. Leave unticked on a shared device.'
 deviceDataSync()
}
try{
 const raw=sourceName==='demo'?null:localStorage.getItem(deviceDataKey);deviceHasSaved=raw!==null
 if(raw){
  if(raw.length>deviceDataLimit)throw Error('Saved data is too big.')
  const saved=JSON.parse(raw),restored=saved?.data
  if(saved.version!==1||typeof saved.name!=='string'||!saved.name||['sample','demo'].includes(saved.name)||typeof saved.imported_at!=='string'||!Number.isFinite(Date.parse(saved.imported_at))||!Array.isArray(restored?.items)||restored.items.length>10000||restored.items.some(item=>!item||typeof item.sku!=='string'||!Array.isArray(item.monthly_sales)))throw Error('Invalid saved data.')
  validateDataset(restored)
  data=restored;sourceName=saved.name;deviceImportedAt=saved.imported_at;deviceRestored=true;deviceRemember.checked=true
  deviceNotice.textContent='Saved data stays in this browser on this device. This is a snapshot, not live stock.'
  render();smartImportUI.status({parsed:data,smart:false},{name:sourceName})
 }
}catch{deviceNotice.textContent='Could not restore saved data. Import your file again, or forget the saved copy.'}
firstRunMethodSync();firstRunSync();gmSnapshotLabel()
