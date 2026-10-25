"""v5 focused regression: editing saved tasting, iOS form controls and keyboard layout fallback."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import re, json
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text()
html=re.sub(r'<link[^>]+>', '', html).replace('<script src="./app.js" defer></script>','')
mock='''
const __records = new Map(); window.__mockRecords = __records;
const db={objectStoreNames:{contains:()=>true},createObjectStore:()=>({createIndex:()=>{}}),
 transaction:(_store,mode)=>{const tx={oncomplete:null,onerror:null,onabort:null};
 tx.objectStore=()=>({getAll:()=>{const req={};setTimeout(()=>{req.result=[...__records.values()];req.onsuccess?.();},0);return req;},
 put:r=>{__records.set(r.id,structuredClone(r));setTimeout(()=>tx.oncomplete?.(),0);},
 delete:id=>{__records.delete(id);setTimeout(()=>tx.oncomplete?.(),0);}});return tx;}};
Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:()=>{const req={result:db};setTimeout(()=>req.onsuccess?.(),0);return req;}}});
'''
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
  errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.set_content(html,wait_until='domcontentloaded');page.add_style_tag(content=(root/'styles.css').read_text());page.evaluate(mock);page.add_script_tag(content=(root/'app.js').read_text());page.wait_for_timeout(100)
  # iPhone focus autozoom mitigation: computed font size >=16 for all user-typed controls
  css=page.evaluate('''()=>Object.fromEntries(['productName','shopName','productMemo','productUrl','amount','comment','generalJSON','searchBox'].map(id=>{
   const e=document.getElementById(id);return [id,e?parseFloat(getComputedStyle(e).fontSize):null];}))''')
  assert all(size is None or size>=16 for size in css.values()),css
  assert page.locator('meta[name="viewport"]').get_attribute('content').find('user-scalable=no')<0

  # Start tasted record; submit -> detail; immediate edit CTA must be available
  page.locator('#addBtn').click();page.locator('#productName').fill('実食編集検証');page.locator('#shopName').fill('テスト老舗');
  page.locator('#productForm button[type=submit]').click();page.wait_for_timeout(100)
  page.locator('#amount').fill('20g');page.locator('#comment').fill('初回の感想');page.locator('input[data-group="quality"][data-key="overall"]').fill('7')
  page.locator('#tasteForm button[type=submit]').click();page.wait_for_timeout(160)
  assert page.locator('#detailDialog').evaluate('(e)=>e.open')
  assert page.locator('[data-action="edit-latest"]').count()==2
  assert '（1回）' in page.locator('#detailContent').inner_text()
  stored=page.evaluate('Array.from(__mockRecords.values())')[0]
  session_id=stored['sessions'][0]['id'];record_id=stored['id'];assert stored['sessions'][0]['quality']['overall']==7
  # edit after saving and confirm ID is preserved, no duplicate
  page.locator('[data-action="edit-latest"]').first.click();page.wait_for_timeout(80)
  assert page.locator('#tasteDialog').evaluate('(e)=>e.open')
  assert page.locator('#tasteId').input_value()==session_id
  assert page.locator('#comment').input_value()=='初回の感想'
  assert page.locator('#tasteSaveButton').inner_text()=='変更を保存する'
  page.locator('#amount').fill('30g');page.locator('#comment').fill('あとから修正');page.locator('input[data-group="quality"][data-key="overall"]').fill('9')
  page.locator('#tasteSaveButton').click();page.wait_for_timeout(150)
  saved=page.evaluate('Array.from(__mockRecords.values())')[0]
  assert saved['id']==record_id and len(saved['sessions'])==1,saved
  assert saved['sessions'][0]['id']==session_id and saved['sessions'][0]['amount']=='30g'
  assert saved['sessions'][0]['quality']['overall']==9 and saved['sessions'][0]['comment']=='あとから修正'
  assert '（1回）' in page.locator('#detailContent').inner_text()
  assert '9.0' in page.locator('#comparisonPanel').inner_text()
  # edit again from chart to ensure second CTA works
  page.locator('[data-action="edit-latest"]').nth(1).click()
  assert page.locator('#tasteId').input_value()==session_id
  page.locator('#tasteClose').click();page.wait_for_timeout(50)
  # Add another tasting then edit older one
  page.get_by_role('button', name=re.compile('実食編集検証')).click()
  page.locator('[data-action="taste"]').click()
  page.locator('#tastedDate').fill('2026-10-26');page.locator('#comment').fill('二回目')
  page.locator('input[data-group="quality"][data-key="overall"]').fill('6')
  page.locator('#tasteForm button[type=submit]').click();page.wait_for_timeout(160)
  assert '（2回）' in page.locator('#detailContent').inner_text()
  page.locator('[data-session]').last.click();page.wait_for_timeout(80)
  assert page.locator('#tasteId').input_value()==session_id
  page.locator('#comment').fill('一回目だけ変更');page.locator('input[data-group="quality"][data-key="overall"]').fill('8')
  page.locator('#tasteSaveButton').click();page.wait_for_timeout(150)
  stored=page.evaluate('Array.from(__mockRecords.values())')[0]
  assert len(stored['sessions'])==2
  first=next(s for s in stored['sessions'] if s['id']==session_id)
  second=next(s for s in stored['sessions'] if s['id']!=session_id)
  assert first['quality']['overall']==8 and first['comment']=='一回目だけ変更'
  assert second['quality']['overall']==6 and second['comment']=='二回目'
  # backup remains unchanged v4 format
  page.locator('[data-action="close"]').click();page.locator('.tab[data-tab="guide"]').click()
  with page.expect_download() as info:page.locator('#export').click()
  exported=info.value
  out=root/'tests'/'v5-backup-check.json';exported.save_as(str(out))
  payload=json.loads(out.read_text());out.unlink()
  assert payload['version']==4 and len(payload['records'])==1
  assert len(payload['records'][0]['sessions'])==2
  # Modal can scroll and is not touch-scrolling-locked
  page.locator('#addBtn').click()
  overflow=page.locator('#productDialog').evaluate('(e)=>getComputedStyle(e).overflowY')
  assert overflow=='auto',overflow
  page.locator('#productClose').click()
  assert not errors,errors
  print('PASS v5: saved edit CTA, re-edit ID stable, edit older session, no duplicate, 16px iOS inputs, scrollable dialog, v4 backup format.')
  browser.close()
