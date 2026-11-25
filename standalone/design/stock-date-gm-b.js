// Lifecycle: living. Optional "stock counted on" date for the loaded file only.
// Adapt input only: the shared core applyStockDate (mirrors engine.py) translates
// counted stock to the as-of balance; standaloneRows/evaluateDataset/orderGuidance
// own every projection, run-out, order-by and quantity calculation.
const stockDate={dataset:null,value:''}
const stockDateField=node('label',null,'stock-date-control');stockDateField.htmlFor='stock-date'
const stockDateInput=document.createElement('input');stockDateInput.type='date';stockDateInput.id='stock-date';stockDateInput.setAttribute('aria-describedby','stock-date-message')
const stockDateMessage=node('p',null,'stock-date-message');stockDateMessage.id='stock-date-message';stockDateMessage.setAttribute('role','status')
stockDateField.append(node('span','Stock counted on'),stockDateInput)
document.querySelector('.tools-body').prepend(stockDateField,stockDateMessage)
function stockDateActive(dataset,today){
 const value=stockDate.dataset===data?stockDate.value:''
 return value&&!stockDateReason(value,dataset.as_of,today)?value:''
}
function stockDateSync(){
 if(stockDate.dataset!==data){stockDate.dataset=data;stockDate.value='';stockDateInput.value=''}
 const today=currentToday||localToday(),reason=stockDate.value?stockDateReason(stockDate.value,data.as_of,today):null,notice=stockDate.value?null:stockDateNotice(data.as_of,today)
 stockDateInput.min=typeof data.as_of==='string'?data.as_of.slice(0,7)+'-01':'';stockDateInput.max=today
 stockDateMessage.textContent=reason?reason+' Not applied.':stockDate.value?`Run-out and order dates start from ${gmDate(stockDate.value)}. Sales before the count are not subtracted again.`:notice||''
 stockDateMessage.classList.toggle('stock-date-warning',!!(reason||notice))
 stockDateMessage.hidden=!stockDateMessage.textContent
}
const stockDateBaseRows=standaloneRows
standaloneRows=function(dataset,today,options){
 const value=stockDateActive(dataset,today)
 return stockDateBaseRows(value?applyStockDate(dataset,value,today,options):dataset,today,options)
}
const stockDateBaseLabel=gmSnapshotLabel
gmSnapshotLabel=function(...args){
 const result=stockDateBaseLabel(...args),value=stockDateActive(data,currentToday||localToday())
 if(value)$('snapshot').textContent+=` · stock counted ${gmDate(value)}`
 return result
}
stockDateInput.addEventListener('change',()=>{stockDate.dataset=data;stockDate.value=stockDateInput.value;evaluationSnapshot=null;render()})
const stockDateBaseRender=render
render=function(...args){stockDateSync();return stockDateBaseRender(...args)}
stockDateSync()
