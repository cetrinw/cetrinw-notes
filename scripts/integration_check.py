"""Exercise real HTTP -> Rust -> SQLite paths. Uses an isolated test server/data directory."""
import argparse
import base64
import datetime as dt
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.request
import os
import uuid

root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--live',action='store_true')
args=parser.parse_args()
out=root/'output'/'verification'
out.mkdir(parents=True,exist_ok=True)
results=[]

def call(payload):
    req=urllib.request.Request('http://127.0.0.1:14318/v1/command',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+'test-owner-token-not-a-real-credential-12345'})
    with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)

def save(kind,title,data,**extra):return call({'op':'save','record':dict(kind=kind,title=title,data=data,**extra)})

with tempfile.TemporaryDirectory(prefix='cetrinw-integration-') as directory:
    env={**os.environ,'CETRINW_DATA_DIR':directory,'CETRINW_BIND':'127.0.0.1:14318','CETRINW_TOKEN':'test-owner-token-not-a-real-credential-12345','CETRINW_PYTHON':str(root/'.venv/bin/python')}
    log=open(out/'integration-server.log','w')
    server=subprocess.Popen([str(root/'target/debug/cetrinw-server')],cwd=root,env=env,stdout=log,stderr=log)
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:14318/health',timeout=1):break
            except Exception:time.sleep(.1)
        try:
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:14318/v1/command',data=b'{"op":"stats"}',headers={'Content-Type':'application/json'}))
            raise AssertionError('Unauthenticated request was accepted')
        except urllib.error.HTTPError as error:
            assert error.code==401
        results.append({'level':'L2','check':'authenticated HTTP command boundary','result':'pass'})
        topic=save('topic','超级电容产业研究 · 验证夹具',{'description':'本条为明确标注的现实工作流夹具，非行业事实。'})
        content={'type':'doc','content':[{'type':'heading','attrs':{'level':2},'content':[{'type':'text','text':'研究问题与证据'}]},{'type':'paragraph','content':[{'type':'text','text':'需要核对活性炭、电解液、下游订单与供应商之间的证据，不从价格变动直接推断因果。'}]},{'type':'table','content':[{'type':'tableRow','content':[{'type':'tableCell','attrs':{'colspan':2,'rowspan':1},'content':[{'type':'paragraph','content':[{'type':'text','text':'合并单元格保留格式'}]}]}]}]}]}
        note=save('note','产业分析笔记 · 验证夹具',{'content':content,'topicId':topic['id'],'folder':'验证','tags':['电解液']})
        assert call({'op':'list','kind':'note','query':'电解液'})[0]['id']==note['id']
        subtitle=b'1\n00:00:00,000 --> 00:00:04,000\nCould you explain the supply chain?\n'
        asset=call({'op':'asset_put','name':'original-dialogue.srt','mime':'text/plain','base64':base64.b64encode(subtitle).decode()})
        restored=call({'op':'asset_get','hash':asset['hash']})
        assert base64.b64decode(restored['base64'])==subtitle
        note=save('note',note['title'],{**note['data'],'attachments':[asset]},id=note['id'],revision=note['revision'])
        latest=save('note',note['title'],{**note['data'],'conclusion':'需要新增公司公告验证'},id=note['id'],revision=note['revision'])
        conflict=save('note',note['title'],{**note['data'],'conclusion':'来自另一设备的独立更新'},id=note['id'],revision=note['revision'])
        assert conflict['id']!=latest['id'] and conflict['conflict_of']==note['id']
        bundle=call({'op':'export'})
        assert bundle['history'] and bundle['assets'] and any(r['data'].get('content')==content for r in bundle['records'])
        result=call({'op':'import','bundle':bundle})
        assert result['imported']==0
        results.append({'level':'L2','check':'rich note, Chinese search, attachment bytes, conflict copies, export/import through HTTP','result':'pass'})
        dictionary=call({'op':'dictionary','word':'supply'})
        assert dictionary['translation'] and 'ECDICT' in dictionary['source']
        results.append({'level':'L3','check':'real licensed offline English-Chinese dictionary','result':'pass','word':'supply','translation':dictionary['translation']})
        if args.live:
            for title,adapter,config in [('中国 GDP（世界银行）','worldbank',{'country':'CHN','indicator':'NY.GDP.MKTP.CD','unit':'USD'}),('AAPL 美股日线','akshare',{'market':'US','symbol':'AAPL'}),('600519 A 股日线','akshare',{'market':'CN','symbol':'600519'})]:
                source=save('source',title,{'adapter':adapter,'config':config,'enabled':False})
                job_id=call({'op':'refresh','id':source['id']})['jobId']
                job=None
                for _ in range(115):
                    time.sleep(1)
                    job=call({'op':'get','id':job_id})
                    if job['data']['status'] in ['success','failed']:break
                if job['data']['status']=='success':
                    series=call({'op':'get','id':'series:'+source['id']})
                    points=series['data']['points']
                    assert points and all('date' in p and ('value' in p or 'close' in p) for p in points)
                    last=max(points,key=lambda p:p['date'])
                    record={'level':'L4','check':title,'result':'pass','count':len(points),'latest_observation':last,'source':series['data']['sourceUrl']}
                    (out/(adapter+'-'+config.get('symbol','macro')+'.json')).write_text(json.dumps(series,ensure_ascii=False,indent=2))
                else:
                    record={'level':'L4','check':title,'result':'blocked','reason':job['data'].get('error','timeout')}
                results.append(record)
                print(json.dumps(record,ensure_ascii=False),flush=True)
    finally:
        server.terminate()
        server.wait(timeout=10)
        log.close()
(out/'integration.json').write_text(json.dumps({'time':dt.datetime.now(dt.timezone.utc).isoformat(),'results':results},ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
if any(r['result']=='blocked' for r in results):raise SystemExit(2)
