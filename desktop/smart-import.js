/* Dependency-free, bounded workbook import. Mirrored by ../smart_import.py.
 * No network, eval, external XML entities, or formula evaluation. Cached values only.
 * Existing inventory preflight remains the final quantity/readiness authority.
 */
const MAX_INPUT=20*1024*1024, MAX_EXPANDED=80*1024*1024;
const MAX_ROWS=200000, MAX_COLS=16384, MAX_CELLS=2000000;
const FIXED=['sku','name','unit','on_hand','supplier_days'];
const OPTIONAL=['category','supplier','on_order','demand_change_pct','last_count_date'];
const PER_ITEM=['minimum_order','pack_size','unit_cost'];
const REVIEW_FIELDS=['reserved','stock_unit','sales_unit'];
const REVIEW_ALIASES={reserved:['reserved','reserved qty','reserved quantity','allocated','allocated qty','allocated stock','reserved stock','reserved or allocated stock'],stock_unit:['stock unit','stock uom','inventory unit'],sales_unit:['sales unit','sales uom','sold unit']};
const NUMERIC_FIELDS=new Set(['reserved','on_hand','on_order','supplier_days','demand_change_pct','quantity',...PER_ITEM]);
const BALANCE_ERROR='differing on-hand balances; use stock snapshot';
const AMBIGUOUS_NUMBER='ambiguous number format';
export const DATE_HEADERS=['date','transaction date','sales date','invoice date','document date','posting date','month','period'];
export const QUANTITY_HEADERS=['quantity','qty','sales quantity','qty sold','quantity sold','units sold','sales','sold','demand','sales qty','quantity invoiced'];
const MONTH_NAMES=['january','february','march','april','may','june','july','august','september','october','november','december'];
const REQUIRED=[['sku','Product code (SKU)'],['name','Product name'],['on_hand','On-hand stock']];
const NUMERIC=/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const LEGACY_ERROR='Save as .xlsx or CSV; legacy .xls and .xlsb workbooks are not supported.';
const BOUNDS_ERROR='Workbook exceeds safe limits (200000 rows, 16384 columns or 2000000 cells).';
const XML_BOUNDS_ERROR='Workbook XML exceeds safe limits (500000 elements or 200000 shared strings).';
const trim=v=>String(v??'').replace(/^[\s\u001c-\u001f\u0085\ufeff]+|[\s\u001c-\u001f\u0085\ufeff]+$/gu,'');
const fail=message=>{throw new Error(message);};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isMonth=f=>/^(?:rcv:)?[0-9]{4}-[0-9]{2}$/.test(f);

function limits(sheets){
  let rows=0,cells=0;
  for(const sheet of sheets){
    rows+=sheet.rows.length;
    for(const row of sheet.rows){if(row.length>MAX_COLS)fail(BOUNDS_ERROR);cells+=row.length;}
    if(rows>MAX_ROWS||cells>MAX_CELLS)fail(BOUNDS_ERROR);
  }
  return sheets;
}
function decode(raw){
  try{
    const encoding=raw[0]===255&&raw[1]===254?'utf-16le':raw[0]===254&&raw[1]===255?'utf-16be':'utf-8';
    const text=new TextDecoder(encoding,{fatal:true}).decode(raw);
    if(/[\u0000\ufffd]/u.test(text))throw new Error();
    return text;
  }catch{fail('File is not UTF-8; re-export as CSV UTF-8');}
}
function delimiterFor(text){
  const counts={',':0,';':0,'\t':0};let quoted=false;
  for(const c of text){if(c==='"')quoted=!quoted;else if((c==='\r'||c==='\n')&&!quoted)break;else if(own(counts,c)&&!quoted)counts[c]++;}
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
}
function csvRows(text){
  const delimiter=delimiterFor(text),rows=[];let row=[],field='',quoted=false,closed=false,cells=0,started=false;
  const pushField=()=>{row.push(field);field='';closed=false;if(row.length>MAX_COLS)fail(BOUNDS_ERROR);};
  const pushRow=()=>{pushField();cells+=row.length;if(rows.length>=MAX_ROWS||cells>MAX_CELLS)fail(BOUNDS_ERROR);rows.push(row);row=[];started=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];started=true;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(closed&&c!==delimiter&&c!=='\n'&&c!=='\r')fail('Could not read the local CSV file.');
    if(c==='"'&&field===''){quoted=true;continue;}
    if(c===delimiter){pushField();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;if(!row.length&&!field&&!closed){if(rows.length>=MAX_ROWS)fail(BOUNDS_ERROR);rows.push([]);started=false;}else pushRow();continue;}
    field+=c;
  }
  if(quoted)fail('Could not read the local CSV file.');
  if(started||row.length||field||closed)pushRow();
  return rows;
}

