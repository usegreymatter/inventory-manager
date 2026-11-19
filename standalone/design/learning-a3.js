// Opt-in local learning; no raw CSV is persisted. Existing diary rows never change.
const LEARNING_KEY='stock-runway.learning.settings.v1',DIARY_KEY='stock-runway.forecast-diary.v1',LOG_KEY='stock-runway.learning-log.v1'
let learningSettings=normalizeLearningSettings(),learningDiary=[],learningLog=[],learningStoragePaused=false
// Load keys independently: a bad log must never erase a healthy diary.
function readLearningStorage(key,array=false){
  try{
    const value=JSON.parse(localStorage.getItem(key))
    if(value!==null&&(array?!Array.isArray(value):typeof value!=='object'||Array.isArray(value)))throw Error('Invalid learning storage')
    return value
  }catch{learningStoragePaused=true;return null}
}
// Settings validators depend on core constants declared later in the bundle.
learningSettings={...learningSettings,...readLearningStorage(LEARNING_KEY)}
learningDiary=readLearningStorage(DIARY_KEY,true)||[]
learningLog=readLearningStorage(LOG_KEY,true)||[]
if(learningStoragePaused)learningSettings={...learningSettings,learning_enabled:false}
function learningPaused(){if(!learningStoragePaused)return false;$('learning-status').textContent='Learning paused';return true}
function saveLearningSettings(next){
  if(learningPaused())return
  const value=normalizeLearningSettings(next)
  try{localStorage.setItem(LEARNING_KEY,JSON.stringify(value));learningSettings=value;$('learning-status').textContent=STRINGS.learningLocal}
  catch{$('learning-status').textContent=STRINGS.learningStorageError}
  render()
}
function recordLearning(prepared){
  if(learningPaused())return false
  const events=appendLearningRows(learningLog,learningEvents(data,learningDiary,learningSettings,learningLog))
  if(events.length!==learningLog.length){
    try{localStorage.setItem(LOG_KEY,JSON.stringify(events));learningLog=events}
    catch{learningSettings={...learningSettings,learning_enabled:false};$('learning-status').textContent=STRINGS.learningStorageError;return false}
  }
  if(!learningSettings.archive_enabled)return true
  const next=appendLearningRows(learningDiary,forecastDiary(prepared))
  if(next.length===learningDiary.length)return true
  try{localStorage.setItem(DIARY_KEY,JSON.stringify(next));learningDiary=next}
  catch{$('learning-status').textContent=STRINGS.learningStorageError}
  return true
}
function decideLearning(id,action){
  if(learningPaused())return
  try{
    const result=learningDecision(data,learningDiary,learningSettings,learningLog,id,action)
    const next=appendLearningRows(learningLog,result.events)
    localStorage.setItem(LOG_KEY,JSON.stringify(next));learningLog=next
    saveLearningSettings(result.settings)
  }catch{$('learning-status').textContent=STRINGS.learningStorageError}
}
function updateLearningPanel(){
  $('archive-forecasts').checked=learningSettings.archive_enabled
  $('bias-auto-fix').checked=learningSettings.learning_enabled
  const report=learningReport(data,learningDiary,learningSettings,learningLog),body=$('accuracy-report')
  body.replaceChildren();body.dataset.state=report.state
  if(learningPaused()){body.append(node('p','Learning paused'));return}
  if(report.state==='hidden'){body.append(node('p',STRINGS.learningOptIn));return}
  const health=dataHealth(prepareLearning(data,learningDiary,learningSettings),currentToday,settings).features.learning
  body.dataset.capability=health?.state||'locked'
  body.append(stat(STRINGS.accuracy,report.accuracy==null?STRINGS.pending:(report.accuracy*100).toFixed(1)+'%'))
  body.append(stat(STRINGS.monthChange,report.change==null?STRINGS.pending:(report.change>=0?'+':'')+(report.change*100).toFixed(1)+' pp'))
  body.append(node('p',report.count+' '+STRINGS.maturedMonths))
  for(const [method,count] of Object.entries(report.methods))body.append(stat(STRINGS['method_'+method]||method,String(count)))
  const changes=node('ul');changes.dataset.learningChanges=''
  for(const change of report.changes.filter(c=>c.state!=='proposal')){
    const li=node('li');li.dataset.learningSku=change.sku
    li.append(node('strong',change.sku),node('span',' · '+learningChangeText(change)))
    if(change.state==='applied'&&change.kind==='bias_correction'){
      const undo=node('button',STRINGS.undo);undo.type='button';undo.dataset.undoCorrection=change.sku
      undo.addEventListener('click',()=>saveLearningSettings({...learningSettings,learning_disabled_skus:[...learningSettings.learning_disabled_skus,change.sku]}));li.append(undo)
    }
    changes.append(li)
  }
  for(const proposal of report.pending){
    const li=node('li');li.dataset.pendingProposal=proposal.id
    li.append(node('strong',proposal.sku),node('span',' · '+learningChangeText(proposal,false)))
    if(proposal.kind==='bias_correction')li.append(node('span',' · '+((proposal.factor-1)*100).toFixed(1)+'% · 15% cap'))
    else li.append(node('span',' · '+(STRINGS['method_'+proposal.method_before]||proposal.method_before)+' → '+(STRINGS['method_'+proposal.method_after]||proposal.method_after)))
    const approve=node('button',STRINGS.approve),dismiss=node('button',STRINGS.dismiss)
    approve.type=dismiss.type='button';approve.dataset.approveProposal=proposal.id;dismiss.dataset.dismissProposal=proposal.id
    approve.addEventListener('click',()=>decideLearning(proposal.id,'approve'));dismiss.addEventListener('click',()=>decideLearning(proposal.id,'dismiss'))
    const actions=node('span');actions.className='proposal-actions';actions.append(approve,dismiss)
    li.append(actions);changes.append(li)
  }
  body.append(changes)
  const history=node('details');history.append(node('summary',STRINGS.changeLog));history.dataset.learningLog=''
  for(const event of report.log){
    const line=node('p',event.when+' · '+event.sku+' · '+learningChangeText(event))
    line.title=JSON.stringify({before:event.before,after:event.after});history.append(line)
  }
  body.append(history)
}
function initializeLearning(){
  learningSettings=normalizeLearningSettings(learningSettings)
  $('archive-forecasts').addEventListener('change',e=>saveLearningSettings({...learningSettings,archive_enabled:e.target.checked}))
  $('bias-auto-fix').addEventListener('change',e=>saveLearningSettings({...learningSettings,learning_enabled:e.target.checked}))
}
