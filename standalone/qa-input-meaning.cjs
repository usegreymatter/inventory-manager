// Offline capture actions: explicitly answer the import questions, never bypass the gate.
async function confirmMeaning(page) {
  const units=page.locator('#meaning-units')
  if(await units.count())await units.check()
  const desktopUnits=page.getByRole('checkbox',{name:'Units — sales and stock use the same unit',exact:true})
  if(await desktopUnits.count())await desktopUnits.check()
  const ack=page.getByRole('checkbox',{name:'Show orders anyway',exact:true})
  if(await ack.count())await ack.check()
}
async function acceptMeaning(page) {
  // A remembered clean layout can skip review; invalid files remain errors.
  const review=page.getByRole('heading',{name:'Before we suggest orders',exact:true})
  try{await review.waitFor({state:'visible',timeout:1200})}catch{return}
  await confirmMeaning(page)
  await page.getByRole('button',{name:'Use this',exact:true}).click()
}
module.exports={confirmMeaning,acceptMeaning}
