"""36 seeded monthly step scenarios from the offline Opus review probe."""
import calendar
import json
import random
import engine


def run(shift, seed, months_run=18):
    rnd=random.Random(seed)
    full=[100*(1+.08*(rnd.random()-.5)*2) for _ in range(40)]
    full += [100*shift*(1+.08*(rnd.random()-.5)*2) for _ in range(months_run+2)]
    full[0]=10000  # Phase 4: irregular fallback retains the legacy correction probe.
    diary=[];log=[];trace=[]

    @engine.evaluation_pass
    def snapshot(t):
        months=[engine.month_after('2023-01',i) for i in range(t)];last=months[-1]
        def item(sku,sales):return dict(sku=sku,name='n',unit='u',on_hand=50,supplier_days=14,monthly_sales=sales,receipts={})
        data=dict(items=[item('S1',full[:t]),item('X0',[1000]*t)],months=months,
                  as_of=last+'-'+str(calendar.monthrange(int(last[:4]),int(last[5:]))[1]))
        settings=engine.learning_settings_from_log(data,dict(learning_enabled=True),log)
        events=engine.learning_events(data,diary,settings,log)
        seen={e['id'] for e in log}
        log.extend(e for e in events if e['id'] not in seen)
        prepared=engine.prepare_learning(data,diary,settings)
        selection=engine.forecast_selection(prepared['items'][0],last)
        trace.append(dict(month=last,state=selection.get('learning',{}).get('state'),events=events))
        diary.extend(engine.forecast_diary(prepared))
    for t in range(40,40+months_run):snapshot(t)
    return trace,log
