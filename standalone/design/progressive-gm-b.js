// Presentation scheduler only: shared row computation/order and final sorting
// stay unchanged. A cancelled dataset/settings job may never publish stale rows.
const progressiveBaseRender=render
let analysisJob=null
const analysisProgress=node('p',null,'analysis-progress product-note')
analysisProgress.id='analysis-progress';analysisProgress.setAttribute('role','status');analysisProgress.setAttribute('aria-live','polite');analysisProgress.hidden=true;wlSummary.before(analysisProgress)
function analysisYield(fn){setTimeout(fn,0)}
function analysisPublish(job,complete){
  currentRows=sortRows(job.rows.map(r=>r.item)).map(i=>job.byItem.get(i))
  rowMap=new Map(currentRows.map(r=>[r.item.sku,r]));seriesCache=new WeakMap()
  // Only the complete catalog can decide the implicit initial tab. In
  // particular, the first batch may be healthy while a later row needs orders.
  if(complete&&gmBInitialRestorePending){
    // Replay the pre-worklist selection/filter rule with the complete rows,
    // without drawing charts or letting its hash writer normalize an empty SKU.
    selectedSku=attentionRows(currentRows)[0]?.item.sku||currentRows[0]?.item.sku
    gmBStartupBrowseList();gmReadBrowseHash(gmBRestoreHash)
    const params=new URLSearchParams(gmBRestoreHash.slice(1))
    if(rowMap.has(params.get('sku')))selectedSku=params.get('sku')
    gmBStartupBrowseList()
    if(filteredRows.length&&!filteredRows.some(r=>r.item.sku===selectedSku))selectedSku=filteredRows[0].item.sku
    wlRestore(gmBRestoreHash)
    if(!['state','view','status','q'].some(k=>params.has(k)))wl.status=currentRows.some(r=>r.bucket==='order')?'order':'all'
  }
  buildList()
  if(!job.painted){job.painted=true;requestAnimationFrame(()=>{document.body.dataset.analysisFirstUsefulMs=String(performance.now()-job.started);document.body.dataset.analysisFirstUsefulAt=String(performance.now())})}
  if(complete){
    updateLearningPanel();updateHealth();finishEvaluationSnapshot();analysisJob=null
    analysisIncomplete=false
    const restore=gmBInitialRestorePending;gmBInitialRestorePending=false
    progressiveBaseRender()
    if(restore)restoreInitialProductPage(gmBRestoreHash)
    analysisProgress.hidden=true;wlRoot.removeAttribute('aria-busy')
    document.body.dataset.analysisState='complete';document.body.dataset.analysisFullMs=String(performance.now()-job.started);document.body.dataset.analysisFullAt=String(performance.now())
  }
}
render=function(...args){
  gmLoadDatasetSettings();localOrderLoad()
  return withDatasetEvaluation(()=>{
    if(evaluationSnapshot.ready||data.items.length<=1000){
      analysisJob=null;analysisIncomplete=false
      const result=progressiveBaseRender(...args)
      analysisProgress.hidden=true;wlRoot.removeAttribute('aria-busy');document.body.dataset.analysisState='complete';return result
    }
    if(analysisJob?.snapshot===evaluationSnapshot)return
    analysisIncomplete=true
    // A previously opened draft/report must not retain live copy/export closures
    // while settings or a new file are being evaluated.
    $('order-email-dialog')?.close();$('weekly-summary')?.close();removeProductPage();wlCloseDrawer({focus:false})
    currentRows=[];rowMap=new Map();buildList()
    currentToday=localToday()
    document.body.dataset.analysisState='running';wlRoot.setAttribute('aria-busy','true');analysisProgress.hidden=false
    const fail=error=>{
      analysisJob=null;analysisIncomplete=true
      analysisProgress.hidden=false;analysisProgress.textContent='Could not finish analysis. Choose another file or go back to sample data.';wlRoot.removeAttribute('aria-busy');document.body.dataset.analysisState='error';console.error(error)
    }
    let prepared
    try{
      learningSettings=normalizeLearningSettings(learningSettingsFromLog(data,learningSettings,learningLog))
      prepared=prepareLearning(data,learningDiary,learningSettings)
      if(recordLearning(prepared)===false)prepared=prepareLearning(data,learningDiary,learningSettings)
    }catch(error){fail(error);return}
    const job=analysisJob={snapshot:evaluationSnapshot,prepared,today:currentToday,settings,rows:[],byItem:new Map(),at:0,painted:false,started:performance.now()}
    const step=()=>{
      if(analysisJob!==job||evaluationSnapshot!==job.snapshot)return
      // Refresh the key before every batch: settings/import changes invalidate
      // even when a long-lived input object is edited rather than replaced.
      if(job.snapshot.data!==data||job.snapshot.key!==evaluationSnapshotKey()){analysisJob=null;render();return}
      try{
        withEvaluationPass(()=>{
          const start=performance.now()
          do{
            const rows=standaloneRows({...job.prepared,items:[job.prepared.items[job.at++]]},job.today,job.settings)
            for(const r of rows){job.rows.push(r);job.byItem.set(r.item,r)}
          }while(job.at<job.prepared.items.length&&performance.now()-start<40)
          if(!job.painted||job.at===job.prepared.items.length)analysisPublish(job,job.at===job.prepared.items.length)
        },job.snapshot.memo)
        analysisProgress.textContent='Analysing '+job.at.toLocaleString('en-US')+' / '+job.prepared.items.length.toLocaleString('en-US')+'… Results are incomplete until analysis finishes.'
        document.body.dataset.analysisProcessed=String(job.at)
        if(job.at<job.prepared.items.length)analysisYield(step)
      }catch(error){fail(error)}
    }
    analysisYield(step)
  })
}
// Fail closed at action boundaries, not just pointer targets. These also cover
// keyboard/whole-row activation, inline callbacks and programmatic entrypoints.
// Incompleteness survives errors; job existence alone is not a readiness signal.
function analysisDeny(){
  // A completed job can become stale between UI refreshes (for example at
  // midnight). Validate before details/summary code can call renderPass itself.
  if(!analysisIncomplete&&data.items.length>1000){
    withDatasetEvaluation(()=>{})
    if(!evaluationSnapshot.ready||currentToday!==localToday())render()
  }
  if(!analysisIncomplete)return false
  analysisProgress.hidden=false
  if(document.body.dataset.analysisState!=='error')analysisProgress.textContent='Analysis is still running. Orders, exports and product details will be ready when it finishes.'
  return true
}
function analysisGuard(fn,blocked){return function(...args){if(analysisDeny())return blocked;return fn.apply(this,args)}}
wlOpen=analysisGuard(wlOpen)
openProductPage=analysisGuard(openProductPage)
selectItem=analysisGuard(selectItem)
navigateSku=analysisGuard(navigateSku)
openWhy=analysisGuard(openWhy)
wlCopy=analysisGuard(wlCopy)
wlDraftEmail=analysisGuard(wlDraftEmail)
wlExport=analysisGuard(wlExport)
wlExcel=analysisGuard(wlExcel)
weeklySummaryOpen=analysisGuard(weeklySummaryOpen)
localOrderSave=analysisGuard(localOrderSave,false)
localOrderMark=analysisGuard(localOrderMark,false)
purchaseOrderText=analysisGuard(purchaseOrderText,'')
wlOrderText=analysisGuard(wlOrderText,'')
wlCsv=analysisGuard(wlCsv,'')
wlDownload=analysisGuard(wlDownload)
// The legacy menu copy handler writes directly to the clipboard; intercept it
// before it can turn even an empty guarded order string into a clipboard write.
document.addEventListener('click',event=>{
  if(analysisIncomplete&&event.target.closest('#copy-po,#download-excel')&&analysisDeny()){
    event.preventDefault();event.stopImmediatePropagation()
  }
},true)
