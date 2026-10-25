from playwright.sync_api import sync_playwright
from pathlib import Path
import json,re,math
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text()
html=re.sub(r'<link[^>]+>', '', html)
html=html.replace('<script src="./app.js" defer></script>','')
mock='''
const __records = new Map();
window.__mockRecords = __records;
const db={objectStoreNames:{contains:()=>true},createObjectStore:()=>({createIndex:()=>{}}),
 transaction:(_store, mode)=>{const tx={oncomplete:null,onerror:null,onabort:null};
  tx.objectStore=()=>({
   getAll:()=>{const req={};setTimeout(()=>{req.result=[...__records.values()];req.onsuccess?.();},0);return req;},
   put:r=>{__records.set(r.id,structuredClone(r));setTimeout(()=>tx.oncomplete?.(),0);},
   delete:id=>{__records.delete(id);setTimeout(()=>tx.oncomplete?.(),0);}
  });return tx;}
};
Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:()=>{const req={result:db};setTimeout(()=>req.onsuccess?.(),0);return req;}}});
'''
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
  errs=[]
  page.on('pageerror',lambda e:errs.append(str(e)))
  page.set_content(html,wait_until='domcontentloaded');page.add_style_tag(content=(root/'styles.css').read_text());page.evaluate(mock);page.add_script_tag(content=(root/'app.js').read_text());page.wait_for_timeout(80)
  assert page.get_by_text('最初の羊羹を記録しましょう').count()>0

  def new_tasted(name,shop,method,mat=[],tex=[],style=[],overall=8,profiles=None):
    page.locator('#addBtn').click()
    page.locator('#productName').fill(name)
    page.locator('#shopName').fill(shop)
    page.locator('#yokanType').select_option(method)
    for axis,tags in [('materials',mat),('textures',tex),('styles',style)]:
      for x in tags:
        sel=page.locator(f'input[data-tax-axis="{axis}"][value="{x}"]')
        if sel.count(): sel.check(force=True)
        else: page.locator(f'input[data-tax-extra="{axis}"]').fill(x)
    page.locator('#productForm button[type=submit]').click()
    page.wait_for_timeout(80)
    assert page.locator('#tasteDialog').evaluate('(el)=>el.open'),name
    page.locator('#amount').fill('50g')
    page.locator('input[data-group="quality"][data-key="overall"]').fill(str(overall))
    if profiles:
      for k,v in profiles.items():page.locator(f'input[data-group="profile"][data-key="{k}"]').fill(str(v))
    page.locator('#tasteForm button[type=submit]').click();page.wait_for_timeout(100)
    assert page.locator('#detailDialog').evaluate('(el)=>el.open')
    page.locator('[data-action="close"]').click()

  new_tasted('本煉テスト','A店','練羊羹',['小豆'],['なめらか'],['本煉'],8,{'sweetness':4,'richness':6})
  new_tasted('柿羊羹','B店','練羊羹',['柿'],['ぷるぷる'],[],10,{'sweetness':9,'richness':8})
  new_tasted('小城羊羹テスト','C店','練羊羹',['小豆'],['シャリシャリ'],['小城羊羹'],9,{'sweetness':8,'richness':7})
  new_tasted('栗蒸し羊羹','D店','蒸羊羹',['栗'],['もちもち'],[],6,{'sweetness':6,'richness':5})

  # 2nd tasting of 本煉 -> mean 9, overall order 10 / 9 / 9 / 6
  page.get_by_role('button',name=re.compile('本煉テスト')).click()
  page.locator('[data-action="taste"]').click()
  page.locator('input[data-group="quality"][data-key="overall"]').fill('10')
  page.locator('input[data-group="profile"][data-key="sweetness"]').fill('6')
  page.locator('#tasteForm button[type=submit]').click();page.wait_for_timeout(130)
  assert page.get_by_text('（2回）').count()==1
  assert page.locator('#compareScope option').count()>=5
  # group selected method has 3 products. group average = (9+10+9)/3 = 9.333...
  assert page.locator('#comparisonPanel').inner_text().find('3商品')>=0,page.locator('#comparisonPanel').inner_text()
  # group 小豆 has (9+9)/2=9, general all (9+10+9+6)/4=8.5
  page.locator('#compareScope').select_option('materials:小豆')
  assert '2商品' in page.locator('#comparisonPanel').inner_text()
  assert page.locator('#comparisonPanel').locator('tr').last.inner_text().replace(' ','').find('9.0')>=0
  page.locator('#compareScope').select_option('all')
  assert '4商品' in page.locator('#comparisonPanel').inner_text()
  assert '8.5' in page.locator('#comparisonPanel').locator('tr').last.inner_text()
  page.locator('[data-action="close"]').click()

  # preference analysis: 4 products incl 3 high; exclude 柿 -> 2 high.
  page.get_by_role('button',name=re.compile('柿羊羹')).click()
  page.locator('[data-action="toggle-preference"]').click();page.wait_for_timeout(100)
  assert '対象外' in page.locator('.detail-heading').inner_text()
  page.locator('[data-action="close"]').click()
  page.locator('.tab[data-tab="analysis"]').click()
  assert '該当 2商品' in page.locator('main').inner_text()
  assert '除外 1商品' in page.locator('main').inner_text()
  assert '4商品・実食5回' in page.locator('main').inner_text() # all avg includes excluded
  page.locator('#analysisScope').select_option('materials:小豆')
  assert page.locator('#analysisScope').input_value()=='materials:小豆'
  assert '2商品・実食3回' in page.locator('main').inner_text()
  assert '9.0' in page.locator('main').inner_text() # relevant category average
  page.locator('#rankingScope').select_option('materials:柿')
  assert '1商品' in page.locator('main').inner_text()
  assert '柿羊羹' in page.locator('.ranking-list').inner_text()
  page.locator('#rankingScope').select_option('textures:シャリシャリ')
  assert '小城羊羹テスト' in page.locator('.ranking-list').inner_text()
  page.locator('#rankingScope').select_option('styles:本煉')
  assert '本煉テスト' in page.locator('.ranking-list').inner_text()
  page.locator('#rankingScope').select_option('all')
  print('ranking all:',page.locator('.ranking-list').inner_text())
  # 10,9,9,6 => 10=1st; ties =2nd
  assert page.locator('.ranking-list li').nth(0).inner_text().find('1位')>=0
  assert page.locator('.ranking-list li').nth(1).inner_text().find('2位')>=0
  assert page.locator('.ranking-list li').nth(2).inner_text().find('2位')>=0
  # threshold 9 -> include only 本煉 and 小城, count 2
  page.locator('#prefThreshold').select_option('9')
  assert '該当 2商品' in page.locator('main').inner_text()
  page.screenshot(path=str(root/'tests'/'analysis_test.png'),full_page=True)

  # legacy v1 with original form & old v3 小城 and 小倉 migrates without loss
  page.locator('.tab[data-tab="guide"]').click()
  legacy={'version':1,'records':[{'id':'v1test','productName':'昔の羊羹','shopName':'老舗','quality':{'overall':9,'texture':8},'profile':{'sweetness':3},'tastedDate':'2026-09-01','yokanType':'小城羊羹','flavorTags':'小豆・小倉','comment':'旧記録'},{'id':'v3test','productName':'旧v3栗','shopName':'旧店','sessions':[{'id':'session-old','tastedDate':'2026-10-01','amount':'20g','quality':{'overall':8},'profile':{'sweetness':8},'comment':'2年以上'}], 'yokanType':'蒸羊羹','flavorTags':'栗','status':'tasted','generalEvaluation':{'scores':{'overall':8}}}]}
  page.once('dialog',lambda d:d.accept())
  page.locator('#import').set_input_files({'name':'legacy.json','mimeType':'application/json','buffer':json.dumps(legacy,ensure_ascii=False).encode()});page.wait_for_timeout(120)
  data=page.evaluate('Array.from(__mockRecords.values())')
  # imported raw store is normalized
  r1=next(x for x in data if x['id']=='v1test')
  assert r1['taxonomy']['method']=='練羊羹' and 'シャリシャリ' in r1['taxonomy']['textures'] and '小城羊羹' in r1['taxonomy']['styles']
  assert '小倉' in r1['taxonomy']['styles']
  assert r1['sessions'][0]['comment']=='旧記録' and r1['sessions'][0]['quality']['overall']==9
  r3=next(x for x in data if x['id']=='v3test')
  assert r3['taxonomy']['method']=='蒸羊羹' and r3['taxonomy']['materials']==['栗']
  assert r3['sessions'][0]['comment']=='2年以上'
  # v2 reference rating and original backup reimport (idempotency)
  page.locator('.tab[data-tab="guide"]').click()
  old_v2=json.loads((root/'tests'/'legacy-v2.json').read_text())
  page.once('dialog',lambda d:d.accept())
  page.locator('#import').set_input_files({'name':'legacy_v2.json','mimeType':'application/json','buffer':json.dumps(old_v2,ensure_ascii=False).encode()})
  page.wait_for_timeout(120)
  page.get_by_role('button',name=re.compile('サンプル羊羹弐')).click()
  assert page.locator('.radar-poly.general').count()==1
  assert '検証用のダミー評価' in page.locator('#detailContent').inner_text()
  page.locator('[data-action="close"]').click()
  page.locator('.tab[data-tab="guide"]').click()
  page.once('dialog',lambda d:d.accept())
  page.locator('#import').set_input_files({'name':'legacy_v2_repeat.json','mimeType':'application/json','buffer':json.dumps(old_v2,ensure_ascii=False).encode()})
  page.wait_for_timeout(120)
  v2=next(x for x in page.evaluate('Array.from(__mockRecords.values())') if x['id']=='v2-sample-record')
  assert len(v2['sessions'])==1
  # back up version4
  page.locator('.tab[data-tab="guide"]').click()
  with page.expect_download() as download_info:page.locator('#export').click()
  d=download_info.value;d.save_as(str(root/'tests'/'backup_test.json'))
  backup=json.loads((root/'tests'/'backup_test.json').read_text())
  assert backup['version']==4 and len(backup['records'])==7
  # reimport without loss
  page.once('dialog',lambda d:d.accept())
  page.locator('#import').set_input_files({'name':'v4.json','mimeType':'application/json','buffer':json.dumps(backup,ensure_ascii=False).encode()})
  page.wait_for_timeout(100)
  data2=page.evaluate('Array.from(__mockRecords.values())')
  assert len(data2)==7
  assert len(next(x for x in data2 if x['productName']=='本煉テスト')['sessions'])==2
  assert next(x for x in data2 if x['productName']=='柿羊羹')['includeInPreference'] is False
  assert not errs,errs
  print('PASS: v4 taxonomy, group averages, all averages, rankings, preference, v1/v3 import, v4 backup; errors=',errs)
  browser.close()
