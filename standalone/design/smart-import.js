// Shared, local-only workbook review. Mapping rules persist without product rows;
// accepted standalone datasets remain in page memory, not this mapping store.
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
    retained=null;document.getElementById('input-meaning-results')?.remove();sourceStatus.classList.remove('smart-import-source');sourceStatus.querySelector('#smart-import-review')?.remove();sourceAnchor.after(sourceStatus)
  }
  const fields={sku:'Product code (SKU)',name:'Product name',unit:'Unit',on_hand:'Stock on hand',supplier_days:'Lead time (days)',supplier:'Supplier',category:'Category',unit_cost:'Unit cost',sale_price:'Selling price',date:'Sales date',quantity:'Quantity sold',on_order:'Stock on order',minimum_order:'Minimum order quantity',pack_size:'Pack multiple'}
  const csv=(rows,delimiter=',')=>rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(delimiter)).join('\r\n')+'\r\n'
  function rules(){try{const raw=localStorage.getItem(STORE);if(!raw||raw.length>1000000)return [];const a=JSON.parse(raw);return Array.isArray(a)?a.slice(-20).filter(r=>typeof r.fingerprint==='string'&&r.overrides&&typeof r.overrides==='object'&&!Array.isArray(r.overrides)&&typeof r.warning_fingerprint==='string'):[]}catch{return []}}
  async function warningFingerprint(report,parsed){
    const bytes=new TextEncoder().encode(JSON.stringify([report.warnings,parsed?.import_report?.warnings||[],parsed?.import_report?.defaulted||[],parsed?.input_meaning?.warnings||[],parsed?.input_meaning?.reasons||[]]))
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
  }
  async function remember(state){
    try{
      const overrides=Object.create(null)
      for(const sheet of state.report.sheets)for(const m of sheet.mapping)overrides[sheet.name+':'+m.index]=m.field||''
      const confirmed=understandStockWorkbook(state.sheets,state.report.sheet_used,overrides)
      const entry={fingerprint:state.report.fingerprint,sheet:state.report.sheet_used,overrides,choices:inputMeaningChoices(state.choices),warning_fingerprint:await warningFingerprint(confirmed,state.parsed)}
      const entries=rules().filter(r=>r.fingerprint!==entry.fingerprint);entries.push(entry)
      const encoded=JSON.stringify(entries.slice(-20));if(encoded.length<=1000000)localStorage.setItem(STORE,encoded)
    }catch{/* Storage denial means the next upload receives normal review. */}
  }
  async function finish(accepted=false){
    if(!pending)return
    const state=pending;pending=null;if(dialog.open)dialog.close()
    const expiryReview=state.parsed?.items.some(item=>item.lots?.some(lot=>lot.expiry_acknowledged===false))
    if(accepted&&state.parsed&&state.choices.units_confirmed&&(!(state.meaning?.requires_ack||expiryReview)||state.ack)&&state.stillCurrent()){
      // The review checkbox applies to this import only, never to a saved layout.
      if(state.ack)for(const item of state.parsed.items)for(const lot of item.lots||[])if(lot.expiry_acknowledged===false)lot.expiry_acknowledged=true
      await remember(state);retained={file:state.file};state.resolve(state.stillCurrent()?{parsed:state.parsed,smart:!state.legacyParsed||state.edit,remembered:false}:null)
    }else state.resolve(null)
    if(state.focus?.isConnected)state.focus.focus()
  }
  function cancelPending(){finish(false);resetSourceStatus();if(typeof finishImportCheck==='function')finishImportCheck(false)}
  cancel.addEventListener('click',()=>finish(false));use.addEventListener('click',()=>{if(!use.disabled)finish(true)})
  change.addEventListener('click',()=>{if(pending){pending.edit=true;pending.ack=false;draw(pending);body.querySelector('select')?.focus()}})
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});dialog.addEventListener('close',()=>{if(!dialog.open)finish(false)})
  function disclosure(parent,label,values){if(!values?.length)return;const d=el('details'),s=el('summary',label+' · '+values.length),list=el('ul');for(const text of values.slice(0,100))list.append(el('li',text));if(values.length>100)list.append(el('li','First 100 shown.'));d.append(s,list);parent.append(d)}
  function preflight(state){
    state.parsed=null;state.error=null
    try{
      const original=understandStockWorkbook(state.sheets,state.sheet,state.overrides)
      if(state.legacyParsed&&!state.edit){
        // Keep the established CSV row exclusions, warehouse handling and report.
        state.meaning=reviewCsvInputMeaning(state.sheets,state.legacyParsed,state.choices)
        state.report=original
        state.parsed=attachInputMeaning(parseStockImport(csv(state.meaning.sheets[0].rows,state.sheets[0].delimiter||',')),state.meaning);state.report.missing=[];validateDataset(state.parsed)
      }else{
        state.meaning=reviewInputMeaning(state.sheets,original,state.choices)
        // Original mappings remain editable; adjusted canonical joined rows are facts.
        const adjusted=understandStockWorkbook(state.meaning.sheets)
        state.report={...original,missing:[...new Set([...original.missing,...adjusted.missing])],canonical_rows:adjusted.canonical_rows}
        if(!state.report.missing.length&&adjusted.canonical_rows.length>1){state.parsed=attachInputMeaning(parseStockImport(csv(adjusted.canonical_rows)),state.meaning);validateDataset(state.parsed)}
      }
    }catch(error){state.error=error instanceof CsvError?error:new CsvError(error.message||'Could not read this workbook.')}
  }
  function draw(state){
    const focused=document.activeElement,focusKey=body.contains(focused)?{id:focused.id,sheet:focused.dataset.sheet,index:focused.dataset.index}:null,scrollTop=body.scrollTop
    preflight(state);const r=state.report;body.replaceChildren();if(!r)return
    body.append(el('p',state.file.name,'smart-import-file'))
    const summary=el('p',`${r.sheet_used} · Header row ${r.header_row} · ${r.layout==='long'?'Sales by date':r.layout==='wide'?'Monthly sales columns':'Product list'}`,'smart-import-summary');summary.id='smart-import-summary';body.append(summary)
    const card=el('section',undefined,'input-meaning-card');card.id='input-meaning-card';card.append(el('h3','Before we suggest orders'))
    const choose=(id,label,values,current,update)=>{const field=el('label',label),select=el('select');select.id=id;for(const [value,text]of values){const option=el('option',text);option.value=value;select.append(option)}select.value=current;select.addEventListener('change',()=>{update(select.value);state.ack=false;draw(state)});field.append(select);card.append(field)}
    choose('meaning-stock','Your stock number is',[['available','Available to sell'],['reserved','Includes reserved or allocated stock']],state.choices.stock_includes_reserved?'reserved':'available',value=>state.choices.stock_includes_reserved=value==='reserved')
    choose('meaning-incoming','Incoming orders',[['included','Included in file'],['unknown','Not in file']],state.choices.incoming_not_in_file?'unknown':'included',value=>state.choices.incoming_not_in_file=value==='unknown')
    const units=el('label'),confirm=el('input');confirm.type='checkbox';confirm.id='meaning-units';confirm.checked=state.choices.units_confirmed;confirm.addEventListener('change',()=>{state.choices.units_confirmed=confirm.checked;draw(state)});units.append(confirm,document.createTextNode('Units — sales and stock use the same unit'));card.append(units)
    for(const text of [...(state.meaning?.warnings||[]),...(state.meaning?.reasons||[])])card.append(el('p',text,'smart-import-warning'))
    const expiryReview=state.parsed?.items.flatMap(item=>(item.lots||[]).filter(lot=>lot.expiry_acknowledged===false).map(lot=>item.sku+' · lot '+lot.lot+' → '+lot.expiry+' (interpreted date)'))||[]
    if(expiryReview.length){card.append(el('p','Check ambiguous expiry dates before ordering. Dates below are interpreted as year-month-day.','smart-import-warning'));disclosure(card,'Interpreted expiry dates',expiryReview)}
    if(state.meaning?.requires_ack||expiryReview.length){const label=el('label'),ack=el('input');ack.type='checkbox';ack.id='meaning-show-anyway';ack.checked=state.ack===true;ack.addEventListener('change',()=>{state.ack=ack.checked;draw(state)});label.append(ack,document.createTextNode('Show orders anyway'));card.append(label)}
    card.append(el('small','These answers are remembered for this file layout. Imported data stays on this device.'));body.append(card)
    const suggestions=r.sheets.some(sheet=>sheet.mapping.some(m=>['medium','low'].includes(m.confidence)))
    body.append(el('p',(suggestions?'Suggested matches need your review before you use this file. ':'Review the column matches. ')+'Your current products stay unchanged until you choose Use this.','smart-import-note'))
    if(r.sheets.length>1){const label=el('label','Main stock sheet '),select=el('select');select.id='smart-import-sheet';for(const s of r.sheets){const o=el('option',s.name);o.value=s.name;o.selected=s.name===r.sheet_used;select.append(o)}select.addEventListener('change',()=>{state.sheet=select.value;state.ack=false;draw(state)});label.append(select);body.append(label)}
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
          select.addEventListener('change',()=>{state.overrides[sheet.name+':'+m.index]=select.value;state.ack=false;draw(state)});target.append(select,fullValue)
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
    const setAside=[],seenRows=new Set()
    const addAside=(sheet,row,text)=>{const key=JSON.stringify([sheet,Number(row)]);if(row!=null&&seenRows.has(key))return;if(row!=null)seenRows.add(key);setAside.push(text)}
    // Legacy preflight rows and workbook warnings refer to the same physical CSV rows.
    for(const x of report?.rows_set_aside||[])addAside(state.legacyParsed&&!state.edit?r.sheet_used:'canonical',x.row,'Row '+x.row+': '+x.reason)
    for(const w of r.warnings.filter(w=>w.includes('row omitted'))){
      const sheet=r.sheets.find(s=>w.startsWith(s.name+': '))?.name
      const row=w.slice((sheet?.length||0)+2).match(/^row (\d+)\b|row omitted \((\d+)\)/)
      addAside(sheet,row?(row[1]||row[2]):null,w.replace(/^(.*?): row ([0-9]+) /,'$1: Row $2: ').replace(/row omitted \((\d+)\)/,'Row $1 omitted'))
    }
    const count=el('p',parsed?`${parsed.items.length} products ready · ${state.meaning.rows_kept} rows kept · ${state.meaning.rows_flagged} rows flagged${report?' · '+setAside.length+' rows set aside':''}`:'No products ready yet. Check the column matches.','smart-import-ready');count.id='smart-import-ready';count.setAttribute('aria-live','polite');body.append(count)
    if(parsed){
      const table=el('table');table.id='smart-import-preview';const head=el('tr');for(const t of ['Product code','Product name','Stock on hand'])head.append(el('th',t));table.append(head)
      for(const product of parsed.items.slice(0,5)){const row=el('tr');for(const value of [product.sku,product.name,product.on_hand])row.append(el('td',String(value??'')));table.append(row)}body.append(el('h3','First products'),table)
      if(report){disclosure(body,'Rows set aside',setAside);disclosure(body,'Defaults',report.defaulted.map(x=>x.field+' → '+(x.value??'unknown')+' ('+x.reason+')'));disclosure(body,'Preflight column matches',report.matched.map(x=>x.source+' → '+x.field))}
    }
    use.disabled=!parsed?.items.length||!!r.missing.length||!!state.error||!state.choices.units_confirmed||(state.meaning?.requires_ack||expiryReview.length>0)&&!state.ack
    // Rebuilding a mapping must not strand keyboard users on the page behind it.
    if(focusKey){const replacement=[...body.querySelectorAll('select,input')].find(select=>focusKey.id?select.id===focusKey.id:select.dataset.sheet===focusKey.sheet&&select.dataset.index===focusKey.index);replacement?.focus({preventScroll:true});body.scrollTop=scrollTop}
  }
  async function load(file,stillCurrent=()=>true){
    const reviewRequested=forceReview;forceReview=false
    let legacyError,legacyText,legacyParsed
    if(!/\.(xlsx|xls|xlsb)$/i.test(file.name)){
      try{
        const text=legacyText=await readStockFile(file),parsed=legacyParsed=parseStockImport(text)
        if(file.size>(/\.json$/i.test(file.name)?16:2)*1024*1024)throw new CsvError(/\.json$/i.test(file.name)?'Bundle bridge must be no larger than 16 MiB.':'CSV must be no larger than 2 MiB.')
        if(!stillCurrent())return null
        if(/\.json$/i.test(file.name))return {parsed,smart:false,remembered:false}
      }catch(error){legacyError=error;if(/\.json$/i.test(file.name))throw error}
    }
    let sheets
    try{sheets=legacyText!=null?[{name:'CSV',rows:importRows(legacyText,importDelimiter(legacyText)),delimiter:importDelimiter(legacyText)}]:await readSmartWorkbook(file)}catch(error){if(legacyError?.message?.includes('UTF-8'))throw legacyError;throw error}
    if(!stillCurrent())return null
    // Canonical first-row CSV keeps the old exclusions, preflight report and errors.
    if(legacyError&&sheets.length===1&&['sku','name','unit','on_hand','supplier_days'].every((v,i)=>sheets[0].rows[0]?.[i]===v))throw legacyError
    const report=understandStockWorkbook(sheets),saved=rules().find(r=>r.fingerprint===report.fingerprint)
    const state={file,sheets,sheet:saved?.sheet||report.sheet_used,overrides:Object.assign(Object.create(null),saved?.overrides||{}),choices:inputMeaningChoices(saved?.choices),ack:false,legacyParsed,report,stillCurrent,edit:false,focus:document.activeElement}
    preflight(state)
    if(!state.report.mapping.some(m=>m.field==='sku')&&!state.report.canonical_rows.slice(1).length){throw new CsvError('Could not find a product code (SKU). Add a product-code column in your spreadsheet, then choose the file again.')}
    let sameWarnings=false
    if(saved){try{sameWarnings=await warningFingerprint(state.report,state.parsed)===saved.warning_fingerprint}catch{}}
    if(!stillCurrent())return null
    // Remember a layout, never permission to drop products from a later file.
    const noRowsSetAside=state.parsed?.import_report?.rows_set_aside?.length===0&&!state.report.warnings.some(w=>w.includes('row omitted'))
    if(saved&&!state.parsed?.items.some(item=>item.lots?.some(lot=>lot.expiry_acknowledged===false))&&state.choices.units_confirmed&&!state.meaning?.requires_ack&&!reviewRequested&&state.parsed?.items.length&&!state.report.missing.length&&!state.error&&sameWarnings&&noRowsSetAside){retained={file};return {parsed:state.parsed,smart:!state.legacyParsed||state.edit,remembered:true}}
    return new Promise(resolve=>{state.resolve=resolve;pending=state;draw(state);dialog.showModal()})
  }
  function status(result,file){
    showMeaningResults(result.parsed)
    if(!result.smart)return
    const status=document.getElementById('source-status');document.body.append(status);status.classList.add('smart-import-source');status.replaceChildren(document.createTextNode(result.remembered?'Same layout as last time — imported automatically · ':'Using '+file.name+' · '+result.parsed.items.length+' products. File stays on this device. · '))
    const review=el('button','Review');review.type='button';review.id='smart-import-review';review.addEventListener('click',()=>{if(retained){forceReview=true;readCsv(retained.file)}});status.append(review)
  }
  function showMeaningResults(parsed){
    document.getElementById('input-meaning-results')?.remove()
    const affected=(parsed?.items||[]).filter(i=>i.input_warnings?.length),warnings=[...new Set([...(parsed?.input_meaning?.warnings||[]),...affected.flatMap(i=>i.input_warnings)])]
    if(!warnings.length)return
    const banner=el('section',undefined,'input-meaning-results');banner.id='input-meaning-results';banner.setAttribute('aria-label','Check before ordering')
    banner.append(el('h3','Check before ordering · '+affected.length+' product'+(affected.length===1?'':'s')))
    for(const text of parsed?.input_meaning?.warnings?.length?parsed.input_meaning.warnings:warnings)banner.append(el('p',text))
    const list=el('details'),summary=el('summary','Affected products · '+affected.length),rows=el('ul');list.append(summary,rows)
    for(const entry of affected){const row=el('li',entry.sku+' — '+entry.input_warnings.join(' '));row.dataset.inputWarningSku=entry.sku;rows.append(row)}banner.append(list)
    const dismiss=el('button','Dismiss');dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss input warning summary');dismiss.addEventListener('click',()=>banner.remove());banner.append(dismiss)
    // Summary dismissal is DOM/session-only; item warnings survive and every import redraws it.
    const worklist=document.getElementById('worklist'),layout=document.querySelector('.layout')
    if(worklist)worklist.prepend(banner)
    else if(layout)layout.before(banner)
    else (document.querySelector('main')||document.body).prepend(banner)
  }
  return {load,cancelPending,status}
})()
function loadStockImport(file,stillCurrent){return smartImportUI.load(file,stillCurrent)}
function cancelStockImport(){smartImportUI.cancelPending()}
function stockImportStatus(result,file){smartImportUI.status(result,file)}
