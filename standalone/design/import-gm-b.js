// Lifecycle: living. Arctic preflight uses the existing native sheet pattern.
// Report values are inserted as text, never HTML; rejected rows stay in memory only.
// Rejections must remain visible even when the Tools upload menu is closed.
// Native modality makes background content inert, but Chromium still lets Tab
// visit browser chrome at the boundary. Keep the app's modal keyboard loop local.
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||event.metaKey||event.ctrlKey||event.altKey)return
  const dialog=[...document.querySelectorAll('dialog:modal')].at(-1);if(!dialog)return
  const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility()&&!el.closest('[inert]'))
  const index=controls.indexOf(document.activeElement)
  if(!controls.length){event.preventDefault();dialog.tabIndex=-1;dialog.focus();return}
  if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus()}
},true)
document.body.append($('file-error'));$('file-error').classList.add('import-error-banner')
const importCheck=node('dialog',null,'settings-sheet import-check');importCheck.id='import-check';importCheck.setAttribute('aria-labelledby','import-check-title')
const importHeader=node('header'),importTitle=node('h2','Import check');importTitle.id='import-check-title'
const importClose=node('button','×','sheet-close');importClose.type='button';importClose.setAttribute('aria-label','Cancel import');importHeader.append(importTitle,importClose)
const importBody=node('div',null,'settings-sheet-content'),importFile=node('p',null,'import-file'),importSummary=node('p',null,'import-summary');importSummary.id='import-check-summary';importSummary.setAttribute('aria-live','polite')
const importLists=node('div'),importActions=node('div',null,'import-actions'),importConfirm=node('button'),importCancel=node('button','Cancel'),importDownload=node('button','Download set-aside rows (CSV)')
importConfirm.id='import-check-confirm';importCancel.id='import-check-cancel';importDownload.id='import-check-download';for(const b of [importConfirm,importCancel,importDownload])b.type='button'
importActions.append(importConfirm,importCancel);importBody.append(importFile,importSummary,node('p','Review what will be used. Your current products stay unchanged until you import.','import-note'),importLists,importDownload);importCheck.append(importHeader,importBody,importActions);document.body.append(importCheck)
let importPending=null
const importCount=n=>n.toLocaleString('en-GB')
function importSection(title,values,format){
  if(!values.length)return
  const details=node('details'),summary=node('summary',title+' · '+importCount(values.length)),list=node('ul');details.append(summary,list)
  // Expand lazily; a 10,000-row problem file must not create 10,000 DOM nodes.
  let shown=0
  const more=node('button','Show next 100');more.type='button'
  const append=()=>{const end=Math.min(shown+100,values.length);for(;shown<end;shown++)list.append(node('li',format(values[shown])));more.hidden=shown===values.length}
  more.addEventListener('click',append);details.addEventListener('toggle',()=>{if(details.open&&!shown)append()});append();details.append(more);importLists.append(details)
}
function importSetAsideCsv(report){
  const safe=value=>{const s=String(value??'');return /^[=+\-@\t\r]/.test(s)?"'"+s:s}
  const rows=[['Source row','Reason',...report.source_headers],...report.rows_set_aside.map(r=>[String(r.row),r.reason,...r.values])]
  return '\uFEFF'+rows.map(r=>r.map(v=>'"'+safe(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n'
}
importDownload.addEventListener('click',()=>{
  if(!importPending)return
  const blob=new Blob([importSetAsideCsv(importPending.report)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='stock-runway-set-aside.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
})
function finishImportCheck(accepted=false){if(!importPending)return;const pending=importPending;importPending=null;if(importCheck.open)importCheck.close();pending.resolve(accepted);if(pending.focus?.isConnected)pending.focus.focus()}
importClose.addEventListener('click',()=>finishImportCheck(false));importCancel.addEventListener('click',()=>finishImportCheck(false));importConfirm.addEventListener('click',()=>finishImportCheck(true));importCheck.addEventListener('cancel',event=>{event.preventDefault();finishImportCheck(false)});importCheck.addEventListener('close',()=>{if(!importCheck.open)finishImportCheck(false)})
function confirmStockImport(parsed,file){
  if(!parsed.import_report)return Promise.resolve(true)
  finishImportCheck(false)
  const report=parsed.import_report,n=report.products_ready,productWord=n===1?'product':'products'
  importFile.textContent=file.name
  importSummary.textContent=`${importCount(n)} ${productWord} ready · ${importCount(report.rows_set_aside.length)} set aside · ${importCount(report.ignored.length)} columns ignored`
  importConfirm.textContent=`Import ${importCount(n)} ${productWord}`;importConfirm.disabled=!n
  importDownload.hidden=!report.rows_set_aside.length;importLists.replaceChildren()
  importSection('Columns matched',report.matched,r=>`${r.source} → ${r.field}`)
  importSection('Columns ignored',report.ignored,x=>x)
  importSection('Defaults',report.defaulted,r=>`${r.field} → ${r.value===null?'unknown':r.value} (${r.reason})`)
  importSection('Rows set aside',report.rows_set_aside,r=>`Row ${r.row}: ${r.reason}`)
  importSection('Warnings',report.warnings,x=>x)
  return new Promise(resolve=>{importPending={resolve,report,focus:document.activeElement};openSheet(importCheck,document.activeElement)})
}
