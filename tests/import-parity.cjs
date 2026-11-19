const fs=require('node:fs'),vm=require('node:vm')
const source=fs.readFileSync('desktop/plugin.js','utf8'),ctx=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,btoa})
vm.runInContext(source.slice(source.indexOf('const SAMPLE ='),source.indexOf('const pageStyle =')).replaceAll('export ','')+'\nglobalThis.api={parseCsv,decodeCsvBytes}',ctx)
const results={}
for(const file of process.argv.slice(2))try{results[file]={data:ctx.api.parseCsv(ctx.api.decodeCsvBytes(fs.readFileSync(file)))}}catch(e){results[file]={error:e.message,...(e.import_report?{import_report:e.import_report}:{})}}
console.log(JSON.stringify(results))
