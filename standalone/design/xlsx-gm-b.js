// Lifecycle: living. Offline OOXML writer; no dependencies, network or engine changes.
// Integration: include alongside worklist-gm-b.js, then call wlExcel(orderRows).
// Pure API: wlXlsxWorkbook([{name, rows}]) -> Uint8Array (first row is bold).
function wlXlsxXml(value){
 // Bound Excel cell text before regex work; remove XML 1.0 forbidden controls.
 // Escape literal OOXML _xHHHH_ sequences so Excel does not decode user text.
 return String(value).slice(0,32767).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'').replace(/_x[0-9a-f]{4}_/gi,match=>'_x005F_'+match.slice(1)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}
function wlXlsxColumn(index){let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name}
function wlXlsxSheet(rows){
 if(!Array.isArray(rows)||rows.length>1048576)throw Error('Invalid Excel row count')
 const body=rows.map((row,r)=>{
  if(!Array.isArray(row)||row.length>16384)throw Error('Invalid Excel column count')
  const cells=Array.from(row,(raw,c)=>{
   const ref=wlXlsxColumn(c)+(r+1),style=r===0?' s="1"':''
   const value=raw instanceof Date?(Number.isFinite(raw.getTime())?raw.toISOString().slice(0,10):null):raw
   if(value==null||typeof value==='number'&&!Number.isFinite(value))return `<c r="${ref}"${style}/>`
   if(typeof value==='number')return `<c r="${ref}"${style}><v>${value}</v></c>`
   // Inline strings are always literal, including = + - @ prefixes. Never emit formulas.
   return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${wlXlsxXml(value)}</t></is></c>`
  }).join('')
  return `<row r="${r+1}">${cells}</row>`
 }).join('')
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+body+'</sheetData></worksheet>'
}
function wlXlsxCrc32(bytes){
 let crc=0xFFFFFFFF
 for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0)}
 return (crc^0xFFFFFFFF)>>>0
}
function wlXlsxZip(files){
 const encoder=new TextEncoder(),locals=[],central=[];let offset=0,centralSize=0
 if(files.length>65535)throw Error('Too many ZIP entries')
 const header=(size)=>{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)}}
 for(const [path,text] of files){
  const name=encoder.encode(path),bytes=encoder.encode(text),crc=wlXlsxCrc32(bytes),local=header(30),directory=header(46)
  if(name.length>65535||bytes.length>0xFFFFFFFF||offset+30+name.length+bytes.length>0xFFFFFFFF)throw Error('Workbook exceeds ZIP STORE limits')
  const l=local.view,d=directory.view
  l.setUint32(0,0x04034B50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true)
  l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true)
  d.setUint32(0,0x02014B50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true)
  d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true)
  locals.push(local.bytes,name,bytes);central.push(directory.bytes,name);offset+=30+name.length+bytes.length;centralSize+=46+name.length
 }
 if(offset+centralSize+22>0xFFFFFFFF)throw Error('Workbook exceeds ZIP STORE limits')
 const end=header(22),v=end.view;v.setUint32(0,0x06054B50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true)
 const output=new Uint8Array(offset+centralSize+22);let at=0
 for(const chunk of [...locals,...central,end.bytes]){output.set(chunk,at);at+=chunk.length}
 return output
}
function wlXlsxWorkbook(sheets){
 if(!Array.isArray(sheets)||!sheets.length||sheets.length>65529)throw Error('Invalid sheet count')
 const names=new Set()
 for(const sheet of sheets){
  const name=sheet?.name
  if(typeof name!=='string'||!name.trim()||name.length>31||/[\\/?*\[\]:\u0000-\u001F]/.test(name)||name.startsWith("'")||name.endsWith("'")||names.has(name.toLowerCase()))throw Error('Invalid or duplicate sheet name')
  names.add(name.toLowerCase())
 }
 const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
 const files=[
  ['[Content_Types].xml',xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,n)=>`<Override PartName="/xl/worksheets/sheet${n+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],
  ['_rels/.rels',xml+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml',xml+`<workbook xmlns="${main}" xmlns:r="${office}"><sheets>`+sheets.map((s,n)=>`<sheet name="${wlXlsxXml(s.name)}" sheetId="${n+1}" r:id="rId${n+1}"/>`).join('')+'</sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',xml+`<Relationships xmlns="${rel}">`+sheets.map((_,n)=>`<Relationship Id="rId${n+1}" Type="${office}/worksheet" Target="worksheets/sheet${n+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="${office}/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',xml+`<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
  ...sheets.map((sheet,n)=>[`xl/worksheets/sheet${n+1}.xml`,wlXlsxSheet(sheet.rows)])
 ]
 return wlXlsxZip(files)
}
function wlXlsxProductsValue(row,key){
 if(key==='product')return row.item.name+' ('+row.item.sku+')'
 if(key==='status')return wlStatus.find(([bucket])=>bucket===row.bucket)?.[1]||row.bucket
 if(key==='due')return row.guidance.order_by==='now'?currentToday:row.guidance.order_by||null
 if(key==='runout')return row.guidance.runout_date||null
 return wlValue(row,key)
}
function wlExcel(rows){
 const purchase=[['Supplier','SKU','Name','Quantity','Unit','Unit cost','Line value','Requested delivery','Note']]
 // Reuse purchase eligibility/grouping and already-rounded quantities. Costs missing
 // from an item/settings stay blank (zero cost remains a real numeric zero).
 for(const [supplier,group] of wlOrderGroups(rows))for(const {item:i,guidance:g,minimumAdded} of group){
  if(!(g.quantity>0)||!Number.isFinite(g.quantity))continue
  const raw=resolveOrderSettings(i,settings).values.unit_cost,cost=Number.isFinite(raw)&&raw>=0?raw:null
  const day=dateOrdinal(g.order_by==='now'?currentToday:g.order_by),arrival=day!==null&&Number.isFinite(g.lead_days)&&g.lead_days>=0?ordinalDate(day+g.lead_days):null
  purchase.push([supplier||'Supplier not assigned',i.sku,i.name,g.quantity,i.unit,cost,cost===null?null:g.quantity*cost,arrival,minimumAdded?'(added to reach minimum)':''])
 }
 // Not filteredRows or mounted virtual rows: include every product, with the
 // visible column sequence and current sort, regardless of order selection.
 const columns=wlVisible(),products=[columns.map(c=>c[1]),...[...currentRows].sort(wlCompare).map(row=>columns.map(([key])=>wlXlsxProductsValue(row,key)))]
 const bytes=wlXlsxWorkbook([{name:'Purchase order',rows:purchase},{name:'All products',rows:products}])
 wlDownload(bytes,'inventory-manager-order.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 return bytes
}