// Small XML data parser: DTD/entity declarations are forbidden, only five XML
// entities and numeric character references are decoded; nothing is fetched.
function entities(text){
  // Exclude another '&': unterminated runs must not retry an unbounded suffix
  // at every ampersand. The bare-& alternative rejects malformed references.
  return text.replace(/&([^&;<\s]*);|&/g,(_,v)=>{
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(own(known,v))return known[v];
    if(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(v)){
      const n=v[1]==='x'?parseInt(v.slice(2),16):Number(v.slice(1));
      if(n===9||n===10||n===13||n>=0x20&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff)return String.fromCodePoint(n);
    }
    fail('Invalid XML entity in workbook.');
  });
}
function xml(raw,budget={elements:0}){
  let text=decode(raw).replace(/\r\n?/g,'\n');
  if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('Unsafe XML declarations in workbook.');
  if(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text))fail('Invalid XML character in workbook.');
  // Sticky matching rejects a malformed token at its first position rather
  // than searching every remaining suffix (quadratic for runs of '<').
  const tokenPattern=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"<]*"|'[^'<]*'|[^'"<>])*>|[^<]+/gy;
  // Streaming lexical pass before tree allocation, never text.match()'s huge
  // token array. The budget covers all loaded XML parts, including all sheets.
  let strings=0,depth=0,position=0;
  for(const match of text.matchAll(tokenPattern)){
    const token=match[0];
    if(match.index!==position)fail('Invalid XML in workbook.');position+=token.length;
    if(token[0]!=='<'||token.startsWith('<!--')||token.startsWith('<?')||token.startsWith('<![CDATA['))continue;
    if(token.startsWith('</')){depth--;continue;}
    budget.elements++;if(/^<(?:[^\s:/>]+:)?si(?=[\s/>])/.test(token))strings++;
    if(budget.elements>500000||strings>200000)fail(XML_BOUNDS_ERROR);
    if(depth+1>255)fail('Workbook XML nesting is too deep.');
    if(!token.endsWith('/>')&&++depth>255)fail('Workbook XML nesting is too deep.');
  }
  if(position!==text.length)fail('Invalid XML in workbook.');
  const top={tag:'#root',attrs:Object.create(null),children:[],text:''},stack=[top];
  for(const [token] of text.matchAll(tokenPattern)){
    if(token.startsWith('<!--')||token.startsWith('<?'))continue;
    const current=stack[stack.length-1];
    if(token.startsWith('<![CDATA[')){if(stack.length===1)fail('Invalid XML in workbook.');current.text+=token.slice(9,-3);continue;}
    if(token.startsWith('</')){const name=token.slice(2,-1).trim();if(stack.length===1||stack.pop().fullTag!==name)fail('Invalid XML in workbook.');continue;}
    if(token[0]==='<'){
      const match=/^<([^\s/>]+)([\s\S]*?)(\/?)>$/.exec(token);if(!match)fail('Invalid XML in workbook.');
      const attrs=Object.create(null);let remaining=match[2];
      while(remaining.trim()){
        const attr=/^\s+([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(remaining);
        if(!attr||own(attrs,attr[1]))fail('Invalid XML attributes in workbook.');
        const value=attr[2]??attr[3];if(value.includes('<'))fail('Invalid XML attributes in workbook.');
        attrs[attr[1]]=entities(value.replace(/[\t\n\r]/g,' '));remaining=remaining.slice(attr[0].length);
      }
      const node={tag:match[1].split(':').at(-1),fullTag:match[1],attrs,children:[],text:''};
      current.children.push(node);if(!match[3]){stack.push(node);if(stack.length>256)fail('Workbook XML nesting is too deep.');}
    }else{if(token.includes(']]>'))fail('Invalid XML in workbook.');current.text+=entities(token);}
  }
  if(stack.length!==1||top.children.length!==1||top.text.trim())fail('Invalid XML in workbook.');
  return top.children[0];
}
function descendants(node,tag){const out=[];const visit=n=>{if(n.tag===tag)out.push(n);for(const c of n.children)visit(c);};visit(node);return out;}
function stringText(node){return node.children.filter(c=>c.tag!=='rPh').map(c=>c.tag==='t'?c.text:stringText(c)).join('');}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
async function zipParts(raw){
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),size=raw.length;
  const u16=p=>{if(p<0||p+2>size)fail('Invalid ZIP structure in workbook.');return view.getUint16(p,true);};
  const u32=p=>{if(p<0||p+4>size)fail('Invalid ZIP structure in workbook.');return view.getUint32(p,true);};
  let end=-1;
  for(let p=size-22;p>=Math.max(0,size-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===size){end=p;break;}
  if(end<0)fail('Could not read workbook; Save as .xlsx or CSV.');
  const count=u16(end+10),centralSize=u32(end+12),offset=u32(end+16);
  if(u16(end+4)||u16(end+6)||u16(end+8)!==count||offset+centralSize>end)fail('Invalid ZIP structure in workbook.');
  if(count>4096)fail('Workbook contains too many ZIP entries.');
  const parts=new Map();let at=offset,expanded=0;
  for(let i=0;i<count;i++){
    if(u32(at)!==0x02014b50)fail('Invalid ZIP structure in workbook.');
    const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),compressed=u32(at+20),uncompressed=u32(at+24),nameLen=u16(at+28),extra=u16(at+30),comment=u16(at+32),local=u32(at+42);
    if(flags&1)fail('Encrypted workbooks are not supported. Save an unencrypted .xlsx or CSV.');
    if(![0,8].includes(method))fail('Unsupported ZIP compression; Save as .xlsx or CSV.');
    const next=at+46+nameLen+extra+comment;if(next>offset+centralSize)fail('Invalid ZIP structure in workbook.');
    const name=decode(raw.subarray(at+46,at+46+nameLen));
    if(parts.has(name))fail('Duplicate ZIP entries in workbook.');
    expanded+=uncompressed;if(expanded>MAX_EXPANDED)fail('Workbook expands beyond 80 MiB.');
    if(u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail('Invalid ZIP structure in workbook.');
    const localNameLen=u16(local+26),start=local+30+localNameLen+u16(local+28);
    if(decode(raw.subarray(local+30,local+30+localNameLen))!==name||start+compressed>offset)fail('Invalid ZIP structure in workbook.');
    parts.set(name,{method,crc,compressed,uncompressed,start});at=next;
  }
  if(at!==offset+centralSize)fail('Invalid ZIP structure in workbook.');
  if(parts.has('xl/workbook.bin'))fail(LEGACY_ERROR);
  let readSize=0;const cache=new Map(),xmlBudget={elements:0};
  return async(name,optional=false)=>{
    if(!parts.has(name)){if(optional)return null;fail('Workbook is missing a required XML part.');}
    if(cache.has(name))return cache.get(name);
    const info=parts.get(name),compressed=raw.subarray(info.start,info.start+info.compressed);let bytes;
    if(info.method===0){bytes=compressed;readSize+=bytes.length;if(readSize>MAX_EXPANDED)fail('Workbook expands beyond 80 MiB.');}
    else{
      if(typeof DecompressionStream!=='function')fail('This browser cannot decompress .xlsx; Save as CSV.');
      let stream;try{stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{fail('This browser cannot decompress .xlsx; Save as CSV.');}
      const reader=stream.getReader(),chunks=[];let length=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;readSize+=value.length;if(readSize>MAX_EXPANDED||length>info.uncompressed){await reader.cancel();fail('Workbook expands beyond 80 MiB.');}chunks.push(value);}}finally{reader.releaseLock();}
      bytes=new Uint8Array(length);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
    }
    if(bytes.length!==info.uncompressed||crc32(bytes)!==info.crc)fail('Workbook ZIP checksum or size is invalid.');
    const parsed=xml(bytes,xmlBudget);cache.set(name,parsed);return parsed;
  };
}
function dateFormat(fmt){fmt=fmt.replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'').toLowerCase();return /[dy]/.test(fmt)||/m/.test(fmt)&&!/[hs]/.test(fmt);}
function uint(raw,message='Invalid numeric attribute in workbook.'){
  raw=String(raw);if(raw.length>10||!/^\d+$/.test(raw)||Number(raw)>2147483647)fail(message);return Number(raw);
}
function isoDate(y,m,d){
  if(!Number.isInteger(y)||y<1||y>9999||!Number.isInteger(m)||m<1||m>12||!Number.isInteger(d)||d<1||d>31)return null;
  const value=new Date(0);value.setUTCFullYear(y,m-1,d);value.setUTCHours(0,0,0,0);
  return value.getUTCFullYear()===y&&value.getUTCMonth()===m-1&&value.getUTCDate()===d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
async function readXlsx(raw){
  const load=await zipParts(raw),workbook=await load('xl/workbook.xml'),rels=await load('xl/_rels/workbook.xml.rels');
  const relations=new Map(rels.children.map(r=>[r.attrs.Id,r]));
  const props=descendants(workbook,'workbookPr'),epoch1904=props.length&&['1','true'].includes(props[0].attrs.date1904);
  const styles=await load('xl/styles.xml',true),formats=new Map(),styleIds=[];
  if(styles){for(const e of descendants(styles,'numFmt'))formats.set(uint(e.attrs.numFmtId??0),e.attrs.formatCode||'');const xfs=descendants(styles,'cellXfs');if(xfs.length)for(const e of xfs[0].children)styleIds.push(uint(e.attrs.numFmtId??0));}
  const strings=await load('xl/sharedStrings.xml',true),shared=strings?strings.children.filter(e=>e.tag==='si').map(stringText):[];
  const sheets=[];let rowCount=0,cellCount=0,paddingSize=0;
  for(const sheet of descendants(workbook,'sheet')){
    const rid=Object.entries(sheet.attrs).find(([k])=>k.split(':').at(-1)==='id')?.[1],relation=relations.get(rid);
    if(!relation||relation.attrs.TargetMode==='External')fail('Workbook sheet relationship is missing or external.');
    const target=relation.attrs.Target||'',segments=(target.startsWith('/')?target.slice(1):'xl/'+target).split('/'),resolved=[];
    for(const segment of segments){if(segment==='..'){if(!resolved.length)fail('Unsafe workbook sheet path.');resolved.pop();}else if(segment&&segment!=='.')resolved.push(segment);}
    const name=resolved.join('/');if(!name.startsWith('xl/')||name.includes('\\'))fail('Unsafe workbook sheet path.');
    const root=await load(name),rows=[],percentCells=[];
    for(const row of descendants(root,'row')){
      const rowIndex=uint(row.attrs.r??rows.length+1)-1;
      if(!Number.isInteger(rowIndex)||rowIndex<rows.length||rowIndex>=MAX_ROWS)fail(BOUNDS_ERROR);
      rowCount+=rowIndex+1-rows.length;if(rowCount>MAX_ROWS)fail(BOUNDS_ERROR);
      while(rows.length<=rowIndex)rows.push([]);const values=rows[rowIndex];
      for(const cell of row.children){
        if(cell.tag!=='c')continue;
        const ref=cell.attrs.r||'';if(ref.length>16)fail('Invalid workbook cell reference.');const match=/^([A-Za-z]+)([1-9][0-9]*)$/.exec(ref);
        if(ref&&(!match||Number(match[2])!==rowIndex+1))fail('Invalid workbook cell reference.');
        let col=0;if(match){for(const c of match[1].toUpperCase())col=col*26+c.charCodeAt(0)-64;col--;}else col=values.length;
        if(col<values.length||col>=MAX_COLS)fail(BOUNDS_ERROR);
        cellCount+=col+1-values.length;if(cellCount>MAX_CELLS)fail(BOUNDS_ERROR);
        while(values.length<=col)values.push('');
        const valueNodes=descendants(cell,'v');let value=valueNodes.length?valueNodes[0].text:'',typ=cell.attrs.t||'';
        if(typ==='inlineStr')value=stringText(cell);
        else if(typ==='s'){const index=uint(value,'Invalid shared-string index in workbook.');if(index>=shared.length)fail('Invalid shared-string index in workbook.');value=shared[index];}
        else if(typ==='b')value=value==='1'?'TRUE':'FALSE';
        else if(!['str','e','d'].includes(typ)&&value){
          const styleIndex=uint(cell.attrs.s??0),fmtId=styleIds[styleIndex]||0,fmt=formats.get(fmtId)||'';
          if([9,10].includes(fmtId)||fmt.replace(/"[^"]*"|\\./g,'').includes('%'))percentCells.push([rowIndex,col]);
          if(fmtId>=14&&fmtId<=22||dateFormat(fmt)){
            const serial=Number(value);if(value.length>256||!NUMERIC.test(value)||!Number.isFinite(serial)||serial<0||serial>2958465)fail('Invalid Excel date value.');
            const days=Math.floor(serial),epoch=epoch1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31);
            const d=new Date(epoch+(epoch1904||days<60?days:days-1)*86400000);value=d.toISOString().slice(0,10);if(value.length!==10)fail('Invalid Excel date value.');
          }else if(/^0+$/.test(fmt)&&/^[0-9]+$/.test(value)){
            // ZIP byte limits do not bound amplification by numeric formatting.
            paddingSize+=Math.max(0,fmt.length-value.length);
            if(paddingSize>MAX_EXPANDED)fail('Workbook formatting expands beyond 80 MiB.');
            value=value.padStart(fmt.length,'0');
          }
        }
        values[col]=value;
      }
    }
    const result={name:sheet.attrs.name??'Sheet',rows};if(percentCells.length)result.percent_cells=percentCells;sheets.push(result);
  }
  return limits(sheets);
}
export async function readWorkbook(buffer,filename='workbook.xlsx'){
  const raw=buffer instanceof Uint8Array?buffer:buffer instanceof ArrayBuffer?new Uint8Array(buffer):ArrayBuffer.isView(buffer)?new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength):fail('Expected workbook bytes.');
  if(/\.(xls|xlsb)$/i.test(filename))fail(LEGACY_ERROR);
  if(raw.length>MAX_INPUT)fail('File must be no larger than 20 MiB.');
  if(raw[0]===0xd0&&raw[1]===0xcf&&raw[2]===0x11&&raw[3]===0xe0)fail(LEGACY_ERROR);
  if(/\.xlsx$/i.test(filename)||raw[0]===80&&raw[1]===75)return readXlsx(raw);
  const text=decode(raw),name=filename.split(/[\\/]/).at(-1).replace(/\.[^.]*$/,'');return [{name,rows:csvRows(text),delimiter:delimiterFor(text)}];
}

