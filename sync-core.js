(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x}
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  function changes(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!equal(before[k],after[k])).map(key=>({key,beforePresent:Object.hasOwn(before,key),before:before[key]??null,afterPresent:Object.hasOwn(after,key),after:after[key]??null}))}
  function applies(q,date){if(q.o)return q.o===date;return !q.w?.length||q.w.includes(new Date(date+'T12:00:00').getDay())}
  function apply(input,op){
    const s=clone(input);
    if(op.type==='patch'){
      for(const c of op.changes){
        if(['__proto__','constructor','prototype'].includes(c.key))throw new Error('INVALID_PATCH');
        const present=Object.hasOwn(s,c.key);
        if(present===c.afterPresent&&(!present||equal(s[c.key],c.after)))continue;
        if(present!==c.beforePresent||(present&&!equal(s[c.key],c.before)))throw new Error('SYNC_CONFLICT:'+c.key);
        if(c.afterPresent)s[c.key]=clone(c.after);else delete s[c.key];
      }
      return s;
    }
    if(op.type!=='complete'||typeof op.completed!=='boolean')throw new Error('INVALID_OPERATION');
    const q=s.quests.find(q=>q.id===op.questId);if(!q)throw new Error('TASK_MISSING');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(op.day)||!applies(q,op.day))throw new Error('INVALID_DAY');
    s.done=s.done||{};const ids=s.done[op.day]||[],wasDone=ids.includes(q.id);if(wasDone===op.completed)return s;
    if(op.day<=(s.checked||''))throw new Error('STALE_DAY');
    const qs=s.quests.filter(q=>applies(q,op.day));
    const wasAll=qs.length>0&&qs.every(q=>ids.includes(q.id));
    s.done[op.day]=op.completed?[...ids,q.id]:ids.filter(id=>id!==q.id);
    const all=qs.length>0&&qs.every(q=>s.done[op.day].includes(q.id));
    const rewards={e:[10,1,3],m:[20,2,6],h:[40,4,12]},[xp,points,coins]=rewards[q.d],sign=op.completed?1:-1;
    s.xp=Math.max(0,(s.xp||0)+sign*xp);s.stats[q.s]=Math.max(0,(s.stats[q.s]||0)+sign*points);
    s.coins=Math.max(0,(s.coins||0)+sign*coins);
    const bonus=10+Math.min(s.streak||0,20);
    if(!wasAll&&all)s.coins+=bonus;else if(wasAll&&!all)s.coins=Math.max(0,s.coins-bonus);
    return s;
  }
  root.LifeSyncCore={clone,equal,changes,apply};
})(globalThis);
