// Test-only transport. macOS sync child pipes can leave Python json.load waiting
// for EOF under suite load (Python _Py_read, Node SyncProcessRunner polling).
// A regular stdin file has deterministic EOF; bound every child and always clean up.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process')
module.exports=function pythonStdin(args,input,options={}){
 const root=options.cwd||process.cwd(),scratch=path.join(root,'.scratch')
 fs.mkdirSync(scratch,{recursive:true})
 const dir=fs.mkdtempSync(path.join(scratch,'python-stdin-'));let fd
 try{
  const file=path.join(dir,'input.json');fs.writeFileSync(file,input,{mode:0o600});fd=fs.openSync(file,'r')
  return spawnSync(process.env.PYTHON||'/usr/bin/python3',args,{...options,encoding:'utf8',timeout:Math.min(options.timeout??120000,120000),maxBuffer:64*1024*1024,stdio:[fd,'pipe','pipe']})
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(dir,{recursive:true,force:true})}
}
