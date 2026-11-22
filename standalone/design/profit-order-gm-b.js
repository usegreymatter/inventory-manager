// Lifecycle: living. Separate suggestion only; purchasing actions use current qty.
function profitOrderLine(row){
 if(!row?.guidance?.profit_suggestion&&!row?.guidance?.profit_suggestion_unavailable)return null
 const line=node('p',profitSuggestionSentence(row.guidance),'decision-why');line.dataset.profitSuggestion='true'
 line.title='Synthetic demand simulation, not a guarantee. Ordering now over the review period can differ from the existing cover-based future order.'
 const warning=StockRunwayProfitWarnings.warning(row.item,row.guidance,resolveOrderSettings(row.item,settings).values.review_days)
 if(warning){const note=node('span',warning,'profit-suggestion-warning');note.dataset.profitSuggestionWarning='true';note.style.display='block';line.append(note)}
 return line
}
const profitDrawBase=drawProductPage
// Keep both the product page and side panel text-only and setting-gated.
drawProductPage=function(row){profitDrawBase(row);const line=profitOrderLine(row);if(line)productPage.overlay?.querySelector('.product-page-figures')?.after(line)}
const profitPanelBase=chartPanel
chartPanel=function(row){const panel=profitPanelBase(row),line=profitOrderLine(row);if(line)(panel.querySelector('.decision')||panel.querySelector('.product-heading'))?.after(line);return panel}
if(productPage.overlay)drawProductPage(rowMap.get(selectedSku))