function key(raw){return trim(raw).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/#/g,' no').toLowerCase().replace(/[^\p{L}\p{N}\s]|_/gu,' ').trim().split(/\s+/u).join(' ');}
function month(raw,inferred=2000){
  const t=trim(raw);let m=/^([1-9][0-9]{3})[-/.]([0-9]{1,2})(?:[-/.]([0-9]{1,2})(?:[ T].*)?)?$/.exec(t);
  if(m){const iso=isoDate(Number(m[1]),Number(m[2]),Number(m[3]||1));return iso?iso.slice(0,7):null;}
  m=/^([0-9]{1,2})[-/.]([1-9][0-9]{3})$/.exec(t);if(m)return Number(m[1])>=1&&Number(m[1])<=12?`${m[2]}-${m[1].padStart(2,'0')}`:null;
  m=/^([0-9]{1,2})([/.])([0-9]{1,2})\2([1-9][0-9]{3})$/.exec(t);
  if(m){const mo=Number(m[m[2]==='/'?1:3]),day=Number(m[m[2]==='/'?3:1]),iso=isoDate(Number(m[4]),mo,day);return iso?iso.slice(0,7):null;}
  m=/^([A-Za-z]{3,9})(?:[\s\-/.,']*([0-9]{4}|[0-9]{2}))?$/.exec(t);
  if(m){const name=m[1].toLowerCase();for(let i=0;i<MONTH_NAMES.length;i++){const full=MONTH_NAMES[i];if(name===full||name===full.slice(0,3)||name==='sept'&&i===8){const y=m[2]?Number(m[2])+(m[2].length===2?2000:0):inferred;return y>=1000&&y<=9999?`${String(y).padStart(4,'0')}-${String(i+1).padStart(2,'0')}`:null;}}}
  return null;
}
const yearless=raw=>month(raw)!==null&&!/[0-9]/.test(raw);
// Mirror csv_import.number_parts / number_style / erp_number. The Python path
// calls those helpers directly; keep locale decisions covered by report parity.
function numberParts(raw){
  let t=trim(raw),negative=t.startsWith('(')&&t.endsWith(')');if(negative)t=trim(t.slice(1,-1));
  const currency=/^[$€£¥₹﷼]|[$€£¥₹﷼]$/.test(t);t=trim(t.replace(/^[$€£¥₹﷼]|[$€£¥₹﷼]$/g,''));
  if(/^[+-]?[0-9]{1,3}(?:[ \t\u00a0\u2007\u202f\ufeff][0-9]{3})+(?:[.,][0-9]+)?$/.test(t))t=t.replace(/[ \t\u00a0\u2007\u202f\ufeff]/g,'');
  return [t,negative,currency];
}
function erpNumber(raw,delimiter=',',lead=false,style='decimal-dot',mixed=false){
  let t=trim(raw);if(t.length>256)return raw;
  if(lead){const m=/^([0-9][0-9.,]*)[\s\u001c-\u001f\u0085\ufeff]*(days?|weeks?|months?)$/.exec(t.toLowerCase());if(m){const v=erpNumber(m[1],delimiter,false,style,mixed);if(v===AMBIGUOUS_NUMBER)return v;if(NUMERIC.test(v))return String(Number(v)*(m[2].startsWith('week')?7:m[2].startsWith('month')?30:1));}}
  const parts=numberParts(t);t=parts[0];const [,negative,currency]=parts,dottedGroup=/^[+-]?[1-9][0-9]{0,2}(?:\.[0-9]{3})+(?:,[0-9]+)?$/.test(t);
  if(style==='decimal-comma'){
    if((currency||mixed)&&/^[+-]?[1-9][0-9]{0,2},[0-9]{3}$/.test(t))return AMBIGUOUS_NUMBER;
    if(mixed&&dottedGroup&&!t.includes(','))return AMBIGUOUS_NUMBER;
    if(dottedGroup)t=t.replaceAll('.','').replace(',','.');
    else if(/^[+-]?[0-9]+,[0-9]+$/.test(t))t=t.replace(',','.');
    else if(/[.,]/.test(t)&&/^[+-]?[0-9][0-9.,]*(?:[eE][+-]?[0-9]+)?$/.test(t))return AMBIGUOUS_NUMBER;
  }else{
    if(delimiter===';'&&dottedGroup)return AMBIGUOUS_NUMBER;
    if(/^[+-]?[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]+)?$/.test(t)||/^[+-]?[1-9][0-9]?(?:,[0-9]{2})+,[0-9]{3}(?:\.[0-9]+)?$/.test(t))t=t.replaceAll(',','');
    else if(t.includes(',')&&/^[+-]?[0-9][0-9.,]*$/.test(t))return AMBIGUOUS_NUMBER;
  }
  return negative?'-'+t:t;
}
function sheetNumbers(sheet,picked,start){
  const rows=sheet.rows.slice(start),indices=[...picked].filter(([f])=>NUMERIC_FIELDS.has(f)||isMonth(f)).flatMap(([,hits])=>hits),values=[];
  for(const row of rows)for(const i of indices)if(i<row.length&&row[i].length<=256)values.push(row[i]);
  // Dot numeric cells in Excel must not be reinterpreted by comma text nearby.
  const delimiter=sheet.delimiter??null,effective=delimiter||',';
  const style=effective===';'&&values.some(v=>/^[+-]?(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+),[0-9]+$/.test(numberParts(v)[0]))?'decimal-comma':'decimal-dot';
  const leadIndex=picked.get('supplier_days')?.[0];
  const mixed=style==='decimal-comma'&&rows.some(row=>indices.some(i=>i<row.length&&row[i].length<=256&&row[i].includes('.')&&NUMERIC.test(erpNumber(row[i],',',i===leadIndex))&&erpNumber(row[i],effective,i===leadIndex,style)===AMBIGUOUS_NUMBER));
  const number=(raw,lead=false)=>{
    const t=trim(raw);if(delimiter===null&&style==='decimal-dot'&&t.includes(',')&&!/^[+-]?[0-9]{1,3}(?:,[0-9]{3})+\.[0-9]+$/.test(t))return AMBIGUOUS_NUMBER;
    const result=erpNumber(t,effective,lead,style,mixed);return lead&&NUMERIC.test(result)?add('0',result):result;
  };
  return [number,style];
}
function add(left,right){
  if(!left)return right;if(!right)return left;
  if(left.length>256||right.length>256||!NUMERIC.test(left)||!NUMERIC.test(right))return 'Invalid quantity: '+left+' + '+right;
  const parse=t=>{const match=/^([+-]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(t),digits=(match[2]+(match[3]||'')).replace(/^0+/,'')||'0',exponent=Number(match[4]||0)-(match[3]||'').length,adjusted=digits==='0'?exponent:digits.length+exponent-1;return {n:BigInt((match[1]==='-'?'-':'')+digits),exponent,adjusted};};
  const a=parse(left),b=parse(right);if(!Number.isFinite(a.adjusted)||!Number.isFinite(b.adjusted)||Math.abs(a.adjusted)>308||Math.abs(b.adjusted)>308)return 'Invalid quantity';
  const exponent=Math.min(a.exponent,b.exponent),sum=a.n*10n**BigInt(a.exponent-exponent)+b.n*10n**BigInt(b.exponent-exponent),sign=sum<0n?'-':'',digits=(sum<0n?-sum:sum).toString();
  let result;if(exponent>=0)result=digits+'0'.repeat(exponent);else{const padded=digits.padStart(1-exponent,'0');result=padded.slice(0,exponent)+'.'+padded.slice(exponent);result=result.replace(/0+$/,'').replace(/\.$/,'');}
  return sum===0n?'0':sign+result;
}
function sameNumber(left,right){const a=add('0',left),b=add('0',right);return NUMERIC.test(a)&&NUMERIC.test(b)&&a===b;}
function percent(raw){
  const value=add('0',raw);if(!NUMERIC.test(value))return value;
  // add() normalized the bounded input to fixed decimal notation already.
  return add('0',value+'e2');
}
function analyse(sheet,overrides,aliases,typeAliases){
  const {rows,name}=sheet,lookup=new Map();
  for(const [field,labels] of Object.entries(aliases))for(const [rank,label] of [field,...labels].entries())if(!lookup.has(key(label)))lookup.set(key(label),[field,rank]);
  for(const [rank,label] of typeAliases.entries())if(!lookup.has(key(label)))lookup.set(key(label),['category',100+rank]);
  for(const [label,hit] of [...lookup])if(!lookup.has(label.replaceAll(' ','')))lookup.set(label.replaceAll(' ',''),hit);
  const abbreviations=new Map();
  for(const [label,[field]] of lookup){const parts=label.split(' ');if(parts.length>=3){const acronym=parts.map(p=>p[0]).join('');if(!abbreviations.has(acronym))abbreviations.set(acronym,new Set());abbreviations.get(acronym).add(field);}}
  let best=null;
  // Freeze header detection before applying confirmed column rules.
  let scan=[...rows.slice(0,30).entries()];
  if(Object.keys(overrides).length&&rows.length){const detected=analyse(sheet,{},aliases,typeAliases)[0].header_row-1;scan=[[detected,rows[detected]]];}
  for(const [ri,headers] of scan){
    const years=headers.filter(h=>month(h)&&!yearless(h)).map(h=>month(h).slice(0,4)),inferred=years.length?Number(years[0]):2000,hasDate=headers.some(h=>DATE_HEADERS.includes(key(h))),mapping=[],candidates=[];
    for(const [i,source] of headers.entries()){
      let k=key(source);const bracketKey=key(source.replace(/\([^)]*\)|\[[^]]*\]/g,'')),overrideKey=`${name}:${i}`;
      if(!lookup.has(k)&&lookup.has(k.replaceAll(' ','')))k=k.replaceAll(' ','');
      let field=null,confidence='high',reason='Exact header alias',rank=0;
      if(own(overrides,overrideKey)){
        field=overrides[overrideKey]||null;reason='Manual mapping';rank=-1000;
        if(field!==null&&![...Object.keys(aliases),...FIXED,...OPTIONAL,...PER_ITEM,'date','quantity'].includes(field)&&!/^(?:rcv:)?[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/.test(field)){field=null;reason='Unknown manual mapping ignored';}
      }else{
        const receipt=trim(source).toLowerCase().startsWith('rcv:'),label=receipt?trim(source).slice(4):source,m=month(label,inferred);
        if(m){field=(receipt?'rcv:':'')+m;reason=receipt?'Monthly receipt header':'Monthly sales header';}
        else if(DATE_HEADERS.includes(k)){field='date';reason='Transaction date header';}
        else if(hasDate&&QUANTITY_HEADERS.includes(k)){field='quantity';reason='Transaction quantity header';}
        else if(lookup.has(k)||lookup.has(bracketKey)){
          [field,rank]=lookup.get(k)||lookup.get(bracketKey);reason=lookup.has(k)?'Exact header alias':'Header alias without unit annotation';
          if(k==='barcode'){rank=10000;reason='Barcode fallback identifier';}
        }else if(abbreviations.has(k)&&abbreviations.get(k).size===1){field=[...abbreviations.get(k)][0];rank=500;confidence='low';reason='Header abbreviation; review mapping';}
        else if(k){
          const tokens=new Set(k.split(' ')),options=[];
          for(const [alias,[target,aliasRank]] of lookup){const parts=new Set(alias.split(' ')),intersection=[...tokens].filter(t=>parts.has(t)).length,union=new Set([...tokens,...parts]).size;if(parts.size>=2&&intersection>=2){const overlap=intersection/union;if(overlap>=0.5)options.push([-overlap,aliasRank,target]);}}
          options.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||(a[2]<b[2]?-1:a[2]>b[2]?1:0));
          if(options.length){const [overlap,r,f]=options[0];rank=r+100;field=f;confidence=-overlap>=0.75?'medium':'low';reason='Token overlap; review mapping';}
        }
      }
      const item={index:i,source,field,confidence:field?confidence:'none',reason:field?reason:own(overrides,overrideKey)&&!overrides[overrideKey]?'Ignored by manual mapping':own(overrides,overrideKey)?reason:'No recognized header'};
      mapping.push(item);if(field)candidates.push([rank,i,field]);
    }
    if(!candidates.some(c=>c[2]==='date')){
      for(const item of mapping){const i=item.index;if(item.field||own(overrides,`${name}:${i}`))continue;const values=rows.slice(ri+1,ri+21).filter(r=>i<r.length&&trim(r[i])).map(r=>trim(r[i]));if(values.length>=2&&values.every(v=>/[0-9][-/\.][0-9]/.test(v)&&month(v))){Object.assign(item,{field:'date',confidence:'low',reason:'Text date values; review mapping'});candidates.push([500,i,'date']);break;}}
    }
    if(candidates.some(c=>c[2]==='date')){
      for(const item of mapping){const i=item.index;if(QUANTITY_HEADERS.includes(key(item.source))&&!own(overrides,`${name}:${i}`)){for(let j=candidates.length-1;j>=0;j--)if(candidates[j][1]===i)candidates.splice(j,1);Object.assign(item,{field:'quantity',confidence:'high',reason:'Transaction quantity header'});candidates.push([0,i,'quantity']);}}
    }
    // NetSuite Name is the identifier beside Display Name/Description.
    if(!candidates.some(c=>c[2]==='sku')){
      const names=mapping.filter(m=>m.field==='name'),plain=names.filter(m=>key(m.source)==='name'&&!own(overrides,`${name}:${m.index}`)),descriptions=names.filter(m=>key(m.source)!=='name');
      if(plain.length&&descriptions.length){const item=plain[0],i=item.index;for(let j=candidates.length-1;j>=0;j--)if(candidates[j][1]===i)candidates.splice(j,1);Object.assign(item,{field:'sku',confidence:'medium',reason:'Name identifier beside product description'});candidates.push([0,i,'sku']);}
    }
    if(!candidates.some(c=>c[2]==='sku')){
      const possible=[];
      for(const item of mapping){const i=item.index;if(item.field||own(overrides,`${name}:${i}`))continue;const hint=key(item.source).split(' ').filter(Boolean);if(hint.length&&!hint.some(t=>['code','id','ref','reference','sku','item','article','material','part','product','identifier'].includes(t)))continue;if(!candidates.some(c=>c[2]==='name'))continue;const values=rows.slice(ri+1,ri+21).filter(r=>i<r.length&&trim(r[i])).map(r=>trim(r[i]));if(values.length>=2&&values.every(v=>/^[A-Za-z0-9_-]{1,64}$/.test(v)&&/[0-9]/.test(v)&&!month(v)))possible.push(item);}
      if(possible.length===1){const item=possible[0];Object.assign(item,{field:'sku',confidence:'low',reason:'Identifier values; review mapping'});candidates.push([500,item.index,'sku']);}
    }
    const picked=new Map();candidates.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||(a[2]<b[2]?-1:a[2]>b[2]?1:0));
    for(const [,i,field] of candidates){if(!picked.has(field)||isMonth(field)){if(!picked.has(field))picked.set(field,[]);picked.get(field).push(i);}else Object.assign(mapping[i],{field:null,confidence:'none',reason:'Duplicate field; preferred alias used'});}
    const fields=new Set(picked.keys()),score=[...fields].reduce((n,f)=>n+(['sku','name','on_hand'].includes(f)?12:['date','quantity'].includes(f)?5:2),0),layout=fields.has('date')&&fields.has('quantity')?'long':[...fields].some(isMonth)?'wide':'products';
    const result={name,header_row:ri+1,score,layout,mapping,unmapped:mapping.filter(m=>!m.field).map(m=>m.source),missing:REQUIRED.filter(([f])=>!fields.has(f)).map(([,t])=>t),products:0};
    if(!best||score>best[0].score)best=[result,picked,headers,inferred,Boolean(years.length)];
  }
  if(!best)best=[{name,header_row:1,score:0,layout:'products',mapping:[],unmapped:[],missing:REQUIRED.map(([,t])=>t),products:0},new Map(),[],2000,false];
  const [report,picked,headers,inferred,hasYear]=best,records=new Map(),warnings=[],locations=new Map();
  report.accepted_rows=[];report.incoming_evidence=Object.create(null);report.reserved_warnings=Object.create(null);report.input_warnings=Object.create(null);report.reasons=[];
  const [number,style]=sheetNumbers(sheet,picked,report.header_row);
  const percentCells=new Set((sheet.percent_cells||[]).map(([row,col])=>`${row}:${col}`));
  warnings.push(`${name}: Number format: ${style}; review numeric text conventions.`);
  if(picked.has('on_order')&&headers[picked.get('on_order')[0]]!=='on_order'){
    const index=picked.get('on_order')[0],vals=rows.slice(report.header_row).filter(r=>index<r.length&&trim(r[index])).map(r=>number(r[index]));
    if(!vals.some(v=>NUMERIC.test(v)||v===AMBIGUOUS_NUMBER)){
      picked.delete('on_order');Object.assign(report.mapping[index],{field:null,confidence:'none',reason:'No numeric on_order values'});report.unmapped.push(headers[index]);
      warnings.push(`${name}: ${headers[index]} ignored: no numeric on_order values parsed; no incoming stock counted`);
    }
  }
  for(const [field,hits] of picked)if(hits.length>1&&isMonth(field))warnings.push(`${name}: duplicate month columns for ${field} summed; review mapping.`);
  if(headers.some(h=>yearless(trim(h).toLowerCase().startsWith('rcv:')?trim(h).slice(4):h)))warnings.push(`${name}: month labels without a year use ${inferred}`+(hasYear?' inferred from other headers.':'; no year found, review the fixed 2000 placeholder.'));
  let skipped=0;
  for(const [offset,row] of rows.slice(report.header_row).entries()){
    const rownum=report.header_row+1+offset;
    const get=f=>picked.has(f)&&picked.get(f)[0]<row.length?trim(row[picked.get(f)[0]]):'',sku=get('sku');
    if(!row.some(v=>trim(v)))continue;
    const summary=value=>{const k=key(value);return ['total','totals','grand total','subtotal','sub total'].includes(k)||[' total',' subtotal',' sub total'].some(s=>k.endsWith(s));};
    if(!sku||summary(sku)||summary(get('name'))){skipped++;continue;}
    if(['false','0','no','inactive'].includes(get('active').toLowerCase())||['true','1','yes','inactive'].includes(get('inactive').toLowerCase())){warnings.push(`${name}: row ${rownum} inactive in ERP; row omitted.`);continue;}
    // Preserve per-row preflight rejection before aggregation can hide it.
    const negativeFields=['on_hand','on_order'].filter(f=>report.layout!=='long'&&add('0',number(get(f))).startsWith('-'));
    if(negativeFields.length){warnings.push(`${name}: row ${rownum} negative ${negativeFields[0]} in ERP; row omitted.`);continue;}
    const location=Array.from(get('location').toLowerCase(),c=>c==='\u0131'?c:c.toUpperCase().toLowerCase()).join('');
    if(records.has(sku)){
      const record=records.get(sku);let reason=null;
      if((record.get('unit')||record.get('stock_unit')||'units')!==(get('unit')||get('stock_unit')||'units'))reason='conflicting stock units';
      else if(report.layout!=='long'){
        if(!picked.has('location'))reason='duplicate sku without warehouse/location';
        else if(location&&locations.get(sku).has(location))reason='duplicate sku at same warehouse/location';
        else if(picked.has('on_hand')&&(!record.get('on_hand')||!get('on_hand')))reason='missing on-hand stock for warehouse row';
      }
      if(reason){warnings.push(`${name}: ${sku}: ${reason}; first row kept; row omitted (${rownum}).`);continue;}
      if(report.layout!=='long'){
        warnings.push(`${name}: ${sku}: combined distinct warehouse/location rows; stock, on order, sales and receipts summed; first-row metadata kept.`);
        if(!location||locations.get(sku).has(''))warnings.push(`${name}: ${sku}: blank warehouse/location treated as Unspecified; all blank-location rows aggregated, including repeated blanks. Check for duplicate exports.`);
      }
    }
    report.accepted_rows.push(rownum-1);
    if(picked.has('on_hand'))(report.incoming_evidence[sku]??=[]).push(!!get('on_order'));
    if(picked.has('reserved')&&picked.has('on_hand')){
      const notes=report.reserved_warnings[sku]??=[],stock=number(get('on_hand')),held=number(get('reserved')||'0');
      if(NUMERIC.test(stock)&&NUMERIC.test(held)&&+stock>=0&&+stock<=1e12&&+held>+stock)notes.push('Oversold: reserved exceeds stock in a warehouse — available stock is netted across contributing warehouses, then floored at 0. Check allocations before ordering.');
      if(!get('reserved'))notes.push('Reserved cell is blank — counted as 0; check allocations before ordering.');
    }
    // Preserve stock-header provenance even when allocations join later.
    if(picked.has('on_hand')&&key(headers[picked.get('on_hand')[0]]).includes('available'))(report.reserved_warnings[sku]??=[]).push('Stock header says already available — subtracting reserved again may double-count allocations.');
    if(!records.has(sku))records.set(sku,new Map());const record=records.get(sku);
    if(!locations.has(sku))locations.set(sku,new Set());locations.get(sku).add(location);
    for(const [f,indices] of picked){
      if(['date','quantity','sku','location','active','inactive'].includes(f))continue;
      const monthly=isMonth(f),numeric=monthly||NUMERIC_FIELDS.has(f);
      const vals=indices.map(i=>i<row.length?(numeric?number(row[i],f==='supplier_days'):trim(row[i])):'');let value=vals[0];
      for(const [j,index] of indices.entries())if(numeric&&percentCells.has(`${rownum-1}:${index}`)&&vals[j])vals[j]=f==='demand_change_pct'?percent(vals[j]):'percentage-formatted quantity; use stock units';
      for(let j=0;j<vals.length;j++)if(monthly&&!f.startsWith('rcv:')&&report.layout!=='long'&&add('0',vals[j]).startsWith('-')){vals[j]='0';warnings.push(`${name}: ${sku}: negative sales in ${f} treated as 0 before warehouse aggregation.`);}
      value=vals[0];
      if(f==='reserved'&&value&&(!NUMERIC.test(value)||!Number.isFinite(+value)||+value<0||+value>1e12))value='Invalid reserved stock';
      if(monthly)for(const v of vals.slice(1))value=add(value,v);
      if(['on_hand','on_order','reserved'].includes(f)||monthly){
        if(report.layout==='long'&&['on_hand','on_order','reserved'].includes(f)){
          if(value&&!record.get(f))record.set(f,value);
          else if(value&&record.get(f)!==value&&!sameNumber(value,record.get(f))){
            if(f==='on_hand'){record.set(f,BALANCE_ERROR);warnings.push(`${name}: ${sku}: ${BALANCE_ERROR}.`);}
            else {const message=`${name}: differing ${f} for ${sku}; first value kept, not summed across transactions.`;warnings.push(message);if(f==='reserved'){report.reasons.push(message);(report.input_warnings[sku]??=[]).push(message);}}
          }
        }else record.set(f,add(record.get(f)||'',value));
      }else if(value){
        if(!record.has(f))record.set(f,value);
      }
    }
    if(report.layout==='long'){const m=month(get('date'),inferred);if(m)record.set(m,add(record.get(m)||'',number(get('quantity'))));else if(get('date'))warnings.push(`${name}: unrecognized transaction date for ${sku}; quantity not imported.`);}
  }
  if(skipped)warnings.push(`${name}: skipped ${skipped} summary or blank-code rows.`);
  for(const record of records.values())if(!record.get('unit')&&record.get('stock_unit'))record.set('unit',record.get('stock_unit'));
  // Public JSON-shaped reports keep ordinary prototypes; accumulation above is
  // null-prototype so product codes such as __proto__ remain literal keys.
  report.incoming_evidence=Object.fromEntries(Object.entries(report.incoming_evidence));
  report.reserved_warnings=Object.fromEntries(Object.entries(report.reserved_warnings));
  const metadata=contributorMetadata(sheet,report);
  for(const [sku,notes]of Object.entries(metadata.input_warnings))(report.input_warnings[sku]??=[]).push(...notes);
  report.reserved_missing=metadata.reserved_missing;
  if(picked.has('on_hand')&&!picked.has('reserved'))report.reserved_missing=Object.fromEntries([...records.keys()].map(sku=>[sku,[name]]));
  report.informational_skus=metadata.informational_skus;report.reasons=boundedMessages([...report.reasons,...metadata.reasons]);warnings.push(...metadata.reasons);if(metadata.informational_skus.length)warnings.push(metadataSummary(metadata.informational_skus));
  report.input_warnings=Object.fromEntries(Object.entries(report.input_warnings));
  report.products=records.size;return [report,records,boundedMessages(warnings),headers];
}

