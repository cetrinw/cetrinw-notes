"""Live public content through HTTP -> shared adapters -> SQLite, in isolation."""
import base64, datetime, json, os, pathlib, subprocess, tempfile, time, urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'output/verification';out.mkdir(parents=True,exist_ok=True)
results=[]
def call(payload):
    request=urllib.request.Request('http://127.0.0.1:14322/v1/command',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=150) as response:return json.load(response)
def check(label,fn):
    try:
        details=fn();result={'level':'L4','check':label,'result':'pass',**(details or {})}
    except Exception as e:
        reason=e.read().decode() if hasattr(e,'read') else str(e)
        result={'level':'L4','check':label,'result':'blocked','reason':reason}
    results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
with tempfile.TemporaryDirectory(prefix='cetrinw-learning-live-') as folder:
    server=subprocess.Popen([str(root/'target/debug/cetrinw-server')],cwd=root,env={**os.environ,'CETRINW_BIND':'127.0.0.1:14322','CETRINW_DATA_DIR':folder},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:call({'op':'stats'});break
            except Exception:time.sleep(.1)
        catalog=call({'op':'learning_catalog'});assert len(catalog['courses'])==77
        for id in ['voa-level1-1','voa-level1-26','voa-level1-52','elllo-a1-1','elllo-a1-25']:
            def lesson(id=id):
                r=call({'op':'learning_download','id':id});assert len(r['data']['segments'])>=2
                asset=r['data']['audio'];data=base64.b64decode(call({'op':'asset_get','hash':asset['hash']})['base64']);assert len(data)==asset['size'] and len(data)>10000
                return {'title':r['title'],'segments':len(r['data']['segments']),'audio_bytes':len(data),'source':r['data']['sourceUrl']}
            check(id,lesson)
        def translation():
            text='Could you explain the supply chain?';r=call({'op':'learning_translate','text':text});assert any('\u3400'<=c<='\u9fff' for c in r['text']);return {'english':text,'chinese':r['text'],'provider':r['provider']}
        check('English-Chinese public translation',translation)
        for source in ['nasa','guardian']:
            def news(source=source):
                articles=call({'op':'news_refresh','id':source});assert articles and articles[0]['data']['text']; latest=max(a['data']['publishedAt'] or '' for a in articles)
                assert datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(latest)<datetime.timedelta(days=7)
                return {'count':len(articles),'latest_publication':latest,'content_type':articles[0]['data']['contentType']}
            check('Daily news '+source,news)
        for title,url in [('少数派','https://sspai.com/feed'),('爱范儿','https://www.ifanr.com/feed'),('V2EX','https://www.v2ex.com/index.xml'),('Hacker News','https://hnrss.org/frontpage')]:
            def rss(title=title,url=url):
                feed=call({'op':'save','record':{'kind':'feed','title':title,'data':{'url':url,'enabled':False}}})
                result=call({'op':'rss_fetch','url':url,'id':feed['id']});assert result['articles']
                rows=call({'op':'news_import','articles':result['articles']}); first=rows[0];first['data']['read']=True;call({'op':'save','record':first})
                call({'op':'news_import','articles':result['articles']});assert call({'op':'get','id':first['id']})['data']['read'] is True
                return {'count':len(rows),'source':url,'preserved_read_status':True}
            check('RSS '+title,rss)
        check('Website RSS discovery',lambda: {'found':call({'op':'rss_discover','url':'https://www.nasa.gov/'})})
    finally:server.terminate();server.wait(timeout=10)
(out/'learning-rss-live.json').write_text(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results},ensure_ascii=False,indent=2))
if any(r['result']!='pass' for r in results):raise SystemExit(2)
