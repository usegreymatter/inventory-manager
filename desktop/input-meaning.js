// Lifecycle: living. Input interpretation only; forecast/order maths stay unchanged.
// Mirrored by input_meaning.py. Embedded verbatim in plugin.js by sync_input_meaning.py.
// Generated priority list from input-meaning-warning-order.json by sync_input_meaning.py.
export const INPUT_WARNING_PREFIXES = ["Stock is blank but reserved is filled", "Reserved stock could not be subtracted", "Stock includes reserved or allocated stock", "Oversold:", "Stock header says already available", "Reserved cell is blank", "Incoming orders unknown", "Incoming partly unknown", "Sales and stock units disagree", "More than 20%", "Sales dates", "Latest month", "New product:"]
export function orderedInputWarnings(messages) {
  const rank=text=>{const i=INPUT_WARNING_PREFIXES.findIndex(prefix=>text.startsWith(prefix));return i<0?INPUT_WARNING_PREFIXES.length:i}
  return [...new Set(messages)].sort((a,b)=>rank(a)-rank(b)||(a<b?-1:a>b?1:0))
}
export const INCOMING_UNKNOWN = 'Incoming orders unknown — counted as 0. Check open POs before ordering.'
export const INCOMING_PARTLY_UNKNOWN = 'Incoming partly unknown — known incoming retained; check open POs for every warehouse before ordering.'
export function inputMeaningChoices(raw={}) {
  return {stock_includes_reserved:raw?.stock_includes_reserved===true,incoming_not_in_file:raw?.incoming_not_in_file===true,units_confirmed:raw?.units_confirmed===true}
}
export function reviewInputMeaning(sheets,report,rawChoices={},today=null) {
  let evidence=null
  if(report.review_sheets!=null){const {review_sheets,review_report,...sourceReport}=report;evidence=reviewInputMeaning(sheets,sourceReport,{},today);sheets=review_sheets;report=review_report}
  if(!today){const now=new Date();today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`}
  const choices=inputMeaningChoices(rawChoices),warnings=[],reasons=[...(report.reasons||[])],affected=new Map(),copy=sheets.map(s=>({...s,rows:s.rows.map(r=>r.slice())}))
  const mark=(sku,text)=>{if(!sku)return;if(!affected.has(sku))affected.set(sku,[]);if(!affected.get(sku).includes(text))affected.get(sku).push(text)}
  const key=v=>String(v??'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ')
  const addUnit=(units,sku,value)=>{if(value){if(!units.has(sku))units.set(sku,new Set());units.get(sku).add(key(value))}}
  for(const [sku,notes]of Object.entries(report.input_warnings||{}))for(const text of notes){mark(sku,text);if(!warnings.includes(text))warnings.push(text)}
  if(choices.stock_includes_reserved){
    for(const [sku,names]of Object.entries(report.reserved_missing||{}))if(names.length){const text='Reserved stock missing in sheets '+names.join(', ')+' — available stock may be overstated; check allocations before ordering.';mark(sku,text);if(!warnings.includes(text))warnings.push(text)}
    for(const [sku,notes]of Object.entries(report.reserved_warnings||{}))for(const text of notes)mark(sku,text)
  }
  let missing=0,total=0,future=false,reservedFound=false,salesRows=0,missingSalesRows=0,reservedFailed=0,notLaunched=0,latestMonth=''
  const mainRows=[],salesEvidence=new Set(),longSales=[],wideSales=[]
  const stockUnits=new Map(),salesUnits=new Map(),stockSkus=new Set(),unknownSkus=new Set(),incomingEvidence=new Map()
  for(const meta of report.sheets||[]){
    const sheet=copy.find(s=>s.name===meta.name);if(!sheet||!sheet.rows.length)continue
    const mappings=meta.mapping||[],index=f=>mappings.find(m=>m.field===f)?.index
    const headers=sheet.rows[meta.header_row-1]||[],find=names=>headers.findIndex(h=>names.includes(key(h)))
    const skuIndex=index('sku'),stockIndex=index('on_hand'),incoming=index('on_order'),unit=index('unit'),quantity=index('quantity'),date=index('date')
    const reserved=find(['reserved','reserved qty','reserved quantity','allocated','allocated qty','allocated stock','reserved stock','reserved or allocated stock'])
    const stockUnit=find(['stock unit','stock uom','inventory unit']),salesUnit=find(['sales unit','sales uom','sold unit'])
    const months=mappings.filter(m=>/^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/.test(m.field||'')).sort((a,b)=>a.field.localeCompare(b.field))
    if(months.length&&months.at(-1).field>latestMonth)latestMonth=months.at(-1).field
    if(months.some(m=>m.field>today.slice(0,7)))future=true
    const rows=sheet.rows.slice(meta.header_row),numeric=[stockIndex,incoming,quantity,...months.map(m=>m.index)].filter(i=>i>=0)
    const delimiter=sheet.delimiter||',',style=importNumberStyle(rows,numeric,delimiter)
    const numericValue=raw=>{const v=importNumber(String(raw??''),delimiter,false,style);return IMPORT_NUMERIC.test(v)&&Number.isFinite(+v)&&+v>=0&&+v<=MAX_QUANTITY?+v:null}
    const stockText=([n,d])=>{let remaining=n%d,fraction='';while(remaining){remaining*=10n;fraction+=String(remaining/d);remaining%=d}let text=String(n/d)+(fraction?'.'+fraction:'');if(style==='decimal-comma'){if(!text.includes('.'))text+='.0';text=text.replace('.',',')}return text}
    const reservedGroups=new Map(),locations=new Map(),acceptedRows=meta.accepted_rows?new Set(meta.accepted_rows):null
    for(const [offset,row]of rows.entries()){
      const rowIndex=meta.header_row+offset
      const get=i=>i==null||i<0?'':String(row[i]??'').trim(),sku=get(skuIndex)
      if(!sku||['total','grand total','totals'].includes(key(sku)))continue
      const inactive=index('inactive'),active=index('active');if(['false','0','no','inactive'].includes(key(get(active)))||['true','1','yes','inactive'].includes(key(get(inactive))))continue
      const history=months.map(m=>[m.field,!!get(m.index)]);let main=null
      if(months.some(m=>get(m.index)))salesEvidence.add(sku)
      if(meta.name===report.sheet_used){
        stockSkus.add(sku);total++
        main={sku,missing:!get(stockIndex),needsSales:!months.length&&quantity==null};mainRows.push(main)
        addUnit(stockUnits,sku,get(stockUnit>=0?stockUnit:unit))
        if(reserved>=0)reservedFound=true
        const location=get(index('location')).toLowerCase(),prior=locations.get(sku)||[]
        const usable=numericValue(get(stockIndex))!=null&&(!choices.stock_includes_reserved||reserved<0||numericValue(get(reserved)||'0')!=null)
        const contributes=usable&&(acceptedRows?acceptedRows.has(rowIndex):!prior.length||quantity!=null||(location&&prior.every(p=>p[0]&&p[0]!==location&&p[1]===get(unit))))
        if(contributes){prior.push([location,get(unit)]);locations.set(sku,prior)}
        if(contributes&&numericValue(get(stockIndex))!=null){if(!incomingEvidence.has(sku))incomingEvidence.set(sku,[]);incomingEvidence.get(sku).push(!!get(incoming))}
        if(choices.stock_includes_reserved&&reserved>=0&&stockIndex!=null){
          const stock=numericValue(get(stockIndex)),held=numericValue(get(reserved)||'0')
          if(!get(reserved))mark(sku,'Reserved cell is blank — counted as 0; check allocations before ordering.')
          if(key(headers[stockIndex]).includes('available'))mark(sku,'Stock header says already available — subtracting reserved again may double-count allocations.')
          if(stock==null||held==null){reservedFailed++;const detail=!get(stockIndex)&&get(reserved)?'Stock is blank but reserved is filled — available stock cannot be calculated.':'Reserved stock could not be subtracted — check stock and reserved quantities.';row[stockIndex]=detail.startsWith('Stock is blank')?detail:'Invalid reserved stock';mark(sku,detail)}else {
            if(held>stock)mark(sku,'Oversold: reserved exceeds stock in a warehouse — available stock is netted across contributing warehouses, then floored at 0. Check allocations before ordering.')
            const net=subtractRatio(decimalRatio(stock),decimalRatio(held))
            if(contributes){const group=quantity==null?sku:row;if(!reservedGroups.has(group))reservedGroups.set(group,[]);reservedGroups.get(group).push([row,net])}else row[stockIndex]=stockText(net[0]>0n?net:[0n,1n])
          }
        }
        if(choices.incoming_not_in_file&&incoming!=null)row[incoming]='0'
      }
      if(months.length){wideSales.push([sku,history,main]);if(!main)salesRows++}
      if(quantity!=null){salesRows++;longSales.push([sku,date!=null?erpMonth(get(date)):null,!!get(quantity)]);if(get(quantity))salesEvidence.add(sku)}
      addUnit(salesUnits,sku,get(salesUnit>=0?salesUnit:quantity!=null||months.length?unit:null))
      if(date!=null){const m=erpMonth(get(date));if(m&&m>latestMonth)latestMonth=m;if(m&&m>today.slice(0,7)||/^\d{4}-\d{2}-\d{2}$/.test(get(date))&&get(date)>today)future=true}
    }
    for(const entries of reservedGroups.values()){
      const scale=entries.reduce((d,[,net])=>net[1]>d?net[1]:d,1n),nets=entries.map(([,net])=>net[0]*(scale/net[1]))
      let remaining=nets.reduce((a,b)=>a+b,0n);if(remaining<0n)remaining=0n
      entries.forEach(([row],i)=>{const positive=nets[i]>0n?nets[i]:0n,value=positive<remaining?positive:remaining;row[stockIndex]=stockText([value,scale]);remaining-=value})
    }
  }
  const launchCounts=new Map(),firstLongSale=new Map()
  for(const [sku,month,present]of longSales)if(present&&month&&(!firstLongSale.has(sku)||month<firstLongSale.get(sku)))firstLongSale.set(sku,month)
  for(const [sku,history]of wideSales)for(const [month,present]of history)if(present&&(!firstLongSale.has(sku)||month<firstLongSale.get(sku)))firstLongSale.set(sku,month)
  for(const [sku,history,main]of wideSales){let missingMonth=false;const firstSale=firstLongSale.get(sku);for(const [month,present]of history)if(!present){if(firstSale&&month<firstSale){notLaunched++;launchCounts.set(sku,(launchCounts.get(sku)||0)+1)}else missingMonth=true}if(main)main.missing=main.missing||missingMonth;else if(missingMonth)missingSalesRows++}
  for(const [sku,month,present]of longSales)if(!present){if(month&&firstLongSale.has(sku)&&month<firstLongSale.get(sku)){notLaunched++;launchCounts.set(sku,(launchCounts.get(sku)||0)+1)}else missingSalesRows++}
  missing=mainRows.filter(r=>r.missing||r.needsSales&&!salesEvidence.has(r.sku)).length
  if(evidence){
    missing=evidence.missing_rows;total=evidence.total_rows;missingSalesRows=evidence.missing_sales_rows;salesRows=evidence.sales_rows;notLaunched=evidence.not_yet_launched_cells
    const keep=text=>['Sales and stock units','Sales dates','Latest month','New product:'].some(prefix=>text.startsWith(prefix))
    for(const row of evidence.affected)for(const text of row.warnings)if(keep(text))mark(row.sku,text)
    for(const text of evidence.warnings)if(keep(text)&&!warnings.includes(text))warnings.push(text)
    for(const text of evidence.reasons)if(!reasons.includes(text))reasons.push(text)
  }else for(const [sku,count]of launchCounts){const text=`New product: ${count} months before first sale ignored`;mark(sku,text);if(!warnings.includes(text))warnings.push(text)}
  if(reservedFailed){const text=`Reserved stock could not be subtracted for ${reservedFailed} rows — they were set aside. Check stock and reserved quantities before ordering.`;warnings.push(text);reasons.push(text)}
  if(choices.stock_includes_reserved&&!reservedFound){const text='Stock includes reserved or allocated stock, but no reserved column was found. Available stock may be overstated — check allocations before ordering.';warnings.push(text);for(const sku of stockSkus)mark(sku,text)}
  for(const entries of affected.values())for(const text of entries)if((text.startsWith('Oversold:')||text.startsWith('Stock header'))&&!warnings.includes(text))warnings.push(text)
  for(const sku of stockSkus){const evidence=report.incoming_evidence!=null?(report.incoming_evidence[sku]||[]):incomingEvidence.get(sku)||[];if(choices.incoming_not_in_file||!evidence.length||!evidence.every(Boolean)){unknownSkus.add(sku);const text=!choices.incoming_not_in_file&&evidence.some(Boolean)?INCOMING_PARTLY_UNKNOWN:INCOMING_UNKNOWN;if(!warnings.includes(text))warnings.push(text);mark(sku,text)}}
  for(const sku of new Set([...stockUnits.keys(),...salesUnits.keys()]))if(new Set([...(stockUnits.get(sku)||[]),...(salesUnits.get(sku)||[])]).size>1)mark(sku,'Sales and stock units disagree — convert both to the same unit before ordering.')
  if([...affected.values()].some(a=>a.some(s=>s.startsWith('Sales and stock units')))){const text='Sales and stock units disagree — convert both to the same unit before ordering.';warnings.push(text);reasons.push(text)}
  if(total&&missing/total>0.2||salesRows&&missingSalesRows/salesRows>0.2)reasons.push('More than 20% of rows lack stock or sales. Missing sales can look like zero demand; check the file before ordering.')
  if(future){const text='Sales dates are in the future. Dates may be shifted — check the sales period before ordering.';reasons.push(text);warnings.push(text);for(const sku of stockSkus)mark(sku,text)}
  if(latestMonth===today.slice(0,7)){const text=`Latest month (${latestMonth}) is still in progress — partial sales may lower the forecast. Remove it or wait for month end.`;warnings.push(text);reasons.push(text);for(const sku of stockSkus)mark(sku,text)}
  return {sheets:copy,choices,warnings:orderedInputWarnings(warnings),affected:[...affected].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([sku,warnings])=>({sku,warnings:orderedInputWarnings(warnings)})),incoming_unknown:[...unknownSkus],requires_ack:reasons.length>0,reasons:orderedInputWarnings(reasons),missing_rows:missing,total_rows:total,missing_sales_rows:missingSalesRows,sales_rows:salesRows,not_yet_launched_cells:notLaunched,rows_kept:total-reservedFailed,rows_flagged:[...stockSkus].filter(sku=>affected.has(sku)).length}
}
// CSV retains its established row exclusions rather than workbook aggregation.
// Use actual accepted logical records, then recheck eligibility after netting.
export function reviewCsvInputMeaning(sheets,data,choices={},today=null) {
  const sheet=sheets[0],headers=sheet.rows[0],preflight=data.import_report
  const meta={name:sheet.name,header_row:1,mapping:headers.map((source,index)=>({index,source,field:preflight.matched.find(m=>m.source===source)?.field??SMART_WORKBOOK.reviewField(source)})),accepted_rows:preflight.accepted_rows}
  const report={sheet_used:sheet.name,sheets:[meta]}
  const provisional=reviewInputMeaning(sheets,report,choices,today),delimiter=sheet.delimiter||','
  const text=provisional.sheets[0].rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(delimiter)).join('\n')
  const eligibility=parseStockImport(text)
  meta.accepted_rows=eligibility.import_report.accepted_rows
  Object.assign(report,SMART_WORKBOOK.contributorMetadata(sheet,meta))
  return reviewInputMeaning(sheets,report,choices,today)
}
export function attachInputMeaning(data,review) {
  for(const item of data.items){
    if((review.choices.incoming_not_in_file||item.on_order==null)&&!review.incoming_unknown.includes(item.sku)){
      review.incoming_unknown.push(item.sku)
      if(!review.warnings.includes(INCOMING_UNKNOWN))review.warnings.push(INCOMING_UNKNOWN)
      let row=review.affected.find(r=>r.sku===item.sku);if(!row){row={sku:item.sku,warnings:[]};review.affected.push(row)}
      if(!row.warnings.includes(INCOMING_UNKNOWN))row.warnings.push(INCOMING_UNKNOWN)
    }
    item.input_warnings=orderedInputWarnings(review.affected.find(r=>r.sku===item.sku)?.warnings||[])
    if(review.incoming_unknown.includes(item.sku)){if(review.choices.incoming_not_in_file)delete item.on_order;item.incoming_unknown=true}
  }
  review.warnings=orderedInputWarnings(review.warnings)
  for(const row of review.affected)row.warnings=orderedInputWarnings(row.warnings)
  const report=data.import_report||{},headers=report.source_headers||[],skuSource=report.matched?.find(m=>m.field==='sku')?.source||'sku',skuIndex=headers.includes(skuSource)?headers.indexOf(skuSource):0
  for(const entry of report.rows_set_aside||[]){const sku=String(entry.values?.[skuIndex]??'').trim(),notes=review.affected.find(r=>r.sku===sku)?.warnings||[],detail=notes.find(w=>w.startsWith('Stock is blank but reserved is filled'));if(detail&&entry.values?.includes(detail)&&entry.reason?.includes('on_hand must be a number'))entry.reason=detail}
  review.rows_kept=report.rows_imported??data.items.length
  review.rows_flagged=data.items.filter(item=>item.input_warnings.length).length
  const {sheets,...meaning}=review;data.input_meaning=meaning
  return data
}