function shortLabel(value,limit=64){const chars=Array.from(value);return chars.length<=limit?value:chars.slice(0,limit-1).join('')+'…';}
function boundedMessages(messages){const unique=[...new Set(messages.map(message=>shortLabel(message,512)))];return unique.length<=100?unique:[...unique.slice(0,99),`${unique.length-99} more input warnings omitted; check all source rows before ordering.`];}
function metadataSummary(skus){skus=[...new Set(skus)];const labels=skus.slice(0,10).map(sku=>shortLabel(sku,24)).join(', '),remaining=skus.length>10?`; ${skus.length-10} more`:'';return `Metadata differences for ${skus.length} SKUs (${labels}${remaining}); first values kept. Informational only.`;}
function boundedInputWarnings(notes){const keys=Object.keys(notes).sort(),messages=[...new Set(keys.flatMap(sku=>notes[sku].map(note=>shortLabel(note,512))))],keep=new Set(messages.length>100?messages.slice(0,99):messages),omitted='Additional input warnings omitted; check all source rows before ordering.';return Object.fromEntries(Object.entries(notes).map(([sku,entries])=>[sku,[...new Set(entries.map(note=>{const text=shortLabel(note,512);return keep.has(text)?text:omitted;}))]]));}

export function contributorMetadata(sheet,meta){
  const picked=new Map((meta.mapping||[]).filter(m=>m.field).map(m=>[m.field,[m.index]])),headers=sheet.rows[meta.header_row-1]||[];
  const reserved=headers.findIndex(h=>REVIEW_ALIASES.reserved.includes(key(h))),[number]=sheetNumbers(sheet,picked,meta.header_row),accepted=new Set(meta.accepted_rows||[]);
  const warnings=new Map(),missing=new Map(),reasons=[],first=new Map(),identical=new Map(),informational=new Set();
  const mark=(sku,message)=>{message=shortLabel(message,512);if(!reasons.includes(message)&&reasons.length>=99)message='Additional input warnings omitted; check all source rows before ordering.';if(!warnings.has(sku))warnings.set(sku,[]);if(!warnings.get(sku).includes(message))warnings.get(sku).push(message);if(!reasons.includes(message))reasons.push(message);};
  for(const [offset,row]of sheet.rows.slice(meta.header_row).entries()){
    if(!accepted.has(meta.header_row+offset))continue;
    const get=f=>picked.has(f)?trim(row[picked.get(f)[0]]??''):'',sku=get('sku');if(!sku)continue;
    if(picked.has('on_hand')&&reserved>=0&&(reserved>=row.length||!trim(row[reserved])))missing.set(sku,[sheet.name]);
    if(meta.layout!=='long'&&!get('location')){const fingerprint=JSON.stringify(row);if(!identical.has(sku))identical.set(sku,new Set());const seen=identical.get(sku);if(seen.has(fingerprint))mark(sku,`Identical rows found for SKU ${shortLabel(sku)} — possible duplicate export`);seen.add(fingerprint);}
    if(!first.has(sku))first.set(sku,new Map());const values=first.get(sku);
    for(const field of picked.keys()){
      if(['sku','location','active','inactive','date','quantity','on_hand','on_order','reserved'].includes(field)||/^(?:rcv:)?[0-9]{4}-[0-9]{2}$/.test(field))continue;
      const value=NUMERIC_FIELDS.has(field)?number(get(field),field==='supplier_days'):get(field);
      if(value){if(values.get(field)&&values.get(field)!==value&&!(NUMERIC_FIELDS.has(field)&&sameNumber(values.get(field),value))){if(['supplier_days','unit','stock_unit','sales_unit'].includes(field))mark(sku,`${shortLabel(sheet.name)}: conflicting ${field} for ${shortLabel(sku)}; first value kept; acknowledge before ordering.`);else informational.add(sku);}if(!values.has(field))values.set(field,value);}
    }
  }
  if(informational.size){const summary=metadataSummary(informational);for(const sku of informational){if(!warnings.has(sku))warnings.set(sku,[]);warnings.get(sku).push(summary);}}
  return {input_warnings:Object.fromEntries(warnings),reserved_missing:Object.fromEntries(missing),reasons,informational_skus:[...informational]};
}

