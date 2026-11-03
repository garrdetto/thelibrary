import { chromium } from 'playwright'
const [,,url,out]=process.argv
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}); const p=await b.newPage({viewport:{width:1200,height:1400}})
p.on('console',m=>console.log(m.text())); p.on('pageerror',e=>console.log('ERR',e.message))
await p.goto(url); await p.waitForFunction(()=>window.done,null,{timeout:120000}); await p.locator('canvas').screenshot({path:out}); await b.close()
