(function(){
  'use strict';
  const app=window.LifeReset,C=window.LifeSyncCore,cfg=window.LIFE_RESET_CLOUD||{};
  const el=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let client=null,user=null,prefix='',base=null,observed=app.getState(),ready=false,busy=false,conflict='',status='Chỉ lưu trên máy',channel=null,epoch=0,message='',sequence=0;
  const memory=new Map(),guestInitial=C.clone(observed);
  function stored(key,fallback=null){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
  function keep(key,data){localStorage.setItem(key,JSON.stringify(data))}
  function pending(){
    if(!prefix)return[];
    const all=new Map(memory);
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(prefix+'.op.')){const op=stored(key);if(op)all.set(key,op)}}
    return [...all].filter(([key])=>key.startsWith(prefix+'.op.')).sort((a,b)=>a[1].queuedAt-b[1].queuedAt||a[1].id.localeCompare(b[1].id));
  }
  function stateLabel(text,warn=false){status=text;el('cloud-toggle').textContent='☁ '+text;el('cloud-toggle').classList.toggle('warn',warn);const node=el('cloud-state');if(node)node.textContent=text}
  function locked(value){app.block(value)}
  function renderPanel(){
    const panel=el('cloud-panel');
    const close='<button type="button" class="btn s" onclick="LifeCloud.hide()">Đóng</button>';
    let body='';
    if(!client){body='<p>Đồng bộ giúp máy tính và điện thoại dùng chung nhiệm vụ, giờ thực hiện và tiến độ khi đăng nhập cùng tài khoản.</p><p class="mu">Chưa kết nối đám mây. Người quản lý website cần cấu hình Supabase theo hướng dẫn đi kèm bản cập nhật. Hiện dữ liệu vẫn chỉ lưu trên thiết bị này.</p>'}
    else if(!user){body=`<p>Đăng nhập cùng một tài khoản trên cả hai thiết bị. Tài khoản mới cần xác nhận email trước khi đăng nhập.</p><p class="mu">Nếu tài khoản đã có dữ liệu, thiết bị này sẽ nhận bản đám mây. Dữ liệu khi chưa đăng nhập được giữ riêng trên máy.</p><form id="cloud-auth" onsubmit="event.preventDefault();LifeCloud.signIn()"><label>Email<input id="cloud-email" type="email" autocomplete="username" required></label><label>Mật khẩu<input id="cloud-password" type="password" autocomplete="current-password" minlength="8" required></label><div class="actions"><button type="submit" class="btn">Đăng nhập</button><button type="button" class="btn s" onclick="LifeCloud.signUp()">Tạo tài khoản</button></div></form>`}
    else{
      body=`<p>Đã đăng nhập: <b>${escape(user.email||'Tài khoản của bạn')}</b></p><p id="cloud-state">${escape(status)}</p>`;
      if(!ready&&status==='Tài khoản chưa có dữ liệu')body+='<p>Trên thiết bị đang có checklist bạn muốn giữ, chọn nút bên dưới để đưa dữ liệu lên tài khoản. Thiết bị thứ hai chỉ cần đăng nhập cùng tài khoản.</p><button class="btn" onclick="LifeCloud.initialize()">Dùng dữ liệu trên thiết bị này</button>';
      if(conflict)body+='<p class="editor-error">Hai thiết bị có thay đổi cần đối chiếu, hoặc một thao tác cũ không còn áp dụng được. Các thay đổi trên máy này đang được giữ lại, chưa ghi đè dữ liệu trên đám mây.</p><div class="actions"><button class="btn s" onclick="LifeCloud.exportPending()">Tải bản trên máy để đối chiếu</button><button class="btn" onclick="LifeCloud.useCloud()">Nhận bản đám mây, giữ bản dự phòng</button></div>';
      body+=`<p class="mu">${pending().length} thao tác đang chờ. Khi có mạng, thay đổi được gửi tự động; khi mở lại trang sẽ kiểm tra dữ liệu mới.</p><div class="actions"><button class="btn s" onclick="LifeCloud.sync()">Đồng bộ ngay</button><button class="btn s" onclick="LifeCloud.signOut()">Đăng xuất trên thiết bị này</button>${recoveryKeys().length?'<button class="btn s" onclick="LifeCloud.exportRecovery()">Tải bản dự phòng gần nhất</button>':''}</div>`;
    }
    panel.innerHTML='<h2>Tài khoản và đồng bộ</h2>'+body+'<p id="cloud-message" role="status" class="mu">'+escape(message)+'</p><div class="actions">'+close+'</div>';
  }
  function say(text){message=text;const node=el('cloud-message');if(node)node.textContent=text}
  function fail(error){
    const code=String(error?.message||error||'');
    if(/SYNC_CONFLICT|STALE_DAY|TASK_MISSING|INVALID_DAY|INVALID_TASK/.test(code)){conflict=code;locked(true);stateLabel('Cần đối chiếu thay đổi',true);renderPanel();el('cloud-panel').hidden=false}
    else{stateLabel(navigator.onLine?'Chưa đồng bộ được — dữ liệu đang giữ trên máy':'Mất mạng — đang giữ thay đổi trên máy',true);say('Kiểm tra kết nối và cấu hình Supabase, rồi chọn Đồng bộ ngay. Nếu phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');if(!ready)renderPanel()}
  }
  function project(row){let next=C.clone(row.data);for(const[,op]of pending())next=C.apply(next,op);return next}
  function accept(row){
    if(base&&row.version<base.version)return;
    base=row;keep(prefix+'.base',row);
    const next=project(row);observed=C.clone(next);app.applyState(next);
  }
  async function readRemote(){const{data,error}=await client.from('life_reset_state').select('data,version,updated_at').eq('user_id',user.id).maybeSingle();if(error)throw error;return data}
  async function pump(){
    if(!client||!user||!ready||busy||conflict)return;
    if(!navigator.onLine){stateLabel('Mất mạng — đang giữ thay đổi trên máy',true);return}
    busy=true;const generation=epoch;stateLabel('Đang đồng bộ…');
    try{
      while(pending().length){
        const[key,op]=pending()[0];
        const{data,error}=await client.rpc('life_reset_apply',{p_operation:op});
        if(generation!==epoch)return;if(error)throw error;
        // Keep the operation until the server has acknowledged its unique ID.
        localStorage.removeItem(key);memory.delete(key);accept(data);
      }
      const row=await readRemote();if(generation!==epoch)return;
      if(!row)throw new Error('NOT_INITIALIZED');accept(row);
      stateLabel('Đã đồng bộ · '+new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}));say('');
    }catch(error){if(generation===epoch)fail(error)}finally{if(generation===epoch)busy=false}
  }
  function record(state,operation){
    const previous=observed;observed=C.clone(state);
    if(!user||!ready)return;
    const changes=C.changes(previous,state);if(!changes.length)return;
    const op={...(operation||{type:'patch',changes}),id:crypto.randomUUID(),queuedAt:Date.now()+(sequence++%1000)/1000};
    const key=prefix+'.op.'+op.id;
    try{keep(key,op)}catch{memory.set(key,op);say('Bộ nhớ trình duyệt đầy. Chưa đóng trang cho đến khi đồng bộ xong; bạn có thể xuất sao lưu để giữ dữ liệu.')}
    stateLabel('Đang chờ đồng bộ ('+pending().length+')',true);clearTimeout(record.timer);record.timer=setTimeout(pump,400);
  }
  async function connect(nextUser){
    if(user?.id===nextUser.id){if(ready)pump();return}
    const local=user?stored('lifereset.v1',guestInitial):app.getState();epoch++;const generation=epoch;busy=false;conflict='';ready=false;user=nextUser;
    if(channel){client.removeChannel(channel);channel=null}
    prefix='lifereset.cloud.'+new URL(cfg.url).host+'.'+user.id;
    base=stored(prefix+'.base');
    try{
      // Guest progress stays in its original storage key. Each account has its own cache/outbox.
      observed=app.useStorage(prefix+'.state',base?base.data:local);
      if(base){ready=true;observed=project(base);app.applyState(observed)}
      locked(!ready);stateLabel('Đang tải dữ liệu tài khoản…');renderPanel();
      const row=await readRemote();if(generation!==epoch)return;
      if(row){ready=true;accept(row);locked(false);app.afterConnect();await pump()}
      else{ready=false;locked(true);stateLabel('Tài khoản chưa có dữ liệu')}
      if(generation!==epoch)return;
      if(channel)await client.removeChannel(channel);
      channel=client.channel('life-reset-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'life_reset_state',filter:'user_id=eq.'+user.id},()=>pump()).subscribe();
      renderPanel();
    }catch(error){if(generation===epoch)fail(error)}
  }
  function disconnected(){epoch++;busy=false;ready=false;user=null;base=null;prefix='';conflict='';if(channel){client.removeChannel(channel);channel=null}observed=app.useStorage('lifereset.v1');locked(false);stateLabel('Chỉ lưu trên máy');message='';renderPanel()}
  function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function recoveryKeys(){const keys=[];if(prefix)for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith(prefix+'.recovery.'))keys.push(key)}return keys.sort().reverse()}
  function credentials(){const form=el('cloud-auth');if(!form.reportValidity())return null;return{email:el('cloud-email').value.trim(),password:el('cloud-password').value}}
  function authMessage(error){if(/invalid login/i.test(error.message))return'Email hoặc mật khẩu chưa đúng.';if(/email not confirmed/i.test(error.message))return'Bạn cần xác nhận email trước khi đăng nhập.';if(/rate limit|too many/i.test(error.message))return'Bạn thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.';return'Chưa đăng nhập được. Kiểm tra email, mật khẩu, kết nối hoặc cấu hình xác thực.'}
  window.LifeCloud={
    localSave:record,
    show(){renderPanel();el('cloud-panel').hidden=false;el('cloud-panel').scrollIntoView({behavior:'smooth',block:'start'})},
    hide(){el('cloud-panel').hidden=true},
    async signIn(){const input=credentials();if(!input)return;say('Đang đăng nhập…');try{const{error}=await client.auth.signInWithPassword(input);if(el('cloud-password'))el('cloud-password').value='';if(error)say(authMessage(error))}catch{say('Không kết nối được. Hãy thử lại.')}},
    async signUp(){const input=credentials();if(!input)return;say('Đang tạo tài khoản…');try{const{data,error}=await client.auth.signUp({...input,options:{emailRedirectTo:location.origin+location.pathname}});if(el('cloud-password'))el('cloud-password').value='';say(error?authMessage(error):data.session?'Đã tạo tài khoản.':'Hãy mở email xác nhận, sau đó quay lại đăng nhập.')}catch{say('Không kết nối được. Hãy thử lại.')}},
    async initialize(){if(!user||ready)return;locked(true);stateLabel('Đang tạo bản đồng bộ…');try{const generation=epoch;const{data,error}=await client.rpc('life_reset_initialize',{p_data:app.getState()});if(generation!==epoch)return;if(error)throw error;ready=true;accept(data);locked(false);app.afterConnect();await pump();renderPanel()}catch(error){fail(error)}},
    async sync(){if(!user)return;if(ready){await pump();if(!el('cloud-panel').hidden)renderPanel()}else{const u=user;user=null;await connect(u)}},
    async signOut(){if(pending().length&&!confirm('Còn thay đổi chưa đồng bộ. Chúng sẽ được giữ riêng cho tài khoản này trên thiết bị. Đăng xuất?'))return;const{error}=await client.auth.signOut({scope:'local'});if(error)say('Chưa đăng xuất được. Hãy thử lại.');else disconnected()},
    exportPending(){download('life-reset-ban-tren-may.json',app.getState())},
    exportRecovery(){const key=recoveryKeys()[0];if(key)download('life-reset-ban-du-phong.json',stored(key).state)},
    async useCloud(){
      if(!confirm('Nhận bản trên đám mây? Bản hiện tại và thao tác chưa gửi sẽ được giữ thành bản dự phòng trong trình duyệt này.'))return;
      const generation=epoch;try{const row=await readRemote();if(generation!==epoch||!row)return;keep(prefix+'.recovery.'+Date.now(),{state:app.getState(),operations:pending().map(x=>x[1])});for(const[key]of pending()){localStorage.removeItem(key);memory.delete(key)}conflict='';ready=true;accept(row);locked(false);await pump();renderPanel()}catch(error){fail(error)}
    }
  };
  renderPanel();
  if(!cfg.url||!cfg.publicKey)return;
  try{
    const url=new URL(cfg.url);if(url.protocol!=='https:'||cfg.publicKey.startsWith('sb_secret_'))throw new Error('INVALID_CONFIG');
    if(cfg.publicKey.split('.').length===3){const payload=JSON.parse(atob(cfg.publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw new Error('INVALID_CONFIG')}
    client=window.supabase.createClient(cfg.url,cfg.publicKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(session?.user)connect(session.user);else if(user)disconnected()},0)});
    client.auth.getSession().then(({data,error})=>{if(error){say('Không đọc được phiên đăng nhập. Hãy đăng nhập lại.');return}if(data.session?.user)connect(data.session.user)});
    window.addEventListener('online',pump);window.addEventListener('focus',pump);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pump()});
    window.addEventListener('storage',event=>{if(prefix&&event.key?.startsWith(prefix+'.op.'))pump()});
    setInterval(()=>{if(!document.hidden)pump()},15000);renderPanel();
  }catch{client=null;say('Cấu hình đồng bộ chưa hợp lệ. Chỉ dùng Project URL và Publishable/anon key; không dùng khóa quản trị.');renderPanel()}
})();