export function understandWorkbook(sheets,sheet=null,overrides=null,aliases={},productTypeAliases=[]){
  // Meaning-specific unit aliases take precedence over generic ERP unit labels.
  aliases={...REVIEW_ALIASES,...aliases};
  sheets=sheets.map(s=>({name:String(s.name??'Sheet'),delimiter:s.delimiter??null,percent_cells:s.percent_cells||[],rows:(s.rows||[]).map(r=>r.map(v=>String(v??'')))}));limits(sheets);
  if(new Set(sheets.map(s=>s.name)).size!==sheets.length)fail('Sheet names must be unique.');
  const analyses=sheets.map(s=>analyse(s,overrides||{},aliases,productTypeAliases));if(!analyses.length)fail('Workbook has no worksheets.');let base=0;
  if(sheet!==null&&sheet!==undefined){const found=sheets.findIndex((s,i)=>s.name===sheet||Number.isInteger(sheet)&&i===sheet);if(found<0)fail('Selected worksheet was not found.');base=found;}
  else{
    const priority=i=>{const report=analyses[i][0],fields=new Set(report.mapping.map(m=>m.field));return [Number(fields.has('sku')&&fields.has('on_hand')),Number(fields.has('sku')),report.score];};
    for(let i=1;i<sheets.length;i++){const a=priority(i),b=priority(base);for(let j=0;j<a.length;j++){if(a[j]>b[j]){base=i;break;}if(a[j]<b[j])break;}}
  }
  const report=analyses[base][0],products=new Map([...analyses[base][1]].map(([sku,v])=>[sku,new Map(v)])),warnings=analyses.flatMap(a=>a[2]).filter(w=>!w.startsWith('Metadata differences')),matched=new Set(),unmatched=new Set(),available=new Set(report.mapping.filter(m=>m.field).map(m=>m.field)),informational=new Set(analyses.flatMap(([a])=>a.informational_skus).filter(sku=>products.has(sku)));
  const hasSales=values=>[...values].some(([f,v])=>/^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/.test(f)&&v);let externalSales=false;
  const reasons=analyses.flatMap(([a])=>a.reasons),inputWarnings=Object.create(null),reservedMissing=Object.assign(Object.create(null),Object.fromEntries(Object.entries(report.reserved_missing).map(([sku,names])=>[sku,[...names]]))),reservedWarnings=Object.create(null),incomingEvidence=Object.assign(Object.create(null),Object.fromEntries(Object.entries(report.incoming_evidence).map(([sku,e])=>[sku,[...e]]))),baseStock=report.mapping.some(m=>m.field==='on_hand');
  const quantitySchema=meta=>new Set(meta.mapping.filter(m=>m.field&&isMonth(m.field)).map(m=>m.field)),baseSchema=quantitySchema(report);
  const stockSheets=baseStock?[report.name]:[],stockSources=new Map(baseStock?[...products.keys()].map(sku=>[sku,[report.name]]):[]),filledSources=new Map(),joinedReserved=new Set(),summedSources=new Set();
  const flag=(sku,message)=>{message=shortLabel(message,512);if(!reasons.includes(message)&&reasons.length>=99)message='Additional input warnings omitted; check all source rows before ordering.';warnings.push(message);reasons.push(message);(inputWarnings[sku]??=[]).push(message);};
  for(const [a]of analyses)for(const [sku,notes]of Object.entries(a.input_warnings))if(products.has(sku))(inputWarnings[sku]??=[]).push(...notes.filter(note=>!note.startsWith('Metadata differences')));
  for(const [a]of analyses)for(const [sku,notes]of Object.entries(a.reserved_warnings))if(products.has(sku))(reservedWarnings[sku]??=[]).push(...notes);
  for(const [i,[other,records]] of analyses.entries()){
    if(i===base)continue;externalSales=externalSales||[...records.values()].some(hasSales);for(const m of other.mapping)if(m.field)available.add(m.field);
    for(const [sku,values] of records){
      if(!products.has(sku)){unmatched.add(sku);continue;}matched.add(sku);const target=products.get(sku);
      if(target.get('unit')&&values.get('unit')&&target.get('unit')!==values.get('unit')){const message=`${other.name}: conflicting stock units for ${sku}; auxiliary row omitted, base sheet kept; acknowledge before ordering.`;flag(sku,message);continue;}
      const otherStock=other.mapping.some(m=>m.field==='on_hand');
      if(otherStock&&!target.get('on_hand')&&values.get('on_hand'))filledSources.set(sku,other.name);
      if(!otherStock&&values.get('reserved')&&!target.get('reserved'))joinedReserved.add(sku);
      // Transaction balances are snapshots; mismatched period columns may overlap.
      const otherSchema=quantitySchema(other),combineStock=baseStock&&otherStock&&report.layout!=='long'&&other.layout!=='long'&&baseSchema.size===otherSchema.size&&[...baseSchema].every(f=>otherSchema.has(f));
      if(combineStock&&target.get('on_hand')&&values.get('on_hand'))summedSources.add(sku);
      if(baseStock&&otherStock&&report.layout!=='long'&&other.layout!=='long'&&!combineStock){const message=`${other.name}: ambiguous repeated stock for ${sku}: incompatible quantity schema; base sheet values kept where present, not summed; acknowledge before ordering.`;flag(sku,message);}
      if(combineStock&&!stockSheets.includes(other.name))stockSheets.push(other.name);
      if(otherStock&&(combineStock||!baseStock))(incomingEvidence[sku]??=[]).push(...(other.incoming_evidence[sku]||[]));
      else if(values.get('on_order')&&!(incomingEvidence[sku]||[]).some(Boolean)&&(!otherStock||!target.get('on_order')))incomingEvidence[sku]=[true];
      if(otherStock&&(combineStock||!target.get('on_hand')&&values.get('on_hand'))){if(!stockSources.has(sku))stockSources.set(sku,[]);stockSources.get(sku).push(other.name);for(const name of other.reserved_missing[sku]||[])if(!(reservedMissing[sku]??=[]).includes(name))reservedMissing[sku].push(name);}
      for(const [field,value] of values){
        const quantityField=['on_hand','reserved','on_order'].includes(field)||isMonth(field);
        if(combineStock&&quantityField)target.set(field,add(target.get(field)||'',value));
        else if(!target.get(field))target.set(field,value);
        else if(value&&target.get(field)!==value&&!(NUMERIC_FIELDS.has(field)&&sameNumber(value,target.get(field)))){if(!quantityField&&!['supplier_days','unit','stock_unit','sales_unit'].includes(field))informational.add(sku);else{const message=`${shortLabel(other.name)}: conflicting ${field} for ${shortLabel(sku)}; base sheet value kept; acknowledge before ordering.`;flag(sku,message);}}
      }
    }
  }
  for(const names of stockSources.values())names.sort((a,b)=>sheets.findIndex(s=>s.name===a)-sheets.findIndex(s=>s.name===b));
  for(const [sku,names]of stockSources)if(filledSources.has(sku)&&!summedSources.has(sku))flag(sku,`Blank stock in sheet ${shortLabel(report.name)} was filled from sheet ${shortLabel(filledSources.get(sku))}. Check the selected base sheet before ordering.`);else if(names.length>1)flag(sku,'Stock from sheets '+names.join(', ')+' was added together. Confirm these are separate warehouses — not totals, copies or older snapshots.');
  if(stockSheets.length>1&&summedSources.size)warnings.push('Combined stock from sheets '+stockSheets.join(', '));
  if(unmatched.size)warnings.push(`${unmatched.size} product codes in other sheets did not match ${report.name}; not imported.`);
  const fields=products.size?new Set([...products.values()].flatMap(v=>[...v.keys()])):available;
  for(const sku of joinedReserved){delete reservedMissing[sku];reservedWarnings[sku]=(reservedWarnings[sku]||[]).filter(note=>!note.startsWith('Reserved cell is blank'));if(!reservedWarnings[sku].length)delete reservedWarnings[sku];}
  if(!fields.has('reserved'))for(const sku of Object.keys(reservedMissing))delete reservedMissing[sku];
  if(informational.size){const summary=metadataSummary(informational);warnings.push(summary);for(const sku of informational)(inputWarnings[sku]??=[]).push(summary);}
  const months=[...fields].filter(f=>/^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/.test(f)).sort(),receipts=[...fields].filter(f=>/^rcv:[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/.test(f)).sort(),headers=[...FIXED,...[...OPTIONAL,...PER_ITEM,...REVIEW_FIELDS].filter(f=>fields.has(f)),...months,...receipts],canonical=[headers];
  for(const [sku,values] of products)canonical.push(headers.map(f=>f==='sku'?sku:values.get(f)||(f==='unit'?'units':'')));
  const missing=REQUIRED.filter(([f])=>!products.size&&!available.has(f)||[...products].some(([sku,values])=>f==='sku'?!sku:!values.get(f)||f==='on_hand'&&values.get(f)===BALANCE_ERROR)).map(([,title])=>title);
  const noHistory=externalSales?[...products.values()].filter(v=>!hasSales(v)).length:0;
  if(noHistory){const message=`Sales history for ${noHistory} products (exact SKU match required)`;missing.push(message);warnings.push(message+'; unmatched history is not zero demand; cannot import.');}
  if(analyses.some(([a])=>a.mapping.some(m=>['medium','low'].includes(m.confidence))))warnings.push('Some mappings are suggestions; review medium/low-confidence columns before import.');
  const reviewName='Canonical review',reviewMeta={name:reviewName,header_row:1,mapping:headers.map((f,index)=>({index,source:f,field:f})),accepted_rows:canonical.slice(1).map((_,i)=>i+1)};
  const review_sheets=[{name:reviewName,rows:canonical}],review_report={sheet_used:reviewName,sheets:[reviewMeta],incoming_evidence:Object.fromEntries(Object.entries(incomingEvidence)),requires_ack:!!reasons.length,reasons:boundedMessages(reasons),input_warnings:boundedInputWarnings(inputWarnings),reserved_missing:Object.fromEntries(Object.entries(reservedMissing)),reserved_warnings:Object.fromEntries(Object.entries(reservedWarnings).map(([sku,notes])=>[sku,[...new Set(notes)]]))};
  return {review_sheets,review_report,input_warnings:review_report.input_warnings,reserved_missing:review_report.reserved_missing,sheets:analyses.map(a=>a[0]),sheet_used:report.name,header_row:report.header_row,layout:report.layout,mapping:report.mapping,unmapped:report.unmapped,missing,warnings:boundedMessages(warnings),match_report:{matched:matched.size,unmatched:unmatched.size},fingerprint:JSON.stringify(analyses.map(([a,,,h])=>[a.name,h])),canonical_rows:canonical};
}
