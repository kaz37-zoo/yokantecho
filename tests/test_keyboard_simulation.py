"""Keyboard visualViewport height branch simulation, not an iOS hardware test."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=re.sub(r'<link[^>]+>','',(root/'index.html').read_text()).replace('<script src="./app.js" defer></script>','')
mock='''
window.__vv=new EventTarget(); Object.assign(window.__vv,{height:844,scale:1});
Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__vv});
const db={objectStoreNames:{contains:()=>true},createObjectStore:()=>({createIndex:()=>{}}),transaction:()=>({objectStore:()=>({getAll:()=>{const req={};setTimeout(()=>{req.result=[];req.onsuccess?.()},0);return req}})})};
Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:()=>{const req={result:db};setTimeout(()=>req.onsuccess?.(),0);return req}}});
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
    page.set_content(html);page.add_style_tag(content=(root/'styles.css').read_text());page.evaluate(mock);page.add_script_tag(content=(root/'app.js').read_text());page.wait_for_timeout(80)
    page.locator('#addBtn').click();page.locator('#productName').focus()
    page.evaluate('''()=>{window.__vv.height=440;window.__vv.dispatchEvent(new Event('resize'))}''')
    page.wait_for_timeout(230)
    assert page.locator('#productDialog').evaluate('(e)=>e.style.getPropertyValue("--editor-view-height")')=='440px'
    assert page.locator('#productDialog').evaluate('(e)=>getComputedStyle(e).height')=='440px'
    page.locator('#productName').blur();page.evaluate('''()=>{window.__vv.height=844;window.__vv.dispatchEvent(new Event('resize'))}''')
    page.wait_for_timeout(250)
    assert not page.locator('#productDialog').evaluate('(e)=>e.style.getPropertyValue("--editor-view-height")')
    page.locator('#productClose').click();assert not errs,errs
    print('PASS: simulated visualViewport keyboard 440px -> dialog 440px, blur restores default.')
    browser.close()
