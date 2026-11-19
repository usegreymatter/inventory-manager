// Shared, local-only workbook review. No spreadsheet rows are persisted.
const smartImportUI = (() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
  const dialog=el('dialog',undefined,'settings-sheet smart-import');dialog.id='smart-import';dialog.setAttribute('aria-labelledby','smart-import-title')
  const header=el('header'),title=el('h2','We understood your file');title.id='smart-import-title';header.append(title)
  const body=el('div',undefined,'settings-sheet-content smart-import-content'),actions=el('div',undefined,'smart-import-actions')
  const use=el('button','Use this'),change=el('button','Edit mappings'),cancel=el('button','Cancel')
  use.id='smart-import-use';change.id='smart-import-change';cancel.id='smart-import-cancel';for(const b of [use,change,cancel])b.type='button'
  actions.append(use,change,cancel);dialog.append(header,body,actions);document.body.append(dialog)
  const STORE='stock-runway-smart-mappings-v1';let pending=null,retained=null,forceReview=false
  const sourceStatus=document.getElementById('source-status'),sourceAnchor=document.createComment('source status home')
  sourceStatus.before(sourceAnchor)
  function resetSourceStatus(){
    retained=null;sourceStatus.classList.remove('smart-import-source');sourceStatus.querySelector('#smart-import-review')?.remove();sourceAnchor.after(sourceStatus)
  }
  const fields={sku:'Product code (SKU)',name:'Product name',unit:'Unit',on_hand:'Stock on hand',supplier_days:'Lead time (days)',supplier:'Supplier',category:'Category',unit_cost:'Unit cost',date:'Sales date',quantity:'Quantity sold',on_order:'Stock on order',minimum_order:'Minimum order quantity',pack_size:'Pack multiple'}
  const csv=rows=>rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n'
  function rules(){try{const raw=localStorage.getItem(STORE);if(!raw||raw.length>1000000)return [];const a=JSON.parse(raw);return Array.isArray(a)?a.slice(-20).filter(r=>typeof r.fingerprint==='string'&&r.overrides&&typeof r.overrides==='object'&&!Array.isArray(r.overrides)&&typeof r.warning_fingerprint==='string'):[]}catch{return []}}
  async function warningFingerprint(report,parsed){
    const bytes=new TextEncoder().encode(JSON.stringify([report.warnings,parsed?.import_report?.warnings||[],parsed?.import_report?.defaulted||[]]))
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
  }
  async function remember(state){
    try{
      const overrides=Object.create(null)
      for(const sheet of state.report.sheets)for(const m of sheet.mapping)overrides[sheet.name+':'+m.index]=m.field||''
      const confirmed=understandStockWorkbook(state.sheets,state.report.sheet_used,overrides)
      const entry={fingerprint:state.report.fingerprint,sheet:state.report.sheet_used,overrides,warning_fingerprint:await warningFingerprint(confirmed,state.parsed)}
      const entries=rules().filter(r=>r.fingerprint!==entry.fingerprint);entries.push(entry)
      const encoded=JSON.stringify(entries.slice(-20));if(encoded.length<=1000000)localStorage.setItem(STORE,encoded)
    }catch{/* Storage denial means the next upload receives normal review. */}
  }
  async function finish(accepted=false){
    if(!pending)return
    const state=pending;pending=null;if(dialog.open)dialog.close()
    if(accepted&&state.parsed&&state.stillCurrent()){
      await remember(state);retained={file:state.file};state.resolve(state.stillCurrent()?{parsed:state.parsed,smart:true,remembered:false}:null)
    }else state.resolve(null)
    if(state.focus?.isConnected)state.focus.focus()
  }
  function cancelPending(){finish(false);resetSourceStatus();if(typeof finishImportCheck==='function')finishImportCheck(false)}
  cancel.addEventListener('click',()=>finish(false));use.addEventListener('click',()=>{if(!use.disabled)finish(true)})
  change.addEventListener('click',()=>{if(pending){pending.edit=true;draw(pending);body.querySelector('select')?.focus()}})
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});dialog.addEventListener('close',()=>{if(!dialog.open)finish(false)})
  function disclosure(parent,label,values){if(!values?.length)return;const d=el('details'),s=el('summary',label+' · '+values.length),list=el('ul');for(const text of values.slice(0,100))list.append(el('li',text));if(values.length>100)list.append(el('li','First 100 shown.'));d.append(s,list);parent.append(d)}
  function preflight(state){
    state.parsed=null;state.error=null
    try{
      state.report=understandStockWorkbook(state.sheets,state.sheet,state.overrides)
      if(!state.report.missing.length&&state.report.canonical_rows.length>1){state.parsed=parseStockImport(csv(state.report.canonical_rows));validateDataset(state.parsed)}
    }catch(error){state.error=error instanceof CsvError?error:new CsvError(error.message||'Could not read this workbook.')}
  }
  function draw(state){
    const focused=document.activeElement,focusKey=body.contains(focused)?{id:focused.id,sheet:focused.dataset.sheet,index:focused.dataset.index}:null,scrollTop=body.scrollTop
    preflight(state);const r=state.report;body.replaceChildren();if(!r)return
    body.append(el('p',state.file.name,'smart-import-file'))
    const summary=el('p',`${r.sheet_used} · Header row ${r.header_row} · ${r.layout==='long'?'Sales by date':r.layout==='wide'?'Monthly sales columns':'Product list'}`,'smart-import-summary');summary.id='smart-import-summary';body.append(summary)
    const suggestions=r.sheets.some(sheet=>sheet.mapping.some(m=>['medium','low'].includes(m.confidence)))
    body.append(el('p',(suggestions?'Suggested matches need your review before you use this file. ':'Review the column matches. ')+'Your current products stay unchanged until you choose Use this.','smart-import-note'))
    if(r.sheets.length>1){const label=el('label','Main stock sheet '),select=el('select');select.id='smart-import-sheet';for(const s of r.sheets){const o=el('option',s.name);o.value=s.name;o.selected=s.name===r.sheet_used;select.append(o)}select.addEventListener('change',()=>{state.sheet=select.value;draw(state)});label.append(select);body.append(label)}
    for(const sheet of r.sheets){
      const section=el('section',undefined,'smart-import-sheet');section.append(el('h3',sheet.name+' · row '+sheet.header_row))
      const table=el('table'),thead=el('thead'),head=el('tr');for(const text of ['Your column','Use as','Confidence'])head.append(el('th',text));thead.append(head);table.append(thead);const tbody=el('tbody')
      const options=[...new Set([...Object.keys(ERP_ALIASES),...Object.keys(fields),...r.sheets.flatMap(s=>s.mapping.map(m=>m.field).filter(Boolean))])]
      for(const m of sheet.mapping){
        if(!m.field&&!state.edit)continue
        const row=el('tr'),source=el('td',m.source||'(empty header)'),target=el('td'),confidence=el('td',undefined,'smart-confidence '+m.confidence)
        if(state.edit||['medium','low'].includes(m.confidence)){
          const select=el('select');select.setAttribute('aria-label',sheet.name+': '+(m.source||'Column '+(m.index+1)));select.dataset.sheet=sheet.name;select.dataset.index=String(m.index)
          const ignored=el('option','Ignore this column');ignored.value='';select.append(ignored)
          for(const f of options){const option=el('option',fields[f]||f);option.value=f;select.append(option)}select.value=m.field||''
          const selectedLabel=fields[m.field]||m.field||'Ignore this column',fullValue=el('small',selectedLabel,'smart-mapping-value');fullValue.setAttribute('aria-hidden','true');select.title=selectedLabel
          select.addEventListener('change',()=>{state.overrides[sheet.name+':'+m.index]=select.value;draw(state)});target.append(select,fullValue)
        }else target.textContent=fields[m.field]||m.field
        const dot=el('span','●','smart-confidence-dot');dot.setAttribute('aria-hidden','true');confidence.title=m.reason;confidence.setAttribute('aria-label',m.confidence+' confidence: '+m.reason);confidence.append(dot,document.createTextNode(' '+({high:'High',medium:'Medium — check',low:'Low — check',none:'Ignored'}[m.confidence]||m.confidence)));if(m.confidence!=='high')confidence.append(el('small',m.reason));row.append(source,target,confidence);tbody.append(row)
      }
      table.append(tbody);section.append(table);disclosure(section,'Ignored columns',sheet.mapping.filter(m=>!m.field).map(m=>(m.source||'(empty header)')+' — '+m.reason));body.append(section)
    }
    if(r.missing.length){const missing=el('p','Still needed: '+r.missing.join(', '),'smart-import-problem');missing.id='smart-import-missing';body.append(missing)}
    if(r.match_report&&(r.sheets.length>1))body.append(el('p',`${r.match_report.matched} product codes matched across sheets · ${r.match_report.unmatched} did not match. Only products in the main stock sheet are imported.`,'smart-import-join'))
    const warnings=[...r.warnings,...(state.parsed?.import_report?.warnings||[])];if(warnings.length){const w=el('div',undefined,'smart-import-warnings');w.append(el('p',warnings[0]));disclosure(w,'All warnings',warnings);body.append(w)}
    if(state.error)body.append(el('p',state.error.message,'smart-import-problem'))
    const parsed=state.parsed,report=parsed?.import_report
    const omitted=r.warnings.filter(w=>w.includes('row omitted')),setAside=[...(report?.rows_set_aside||[]).map(x=>'Row '+x.row+': '+x.reason),...omitted.map(w=>w.replace(/^(.*?): row ([0-9]+) /,'$1: Row $2: '))]
    const count=el('p',parsed?`${parsed.items.length} products ready${report?' · '+setAside.length+' rows set aside':''}`:'No products ready yet. Check the column matches.','smart-import-ready');count.id='smart-import-ready';count.setAttribute('aria-live','polite');body.append(count)
    if(parsed){
      const table=el('table');table.id='smart-import-preview';const head=el('tr');for(const t of ['Product code','Product name','Stock on hand'])head.append(el('th',t));table.append(head)
      for(const product of parsed.items.slice(0,5)){const row=el('tr');for(const value of [product.sku,product.name,product.on_hand])row.append(el('td',String(value??'')));table.append(row)}body.append(el('h3','First products'),table)
      if(report){disclosure(body,'Rows set aside',setAside);disclosure(body,'Defaults',report.defaulted.map(x=>x.field+' → '+(x.value??'unknown')+' ('+x.reason+')'));disclosure(body,'Preflight column matches',report.matched.map(x=>x.source+' → '+x.field))}
    }
    use.disabled=!parsed?.items.length||!!r.missing.length||!!state.error
    // Rebuilding a mapping must not strand keyboard users on the page behind it.
    if(focusKey){const replacement=[...body.querySelectorAll('select')].find(select=>focusKey.id?select.id===focusKey.id:select.dataset.sheet===focusKey.sheet&&select.dataset.index===focusKey.index);replacement?.focus({preventScroll:true});body.scrollTop=scrollTop}
  }
  async function load(file,stillCurrent=()=>true){
    const reviewRequested=forceReview;forceReview=false
    let legacyError
    if(!/\.(xlsx|xls|xlsb)$/i.test(file.name)){
      try{
        const text=await readStockFile(file),parsed=parseStockImport(text)
        if(file.size>(/\.json$/i.test(file.name)?16:2)*1024*1024)throw new CsvError(/\.json$/i.test(file.name)?'Bundle bridge must be no larger than 16 MiB.':'CSV must be no larger than 2 MiB.')
        if(!stillCurrent())return null
        return {parsed,smart:false,remembered:false}
      }catch(error){legacyError=error;if(/\.json$/i.test(file.name))throw error}
    }
    let sheets
    try{sheets=await readSmartWorkbook(file)}catch(error){if(legacyError?.message?.includes('UTF-8'))throw legacyError;throw error}
    if(!stillCurrent())return null
    // Canonical first-row CSV keeps the old exclusions, preflight report and errors.
    if(legacyError&&sheets.length===1&&['sku','name','unit','on_hand','supplier_days'].every((v,i)=>sheets[0].rows[0]?.[i]===v))throw legacyError
    const report=understandStockWorkbook(sheets),saved=rules().find(r=>r.fingerprint===report.fingerprint)
    const state={file,sheets,sheet:saved?.sheet||report.sheet_used,overrides:Object.assign(Object.create(null),saved?.overrides||{}),report,stillCurrent,edit:false,focus:document.activeElement}
    preflight(state)
    if(!state.report.mapping.some(m=>m.field==='sku')&&!state.report.canonical_rows.slice(1).length){throw new CsvError('Could not find a product code (SKU). Add a product-code column in your spreadsheet, then choose the file again.')}
    let sameWarnings=false
    if(saved){try{sameWarnings=await warningFingerprint(state.report,state.parsed)===saved.warning_fingerprint}catch{}}
    if(!stillCurrent())return null
    // Remember a layout, never permission to drop products from a later file.
    const noRowsSetAside=state.parsed?.import_report?.rows_set_aside?.length===0&&!state.report.warnings.some(w=>w.includes('row omitted'))
    if(saved&&!reviewRequested&&state.parsed?.items.length&&!state.report.missing.length&&!state.error&&sameWarnings&&noRowsSetAside){retained={file};return {parsed:state.parsed,smart:true,remembered:true}}
    return new Promise(resolve=>{state.resolve=resolve;pending=state;draw(state);dialog.showModal()})
  }
  function status(result,file){
    if(!result.smart)return
    const status=document.getElementById('source-status');document.body.append(status);status.classList.add('smart-import-source');status.replaceChildren(document.createTextNode(result.remembered?'Same layout as last time — imported automatically · ':'Using '+file.name+' · '+result.parsed.items.length+' products. File stays on this device. · '))
    const review=el('button','Review');review.type='button';review.id='smart-import-review';review.addEventListener('click',()=>{if(retained){forceReview=true;readCsv(retained.file)}});status.append(review)
  }
  return {load,cancelPending,status}
})()
function loadStockImport(file,stillCurrent){return smartImportUI.load(file,stillCurrent)}
function cancelStockImport(){smartImportUI.cancelPending()}
function stockImportStatus(result,file){smartImportUI.status(result,file)}
