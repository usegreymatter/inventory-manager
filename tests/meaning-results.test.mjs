import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source=fs.readFileSync('standalone/design/smart-import.js','utf8')
const showSource=source.slice(source.indexOf('  function showMeaningResults(parsed){'),source.indexOf('  return {load,cancelPending,status}'))
assert.ok(showSource.includes('function showMeaningResults'))

// Minimal DOM adapter: executes the production renderer against each actual page
// shell. This checks ancestry/disclosure visibility, not browser pixels or CSS.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.textContent=''}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node)}}
  prepend(node){node.remove();node.parent=this;this.children.unshift(node)}
  before(node){assert.ok(this.parent);node.remove();node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),0,node)}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null}}
  setAttribute(key,value){this.attrs[key]=value}
  addEventListener(name,fn){this[name]=fn}
}
function descendants(root){return [root,...root.children.flatMap(descendants)]}
function pageDOM(path,{withoutWorklist=false,withoutMain=false}={}){
  const html=fs.readFileSync(path,'utf8'),body=new Element('body'),stack=[body]
  const shell=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').split(/<body\b[^>]*>/i)[1].split(/<\/body>/i)[0]
  const voidTags=new Set(['input','br','hr','img','meta','link','wbr'])
  for(const match of shell.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)){
    const [,closing,tag,attrs]=match
    if(closing){const index=stack.findLastIndex(n=>n.tag===tag);if(index>0)stack.length=index;continue}
    const node=new Element(tag)
    for(const attr of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){node.setAttribute(attr[1],attr[2]??'');if(attr[1]==='id')node.id=attr[2];if(attr[1]==='class')node.className=attr[2]}
    stack.at(-1).append(node)
    if(!voidTags.has(tag))stack.push(node)
  }
  // Arctic creates its worklist after the shell has loaded.
  const main=descendants(body).find(n=>n.tag==='main')
  if(!withoutWorklist&&html.includes("wlRoot.id='worklist'")){const worklist=new Element('section');worklist.id='worklist';main.append(worklist)}
  if(withoutWorklist)for(const node of descendants(body))if(node.id==='worklist')node.remove()
  if(withoutMain)for(const node of descendants(body))if(node.tag==='main'||node.className?.split(' ').includes('layout'))node.remove()
  return {body,createElement:tag=>new Element(tag),getElementById:id=>descendants(body).find(n=>n.id===id)||null,querySelector:selector=>descendants(body).find(n=>selector==='main'?n.tag==='main':selector==='.layout'&&n.className?.split(' ').includes('layout'))||null}
}
function renderer(document){
  const context=vm.createContext({document,localStorage:{setItem(){assert.fail('warning dismissal must not persist')}}})
  vm.runInContext(source.match(/  const el=.*\n/)[0]+showSource+'\nglobalThis.show=showMeaningResults',context)
  return context.show
}
function visible(node){for(let n=node;n;n=n.parent)if('hidden' in n.attrs||n.tag==='details'&&!('open' in n.attrs)||n.tag==='dialog'&&!('open' in n.attrs))return false;return true}
const parsed={items:[{sku:'A',input_warnings:['Check reserved stock']}],input_meaning:{warnings:['Check imported quantities']}}
const pages=['standalone/inventory-manager.html','standalone/inventory-manager-demo-1000.html',...['baseline','option-a','option-a2','option-a3','option-b','option-gm-a','option-gm-b','option-gm-c'].map(n=>`standalone/design/${n}.html`)]
for(const path of pages)for(const withoutWorklist of [false,true]){
  test(`${path}: ${withoutWorklist?'fallback':'normal'} warning summary stays outside collapsed import controls`,()=>{
    const document=pageDOM(path,{withoutWorklist}),show=renderer(document)
    const status=document.getElementById('source-status');assert.ok(status)
    show(parsed)
    const banner=document.getElementById('input-meaning-results')
    assert.ok(banner?.parent,'persistent section is mounted')
    assert.equal(banner.tag,'section');assert.equal(visible(banner),true)
    assert.ok(banner.children.some(n=>n.tag==='p'&&n.textContent==='Check imported quantities'&&visible(n)))
    show(parsed);assert.equal(descendants(document.body).filter(n=>n.id==='input-meaning-results').length,1)
    document.getElementById('input-meaning-results').children.find(n=>n.tag==='button').click()
    assert.equal(document.getElementById('input-meaning-results'),null)
    assert.deepEqual(parsed.items[0].input_warnings,['Check reserved stock'])
    show(parsed);assert.ok(document.getElementById('input-meaning-results'))
    show({items:[]});assert.equal(document.getElementById('input-meaning-results'),null)
  })
}
test('no layout or main: body is a visible, persistent warning anchor',()=>{
  const document=pageDOM(pages[2],{withoutWorklist:true,withoutMain:true})
  renderer(document)(parsed)
  assert.equal(document.getElementById('input-meaning-results')?.parent,document.body)
})
test('empty global warnings fall back to item warning paragraphs as literal text',()=>{
  const document=pageDOM('standalone/design/option-a3.html'),show=renderer(document)
  const warning='<img src=x onerror=alert(1)> Check reserved stock'
  show({items:[{sku:'A',input_warnings:[warning]}],input_meaning:{warnings:[]}})
  const banner=document.getElementById('input-meaning-results')
  assert.ok(banner.children.some(n=>n.tag==='p'&&n.textContent===warning&&visible(n)))
  assert.equal(descendants(banner).some(n=>n.tag==='img'),false)
})
test('reserved review fixture is outside the deterministic generator directory',()=>{
  assert.ok(fs.existsSync('tests/fixtures/review-import/v_reserved_one_sheet.xlsx'))
  assert.equal(fs.existsSync('tests/fixtures/smart-import/v_reserved_one_sheet.xlsx'),false)
  const capture=fs.readFileSync('standalone/capture-warning-visibility.cjs','utf8')
  assert.ok(capture.includes('tests/fixtures/review-import/v_reserved_one_sheet.xlsx'))
})
