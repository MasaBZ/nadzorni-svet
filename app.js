(function(){
"use strict";
/* =========================================================
   NADZORNI SVET — aplikacija za predsednico NS (več družb)
   Podatki: IndexedDB na napravi + usklajevanje z OneDrive (Microsoft Graph)
   Claude: Anthropic API z uporabničinim ključem
   ========================================================= */

/* ---------- pomožne ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clone=o=>JSON.parse(JSON.stringify(o??null));
const NUM=new Intl.NumberFormat("sl-SI",{maximumFractionDigits:0});
const EUR=v=>v==null||!isFinite(v)?"–":NUM.format(Math.round(v))+" €";
const PCT=v=>v==null||!isFinite(v)?"–":(Math.round(v*10)/10).toLocaleString("sl-SI")+" %";
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const addDays=(iso,n)=>{const d=new Date(iso+"T12:00");d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
const fmtDate=d=>d?new Date(d+"T12:00").toLocaleDateString("sl-SI",{day:"numeric",month:"numeric",year:"numeric"}):"–";
const fmtDateLong=d=>d?new Date(d+"T12:00").toLocaleDateString("sl-SI",{weekday:"long",day:"numeric",month:"long",year:"numeric"}):"";
const fmtTime=ms=>new Date(ms).toLocaleTimeString("sl-SI",{hour:"2-digit",minute:"2-digit"});
const fmtDur=ms=>{const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+":"+String(m).padStart(2,"0"):String(m))+":"+String(x).padStart(2,"0")};
const fmtSize=b=>b>1e6?(b/1e6).toLocaleString("sl-SI",{maximumFractionDigits:1})+" MB":Math.round(b/1e3)+" kB";
const MES=["jan","feb","mar","apr","maj","jun","jul","avg","sep","okt","nov","dec"];
const MESF=["januar","februar","marec","april","maj","junij","julij","avgust","september","oktober","november","december"];
const isIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
function parseNum(s){
  if(s==null)return null; s=String(s).replace(/[\s €]/g,""); if(s==="")return null;
  if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
  const n=parseFloat(s); return isFinite(n)?n:null;
}
const fmtIn=v=>v==null?"":NUM.format(v);
function toast(msg,ms=3800){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,ms)}
const LS={get(k,d){try{const v=localStorage.getItem("ns."+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem("ns."+k,JSON.stringify(v))}catch(e){}}};

/* ---------- IndexedDB ---------- */
const IDB={db:null,
  open(){return this.db?Promise.resolve(this.db):new Promise((res,rej)=>{const r=indexedDB.open("nadzorni-svet",1);
    r.onupgradeneeded=()=>{const d=r.result;["kv","chunks","blobs"].forEach(n=>{if(!d.objectStoreNames.contains(n))d.createObjectStore(n)})};
    r.onsuccess=()=>{this.db=r.result;res(this.db)};r.onerror=()=>rej(r.error)})},
  async tx(store,mode,fn){const d=await this.open();return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;const r=fn(s);if(r)r.onsuccess=()=>out=r.result;t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})},
  get(st,k){return this.tx(st,"readonly",s=>s.get(k))},
  set(st,k,v){return this.tx(st,"readwrite",s=>s.put(v,k))},
  del(st,k){return this.tx(st,"readwrite",s=>s.delete(k))},
  keys(st){return this.tx(st,"readonly",s=>s.getAllKeys())},
  async delPrefix(st,p){const ks=(await this.keys(st)).filter(k=>String(k).startsWith(p));if(ks.length)await this.tx(st,"readwrite",s=>{ks.forEach(k=>s.delete(k))})}
};

/* ---------- podatkovni model ----------
   D.col[zbirka][id] = {...polja, _u: čas spremembe, _d: 1 če izbrisano}
*/
const COLS=["druzbe","seje","sklepi","predloge","finance","direktor","prepisi","nastavitve","posnetki"];
const PER_DRUZBA=["seje","sklepi","predloge","posnetki"];
let D={v:1,col:{}}; COLS.forEach(c=>D.col[c]={});
const S={druzbe:[],druzbaId:null,seje:[],sklepi:[],predloge:[],finance:{},direktor:{},druzba:null,prepisi:{},posnetki:[]};
function derive(){
  const live=c=>Object.entries(D.col[c]||{}).filter(([,r])=>r&&!r._d);
  S.druzbe=live("druzbe").map(([id,r])=>({id,...r})).sort((a,b)=>(a.naziv||"").localeCompare(b.naziv||"","sl"));
  let A=LS.get("druzba",null); if(!S.druzbe.some(d=>d.id===A))A=S.druzbe.length?S.druzbe[0].id:null;
  S.druzbaId=A; S.druzba=S.druzbe.find(d=>d.id===A)||null;
  const mine=([,r])=>r.druzbaId===A;
  S.seje=live("seje").filter(mine).map(([id,r])=>({id,...r}));
  S.sklepi=live("sklepi").filter(mine).map(([id,r])=>({id,...r}));
  S.predloge=live("predloge").filter(mine).map(([id,r])=>({id,...r}));
  S.posnetki=live("posnetki").filter(mine).map(([id,r])=>({id,...r}));
  S.finance=Object.fromEntries(live("finance").filter(mine).map(([,r])=>[String(r.leto),r]));
  S.direktor=Object.fromEntries(live("direktor").filter(mine).map(([,r])=>[String(r.leto),r]));
  S.prepisi=Object.fromEntries(live("prepisi"));
}
function setDruzba(id){LS.set("druzba",id);ui.sejaId=null;ui.draft=null;ui.sklepEdit=null;ui.manual=null;ui.izlusceni=null;ui.dirPorocilo="";derive();render()}
function migrateV1(){ // stari podatki brez družbe
  const old=(D.col.nastavitve||{}).druzba; const orphan=PER_DRUZBA.some(c=>Object.values(D.col[c]||{}).some(r=>r&&!r._d&&!r.druzbaId))||["finance","direktor"].some(c=>Object.values(D.col[c]||{}).some(r=>r&&!r._d&&!r.druzbaId));
  if(!orphan&&!(old&&!old._d))return;
  const id=uid(),now=Date.now();
  D.col.druzbe[id]={...strip(old&&!old._d?old:{}),naziv:(old&&old.naziv)||"Moja družba",_u:now};
  PER_DRUZBA.forEach(c=>Object.entries(D.col[c]||{}).forEach(([k,r])=>{if(r&&!r._d&&!r.druzbaId)D.col[c][k]={...r,druzbaId:id,_u:now}}));
  ["finance","direktor"].forEach(c=>Object.entries(D.col[c]||{}).forEach(([k,r])=>{if(r&&!r._d&&!r.druzbaId){D.col[c][id+"_"+(r.leto||k)]={...r,leto:+(r.leto||k),druzbaId:id,_u:now};D.col[c][k]={_d:1,_u:now}}}));
  if(old&&!old._d)D.col.nastavitve.druzba={_d:1,_u:now};
  LS.set("druzba",id);
}
const strip=o=>{const c=clone(o)||{};delete c.id;delete c._u;delete c._d;return c};
let persistT=null;
function persistSoon(){clearTimeout(persistT);persistT=setTimeout(persistNow,250)}
function persistNow(){clearTimeout(persistT);return IDB.set("kv","data",D).catch(e=>toast("Shranjevanje na napravo ni uspelo: "+e))}
function write(path,data){
  const [col,id]=path.split("/");
  D.col[col]=D.col[col]||{};
  const prev=D.col[col][id];
  const u=Math.max(Date.now(),(prev&&prev._u||0)+1);
  if(data&&PER_DRUZBA.includes(col)&&!data.druzbaId)data={...data,druzbaId:S.druzbaId};
  D.col[col][id]=data?{...strip(data),_u:u}:{_d:1,_u:u};
  derive();persistSoon();Sync.soon();rr();
  return Promise.resolve();
}
function merge(a,b){ // vrne {out, fromB, fromA}
  const out={v:1,col:{}};let fromB=false,fromA=false;
  const cols=new Set([...COLS,...Object.keys(a.col||{}),...Object.keys((b&&b.col)||{})]);
  cols.forEach(c=>{const A=(a.col||{})[c]||{},B=((b&&b.col)||{})[c]||{};const o={};
    new Set([...Object.keys(A),...Object.keys(B)]).forEach(id=>{const x=A[id],y=B[id];
      if(x&&(!y||(x._u||0)>=(y._u||0))){o[id]=x;if(!y||(x._u||0)>(y._u||0))fromA=true}
      else{o[id]=y;fromB=true}});
    out.col[c]=o});
  return {out,fromB,fromA};
}

/* ---------- OneDrive (Microsoft Graph) ---------- */
const FILE="ns-podatki.json";
const SCOPES=["Files.ReadWrite.AppFolder"];
const Sync={msal:null,account:null,state:"off",msg:"",last:LS.get("lastSync",null),etag:LS.get("etag",null),running:false,again:false,t:null,
  clientId(){return (LS.get("clientId","")||(window.NS_CONFIG||{}).CLIENT_ID||"").trim()},
  async init(){
    const cid=this.clientId();
    if(!cid||!window.msal){this.set("off");return}
    try{
      const base=location.origin+location.pathname.replace(/[^/]*$/,"");
      this.msal=new msal.PublicClientApplication({auth:{clientId:cid,authority:(window.NS_CONFIG||{}).AUTHORITY||"https://login.microsoftonline.com/common",redirectUri:base,postLogoutRedirectUri:base,navigateToLoginRequestUrl:false},cache:{cacheLocation:"localStorage"}});
      await this.msal.initialize();
      const r=await this.msal.handleRedirectPromise();
      this.account=(r&&r.account)||this.msal.getAllAccounts()[0]||null;
      if(this.account){this.msal.setActiveAccount(this.account);this.set("ok");this.run()}else this.set("off");
    }catch(e){this.set("err","Prijava ni uspela: "+(e.errorMessage||e.message||e));}
  },
  set(st,msg){this.state=st;this.msg=msg||"";paintConn()},
  async login(){
    if(!this.clientId()){toast("Najprej vpišite Client ID v Nastavitvah.");return}
    if(!this.msal){await this.init();if(!this.msal)return}
    await persistNow();
    this.msal.loginRedirect({scopes:SCOPES,prompt:"select_account"});
  },
  async logout(){if(!this.msal||!this.account)return;await persistNow();this.msal.logoutRedirect({account:this.account})},
  async token(){
    try{const r=await this.msal.acquireTokenSilent({scopes:SCOPES,account:this.account});return r.accessToken}
    catch(e){if(e instanceof msal.InteractionRequiredAuthError||/interaction_required|login_required|consent_required|no_tokens_found/i.test(e.errorCode||"")){this.set("expired");throw {code:"expired"}}throw e}
  },
  async graph(path,opts={}){
    const t=await this.token();
    return fetch(path.startsWith("http")?path:"https://graph.microsoft.com/v1.0"+path,{...opts,headers:{Authorization:"Bearer "+t,...(opts.headers||{})}});
  },
  soon(){if(!this.account)return;clearTimeout(this.t);this.t=setTimeout(()=>this.run(),2500)},
  async run(){
    if(!this.account||!this.msal)return;
    if(this.running){this.again=true;return}
    if(!navigator.onLine){this.set("offline");return}
    this.running=true;this.set("busy");
    try{
      for(let attempt=0;attempt<4;attempt++){
        let remote=null,etag=null;
        const m=await this.graph(`/me/drive/special/approot:/${FILE}`);
        if(m.status===200){const j=await m.json();etag=j.eTag;
          if(etag!==this.etag||!this.remoteCache){const c=await fetch(j["@microsoft.graph.downloadUrl"]);if(!c.ok)throw new Error("prenos "+c.status);remote=await c.json()}else remote=this.remoteCache;}
        else if(m.status!==404)throw new Error("OneDrive "+m.status);
        const {out,fromB,fromA}=merge(D,remote||{col:{}});
        if(fromB){D=out;derive();persistNow();rr()}
        if(fromA||!remote){
          const body=JSON.stringify(out);
          const h={"Content-Type":"application/json"};if(etag)h["If-Match"]=etag;
          const p=await this.graph(`/me/drive/special/approot:/${FILE}:/content`,{method:"PUT",headers:h,body});
          if(p.status===412){this.remoteCache=null;continue}
          if(!p.ok)throw new Error("OneDrive shranjevanje "+p.status);
          const j=await p.json();etag=j.eTag;remote=out;
        }
        this.etag=etag;this.remoteCache=remote;LS.set("etag",etag);
        this.last=Date.now();LS.set("lastSync",this.last);this.set("ok");break;
      }
    }catch(e){
      if(e&&e.code==="expired"){}else if(!navigator.onLine)this.set("offline");else this.set("err",String(e&&e.message||e));
    }
    this.running=false;
    if(this.again){this.again=false;this.soon()}
  },
  async uploadLarge(path,blob,onProgress){ // path pod approot, npr. "Posnetki/x.m4a"
    const s=await this.graph(`/me/drive/special/approot:/${path.split("/").map(encodeURIComponent).join("/")}:/createUploadSession`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item:{"@microsoft.graph.conflictBehavior":"rename"}})});
    if(!s.ok)throw new Error("OneDrive "+s.status);
    const {uploadUrl}=await s.json();const CH=320*1024*16;let pos=0,last=null;
    while(pos<blob.size){const end=Math.min(pos+CH,blob.size);
      const r=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Range":`bytes ${pos}-${end-1}/${blob.size}`},body:blob.slice(pos,end)});
      if(!r.ok&&r.status!==202)throw new Error("Nalaganje "+r.status);
      last=r;pos=end;onProgress&&onProgress(pos/blob.size)}
    return await last.json();
  },
  async download(itemId){
    const m=await this.graph(`/me/drive/items/${itemId}`);if(!m.ok)throw new Error("OneDrive "+m.status);
    const j=await m.json();const c=await fetch(j["@microsoft.graph.downloadUrl"]);return await c.blob();
  }
};
function paintConn(){
  const dot=$("#syncDot"),t=$("#conn");if(!dot)return;
  const st=Sync.state;dot.className="dot "+({ok:"ok",busy:"busy",err:"err",expired:"err",offline:"busy"}[st]||"");
  t.textContent=st==="ok"?("OneDrive"+(Sync.last?" · usklajeno "+fmtTime(Sync.last):"")):st==="busy"?"Usklajujem z OneDrive …":st==="offline"?"Brez povezave · shranjeno na napravi":st==="expired"?"Prijava v OneDrive je potekla":st==="err"?"Usklajevanje ni uspelo":"Samo na tej napravi";
  t.title=Sync.msg||"";
  if(ui.tab==="nastavitve"&&!isField(document.activeElement))render();
}

/* ---------- Claude (Anthropic API) ---------- */
const MODELS={"claude-sonnet-5-5":"Claude Sonnet 5.5 (priporočeno)","claude-opus-5-5":"Claude Opus 5.5 (najboljša kakovost, dražji)","claude-haiku-5-5":"Claude Haiku 5.5 (najhitrejši, najcenejši)"};
async function claude(prompt,{onText,signal,maxTokens=16000,model}={}){
  const key=LS.get("apiKey","");if(!key)throw {code:"no_key"};
  let r;
  try{r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",signal,headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:model||LS.get("model","claude-sonnet-5-5"),max_tokens:maxTokens,stream:true,messages:[{role:"user",content:prompt}]})})}
  catch(e){if(e.name==="AbortError")throw e;throw {code:"network"}}
  if(!r.ok){let j=null;try{j=await r.json()}catch(e){}throw {code:"http",status:r.status,message:j&&j.error&&j.error.message}}
  const rd=r.body.getReader(),dec=new TextDecoder();let buf="",text="",truncated=false;
  try{
  for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
    let i;while((i=buf.indexOf("\n\n"))>=0){const ev=buf.slice(0,i);buf=buf.slice(i+2);
      const line=ev.split("\n").find(l=>l.startsWith("data:"));if(!line)continue;let j;try{j=JSON.parse(line.slice(5))}catch(e){continue}
      if(j.type==="content_block_delta"&&j.delta&&j.delta.type==="text_delta"){text+=j.delta.text;onText&&onText({text})}
      else if(j.type==="message_delta"&&j.delta&&j.delta.stop_reason==="max_tokens")truncated=true;
      else if(j.type==="error")throw {code:"http",status:0,message:j.error&&j.error.message,text}}}
  }catch(e){if(e&&e.name==="AbortError"){e.text=text}throw e}
  return {text,truncated};
}
async function claudeJson(prompt){
  const {text}=await claude(prompt+"\n\nVrni SAMO veljaven JSON, brez kakršnega koli drugega besedila.",{maxTokens:8000});
  const m=text.match(/[\[{][\s\S]*[\]}]/);if(!m)throw {code:"invalid_json"};
  return JSON.parse(m[0]);
}
function errMsg(e){
  if(!e)return "Neznana napaka.";
  if(e.code==="no_key")return "Za pomoč Claude vpišite API ključ v Nastavitvah.";
  if(e.code==="network")return "Ni povezave z internetom.";
  if(e.code==="invalid_json")return "Odgovora ni bilo mogoče prebrati – poskusite znova.";
  if(e.code==="http"){
    if(e.status===401)return "API ključ ni veljaven – preverite ga v Nastavitvah.";
    if(e.status===400&&/credit|balance/i.test(e.message||""))return "Na računu Anthropic ni dovolj dobroimetja (console.anthropic.com → Billing).";
    if(e.status===429)return "Preveč zahtev – poskusite čez minuto.";
    if(e.status===529||e.status===503)return "Claude je trenutno preobremenjen – poskusite čez nekaj minut.";
    return "Napaka Claude ("+e.status+"): "+(e.message||"");
  }
  return "Napaka: "+(e.message||e.code||e);
}

/* ---------- prenos datotek ---------- */
async function saveFile(name,blob){
  const file=new File([blob],name,{type:blob.type||"application/octet-stream"});
  if(isIOS&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file]});return}catch(e){if(e&&e.name==="AbortError")return}
  }
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
}

/* ---------- stanje vmesnika ---------- */
const ui={tab:"pregled",sejaId:null,draft:null,prepis:null,prepisSaved:null,leto:new Date().getFullYear(),filter:"odprti",
  sklepEdit:null,confirm:null,pending:false,izlusceni:null,izbranePredloge:null,busy:{},dirPorocilo:"",predlogaOdprta:null,novaPredloga:false,upload:{},audioUrl:{}};
const SEJA_ST={priprava:["V pripravi",""],sklicana:["Vabilo poslano","acc"],izvedena:["Izvedena","warn"],potrjena:["Zapisnik potrjen","good"]};
const SKLEP_ST={odprt:["Odprt",""],izvajanje:["V izvajanju","acc"],realiziran:["Realiziran","good"],brezpredmeten:["Brezpredmeten",""]};
const DEF_TOCKE=["Ugotovitev sklepčnosti in potrditev dnevnega reda","Potrditev zapisnika prejšnje seje","Pregled realizacije sklepov","Poročilo o poslovanju družbe","Razno"];

function druzba(){
  const d=S.druzba||{};
  return {naziv:d.naziv||"",naslov:d.naslov||"",direktor:d.direktor||"",kraj:d.kraj||"",
    clani:Array.isArray(d.clani)&&d.clani.length?d.clani:[{ime:"",funkcija:"predsednica"},{ime:"",funkcija:"namestnik predsednice"},{ime:"",funkcija:"član"}]};
}
const predsednica=()=>{const c=druzba().clani.find(c=>/predsedni/i.test(c.funkcija)&&!/namest/i.test(c.funkcija));return c&&c.ime?c.ime:"[ime predsednice]"};

/* ---------- risanje ---------- */
const main=$("#main");
function isField(el){return el&&/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)&&main.contains(el)}
function rr(){ if(isField(document.activeElement)||Rec.active){ui.pending=true;if(Rec.active)Rec.paint();return;} render(); }
main.addEventListener("focusout",()=>{ if(ui.pending)setTimeout(()=>{if(!isField(document.activeElement)&&!Rec.active)render()},0) });

function render(){
  ui.pending=false;
  $("#firma").textContent=druzba().naziv||"Nadzorni svet";paintSwitch();
  document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===ui.tab?"page":"false"));
  if(ui.tab==="seje"&&ui.sejaId&&ui.draft){ // posodobi osnutek, če se je seja spremenila na drugi napravi
    const sv=savedSeja();if(!sv){ui.sejaId=null;ui.draft=null}else if(!isDirty()&&ui._draftU!==sv._u){ui.draft=clone(sv);ui._draftU=sv._u}
  }
  if(!S.druzbe.length&&ui.tab!=="nastavitve"){main.innerHTML=vOnboarding();return}
  const v={pregled:vPregled,seje:ui.sejaId?vSeja:vSeje,sklepi:vSklepi,poslovanje:vPoslovanje,direktor:vDirektor,predloge:vPredloge,nastavitve:vNastavitve}[ui.tab]||vPregled;
  main.innerHTML=installNote()+v();
  if(ui.tab==="seje"&&ui.sejaId)updateDirty();
}
function go(tab){ if(Rec.active&&tab!=="seje"){toast("Med snemanjem ostanite na strani seje.");return} ui.tab=tab;ui.manual=null; if(tab!=="seje"){ui.sejaId=null;ui.draft=null} try{history.replaceState(null,"","#"+tab)}catch(e){} render(); window.scrollTo(0,0); }

function vOnboarding(){
  return `<section class="panel" style="max-width:640px"><h2>Dobrodošli</h2>
    <p class="lede">Najprej dodajte družbo, v kateri ste članica nadzornega sveta. Kasneje lahko dodate še druge; vsaka ima ločene seje, sklepe, poslovanje in oceno direktorja.</p>
    <label class="fld">Naziv družbe<input type="text" id="nd-naziv" placeholder="npr. Družba d.o.o."></label>
    <div class="row"><button class="btn primary" data-act="druzba-dodaj">Dodaj družbo</button></div>
    ${Sync.clientId()&&!Sync.account?`<p class="small muted">Podatke že imate v OneDrivu? <button class="btn ghost small" data-act="od-prijava">Prijavite se v OneDrive</button> in naložili se bodo.</p>`:""}
    <p class="small muted">Podatke iz aplikacije v Claudu uvozite v <button class="btn ghost small" data-tab="nastavitve">Nastavitvah</button> → Varnostna kopija.</p></section>`;
}
function paintSwitch(){
  const w=$("#druzbaSwitch");if(!w)return;
  if(S.druzbe.length<2){w.hidden=true;return}
  w.hidden=false;const sel=$("#druzbaSel");
  sel.innerHTML=S.druzbe.map(d=>`<option value="${d.id}" ${d.id===S.druzbaId?"selected":""}>${esc(d.naziv||"Brez naziva")}</option>`).join("");
}
function chip(map,key){const [t,c]=map[key]||[key||"–",""];return `<span class="chip ${c}">${esc(t)}</span>`}
function emptyBox(title,text,btn){return `<div class="empty"><strong style="color:var(--ink)">${esc(title)}</strong><span>${text}</span>${btn||""}</div>`}
const trunc=(s,n)=>{s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s};
let installEvt=null;
function installNote(){
  if(ui.tab!=="pregled")return "";
  if(Sync.state==="expired")return `<div class="banner warn"><span>Prijava v OneDrive je potekla. Spremembe se shranjujejo na napravo, usklajevanje je ustavljeno.</span><button class="btn primary" data-act="od-prijava">Prijavi se znova</button></div>`;
  if(isIOS&&!isStandalone()&&!LS.get("hideIosTip",false))return `<div class="banner"><span>Namestitev na iPhone: v Safariju tapnite <strong>Deli</strong> (kvadrat s puščico) in nato <strong>Dodaj na začetni zaslon</strong>.</span><button class="btn ghost" data-act="skrij-ios">Skrij</button></div>`;
  return "";
}

/* ---------- izračuni ---------- */
function finRows(y){const m=(S.finance[String(y)]||{}).m||{};const out=[];for(let i=1;i<=12;i++){const r=m[i]||{};out.push({m:i,pP:r.pP??null,pR:r.pR??null,oP:r.oP??null,oR:r.oR??null})}return out}
const sum=(a,k)=>a.reduce((s,r)=>s+(r[k]||0),0);
function finSum(y){
  const rows=finRows(y); let last=0; rows.forEach(r=>{if(r.pR!=null||r.oR!=null)last=r.m});
  const ytd=rows.filter(r=>r.m<=last);
  const o={rows,last,pP:sum(ytd,"pP"),pR:sum(ytd,"pR"),oP:sum(ytd,"oP"),oR:sum(ytd,"oR"),pPy:sum(rows,"pP"),oPy:sum(rows,"oP"),hasPlan:rows.some(r=>r.pP!=null||r.oP!=null)};
  o.zP=o.pP-o.oP; o.zR=o.pR-o.oR; o.zPy=o.pPy-o.oPy;
  return o;
}
const isOpen=s=>s.status==="odprt"||s.status==="izvajanje"||!s.status;
function sklepStats(){const t=today();const open=S.sklepi.filter(isOpen);
  return {odprti:open.length,zapadli:open.filter(s=>s.rok&&s.rok<t).length,realizirani:S.sklepi.filter(s=>s.status==="realiziran").length,skupaj:S.sklepi.length}}
const isOverdue=s=>isOpen(s)&&s.rok&&s.rok<today();
function dirData(y){return S.direktor[String(y)]||{kazalniki:[],komentar:""}}
function kpiCalc(k,y){
  const f=finSum(y); let real=k.realizacija??null, cilj=k.cilj??null, auto=false;
  if(k.vir==="prihodki"){auto=true;real=f.last?f.pR:null; if(cilj==null)cilj=f.last?f.pP:null}
  if(k.vir==="rezultat"){auto=true;real=f.last?f.zR:null; if(cilj==null)cilj=f.last?f.zP:null}
  if(k.vir==="sklepi"){auto=true;
    const lim=String(y)===String(new Date().getFullYear())?today():y+"-12-31";
    const rel=S.sklepi.filter(s=>s.rok&&s.rok.slice(0,4)===String(y)&&s.rok<=lim&&s.status!=="brezpredmeten");
    real=rel.length?rel.filter(s=>s.status==="realiziran").length/rel.length*100:null; if(cilj==null)cilj=100}
  let dos=null;
  if(real!=null&&cilj!=null&&cilj>0){dos=k.manjse?(real>0?cilj/real*100:null):real/cilj*100}
  return {real,cilj,dos,auto};
}
function dirScore(y){const ks=dirData(y).kazalniki||[];let w=0,s=0;
  ks.forEach(k=>{const c=kpiCalc(k,y);const u=+k.utez||0;if(c.dos!=null&&u>0){w+=u;s+=u*Math.min(c.dos,120)}});return w?s/w:null}
const tone=p=>p==null?"":p>=100?"good":p>=90?"warn":"bad";

/* ---------- grafi ---------- */
function niceMax(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}
function shortEur(v){const a=Math.abs(v);if(a>=1e6)return (v/1e6).toLocaleString("sl-SI",{maximumFractionDigits:1})+" mio";if(a>=1e3)return Math.round(v/1e3)+" tis.";return String(Math.round(v))}
function chartBars(rows){
  const vals=rows.flatMap(r=>[r.pP,r.pR]).filter(v=>v!=null);
  if(!vals.length)return `<p class="muted small">Graf se izriše, ko vnesete plan ali realizacijo prihodkov.</p>`;
  const W=680,H=230,pl=58,pr=8,pt=14,pb=26,iw=W-pl-pr,ih=H-pt-pb,max=niceMax(Math.max(...vals,1)),bw=iw/12;
  let g="";for(let t=0;t<=4;t++){const y=pt+ih-ih*t/4;g+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}"/><text x="${pl-8}" y="${y+4}" text-anchor="end">${shortEur(max*t/4)}</text>`}
  let b="";rows.forEach((r,i)=>{const x=pl+i*bw;
    if(r.pP!=null){const h=ih*Math.max(r.pP,0)/max;b+=`<rect class="bar-plan" x="${x+bw*.16}" y="${pt+ih-h}" width="${bw*.32}" height="${h}" rx="2"><title>${MESF[i]} plan: ${EUR(r.pP)}</title></rect>`}
    if(r.pR!=null){const h=ih*Math.max(r.pR,0)/max;b+=`<rect class="bar-real" x="${x+bw*.52}" y="${pt+ih-h}" width="${bw*.32}" height="${h}" rx="2"><title>${MESF[i]} realizacija: ${EUR(r.pR)}</title></rect>`}
    b+=`<text x="${x+bw/2}" y="${H-8}" text-anchor="middle">${MES[i]}</text>`});
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prihodki po mesecih, plan in realizacija">${g}<line class="axis" x1="${pl}" x2="${W-pr}" y1="${pt+ih}" y2="${pt+ih}"/>${b}</svg>
  <div class="legend"><span><i style="background:var(--plan)"></i>Plan</span><span><i style="background:var(--accent)"></i>Realizacija</span></div>`;
}
function chartCum(rows){
  let cp=0,cr=0;const P=[],R=[];let last=0;rows.forEach(r=>{if(r.pR!=null||r.oR!=null)last=r.m});
  rows.forEach(r=>{cp+=(r.pP||0)-(r.oP||0);P.push(r.pP!=null||r.oP!=null?cp:null);if(r.m<=last){cr+=(r.pR||0)-(r.oR||0);R.push(cr)}});
  const vals=[...P,...R].filter(v=>v!=null);
  if(!vals.length)return `<p class="muted small">Graf se izriše, ko vnesete prihodke in odhodke.</p>`;
  const W=680,H=210,pl=58,pr=12,pt=14,pb=26,iw=W-pl-pr,ih=H-pt-pb;
  let mx=Math.max(0,...vals),mn=Math.min(0,...vals);mx=mx>0?niceMax(mx):0;mn=mn<0?-niceMax(-mn):0;if(mx===mn)mx=1;
  const X=i=>pl+iw*(i+.5)/12,Y=v=>pt+ih*(mx-v)/(mx-mn);
  let g="";for(let t=0;t<=4;t++){const v=mn+(mx-mn)*t/4,y=Y(v);g+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}"/><text x="${pl-8}" y="${y+4}" text-anchor="end">${shortEur(v)}</text>`}
  const path=a=>a.map((v,i)=>v==null?"":`${X(i)},${Y(v)}`).filter(Boolean).join(" ");
  let lab="";rows.forEach((r,i)=>lab+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle">${MES[i]}</text>`);
  const lastI=R.length-1;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kumulativni poslovni izid">${g}<line class="axis" x1="${pl}" x2="${W-pr}" y1="${Y(0)}" y2="${Y(0)}"/>
  <polyline class="ln-plan" points="${path(P)}"/>${R.length?`<polyline class="ln-real" points="${path(R)}"/><circle class="dot-real" cx="${X(lastI)}" cy="${Y(R[lastI])}" r="5"><title>${MESF[lastI]}: ${EUR(R[lastI])}</title></circle>`:""}${lab}</svg>
  <div class="legend"><span><i style="background:var(--plan)"></i>Plan (kumulativno)</span><span><i style="background:var(--accent)"></i>Realizacija (kumulativno)</span></div>`;
}

/* ---------- PREGLED ---------- */
function vPregled(){
  const t=today();
  const prih=S.seje.filter(s=>s.datum>=t&&s.status!=="potrjena").sort((a,b)=>a.datum.localeCompare(b.datum))[0];
  const zadnja=S.seje.filter(s=>s.datum<t).sort((a,b)=>b.datum.localeCompare(a.datum))[0];
  const st=sklepStats(); const y=new Date().getFullYear(); const f=finSum(y); const sc=dirScore(y);
  const nujni=S.sklepi.filter(isOpen).sort((a,b)=>(a.rok||"9999").localeCompare(b.rok||"9999")).slice(0,5);
  const sejaCard=prih?`<div class="row" style="align-items:flex-end;gap:16px"><div class="sejano">${esc(prih.stevilka)}.<small>seja</small></div>
      <div><div style="font-weight:600">${esc(fmtDateLong(prih.datum))}${prih.ura?", ob "+esc(prih.ura):""}</div><div class="muted small">${esc(prih.kraj||"kraj ni določen")} · ${(prih.tocke||[]).length} točk dnevnega reda</div></div></div>
      <div class="row">${chip(SEJA_ST,prih.status)}<button class="btn" data-act="odpri-sejo" data-id="${prih.id}">Odpri sejo</button></div>`
    :emptyBox("Ni sklicane seje",zadnja?`Zadnja seja je bila ${esc(fmtDate(zadnja.datum))}.`:"Ustvarite prvo sejo in pripravite vabilo z dnevnim redom.",`<button class="btn primary" data-act="nova-seja">Nova seja</button>`);
  return `
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Naslednja seja</h2></div>${sejaCard}
      ${zadnja&&zadnja.status!=="potrjena"?`<p class="small muted">Zapisnik ${esc(zadnja.stevilka)}. seje (${esc(fmtDate(zadnja.datum))}) še ni potrjen. <button class="btn ghost small" data-act="odpri-sejo" data-id="${zadnja.id}">Odpri</button></p>`:""}
    </section>
    <section class="panel"><div class="panel-head"><h2>Sklepi nadzornega sveta</h2><button class="btn ghost" data-tab="sklepi">Vsi sklepi</button></div>
      <div class="stats"><div class="stat"><span class="v">${st.odprti}</span><span class="l">v izvajanju ali odprtih</span></div>
        <div class="stat ${st.zapadli?"bad":""}"><span class="v">${st.zapadli}</span><span class="l">s preteklim rokom</span></div>
        <div class="stat good"><span class="v">${st.realizirani}</span><span class="l">realiziranih</span></div></div>
      ${nujni.length?`<div class="list">${nujni.map(s=>`<div class="item"><div class="main"><div class="small muted num">${esc(s.oznaka||"")}</div><div>${esc(trunc(s.besedilo,140))}</div></div><span class="chip ${isOverdue(s)?"bad":""}">${s.rok?"rok "+esc(fmtDate(s.rok)):"brez roka"}</span></div>`).join("")}</div>`:`<p class="muted small">Ni odprtih sklepov.</p>`}
    </section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Poslovanje ${y}${f.last?` <span class="muted" style="font-family:var(--f-body);font-size:14px;font-weight:400">· jan–${MES[f.last-1]}</span>`:""}</h2><button class="btn ghost" data-tab="poslovanje">Vnos podatkov</button></div>
    ${f.last||f.hasPlan?`<div class="stats">
      <div class="stat"><span class="v">${EUR(f.pR)}</span><span class="l">prihodki, realizacija</span></div>
      <div class="stat ${tone(f.pP?f.pR/f.pP*100:null)}"><span class="v">${PCT(f.pP?f.pR/f.pP*100:null)}</span><span class="l">prihodki glede na plan</span></div>
      <div class="stat"><span class="v">${EUR(f.zR)}</span><span class="l">poslovni izid, realizacija</span></div>
      <div class="stat ${f.zP>0?tone(f.zR/f.zP*100):""}"><span class="v">${EUR(f.zR-f.zP)}</span><span class="l">odmik izida od plana</span></div>
      <div class="stat ${tone(sc)}"><span class="v">${PCT(sc)}</span><span class="l">ocena uspešnosti direktorja</span></div></div>${chartBars(f.rows)}`
    :emptyBox("Ni podatkov o poslovanju",`Vnesite letni plan po mesecih in mesečno realizacijo prihodkov in odhodkov. Iz njih se izračunajo indeksi in kazalniki direktorja.`,`<button class="btn primary" data-tab="poslovanje">Vnesi plan in realizacijo</button>`)}
  </section>`;
}

/* ---------- SEJE ---------- */
function vSeje(){
  const list=[...S.seje].sort((a,b)=>(b.datum||"").localeCompare(a.datum||""));
  return `<section class="panel"><div class="panel-head"><h2>Seje</h2><button class="btn primary" data-act="nova-seja">Nova seja</button></div>
  <p class="lede">Za vsako sejo: dnevni red in vabilo, snemanje, prepis in osnutek zapisnika v slogu vaših preteklih zapisnikov.</p>
  ${list.length?`<div>${list.map(s=>{const n=S.sklepi.filter(k=>k.sejaId===s.id).length;const np=S.posnetki.filter(p=>p.sejaId===s.id).length;return `<button class="sejarow" data-act="odpri-sejo" data-id="${s.id}">
    <span class="sejano">${esc(s.stevilka)}.<small>${s.vrsta==="korespondencna"?"dopisna":"seja"}</small></span>
    <span style="min-width:0"><span style="display:block;font-weight:600">${esc(fmtDateLong(s.datum))}${s.ura?", "+esc(s.ura):""}</span>
    <span class="small muted">${(s.tocke||[]).length} točk · ${s.zapisnik?"zapisnik pripravljen":"brez zapisnika"}${np?" · "+np+" posnetek":""}${n?" · "+n+" sklepov v evidenci":""}</span></span>
    ${chip(SEJA_ST,s.status)}</button>`}).join("")}</div>`
  :emptyBox("Še ni nobene seje","Nova seja dobi privzeti dnevni red (sklepčnost, potrditev zapisnika, realizacija sklepov, poslovanje, razno), ki ga lahko poljubno spremenite.",`<button class="btn primary" data-act="nova-seja">Ustvari prvo sejo</button>`)}
  </section>`;
}
function novaSeja(){
  const nums=S.seje.map(s=>parseInt(s.stevilka,10)).filter(n=>isFinite(n));
  const id=uid(), d=druzba();
  const s={stevilka:String(nums.length?Math.max(...nums)+1:1),datum:addDays(today(),14),ura:"15:00",kraj:d.kraj||"",vrsta:"redna",status:"priprava",
    tocke:DEF_TOCKE.map(n=>({naslov:n,gradivo:"",predlog:""})),prisotni:d.clani.map(c=>c.ime).filter(Boolean),drugi:d.direktor?d.direktor+", direktor":"",vabilo:"",zapisnik:"",ustvarjeno:new Date().toISOString()};
  write("seje/"+id,s);openSeja(id);
}
function openSeja(id){
  const s=S.seje.find(x=>x.id===id); if(!s)return;
  ui.manual=null;ui.tab="seje";ui.sejaId=id;ui.draft=clone(s);ui._draftU=s._u;ui.izlusceni=null;ui.izbranePredloge=null;
  const t=(S.prepisi[id]||{}).besedilo||"";ui.prepis=t;ui.prepisSaved=t;
  try{history.replaceState(null,"","#seje")}catch(e){}
  render();window.scrollTo(0,0);
}
function savedSeja(){return S.seje.find(x=>x.id===ui.sejaId)}
function isDirty(){const s=savedSeja();return !s||JSON.stringify(strip(s))!==JSON.stringify(strip(ui.draft))}
function updateDirty(){const b=$("#savebar");if(b)b.dataset.dirty=isDirty()?"1":"0";const p=$("#prepisState");if(p)p.textContent=ui.prepis!==ui.prepisSaved?"Neshranjen prepis":(ui.prepis?"Prepis shranjen · "+NUM.format(ui.prepis.length)+" znakov":"")}

function vPosnetki(sejaId){
  const list=S.posnetki.filter(p=>p.sejaId===sejaId).sort((a,b)=>(a.ustvarjeno||"").localeCompare(b.ustvarjeno||""));
  if(!list.length)return "";
  return `<div class="list">${list.map(p=>{const up=ui.upload[p.id];const local=Rec.local.has(p.id);
    return `<div class="item" style="flex-wrap:wrap"><div class="main"><strong>${esc(p.ime)}</strong>
      <div class="small muted">${esc(fmtDur(p.trajanje||0))} · ${esc(fmtSize(p.velikost||0))} · ${p.onedriveId?"v OneDrivu":(local?"samo na tej napravi":"na drugi napravi")}${p.obnovljen?" · obnovljen":""}</div>
      ${local&&ui.audioUrl[p.id]?`<audio controls preload="none" src="${ui.audioUrl[p.id]}"></audio>`:""}
      ${up!=null?`<div class="meter" style="margin-top:6px;max-width:260px"><b style="width:${Math.round(up*100)}%"></b></div><span class="small muted">Nalagam v OneDrive ${Math.round(up*100)} %</span>`:""}</div>
      <div class="row">
        ${local&&!ui.audioUrl[p.id]?`<button class="btn ghost" data-act="pos-predvajaj" data-id="${p.id}">Predvajaj</button>`:""}
        ${local||p.onedriveId?`<button class="btn" data-act="pos-shrani" data-id="${p.id}">Shrani datoteko</button>`:""}
        ${local&&!p.onedriveId&&Sync.account&&up==null?`<button class="btn primary" data-act="pos-nalozi" data-id="${p.id}">Naloži v OneDrive</button>`:""}
        ${p.onedriveUrl?`<a class="btn ghost" href="${esc(p.onedriveUrl)}" target="_blank" rel="noopener">Odpri v OneDrivu</a>`:""}
        ${local&&p.onedriveId?`<button class="btn ghost ${ui.confirm==="pl-"+p.id?"danger armed":""}" data-act="pos-brisi-lokalno" data-id="${p.id}">${ui.confirm==="pl-"+p.id?"Potrdite":"Sprosti prostor na napravi"}</button>`:""}
        <button class="btn ghost danger ${ui.confirm==="pd-"+p.id?"armed":""}" data-act="pos-brisi" data-id="${p.id}">${ui.confirm==="pd-"+p.id?"Potrdite izbris":"Izbriši"}</button>
      </div></div>`}).join("")}</div>`;
}

function vSeja(){
  const s=ui.draft; if(!s)return vSeje(); const d=druzba(); const busy=ui.busy;
  const predloge=[...S.predloge].sort((a,b)=>(b.datum||"").localeCompare(a.datum||""));
  if(ui.izbranePredloge==null)ui.izbranePredloge=predloge.slice(0,3).map(p=>p.id);
  const clani=d.clani.map(c=>c.ime).filter(Boolean);
  const hasKey=!!LS.get("apiKey","");
  return `
  <div class="row" style="justify-content:space-between"><button class="btn ghost" data-act="nazaj">← Vse seje</button>
    <button class="btn danger ${ui.confirm==="seja"?"armed":""}" data-act="brisi-sejo">${ui.confirm==="seja"?"Kliknite še enkrat za izbris seje":"Izbriši sejo"}</button></div>
  <section class="panel">
    <div class="step"><span class="n">1</span><div><h2>${esc(s.stevilka)}. ${s.vrsta==="korespondencna"?"korespondenčna":"redna"} seja</h2><p class="small muted">Podatki o seji in dnevni red</p></div></div>
    <div class="fields">
      <label class="fld">Številka seje<input type="text" id="f-stevilka" data-f="stevilka" value="${esc(s.stevilka)}"></label>
      <label class="fld">Datum<input type="date" id="f-datum" data-f="datum" value="${esc(s.datum)}"></label>
      <label class="fld">Ura<input type="time" id="f-ura" data-f="ura" value="${esc(s.ura)}"></label>
      <label class="fld">Vrsta<select id="f-vrsta" data-f="vrsta"><option value="redna" ${s.vrsta!=="korespondencna"?"selected":""}>Redna</option><option value="korespondencna" ${s.vrsta==="korespondencna"?"selected":""}>Korespondenčna</option></select></label>
      <label class="fld">Status<select id="f-status" data-f="status">${Object.entries(SEJA_ST).map(([k,[t]])=>`<option value="${k}" ${s.status===k?"selected":""}>${t}</option>`).join("")}</select></label>
    </div>
    <label class="fld">Kraj<input type="text" id="f-kraj" data-f="kraj" value="${esc(s.kraj)}" placeholder="npr. sejna soba na sedežu družbe"></label>
    <div class="fld"><span>Prisotni člani NS</span>
      ${clani.length?`<div class="checks">${clani.map((c,i)=>`<label><input type="checkbox" id="pris-${i}" data-prisoten="${esc(c)}" ${(s.prisotni||[]).includes(c)?"checked":""}>${esc(c)}</label>`).join("")}</div>`:`<span class="small">Imena članov vpišite v <button class="btn ghost small" data-tab="nastavitve">Nastavitvah</button>.</span>`}</div>
    <label class="fld">Drugi prisotni (direktor, vabljeni, zapisnikar)<input type="text" id="f-drugi" data-f="drugi" value="${esc(s.drugi)}"></label>
    <div><h3 style="margin-bottom:4px">Dnevni red</h3>
      ${(s.tocke||[]).map((t,i)=>`<div class="tocka"><span class="n">${i+1}.</span><div class="body">
        <input type="text" id="t-naslov-${i}" data-t="naslov" data-i="${i}" value="${esc(t.naslov)}" placeholder="Naslov točke" aria-label="Naslov ${i+1}. točke">
        <input type="text" id="t-gradivo-${i}" data-t="gradivo" data-i="${i}" value="${esc(t.gradivo)}" placeholder="Gradivo (npr. Poročilo o poslovanju jan–sep 2026)" aria-label="Gradivo ${i+1}. točke">
        <textarea id="t-predlog-${i}" data-t="predlog" data-i="${i}" rows="2" placeholder="Predlog sklepa" aria-label="Predlog sklepa ${i+1}. točke">${esc(t.predlog)}</textarea></div>
        <div class="tools"><button class="btn ghost" data-act="tocka-gor" data-id="${i}" ${i===0?"disabled":""} aria-label="Premakni gor">↑</button><button class="btn ghost" data-act="tocka-dol" data-id="${i}" ${i===s.tocke.length-1?"disabled":""} aria-label="Premakni dol">↓</button><button class="btn ghost" data-act="tocka-brisi" data-id="${i}" aria-label="Odstrani točko">✕</button></div></div>`).join("")}
      <button class="btn" data-act="tocka-dodaj" style="margin-top:10px">Dodaj točko</button></div>
  </section>

  <section class="panel">
    <div class="step"><span class="n">2</span><div><h2>Vabilo z gradivom</h2><p class="small muted">Vabilo se sestavi iz podatkov zgoraj. Besedilo lahko uredite in ga prenesete kot Word.</p></div></div>
    <div class="row"><button class="btn" data-act="vabilo-sestavi">${s.vabilo?"Sestavi znova iz dnevnega reda":"Sestavi vabilo"}</button>
      ${s.vabilo?`<button class="btn" data-act="vabilo-word">Prenesi Word</button><button class="btn ghost" data-act="kopiraj" data-id="f-vabilo">Kopiraj besedilo</button>`:""}</div>
    ${s.vabilo?`<textarea class="doc" id="f-vabilo" data-f="vabilo" style="min-height:360px">${esc(s.vabilo)}</textarea>`:""}
    <p class="small muted">Gradivo (poročila, izkazi) priložite e-pošti kot doslej; v vabilu so našteta po točkah.</p>
  </section>

  <section class="panel">
    <div class="step"><span class="n">3</span><div><h2>Snemanje seje</h2><p class="small muted">Telefon ali računalnik položite na sredino mize.</p></div></div>
    <div id="recBox">${Rec.html()}</div>
    ${vPosnetki(s.id)}
    <details class="small"><summary style="cursor:pointer;font-weight:600">Brez Sonioxa: kako dobim prepis posnetka v Wordu</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px;max-width:75ch">
        <li>Posnetek naložite v OneDrive (gumb zgoraj). Na računalniku je v mapi <strong>OneDrive – op-bertok → Aplikacije → Nadzorni svet → Posnetki</strong>.</li>
        <li>Na office.com odprite nov Wordov dokument, kliknite <strong>Narekuj → Prepis → Naloži zvok</strong> in izberite posnetek.</li>
        <li>Ko je prepis gotov, izberite <strong>Dodaj v dokument → S pogovorniki in časovnimi žigi</strong>, dokument shranite kot .docx in ga naložite spodaj.</li>
      </ol></details>
  </section>

  <section class="panel">
    <div class="step"><span class="n">4</span><div><h2>Prepis seje</h2><p class="small muted">Prepis je vir za zapisnik.</p></div></div>
    <div class="row"><label class="btn" for="prepisFile">Naloži prepis (.docx, .txt)</label><input type="file" id="prepisFile" accept=".docx,.txt,.vtt,.srt,.md" hidden>
      <button class="btn primary" data-act="prepis-shrani" ${ui.prepis!==ui.prepisSaved?"":"disabled"}>Shrani prepis</button><span class="small muted" id="prepisState"></span></div>
    <textarea id="prepis" rows="10" placeholder="Prilepite prepis seje …">${esc(ui.prepis||"")}</textarea>
  </section>

  <section class="panel">
    <div class="step"><span class="n">5</span><div><h2>Zapisnik</h2><p class="small muted">Claude pripravi osnutek iz prepisa in dnevnega reda, v strukturi in slogu izbranih preteklih zapisnikov. Nejasna mesta označi z [PREVERI].</p></div></div>
    ${ui.manual&&ui.manual.kind==="zapisnik"?manualBox():""}
    <div class="fld"><span>Predloge (pretekli zapisniki)</span>
      ${predloge.length?`<div class="checks">${predloge.map(p=>`<label><input type="checkbox" id="pr-${p.id}" data-predloga="${p.id}" ${ui.izbranePredloge.includes(p.id)?"checked":""}>${esc(p.naziv)}</label>`).join("")}</div>`
      :`<span class="small">Ni naloženih preteklih zapisnikov. Brez njih bo osnutek v splošni obliki. <button class="btn ghost small" data-tab="predloge">Naloži pretekle zapisnike</button></span>`}</div>
    <div class="row">
      <button class="btn primary ${busy.zapisnik?"busy":""}" data-act="zapisnik-pripravi" ${busy.zapisnik?"disabled":""}>${busy.zapisnik?"Pišem osnutek ":s.zapisnik?"Pripravi nov osnutek":"Pripravi osnutek zapisnika"}</button>
      ${busy.zapisnik?`<button class="btn" data-act="zapisnik-ustavi">Ustavi</button>`:""}
      ${s.zapisnik&&!busy.zapisnik?`<button class="btn" data-act="zapisnik-word">Prenesi Word</button><button class="btn ghost" data-act="kopiraj" data-id="f-zapisnik">Kopiraj</button>`:""}</div>
    ${s.zapisnik||busy.zapisnik?`<textarea class="doc" id="f-zapisnik" data-f="zapisnik" ${busy.zapisnik?"readonly":""}>${esc(s.zapisnik)}</textarea>`:""}
    ${s.zapisnik&&!busy.zapisnik?`<div class="panel" style="background:var(--sunk);border:0">
      <div class="panel-head"><h3>Sklepi v evidenco</h3><button class="btn ${busy.izlusci?"busy":""}" data-act="sklepi-izlusci" ${busy.izlusci?"disabled":""}>${busy.izlusci?"Iščem sklepe ":"Izlušči sklepe iz zapisnika"}</button></div>
      ${ui.manual&&ui.manual.kind==="sklepi"?manualBox():""}
      ${ui.izlusceni?(ui.izlusceni.length?`<div class="list">${ui.izlusceni.map((k,i)=>`<label class="item" style="cursor:pointer"><input type="checkbox" id="izl-${i}" data-izl="${i}" ${k.sel?"checked":""} style="margin-top:4px">
          <span class="main"><span class="small muted num">${esc(k.oznaka)}</span><span style="display:block">${esc(k.besedilo)}</span><span class="small muted">${k.zadolzen?"Zadolžen: "+esc(k.zadolzen)+" · ":""}${k.rok?"Rok: "+esc(fmtDate(k.rok)):"Brez roka"}</span></span></label>`).join("")}</div>
          <div class="row"><button class="btn primary" data-act="sklepi-dodaj">Dodaj izbrane v evidenco</button><button class="btn ghost" data-act="izl-preklici">Prekliči</button></div>`
        :`<p class="small muted">V zapisniku ni najdenih sprejetih sklepov.</p>`)
      :`<p class="small muted">Sprejeti sklepi se prenesejo v zavihek Sklepi, kjer spremljate rok in realizacijo.</p>`}</div>`:""}
  </section>
  <div class="savebar" id="savebar" data-dirty="0"><span class="small"><span class="dirtymsg" style="color:var(--warn);font-weight:600">Neshranjene spremembe seje</span><span class="cleanmsg muted">Vse spremembe so shranjene</span></span>
    <div class="row"><button class="btn ghost" data-act="seja-zavrzi">Zavrzi</button><button class="btn primary" data-act="seja-shrani">Shrani sejo</button></div></div>`;
}

function sestaviVabilo(){
  const s=ui.draft,d=druzba(); const clani=d.clani.filter(c=>c.ime);
  const L=[];
  L.push(d.naziv); if(d.naslov)L.push(d.naslov); L.push("NADZORNI SVET","");
  L.push(`Ljubljana, ${fmtDate(today())}`,"");
  L.push("Članom nadzornega sveta:"); clani.forEach(c=>L.push(`– ${c.ime}, ${c.funkcija}`));
  if(d.direktor)L.push("",`V vednost: ${d.direktor}, direktor`); L.push("");
  const vrsta=s.vrsta==="korespondencna"?"KORESPONDENČNO":"REDNO";
  L.push(`VABILO NA ${s.stevilka}. ${vrsta} SEJO NADZORNEGA SVETA`,"");
  if(s.vrsta==="korespondencna")L.push(`Sklicujem ${s.stevilka}. korespondenčno sejo nadzornega sveta družbe ${d.naziv}. Glasovanje poteka do ${fmtDateLong(s.datum)}${s.ura?", do "+s.ura+" ure":""}.`);
  else L.push(`Sklicujem ${s.stevilka}. sejo nadzornega sveta družbe ${d.naziv}, ki bo v ${fmtDateLong(s.datum)}${s.ura?", ob "+s.ura+" uri":""}${s.kraj?", "+s.kraj:""}.`);
  L.push("","Predlagam naslednji","","DNEVNI RED:","");
  (s.tocke||[]).forEach((t,i)=>{L.push(`${i+1}. ${t.naslov}`);if(t.gradivo)L.push(`   Gradivo: ${t.gradivo}`);if(t.predlog)L.push(`   Predlog sklepa: ${t.predlog}`);L.push("")});
  L.push("Gradivo k posameznim točkam dnevnega reda je priloženo temu vabilu.");
  if(s.vrsta!=="korespondencna")L.push("Seja se bo zvočno snemala za potrebe priprave zapisnika. Prosim, da morebitno odsotnost pravočasno sporočite.");
  L.push("","Lep pozdrav,","",predsednica(),"predsednica nadzornega sveta","","Priloge: gradivo po točkah dnevnega reda");
  return L.join("\n");
}

/* ---------- SPROTNI PREPIS (Soniox) ----------
   Med snemanjem se zvok sproti pošilja v Soniox (16 kHz PCM), prepis z oznakami govorcev se izpisuje v korak 4.
   Ključ je shranjen samo na tej napravi (Nastavitve → Soniox). */
const SONIOX_URL="wss://stt-rt.soniox.com/transcribe-websocket";
const Live={on:false,ws:null,ac:null,src:null,proc:null,sejaId:null,base:"",fin:"",nonfin:"",lastSpk:null,legacy:false,opened:false,stopping:false,
  fatal:false,dead:false,err:"",retries:0,kaT:0,saveT:0,reT:0,done:null,
  key(){return LS.get("sonioxKey","")},
  enabled(){return !!this.key()&&LS.get("sonioxOn",true)!==false},
  text(){const f=this.fin.trim();return (this.base&&f?this.base+"\n\n":this.base)+f},
  config(){const c={model:LS.get("sonioxModel","stt-rt-v6"),audio_format:"pcm_s16le",sample_rate:16000,num_channels:1,language_hints:["sl"],enable_speaker_diarization:true};
    if(this.legacy)c.api_key=this.key();return c},
  open(){return this.legacy?new WebSocket(SONIOX_URL):new WebSocket(SONIOX_URL,["soniox-api-key",this.key()])},
  start(stream,sejaId){
    Object.assign(this,{on:true,sejaId,fin:"",nonfin:"",lastSpk:null,err:"",retries:0,stopping:false,fatal:false,dead:false,legacy:LS.get("sonioxLegacy",false)});
    const prev=(ui.sejaId===sejaId?(ui.prepis||""):((S.prepisi[sejaId]||{}).besedilo||"")).trim();
    this.base=prev?prev+"\n\n[nadaljevanje snemanja ob "+fmtTime(Date.now())+"]":"";
    const AC=window.AudioContext||window.webkitAudioContext;
    this.ac=new AC();this.src=this.ac.createMediaStreamSource(stream);this.proc=this.ac.createScriptProcessor(4096,1,1);
    const ratio=this.ac.sampleRate/16000;
    this.proc.onaudioprocess=e=>{
      if(!this.ws||this.ws.readyState!==1||!this.opened||Rec.paused)return;
      const inp=e.inputBuffer.getChannelData(0),n=Math.floor(inp.length/ratio),out=new Int16Array(n);
      for(let i=0;i<n;i++){const a=Math.floor(i*ratio),b=Math.max(a+1,Math.min(inp.length,Math.floor((i+1)*ratio)));let s=0;for(let j=a;j<b;j++)s+=inp[j];
        const v=Math.max(-1,Math.min(1,s/(b-a)));out[i]=v<0?v*0x8000:v*0x7fff}
      try{this.ws.send(out.buffer)}catch(err){}
    };
    const mute=this.ac.createGain();mute.gain.value=0;this.src.connect(this.proc);this.proc.connect(mute);mute.connect(this.ac.destination);
    if(this.ac.state==="suspended")this.ac.resume().catch(()=>{});
    this.connect();
    this.kaT=setInterval(()=>{if(this.ws&&this.ws.readyState===1&&this.opened&&Rec.paused)try{this.ws.send(JSON.stringify({type:"keepalive"}))}catch(e){}},8000);
    this.saveT=setInterval(()=>this.save(),20000);
  },
  connect(){
    this.opened=false;this.fatal=false;let ws;
    try{ws=this.open()}catch(e){if(!this.legacy){this.legacy=true;return this.connect()}return this.fail("Povezava s Sonioxom ni mogoča.")}
    this.ws=ws;
    ws.onopen=()=>{try{ws.send(JSON.stringify(this.config()))}catch(e){}this.opened=true;this.err="";this.paint()};
    ws.onmessage=ev=>{let r;try{r=JSON.parse(ev.data)}catch(e){return}
      if(r.error_code||r.error_message){this.err=String(r.error_message||r.error_code);this.fatal=/^40[0-3]$/.test(String(r.error_code))||/key|auth|unauthori|forbidden|balance|credit|quota/i.test(this.err);return}
      if(Array.isArray(r.tokens)){let nf="";for(const t of r.tokens){if(!t||typeof t.text!=="string"||/^<(end|fin)>$/.test(t.text))continue;if(t.is_final)this.add(t);else nf+=t.text}this.nonfin=nf;this.paint()}
      if(r.finished&&this.done)this.done();
    };
    ws.onclose=()=>{
      const wasOpen=this.opened;this.opened=false;if(this.ws!==ws)return;this.ws=null;
      if(this.stopping){this.done&&this.done();return}
      if(!this.on)return;
      if(!wasOpen&&!this.legacy&&!this.err){this.legacy=true;return this.connect()} // brskalnik/strežnik ni sprejel ključa v protokolu – pošljemo ga v prvem sporočilu
      if(this.fatal)return this.fail("Soniox je zavrnil prepis ("+this.err+"). Preverite ključ in dobroimetje v Nastavitvah. Snemanje teče naprej.");
      if(this.retries++<30){this.err="Povezava s Sonioxom je prekinjena – ponovno povezujem …";this.fin=this.fin.replace(/\s+$/,"")+"\n\n[prekinitev prepisa ob "+fmtTime(Date.now())+"]";this.lastSpk=null;this.paint();
        this.reT=setTimeout(()=>{if(this.on&&!this.stopping)this.connect()},Math.min(15000,1500*this.retries));}
      else this.fail("Povezave s Sonioxom ni mogoče vzpostaviti. Snemanje teče naprej; prepis lahko naredite kasneje iz posnetka.");
    };
    ws.onerror=()=>{};
  },
  add(t){
    let tx=t.text;const sp=t.speaker!=null&&t.speaker!==""?String(t.speaker):null;
    if(sp!==null&&sp!==this.lastSpk){this.fin=this.fin.replace(/\s+$/,"")+(this.fin?"\n\n":"")+"Govorec "+sp+": ";this.lastSpk=sp;tx=tx.replace(/^\s+/,"")}
    this.fin+=tx;
  },
  state(){
    if(this.dead)return `<span style="color:var(--bad)">${esc(this.err)}</span>`;
    if(this.err)return `<span style="color:var(--warn)">${esc(this.err)}</span>`;
    if(!this.opened)return "Povezujem s Sonioxom …";
    return Rec.paused?"Sprotni prepis: premor":"Sprotni prepis teče (Soniox)";
  },
  paint(){
    const s=$("#liveState");if(s)s.innerHTML=this.state();
    const b=$("#liveTxt");if(b){const f=this.fin.trim();const tail=f.length>1600?"…"+f.slice(-1600):f;
      b.innerHTML=(tail?esc(tail):`<span class="muted">Besedilo se bo izpisovalo, ko bo kdo spregovoril …</span>`)+(this.nonfin?`<span class="muted">${esc(this.nonfin)}</span>`:"");b.scrollTop=b.scrollHeight}
    if(ui.sejaId===this.sejaId){ui.prepis=this.text();const ta=$("#prepis");if(ta){ta.readOnly=true;if(document.activeElement!==ta)ta.value=ui.prepis}updateDirty()}
  },
  save(){
    if(!this.sejaId)return;const t=this.text();if(!t.trim())return;
    if(((S.prepisi[this.sejaId]||{}).besedilo||"")===t)return;
    write("prepisi/"+this.sejaId,{besedilo:t,posodobljeno:new Date().toISOString(),vir:"soniox"});
    if(ui.sejaId===this.sejaId){ui.prepis=t;ui.prepisSaved=t;updateDirty()}
  },
  fail(msg){this.err=msg;this.dead=true;toast(msg,9000);this.paint()},
  async stop(){
    if(!this.on)return;this.stopping=true;
    clearInterval(this.kaT);clearInterval(this.saveT);clearTimeout(this.reT);
    try{this.proc&&this.proc.disconnect();this.src&&this.src.disconnect()}catch(e){}
    const ws=this.ws;
    if(ws&&ws.readyState===1&&this.opened){await new Promise(res=>{this.done=res;try{ws.send("")}catch(e){res()}setTimeout(res,8000)})}
    try{ws&&ws.close()}catch(e){}
    try{this.ac&&this.ac.close()}catch(e){}
    if(this.legacy)LS.set("sonioxLegacy",true);
    this.nonfin="";this.save();
    const n=this.fin.trim().length;
    this.on=false;this.ws=null;this.done=null;this.ac=null;this.src=null;this.proc=null;
    if(n)toast("Prepis je shranjen v korak 4 ("+NUM.format(n)+" znakov).",5000);
  },
  test(){ // kratek preizkus ključa: odpre sejo, pošlje pol sekunde tišine in jo zaključi
    return new Promise((res,rej)=>{
      const key=this.key();if(!key)return rej(new Error("Vpišite ključ."));
      let settled=false,legacy=LS.get("sonioxLegacy",false);
      const go=()=>{let opened=false,err="";const ws=legacy?new WebSocket(SONIOX_URL):new WebSocket(SONIOX_URL,["soniox-api-key",key]);
        const fin=(ok,m)=>{if(settled)return;settled=true;try{ws.close()}catch(e){}ok?res():rej(new Error(m))};
        ws.onopen=()=>{opened=true;const c={model:LS.get("sonioxModel","stt-rt-v6"),audio_format:"pcm_s16le",sample_rate:16000,num_channels:1,language_hints:["sl"]};if(legacy)c.api_key=key;
          ws.send(JSON.stringify(c));ws.send(new Int16Array(8000).buffer);ws.send("")};
        ws.onmessage=ev=>{let r={};try{r=JSON.parse(ev.data)}catch(e){}if(r.error_code||r.error_message){err=String(r.error_message||r.error_code);fin(false,err)}else if(r.finished)fin(true)};
        ws.onclose=()=>{if(settled)return;if(!opened&&!legacy){legacy=true;LS.set("sonioxLegacy",true);go();return}fin(false,err||"Povezava ni uspela.")};
        setTimeout(()=>fin(false,"Soniox se ni odzval."),15000)};
      go();
    });
  }
};

/* ---------- SNEMANJE ---------- */
const Rec={active:false,paused:false,mr:null,stream:null,id:null,sejaId:null,n:0,mime:"",t0:0,acc:0,raf:0,an:null,ac:null,wake:null,local:new Set(),level:0,
  supported(){return !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder)},
  elapsed(){return this.acc+(this.active&&!this.paused?Date.now()-this.t0:0)},
  html(){
    if(!this.supported())return `<div class="note warn">Ta brskalnik ne podpira snemanja. Uporabite Safari na iPhonu ali Edge/Chrome na računalniku.</div>`;
    if(this.active&&this.sejaId!==ui.sejaId)return `<div class="note warn">Snemanje teče pri drugi seji.</div>`;
    if(!this.active)return `<div class="rec"><div class="row"><button class="btn rec-btn" data-act="rec-start">● Začni snemanje</button></div>
      ${Live.enabled()?`<p class="small"><span class="chip good">Sprotni prepis vklopljen</span> Med snemanjem Soniox sproti piše prepis z oznakami govorcev v korak 4; ko ustavite, je prepis že shranjen.</p>`
        :`<p class="small muted">Sprotni prepis ni vklopljen. Če v <button class="btn ghost small" data-tab="nastavitve">Nastavitvah</button> vpišete ključ Soniox, se bo prepis pisal sam med snemanjem.</p>`}
      <p class="small muted">Med snemanjem ne zaklepajte telefona in ne preklapljajte v druge aplikacije, ker se snemanje ustavi. Zaslon ostane prižgan sam. Posnetek se sproti shranjuje na napravo, zato se ob prekinitvi ohrani vse do tistega trenutka.</p></div>`;
    return `<div class="rec ${this.paused?"":"live"}"><div class="row" style="gap:14px">${this.paused?`<span class="chip warn">Premor</span>`:`<span class="recdot" aria-hidden="true"></span>`}<span class="time" id="recTime">${fmtDur(this.elapsed())}</span></div>
      <div class="level" aria-hidden="true"><b id="recLevel"></b></div>
      <div class="row">${this.paused?`<button class="btn" data-act="rec-resume">Nadaljuj</button>`:`<button class="btn" data-act="rec-pause">Premor</button>`}<button class="btn primary" data-act="rec-stop">Ustavi in shrani</button></div>
      ${Live.on?`<div class="livebox"><div class="small" id="liveState">${Live.state()}</div><div class="livetxt" id="liveTxt" aria-live="polite"></div></div>`:""}</div>`;
  },
  paint(){const b=$("#recBox");if(b&&ui.tab==="seje"){b.innerHTML=this.html();if(Live.on)Live.paint()}},
  async start(){
    if(this.active)return;
    try{this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}
    catch(e){toast(e&&e.name==="NotAllowedError"?"Dostop do mikrofona je zavrnjen. Dovolite ga v nastavitvah brskalnika (na iPhonu: Nastavitve → Safari → Mikrofon).":"Mikrofona ni mogoče vklopiti: "+(e.message||e),7000);return}
    const cands=["audio/mp4","audio/webm;codecs=opus","audio/webm"];this.mime=cands.find(m=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||"";
    try{this.mr=new MediaRecorder(this.stream,this.mime?{mimeType:this.mime,audioBitsPerSecond:64000}:{})}catch(e){this.mr=new MediaRecorder(this.stream)}
    this.mime=this.mr.mimeType||this.mime||"audio/mp4";
    this.id=uid();this.sejaId=ui.sejaId;this.n=0;this.acc=0;this.t0=Date.now();this.active=true;this.paused=false;
    await IDB.set("kv","recActive",{id:this.id,sejaId:this.sejaId,mime:this.mime,started:Date.now()});
    this.pend=[];this.mr.ondataavailable=ev=>{if(!ev.data||!ev.data.size)return;const k=this.id+":"+String(this.n++).padStart(6,"0");this.pend.push(ev.data.arrayBuffer().then(buf=>IDB.set("chunks",k,buf)).catch(()=>{}))};
    this.mr.onstop=()=>this.finish();
    this.stream.getAudioTracks().forEach(t=>t.onended=()=>{if(this.active){toast("Snemanje se je ustavilo (mikrofon ni več na voljo). Posnetek do tega trenutka je shranjen.",7000);this.stop()}});
    this.mr.start(5000);
    if(Live.enabled()){try{Live.start(this.stream,this.sejaId)}catch(e){toast("Sprotni prepis se ni zagnal: "+(e.message||e),7000)}}
    try{this.ac=new (window.AudioContext||window.webkitAudioContext)();const src=this.ac.createMediaStreamSource(this.stream);this.an=this.ac.createAnalyser();this.an.fftSize=512;src.connect(this.an);this.meter()}catch(e){}
    this.lock();this.paint();
  },
  meter(){const a=new Uint8Array(this.an.fftSize);const tick=()=>{if(!this.active)return;this.an.getByteTimeDomainData(a);let m=0;for(const v of a)m=Math.max(m,Math.abs(v-128));
    const l=$("#recLevel");if(l)l.style.width=Math.min(100,m/128*220)+"%";const t=$("#recTime");if(t)t.textContent=fmtDur(this.elapsed());this.raf=requestAnimationFrame(tick)};tick()},
  async lock(){try{if(navigator.wakeLock)this.wake=await navigator.wakeLock.request("screen")}catch(e){}},
  pause(){if(!this.mr||this.paused)return;this.mr.pause();this.acc+=Date.now()-this.t0;this.paused=true;this.paint()},
  resume(){if(!this.mr||!this.paused)return;this.mr.resume();this.t0=Date.now();this.paused=false;this.paint()},
  stop(){if(!this.active||!this.mr)return;if(!this.paused)this.acc+=Date.now()-this.t0;this.paused=true;try{this.mr.stop()}catch(e){this.finish()}},
  async finish(){
    const id=this.id,sejaId=this.sejaId,mime=this.mime,dur=this.acc;
    if(Live.on)await Live.stop().catch(()=>{});
    this.active=false;cancelAnimationFrame(this.raf);try{this.stream.getTracks().forEach(t=>t.stop())}catch(e){}try{this.ac&&this.ac.close()}catch(e){}try{this.wake&&this.wake.release()}catch(e){}
    this.mr=null;this.stream=null;
    await new Promise(r=>setTimeout(r,300)); await Promise.all(this.pend||[]); // počakaj zadnji kos
    await assembleRecording({id,sejaId,mime,dur});
    ui.pending=false;render();
  }
};
const extFor=m=>/mp4|m4a|aac/.test(m)?"m4a":/webm/.test(m)?"webm":/ogg/.test(m)?"ogg":"m4a";
async function assembleRecording({id,sejaId,mime,dur,obnovljen}){
  const keys=(await IDB.keys("chunks")).filter(k=>String(k).startsWith(id+":")).sort();
  if(!keys.length){await IDB.del("kv","recActive");toast("Posnetek je prazen.");return}
  const parts=[];for(const k of keys)parts.push(await IDB.get("chunks",k));
  const blob=new Blob(parts,{type:mime.split(";")[0]});
  await IDB.set("blobs",id,blob);
  await IDB.delPrefix("chunks",id+":");await IDB.del("kv","recActive");
  Rec.local.add(id);
  const s=S.seje.find(x=>x.id===sejaId);
  const ime=`Seja ${s?s.stevilka:"NS"} – ${s?fmtDate(s.datum):fmtDate(today())} – ${new Date().toLocaleTimeString("sl-SI",{hour:"2-digit",minute:"2-digit"})}.${extFor(mime)}`.replace(/[\/:]/g,".").replace(" . ","-");
  if(!dur){dur=await new Promise(res=>{try{const a=new Audio();a.preload="metadata";a.onloadedmetadata=()=>res(isFinite(a.duration)?a.duration*1000:0);a.onerror=()=>res(0);a.src=URL.createObjectURL(blob)}catch(e){res(0)}})}
  write("posnetki/"+id,{sejaId,ime,mime,trajanje:dur,velikost:blob.size,ustvarjeno:new Date().toISOString(),obnovljen:!!obnovljen});
  toast(obnovljen?"Nedokončan posnetek je obnovljen in shranjen.":"Posnetek je shranjen na napravo ("+fmtSize(blob.size)+").",5000);
  if(Sync.account&&navigator.onLine)uploadRec(id);
}
async function uploadRec(id){
  const p=S.posnetki.find(x=>x.id===id);const blob=await IDB.get("blobs",id);if(!p||!blob)return;
  ui.upload[id]=0;rr();
  try{const safe=p.ime.replace(/[\\/:*?"<>|#%]+/g,"-");
    const dn=(druzba().naziv||"Druzba").replace(/[\\/:*?"<>|#%]+/g,"-").trim();const item=await Sync.uploadLarge("Posnetki/"+dn+"/"+safe,blob,f=>{ui.upload[id]=f;if(ui.tab==="seje"&&!Rec.active&&!isField(document.activeElement))render()});
    delete ui.upload[id];write("posnetki/"+id,{...strip(p),onedriveId:item.id,onedriveUrl:item.webUrl});toast("Posnetek je v OneDrivu.");
  }catch(e){delete ui.upload[id];rr();toast(e&&e.code==="expired"?"Prijava v OneDrive je potekla – prijavite se znova.":"Nalaganje ni uspelo: "+(e.message||e),6000)}
}
async function recoverRecording(){
  try{const a=await IDB.get("kv","recActive");if(a)await assembleRecording({...a,dur:0,obnovljen:true})}catch(e){}
  try{const ks=await IDB.keys("blobs");ks.forEach(k=>Rec.local.add(k))}catch(e){}
}

/* ---------- Claude: zapisnik in sklepi ---------- */
let zapisnikCtl=null;
async function pripraviZapisnik(){
  const s=ui.draft,d=druzba(); const prepis=(ui.prepis||"").trim();
  if(!prepis){toast("Najprej naložite ali prilepite prepis seje (korak 4).");return}
  const pred=S.predloge.filter(p=>ui.izbranePredloge.includes(p.id));
  const predTxt=pred.map((p,i)=>`<predloga st="${i+1}" naziv="${p.naziv}">\n${String(p.besedilo||"").slice(0,24000)}\n</predloga>`).join("\n\n");
  const prompt=`Si izkušen tajnik nadzornega sveta slovenske družbe. Pripravi OSNUTEK ZAPISNIKA ${s.stevilka}. ${s.vrsta==="korespondencna"?"korespondenčne":"redne"} seje nadzornega sveta družbe ${d.naziv||"[PREVERI: naziv družbe]"}.

Pravila:
- ${pred.length?"Natančno posnemaj strukturo, oblikovanje glave, ustaljene formulacije, način oštevilčenja sklepov in zaključek iz priloženih preteklih zapisnikov (predlog). Iz predlog ne prepisuj vsebine, ki ne velja za to sejo.":"Uporabi običajno strukturo zapisnika seje nadzornega sveta d.o.o.: glava, prisotni, ugotovitev sklepčnosti, potrditev dnevnega reda, obravnava po točkah s povzetkom razprave in sklepi, zaključek, podpisa (zapisnikar, predsednica)."}
- V prepisu so govorci lahko označeni kot »Govorec 1«, »Govorec 2« … Kdo je kdo, ugotovi iz vsebine (nagovori, predstavitve, vloga v razpravi); kjer ni jasno, zapiši [PREVERI: govorec].
- Vsebino povzemi izključno iz prepisa. Razpravo povzemi jedrnato in stvarno, v tretji osebi, brez dobesednih navedb, razen kjer je pomembno.
- Sklepe zapiši natančno, kot so bili sprejeti, vsakega z izidom glasovanja (npr. "Sklep je bil sprejet soglasno." ali s številom glasov ZA/PROTI), oštevilči jih tako kot v predlogah.
- Nič si ne izmišljuj. Kjer prepis ni jasen (ime, številka, izid glasovanja, rok), zapiši [PREVERI: kaj je treba preveriti].
- Piši v knjižni slovenščini. Vrni samo besedilo zapisnika kot navadno besedilo, brez markdown oznak (brez #, ** ali tabel). Naslove razdelkov piši z VELIKIMI ČRKAMI v svoji vrstici.

Podatki o seji:
- Datum: ${fmtDateLong(s.datum)}${s.ura?", začetek ob "+s.ura:""}
- Kraj: ${s.kraj||"[PREVERI: kraj]"}
- Člani NS: ${d.clani.filter(c=>c.ime).map(c=>c.ime+" ("+c.funkcija+")").join("; ")||"[PREVERI]"}
- Prisotni člani: ${(s.prisotni||[]).join(", ")||"[PREVERI]"}
- Drugi prisotni: ${s.drugi||"/"}
- Direktor družbe: ${d.direktor||"[PREVERI]"}
- Predsednica NS: ${predsednica()}

Dnevni red s predlogi sklepov:
${(s.tocke||[]).map((t,i)=>`${i+1}. ${t.naslov}${t.gradivo?"\n   Gradivo: "+t.gradivo:""}${t.predlog?"\n   Predlog sklepa: "+t.predlog:""}`).join("\n")}

${pred.length?"PRETEKLI ZAPISNIKI (predloge za obliko in slog):\n"+predTxt+"\n\n":""}PREPIS POSNETKA SEJE:
<prepis>
${prepis.slice(0,160000)}
</prepis>

Zdaj napiši celoten osnutek zapisnika.`;
  if(!LS.get("apiKey","")){ui.manual={kind:"zapisnik",prompt,result:""};render();setTimeout(()=>{const m=$("#manualBox");m&&m.scrollIntoView({block:"center"})},0);return}
  zapisnikCtl=new AbortController(); ui.busy.zapisnik=true; const prev=s.zapisnik; s.zapisnik=""; render();
  try{
    const r=await claude(prompt,{signal:zapisnikCtl.signal,onText:({text})=>{s.zapisnik=text;const ta=$("#f-zapisnik");if(ta){ta.value=text}}});
    s.zapisnik=r.text||s.zapisnik; if(r.truncated)toast("Osnutek je bil zaradi dolžine prekinjen – preverite konec zapisnika.",6000);
    ui.busy.zapisnik=false; render(); toast("Osnutek je pripravljen. Preglejte ga in shranite sejo.");
  }catch(e){
    ui.busy.zapisnik=false; if(e&&e.text)s.zapisnik=e.text; else if(!s.zapisnik)s.zapisnik=prev;
    toast(e&&e.name==="AbortError"?"Pisanje ustavljeno.":errMsg(e),6000); render();
  }
  zapisnikCtl=null;
}
async function izlusciSklepe(){
  const s=ui.draft;
  const prompt=`Iz spodnjega zapisnika seje nadzornega sveta izlušči VSE SPREJETE SKLEPE (ne predlogov, ki niso bili sprejeti).
Vrni JSON polje objektov oblike {"oznaka": string, "besedilo": string, "zadolzen": string, "rok": string}.
- "oznaka": oznaka sklepa, kot je v zapisniku (npr. "Sklep 3/12"); če je ni, sestavi "${s.stevilka}/<zaporedna številka>".
- "besedilo": besedilo sklepa dobesedno.
- "zadolzen": kdo je zadolžen za izvedbo (npr. direktor), sicer "".
- "rok": rok izvedbe v obliki YYYY-MM-DD, če je v sklepu jasno določen (seja je bila ${s.datum}), sicer "".

<zapisnik>
${s.zapisnik.slice(0,120000)}
</zapisnik>`;
  if(!LS.get("apiKey","")){ui.manual={kind:"sklepi",prompt:prompt+"\n\nVrni SAMO veljaven JSON, brez kakršnega koli drugega besedila.",result:""};render();return}
  ui.busy.izlusci=true; render();
  try{
    const arr=await claudeJson(prompt);
    ui.izlusceni=(Array.isArray(arr)?arr:[]).filter(k=>k&&k.besedilo).map(k=>({oznaka:String(k.oznaka||""),besedilo:String(k.besedilo),zadolzen:String(k.zadolzen||""),rok:/^\d{4}-\d{2}-\d{2}$/.test(k.rok||"")?k.rok:"",sel:!S.sklepi.some(x=>x.sejaId===s.id&&x.besedilo===k.besedilo)}));
  }catch(e){toast(errMsg(e),6000)}
  ui.busy.izlusci=false; render();
}

function manualBox(){
  const m=ui.manual;const what={zapisnik:"osnutek zapisnika",sklepi:"seznam sklepov",dir:"poročilo"}[m.kind];
  return `<div class="panel" id="manualBox" style="background:var(--accent-soft);border:0">
    <h3>Pripravi s Claudom v vaši aplikaciji Claude</h3>
    <ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:3px">
      <li>Kliknite <strong>Kopiraj navodilo</strong>.</li>
      <li>Odprite aplikacijo Claude, začnite nov pogovor in navodilo prilepite.</li>
      <li>Ko Claude konča, kopirajte njegov odgovor in ga prilepite spodaj.</li></ol>
    <div class="row"><button class="btn primary" data-act="manual-kopiraj">Kopiraj navodilo</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Odpri Claude</a><span class="small muted">${NUM.format(m.prompt.length)} znakov</span></div>
    <textarea id="manualPrompt" readonly hidden>${esc(m.prompt)}</textarea>
    <label class="fld">Odgovor Claude (${what})<textarea id="manualRes" rows="6" placeholder="Prilepite odgovor …">${esc(m.result)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="manual-uporabi">Uporabi odgovor</button><button class="btn ghost" data-act="manual-preklici">Prekliči</button>
      <span class="small muted">Samodejno pisanje brez kopiranja: vpišite API ključ v Nastavitvah.</span></div></div>`;
}
function manualApply(){
  const m=ui.manual;const t=(($("#manualRes")||{}).value||"").trim();if(!t){toast("Najprej prilepite odgovor Claude.");return}
  if(m.kind==="zapisnik"){ui.draft.zapisnik=t.replace(/^#+\s*/gm,"").replace(/\*\*/g,"");ui.manual=null;render();toast("Osnutek je vstavljen. Preglejte ga in shranite sejo.");return}
  if(m.kind==="dir"){ui.dirPorocilo=t.replace(/\*\*/g,"");ui.manual=null;render();return}
  if(m.kind==="sklepi"){const mm=t.match(/[\[{][\s\S]*[\]}]/);let arr;try{arr=JSON.parse(mm?mm[0]:t)}catch(e){toast("Odgovora ni bilo mogoče prebrati. Kopirajte celoten odgovor Claude.");return}
    const s=ui.draft;ui.izlusceni=(Array.isArray(arr)?arr:[]).filter(k=>k&&k.besedilo).map(k=>({oznaka:String(k.oznaka||""),besedilo:String(k.besedilo),zadolzen:String(k.zadolzen||""),rok:/^\d{4}-\d{2}-\d{2}$/.test(k.rok||"")?k.rok:"",sel:!S.sklepi.some(x=>x.sejaId===s.id&&x.besedilo===k.besedilo)}));
    ui.manual=null;render()}
}

/* ---------- Word (.docx) ---------- */
const xmlEsc=s=>String(s??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function wRun(t,o={}){return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${o.b?"<w:b/>":""}<w:sz w:val="${o.sz||22}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`}
function wPara(t,o={}){return `<w:p><w:pPr><w:spacing w:after="${o.after??80}" w:line="276" w:lineRule="auto"/>${o.ind?`<w:ind w:left="${o.ind}"/>`:""}${o.jc?`<w:jc w:val="${o.jc}"/>`:""}</w:pPr>${t?wRun(t,o):""}</w:p>`}
function wTable(rows){
  const n=rows[0].length,cw=Math.floor(9000/n);
  const b=`<w:tblBorders>${["top","left","bottom","right","insideH","insideV"].map(x=>`<w:${x} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("")}</w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${b}<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array(n).fill(`<w:gridCol w:w="${cw}"/>`).join("")}</w:tblGrid>
  ${rows.map((r,ri)=>`<w:tr>${r.map(c=>`<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/></w:tcPr>${wPara(String(c??""),{b:ri===0,sz:19,after:0})}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>${wPara("")}`;
}
function textToW(text){
  return String(text||"").split(/\r?\n/).map(l=>{const t=l.replace(/\s+$/,"");const lead=t.match(/^\s*/)[0].length;const body=t.trim();
    const head=body.length>2&&body.length<110&&/[A-ZČŠŽ]/.test(body)&&body===body.toUpperCase()&&!/^\d+[\.,]?\d*\s*$/.test(body);
    const sklep=/^sklep\b/i.test(body)&&body.length<40;
    return wPara(body,{b:head||sklep,sz:head?24:22,ind:lead?Math.min(lead,8)*90:0,after:body?80:0})}).join("");
}
async function saveDocx(filename,bodyXml){
  const zip=new JSZip();
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const blob=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
  await saveFile(filename,blob);
}
const fname=s=>s.replace(/[\\/:*?"<>|]+/g,"").replace(/\s+/g,"_");

/* ---------- SKLEPI ---------- */
function vSklepi(){
  const f=ui.filter; const seje=Object.fromEntries(S.seje.map(s=>[s.id,s]));
  let list=[...S.sklepi];
  if(f==="odprti")list=list.filter(isOpen);
  if(f==="zapadli")list=list.filter(isOverdue);
  if(f==="realizirani")list=list.filter(s=>s.status==="realiziran");
  list.sort((a,b)=>(a.rok||"9999").localeCompare(b.rok||"9999"));
  const st=sklepStats(); const e=ui.sklepEdit;
  const form=e?`<div class="panel" style="background:var(--sunk);border:0"><h3>${e.id?"Uredi sklep":"Nov sklep"}</h3>
    <div class="fields"><label class="fld">Oznaka<input type="text" id="sk-oznaka" data-sk="oznaka" value="${esc(e.oznaka)}" placeholder="npr. 12/3"></label>
      <label class="fld">Seja<select id="sk-seja" data-sk="sejaId"><option value="">–</option>${[...S.seje].sort((a,b)=>b.datum.localeCompare(a.datum)).map(s=>`<option value="${s.id}" ${e.sejaId===s.id?"selected":""}>${esc(s.stevilka)}. seja, ${esc(fmtDate(s.datum))}</option>`).join("")}</select></label>
      <label class="fld">Zadolžen<input type="text" id="sk-zad" data-sk="zadolzen" value="${esc(e.zadolzen)}"></label>
      <label class="fld">Rok<input type="date" id="sk-rok" data-sk="rok" value="${esc(e.rok)}"></label>
      <label class="fld">Status<select id="sk-status" data-sk="status">${Object.entries(SKLEP_ST).map(([k,[x]])=>`<option value="${k}" ${e.status===k?"selected":""}>${x}</option>`).join("")}</select></label></div>
    <label class="fld">Besedilo sklepa<textarea id="sk-bes" data-sk="besedilo" rows="3">${esc(e.besedilo)}</textarea></label>
    <label class="fld">Poročilo o realizaciji<textarea id="sk-por" data-sk="porocilo" rows="2" placeholder="Kaj je bilo narejeno, kdaj in kdo je poročal">${esc(e.porocilo)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="sklep-shrani">Shrani sklep</button><button class="btn ghost" data-act="sklep-preklici">Prekliči</button>
      ${e.id?`<button class="btn danger ${ui.confirm==="sk-"+e.id?"armed":""}" data-act="sklep-brisi" data-id="${e.id}" style="margin-left:auto">${ui.confirm==="sk-"+e.id?"Potrdite izbris":"Izbriši"}</button>`:""}</div></div>`:"";
  return `<section class="panel"><div class="panel-head"><h2>Evidenca sklepov</h2><div class="row"><button class="btn" data-act="sklepi-word" ${S.sklepi.length?"":"disabled"}>Pregled realizacije (Word)</button><button class="btn primary" data-act="sklep-nov">Nov sklep</button></div></div>
   <p class="lede">Sklepi se dodajo iz zapisnika seje ali ročno. Pregled realizacije lahko priložite gradivu za točko »Pregled realizacije sklepov«.</p>
   <div class="row">${[["odprti","Odprti",st.odprti],["zapadli","Rok pretekel",st.zapadli],["realizirani","Realizirani",st.realizirani],["vsi","Vsi",st.skupaj]].map(([k,l,n])=>`<button class="btn ${f===k?"primary":""}" data-act="filter" data-id="${k}">${l} <span class="num">${n}</span></button>`).join("")}</div>
   ${form}
   ${list.length?`<div class="tablewrap"><table><thead><tr><th>Oznaka</th><th>Sklep</th><th>Zadolžen</th><th>Rok</th><th>Status</th><th></th></tr></thead><tbody>
     ${list.map(s=>`<tr class="${isOverdue(s)?"overdue":""}"><td class="num" style="white-space:nowrap">${esc(s.oznaka||"")}${seje[s.sejaId]?`<div class="small muted">${esc(seje[s.sejaId].stevilka)}. seja</div>`:""}</td>
       <td style="min-width:260px">${esc(s.besedilo)}${s.porocilo?`<div class="small muted" style="margin-top:4px">Realizacija: ${esc(s.porocilo)}</div>`:""}</td><td>${esc(s.zadolzen||"")}</td>
       <td class="num" style="white-space:nowrap;${isOverdue(s)?"color:var(--bad);font-weight:500":""}">${s.rok?esc(fmtDate(s.rok)):"–"}</td>
       <td><select id="st-${s.id}" data-status-id="${s.id}" aria-label="Status sklepa" style="min-width:132px">${Object.entries(SKLEP_ST).map(([k,[x]])=>`<option value="${k}" ${(s.status||"odprt")===k?"selected":""}>${x}</option>`).join("")}</select></td>
       <td><button class="btn ghost" data-act="sklep-uredi" data-id="${s.id}">Uredi</button></td></tr>`).join("")}</tbody></table></div>`
   :emptyBox(S.sklepi.length?"V tem pogledu ni sklepov":"Evidenca je prazna",S.sklepi.length?"Izberite drug filter.":"Odprite sejo z zapisnikom in kliknite »Izlušči sklepe iz zapisnika« ali dodajte sklep ročno.","")}
  </section>`;
}
function sklepiWord(){
  const seje=Object.fromEntries(S.seje.map(s=>[s.id,s]));const d=druzba();
  const list=[...S.sklepi].sort((a,b)=>(a.rok||"9999").localeCompare(b.rok||"9999"));
  const rows=[["Oznaka","Sklep","Zadolžen","Rok","Status","Realizacija"],...list.map(s=>[(s.oznaka||"")+(seje[s.sejaId]?` (${seje[s.sejaId].stevilka}. seja)`:""),s.besedilo,s.zadolzen||"",s.rok?fmtDate(s.rok):"",(SKLEP_ST[s.status]||SKLEP_ST.odprt)[0]+(isOverdue(s)?" – rok pretekel":""),s.porocilo||""])];
  const st=sklepStats();
  const body=wPara(d.naziv,{b:true})+wPara("Nadzorni svet")+wPara("")+wPara("PREGLED REALIZACIJE SKLEPOV NADZORNEGA SVETA",{b:true,sz:26})+wPara("Stanje na dan "+fmtDate(today()))+wPara("")
    +wPara(`Skupaj sklepov: ${st.skupaj}; realiziranih: ${st.realizirani}; odprtih ali v izvajanju: ${st.odprti}; od tega s preteklim rokom: ${st.zapadli}.`)+wPara("")+wTable(rows);
  saveDocx(fname("Pregled_realizacije_sklepov_NS_"+today())+".docx",body);
}

/* ---------- POSLOVANJE ---------- */
function letaSel(){const y0=new Date().getFullYear();const ys=new Set([y0-1,y0,y0+1,...Object.keys(S.finance).map(Number),...Object.keys(S.direktor).map(Number)]);
  return `<label class="fld" style="flex-direction:row;align-items:center;gap:8px">Leto<select id="leto" style="width:auto">${[...ys].filter(Boolean).sort().map(y=>`<option ${y===ui.leto?"selected":""}>${y}</option>`).join("")}</select></label>`}
function vPoslovanje(){
  const y=ui.leto,f=finSum(y),rows=f.rows;
  const idx=(r,p)=>r!=null&&p?PCT(r/p*100):"–";
  const inp=(m,k,v)=>`<input type="text" inputmode="decimal" id="fin-${m}-${k}" data-m="${m}" data-k="${k}" value="${esc(fmtIn(v))}" aria-label="${MESF[m-1]} ${k}">`;
  return `<section class="panel"><div class="panel-head"><h2>Plan in realizacija ${y}</h2><div class="row">${letaSel()}<button class="btn" data-act="fin-word">Poročilo (Word)</button></div></div>
    <p class="lede">Zneski v EUR brez centov. Vnesite letni plan po mesecih in sproti mesečno realizacijo; poslovni izid je razlika med prihodki in odhodki. Podatke lahko prilepite tudi iz Excela.</p>
    ${f.last?`<div class="stats">
      <div class="stat"><span class="v">${EUR(f.pR)}</span><span class="l">prihodki jan–${MES[f.last-1]}</span></div>
      <div class="stat ${tone(f.pP?f.pR/f.pP*100:null)}"><span class="v">${idx(f.pR,f.pP)}</span><span class="l">indeks prihodkov real./plan</span></div>
      <div class="stat"><span class="v">${EUR(f.zR)}</span><span class="l">poslovni izid jan–${MES[f.last-1]}</span></div>
      <div class="stat ${f.zP>0?tone(f.zR/f.zP*100):""}"><span class="v">${f.zP>0?idx(f.zR,f.zP):EUR(f.zR-f.zP)}</span><span class="l">${f.zP>0?"indeks izida real./plan":"odmik izida od plana"}</span></div>
      <div class="stat"><span class="v">${f.pPy?PCT(f.pR/f.pPy*100):"–"}</span><span class="l">dosežek letnega plana prihodkov</span></div></div>`:""}
    <div class="tablewrap"><table class="fin"><thead><tr><th>Mesec</th><th class="r">Prihodki plan</th><th class="r">Prihodki real.</th><th class="r">Indeks</th><th class="r">Odhodki plan</th><th class="r">Odhodki real.</th><th class="r">Izid plan</th><th class="r">Izid real.</th></tr></thead>
    <tbody>${rows.map(r=>{const zP=r.pP!=null||r.oP!=null?(r.pP||0)-(r.oP||0):null,zR=r.pR!=null||r.oR!=null?(r.pR||0)-(r.oR||0):null;
      return `<tr><td>${MESF[r.m-1]}</td><td>${inp(r.m,"pP",r.pP)}</td><td>${inp(r.m,"pR",r.pR)}</td><td class="r num ${r.pR!=null&&r.pP?"":"muted"}" style="color:${r.pR!=null&&r.pP?`var(--${tone(r.pR/r.pP*100)})`:""}">${idx(r.pR,r.pP)}</td><td>${inp(r.m,"oP",r.oP)}</td><td>${inp(r.m,"oR",r.oR)}</td><td class="r num">${zP==null?"–":EUR(zP)}</td><td class="r num" style="${zR!=null&&zR<0?"color:var(--bad)":""}">${zR==null?"–":EUR(zR)}</td></tr>`}).join("")}</tbody>
    <tfoot><tr><td>Leto</td><td class="r num">${EUR(f.pPy)}</td><td class="r num">${EUR(sum(rows,"pR"))}</td><td class="r num">${f.last?idx(f.pR,f.pP):"–"}</td><td class="r num">${EUR(f.oPy)}</td><td class="r num">${EUR(sum(rows,"oR"))}</td><td class="r num">${EUR(f.zPy)}</td><td class="r num">${EUR(f.zR)}</td></tr></tfoot></table></div>
    <p class="small muted">Indeks v vrstici »Leto« primerja realizacijo s planom za isto obdobje (jan–zadnji mesec z realizacijo).</p>
  </section>
  <div class="grid2"><section class="panel"><h3>Prihodki po mesecih</h3>${chartBars(rows)}</section><section class="panel"><h3>Kumulativni poslovni izid</h3>${chartCum(rows)}</section></div>
  <section class="panel"><h3>Prilepi iz Excela</h3><p class="small muted">Kopirajte 12 vrstic (januar–december) s štirimi stolpci v tem vrstnem redu: prihodki plan, prihodki realizacija, odhodki plan, odhodki realizacija. Prvi stolpec z imenom meseca se preskoči. Prazne celice ostanejo nespremenjene.</p>
    <textarea id="finPaste" rows="4" placeholder="Prilepite celice iz Excela …"></textarea><div class="row"><button class="btn" data-act="fin-uvozi">Uvozi v leto ${y}</button></div></section>`;
}
const fdPath=(c,y)=>`${c}/${S.druzbaId}_${y}`;
function finSet(y,m,k,v){const key=String(y);const doc=strip(S.finance[key]||{m:{}});doc.leto=+y;doc.druzbaId=S.druzbaId;doc.m=doc.m||{};doc.m[m]=doc.m[m]||{};if(v==null)delete doc.m[m][k];else doc.m[m][k]=v;write(fdPath("finance",y),doc)}
function finUvozi(){
  const t=($("#finPaste")||{}).value||"";const lines=t.split(/\r?\n/).filter(l=>l.trim());if(!lines.length){toast("Ni prilepljenih podatkov.");return}
  const key=String(ui.leto);const doc=strip(S.finance[key]||{m:{}});doc.leto=ui.leto;doc.druzbaId=S.druzbaId;doc.m=doc.m||{};let n=0;
  lines.slice(0,12).forEach((l,i)=>{let c=l.split("\t");if(c.length===1)c=l.split(";");if(c.length>=5||(c.length&&parseNum(c[0])==null&&c[0].trim()))c=c.slice(1);
    ["pP","pR","oP","oR"].forEach((k,j)=>{const v=parseNum(c[j]);if(v!=null){doc.m[i+1]=doc.m[i+1]||{};doc.m[i+1][k]=v;n++}})});
  if(n)write(fdPath("finance",ui.leto),doc);
  toast(n?`Uvoženih ${n} vrednosti.`:"Ni najdenih številk – preverite obliko.");render();
}
function finWord(){
  const y=ui.leto,f=finSum(y),d=druzba();
  const rows=[["Mesec","Prihodki plan","Prihodki real.","Indeks","Odhodki plan","Odhodki real.","Izid plan","Izid real."],
    ...f.rows.map(r=>[MESF[r.m-1],EUR(r.pP),EUR(r.pR),r.pR!=null&&r.pP?PCT(r.pR/r.pP*100):"",EUR(r.oP),EUR(r.oR),r.pP!=null||r.oP!=null?EUR((r.pP||0)-(r.oP||0)):"",r.pR!=null||r.oR!=null?EUR((r.pR||0)-(r.oR||0)):""].map(x=>x==="–"?"":x)),
    ["Skupaj",EUR(f.pPy),EUR(sum(f.rows,"pR")),f.last&&f.pP?PCT(f.pR/f.pP*100):"",EUR(f.oPy),EUR(sum(f.rows,"oR")),EUR(f.zPy),EUR(f.zR)]];
  const body=wPara(d.naziv,{b:true})+wPara("")+wPara(`POSLOVANJE ${y}: PLAN IN REALIZACIJA`,{b:true,sz:26})+wPara(f.last?`Obdobje realizacije: januar–${MESF[f.last-1]} ${y}`:"Realizacija še ni vnesena.")+wPara("")+
    (f.last?wPara(`Prihodki: ${EUR(f.pR)} (plan za obdobje ${EUR(f.pP)}, indeks ${f.pP?PCT(f.pR/f.pP*100):"–"}). Odhodki: ${EUR(f.oR)} (plan ${EUR(f.oP)}). Poslovni izid: ${EUR(f.zR)} (plan ${EUR(f.zP)}).`)+wPara(""):"")+wTable(rows);
  saveDocx(fname(`Poslovanje_${y}_plan_realizacija`)+".docx",body);
}

/* ---------- DIREKTOR ---------- */
const VIRI={rocno:"Ročni vnos",prihodki:"Iz poslovanja: prihodki",rezultat:"Iz poslovanja: poslovni izid",sklepi:"Realizacija sklepov NS"};
function dirSet(y,fn){const key=String(y);const doc=strip(S.direktor[key]||{kazalniki:[],komentar:""});doc.leto=+y;doc.druzbaId=S.druzbaId;doc.kazalniki=doc.kazalniki||[];fn(doc);write(fdPath("direktor",y),doc)}
function vDirektor(){
  const y=ui.leto,dd=dirData(y),ks=dd.kazalniki||[],sc=dirScore(y),f=finSum(y),d=druzba();
  const wsum=ks.reduce((s,k)=>s+(+k.utez||0),0);
  return `<section class="panel"><div class="panel-head"><h2>Poslovna uspešnost direktorja ${y}</h2><div class="row">${letaSel()}</div></div>
    <p class="lede">Kazalniki s pripisano utežjo. Prihodki, poslovni izid in realizacija sklepov se izračunajo samodejno iz zavihkov Poslovanje in Sklepi${f.last?` (obdobje jan–${MES[f.last-1]})`:""}; cilj je privzeto plan za isto obdobje. Doseganje posameznega kazalnika šteje največ do 120 %.</p>
    ${ks.length?`<div class="row" style="gap:24px;align-items:center"><div><div class="score num" style="color:var(--${tone(sc)||"ink"})">${PCT(sc)}</div><div class="small muted">skupna ponderirana ocena doseganja${d.direktor?" · "+esc(d.direktor):""}</div></div>
      ${wsum!==100?`<span class="chip warn">Vsota uteži je ${NUM.format(wsum)} %, ne 100 %</span>`:""}</div>
    <div class="tablewrap"><table><thead><tr><th>Kazalnik</th><th>Vir</th><th class="r">Utež %</th><th class="r">Cilj</th><th class="r">Realizacija</th><th>Doseganje</th><th></th></tr></thead><tbody>
    ${ks.map((k,i)=>{const c=kpiCalc(k,y);const unit=k.vir==="sklepi"?"%":(k.vir==="rocno"?(k.enota||""):"€");
      const show=v=>v==null?"":(unit==="€"?NUM.format(Math.round(v)):(Math.round(v*10)/10).toLocaleString("sl-SI"));
      return `<tr><td style="min-width:200px"><input type="text" id="k-naziv-${i}" data-ki="${i}" data-kf="naziv" value="${esc(k.naziv)}" aria-label="Naziv kazalnika">
        <label class="small muted" style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="k-man-${i}" data-ki="${i}" data-kf="manjse" ${k.manjse?"checked":""}>manjše je bolje</label></td>
        <td><select id="k-vir-${i}" data-ki="${i}" data-kf="vir" style="min-width:170px">${Object.entries(VIRI).map(([v,l])=>`<option value="${v}" ${k.vir===v?"selected":""}>${l}</option>`).join("")}</select>
          ${k.vir==="rocno"?`<input type="text" id="k-enota-${i}" data-ki="${i}" data-kf="enota" value="${esc(k.enota||"")}" placeholder="enota (%, €, št.)" style="margin-top:4px" aria-label="Enota">`:""}</td>
        <td><input type="text" inputmode="decimal" id="k-utez-${i}" data-ki="${i}" data-kf="utez" value="${esc(k.utez??"")}" style="text-align:right;width:70px" aria-label="Utež"></td>
        <td><input type="text" inputmode="decimal" id="k-cilj-${i}" data-ki="${i}" data-kf="cilj" value="${esc(k.cilj!=null?show(k.cilj):"")}" placeholder="${c.auto&&c.cilj!=null?esc(show(c.cilj))+" (plan)":""}" style="text-align:right;min-width:110px" aria-label="Cilj"></td>
        <td class="r num">${c.auto?`${c.real==null?"–":esc(show(c.real))} ${unit}<div class="small muted">samodejno</div>`:`<input type="text" inputmode="decimal" id="k-real-${i}" data-ki="${i}" data-kf="realizacija" value="${esc(k.realizacija!=null?show(k.realizacija):"")}" style="text-align:right;min-width:100px" aria-label="Realizacija">`}</td>
        <td style="min-width:130px"><div class="num small" style="margin-bottom:4px">${PCT(c.dos)}</div><div class="meter ${tone(c.dos)}"><b style="width:${Math.min(c.dos||0,120)/1.2}%"></b></div></td>
        <td><button class="btn ghost" data-act="kpi-brisi" data-id="${i}" aria-label="Odstrani kazalnik">✕</button></td></tr>`}).join("")}</tbody></table></div>
    <div class="row"><button class="btn" data-act="kpi-dodaj">Dodaj kazalnik</button></div>`
    :emptyBox("Kazalniki še niso določeni","Začnite s predlaganim naborom (prihodki, poslovni izid, realizacija sklepov NS in en ročni kazalnik) in uteži prilagodite merilom iz pogodbe direktorja.",`<div class="row"><button class="btn primary" data-act="kpi-privzeti">Uporabi predlagane kazalnike</button><button class="btn" data-act="kpi-dodaj">Dodaj prazen kazalnik</button></div>`)}
  </section>
  ${ks.length?`<section class="panel"><h3>Mnenje nadzornega sveta</h3>
    <label class="fld">Komentar in ugotovitve NS (vključi se v poročilo)<textarea id="dir-kom" rows="4" placeholder="npr. vzroki odstopanj, izredni dogodki, ocena vodenja">${esc(dd.komentar||"")}</textarea></label>
    <div class="row"><button class="btn primary ${ui.busy.dir?"busy":""}" data-act="dir-porocilo" ${ui.busy.dir?"disabled":""}>${ui.busy.dir?"Pišem poročilo ":"Pripravi poročilo o uspešnosti"}</button>
      ${ui.dirPorocilo&&!ui.busy.dir?`<button class="btn" data-act="dir-word">Prenesi Word</button><button class="btn ghost" data-act="kopiraj" data-id="dir-por">Kopiraj</button>`:""}</div>
    ${ui.manual&&ui.manual.kind==="dir"?manualBox():""}
    ${ui.dirPorocilo||ui.busy.dir?`<textarea class="doc" id="dir-por" style="min-height:320px">${esc(ui.dirPorocilo)}</textarea>`:""}
    <p class="small muted">Poročilo je osnova za točko dnevnega reda o oceni direktorja in za izračun variabilnega dela plačila po pogodbi.</p></section>`:""}`;
}
async function dirPorocilo(){
  const y=ui.leto,dd=dirData(y),f=finSum(y),d=druzba();
  const kpi=(dd.kazalniki||[]).map(k=>{const c=kpiCalc(k,y);return {kazalnik:k.naziv,vir:VIRI[k.vir],utez:k.utez,cilj:c.cilj,realizacija:c.real,doseganje_odstotkov:c.dos!=null?Math.round(c.dos*10)/10:null,manjse_je_bolje:!!k.manjse}});
  const sc=dirScore(y);
  const prompt=`Pripravi poročilo nadzornega sveta o poslovni uspešnosti direktorja družbe ${d.naziv}${d.direktor?" ("+d.direktor+")":""} za leto ${y}${f.last?", obdobje januar–"+MESF[f.last-1]:""}.
Uporabi samo spodnje podatke, nič ne izmišljuj. Formalna knjižna slovenščina, 250–450 besed, navadno besedilo brez markdown. Struktura:
1) uvod (namen, obdobje, podlaga), 2) doseganje po kazalnikih z zneski in odstotki, 3) skupna ponderirana ocena, 4) ugotovitve NS (iz komentarja), 5) predlog sklepa NS v oglatih oklepajih [PREDLOG SKLEPA: …].
Zneske piši v slovenskem zapisu (npr. 1.250.000 €).

Podatki:
${JSON.stringify({obdobje_realizacije_mesecev:f.last,prihodki:{plan_obdobje:f.pP,realizacija:f.pR,letni_plan:f.pPy},odhodki:{plan_obdobje:f.oP,realizacija:f.oR},poslovni_izid:{plan_obdobje:f.zP,realizacija:f.zR,letni_plan:f.zPy},kazalniki:kpi,skupna_ocena_odstotkov:sc!=null?Math.round(sc*10)/10:null,komentar_NS:dd.komentar||""},null,1)}`;
  if(!LS.get("apiKey","")){ui.manual={kind:"dir",prompt,result:""};render();return}
  ui.busy.dir=true;ui.dirPorocilo="";render();
  try{const r=await claude(prompt,{maxTokens:4000,onText:({text})=>{ui.dirPorocilo=text;const t=$("#dir-por");if(t)t.value=text}});ui.dirPorocilo=r.text||ui.dirPorocilo}
  catch(e){toast(errMsg(e),6000)}
  ui.busy.dir=false;render();
}

/* ---------- PREDLOGE ---------- */
function vPredloge(){
  const list=[...S.predloge].sort((a,b)=>(b.datum||"").localeCompare(a.datum||""));
  return `<section class="panel"><div class="panel-head"><h2>Pretekli zapisniki</h2><div class="row"><label class="btn primary" for="predlogaFile">Naloži zapisnike (.docx, .txt)</label><input type="file" id="predlogaFile" accept=".docx,.txt,.md" multiple hidden><button class="btn" data-act="predloga-prilepi">Prilepi besedilo</button></div></div>
    <p class="lede">Ti zapisniki so vzorec za obliko, slog in oštevilčenje sklepov v novih osnutkih. Dovolj so dva do trije dobri, nedavni zapisniki. Datoteke .doc in PDF najprej shranite kot .docx.</p>
    ${ui.novaPredloga?`<div class="panel" style="background:var(--sunk);border:0"><label class="fld">Naziv<input type="text" id="np-naziv" placeholder="npr. Zapisnik 11. seje, 18. 6. 2026"></label><label class="fld">Besedilo zapisnika<textarea id="np-bes" rows="10"></textarea></label>
      <div class="row"><button class="btn primary" data-act="predloga-shrani">Shrani</button><button class="btn ghost" data-act="predloga-preklici">Prekliči</button></div></div>`:""}
    ${list.length?`<div class="list">${list.map(p=>`<div class="item" style="flex-direction:column;align-items:stretch;gap:8px"><div class="row" style="justify-content:space-between"><div class="main"><strong>${esc(p.naziv)}</strong><div class="small muted">${NUM.format((p.besedilo||"").length)} znakov · dodano ${esc(fmtDate((p.datum||"").slice(0,10)))}</div></div>
      <div class="row"><button class="btn ghost" data-act="predloga-pokazi" data-id="${p.id}">${ui.predlogaOdprta===p.id?"Skrij":"Pokaži"}</button><button class="btn danger ${ui.confirm==="p-"+p.id?"armed":""}" data-act="predloga-brisi" data-id="${p.id}">${ui.confirm==="p-"+p.id?"Potrdite izbris":"Izbriši"}</button></div></div>
      ${ui.predlogaOdprta===p.id?`<div class="pre">${esc(p.besedilo)}</div>`:""}</div>`).join("")}</div>`
    :emptyBox("Ni naloženih zapisnikov","Naložite nekaj preteklih zapisnikov sej NS. Osnutki novih zapisnikov bodo sledili njihovi strukturi in ustaljenim formulacijam.","")}
  </section>`;
}
async function readFileText(f){
  const n=f.name.toLowerCase();
  if(n.endsWith(".docx")){const r=await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()});return r.value}
  if(n.endsWith(".doc")||n.endsWith(".pdf"))throw new Error(f.name+": shranite kot .docx ali .txt");
  return await f.text();
}
const MAXC=110000;

/* ---------- NASTAVITVE ---------- */
function vNastavitve(){
  const d=druzba();const key=LS.get("apiKey","");const model=LS.get("model","claude-sonnet-5-5");
  const acc=Sync.account;
  const druzbeHtml=`<section class="panel"><h2>Družbe</h2><p class="lede">Za vsako družbo, v kateri ste v nadzornem svetu, so podatki ločeni. Med družbami preklapljate v glavi aplikacije.</p>
    ${S.druzbe.length?`<div class="list">${S.druzbe.map(x=>`<div class="item"><div class="main"><strong>${esc(x.naziv||"Brez naziva")}</strong>${x.id===S.druzbaId?` <span class="chip acc">izbrana</span>`:""}</div>
      <div class="row">${x.id!==S.druzbaId?`<button class="btn" data-act="druzba-preklopi" data-id="${x.id}">Preklopi</button>`:""}<button class="btn ghost danger ${ui.confirm==="dr-"+x.id?"armed":""}" data-act="druzba-brisi" data-id="${x.id}">${ui.confirm==="dr-"+x.id?"Izbriše vse podatke družbe – potrdite":"Izbriši"}</button></div></div>`).join("")}</div>`:""}
    <div class="row"><input type="text" id="nd-naziv" placeholder="Naziv nove družbe" style="max-width:340px"><button class="btn" data-act="druzba-dodaj">Dodaj družbo</button></div></section>`;
  if(!S.druzba)return druzbeHtml+vNastavitveSplosno();
  return druzbeHtml+`<section class="panel"><h2>${esc(d.naziv||"Družba")}: podatki in nadzorni svet</h2><p class="lede">Ti podatki se uporabijo v vabilih, zapisnikih in poročilih te družbe.</p>
    <div class="fields"><label class="fld">Naziv družbe<input type="text" id="n-naziv" value="${esc(d.naziv)}"></label><label class="fld">Naslov sedeža<input type="text" id="n-naslov" value="${esc(d.naslov)}"></label></div>
    <div class="fields"><label class="fld">Direktor<input type="text" id="n-direktor" value="${esc(d.direktor)}"></label><label class="fld">Običajni kraj sej<input type="text" id="n-kraj" value="${esc(d.kraj)}" placeholder="npr. sejna soba na sedežu družbe"></label></div>
    <h3>Člani nadzornega sveta</h3>
    ${d.clani.map((c,i)=>`<div class="fields"><label class="fld">Ime in priimek<input type="text" id="n-cl-ime-${i}" value="${esc(c.ime)}"></label><label class="fld">Funkcija<input type="text" id="n-cl-fun-${i}" value="${esc(c.funkcija)}"></label></div>`).join("")}
    <div class="row"><button class="btn primary" data-act="nastavitve-shrani">Shrani podatke družbe</button></div>
  </section>`+vNastavitveSplosno();
}
function vNastavitveSplosno(){
  const key=LS.get("apiKey","");const model=LS.get("model","claude-sonnet-5-5");const acc=Sync.account;
  return `<section class="panel"><div class="panel-head"><h2>OneDrive</h2>${acc?`<span class="chip good">Povezano</span>`:`<span class="chip">Ni povezano</span>`}</div>
    <p class="lede">Podatki so vedno shranjeni na tej napravi. Ko se prijavite v OneDrive, se samodejno usklajujejo med računalnikom in telefonom (datoteka ${FILE} v mapi Aplikacije → Nadzorni svet).</p>
    ${acc?`<p><strong>${esc(acc.username||acc.name||"")}</strong>${Sync.last?` <span class="muted small">· zadnja uskladitev ${esc(new Date(Sync.last).toLocaleString("sl-SI"))}</span>`:""}</p>
      ${Sync.state==="err"?`<p class="small" style="color:var(--bad)">${esc(Sync.msg)}</p>`:""}
      <div class="row"><button class="btn primary" data-act="od-sync">Uskladi zdaj</button>${Sync.state==="expired"?`<button class="btn primary" data-act="od-prijava">Prijavi se znova</button>`:""}<button class="btn ghost" data-act="od-odjava">Odjava</button></div>`
    :`<div class="row"><button class="btn primary" data-act="od-prijava" ${Sync.clientId()?"":"disabled"}>Prijava z Microsoftovim računom</button></div>
      ${Sync.clientId()?"":`<p class="small muted">Za prijavo potrebujete Client ID iz registracije aplikacije pri Microsoftu.</p>`}`}
    <details class="small" ${Sync.clientId()?"":"open"}><summary style="cursor:pointer">Napredno: Client ID</summary>
      <div class="row" style="margin-top:8px"><input type="text" id="n-client" value="${esc(LS.get("clientId","")||"")}" placeholder="${esc((window.NS_CONFIG||{}).CLIENT_ID||"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")}" style="max-width:380px"><button class="btn" data-act="client-shrani">Shrani</button></div></details>
  </section>

  <section class="panel"><h2>Claude</h2>
    <p class="lede">Brez ključa aplikacija pripravi navodilo, ki ga prilepite v svojo aplikacijo Claude, odgovor pa prilepite nazaj. Z API ključem Claude piše neposredno v aplikaciji (plačilo po porabi). Ključ ustvarite na console.anthropic.com (API keys). Shrani se samo na tej napravi, zato ga vpišite na računalniku in na telefonu.</p>
    <div class="fields"><label class="fld">API ključ<input type="password" id="n-key" value="${esc(key)}" placeholder="sk-ant-..." autocomplete="off"></label>
      <label class="fld">Model<select id="n-model">${Object.entries(MODELS).map(([k,l])=>`<option value="${k}" ${model===k?"selected":""}>${l}</option>`).join("")}</select></label></div>
    <div class="row"><button class="btn primary" data-act="key-shrani">Shrani</button><button class="btn ${ui.busy.key?"busy":""}" data-act="key-test" ${key&&!ui.busy.key?"":"disabled"}>Preizkusi ključ</button></div>
  </section>

  <section class="panel"><div class="panel-head"><h2>Soniox – sprotni prepis seje</h2>${LS.get("sonioxKey","")?(LS.get("sonioxOn",true)!==false?`<span class="chip good">Vklopljeno</span>`:`<span class="chip">Izklopljeno</span>`):`<span class="chip">Ni ključa</span>`}</div>
    <p class="lede">Z ključem Soniox se med snemanjem seje prepis piše sam, z ločenimi govorci, in se shrani v korak 4. Prepisa posnetka v Wordu ni več treba delati. Ključ ustvarite na console.soniox.com (API keys); shrani se samo na tej napravi, zato ga vpišite na računalniku in na telefonu. Zvok seje se med snemanjem pošilja Sonioxu v prepis.</p>
    <div class="fields"><label class="fld">Soniox API ključ<input type="password" id="n-sxkey" value="${esc(LS.get("sonioxKey",""))}" autocomplete="off" placeholder="prilepite ključ"></label>
      <label class="fld">Model<input type="text" id="n-sxmodel" value="${esc(LS.get("sonioxModel","stt-rt-v6"))}"></label></div>
    <div class="checks"><label><input type="checkbox" id="n-sxon" ${LS.get("sonioxOn",true)!==false?"checked":""}>Med snemanjem sproti prepisuj</label></div>
    <div class="row"><button class="btn primary" data-act="sx-shrani">Shrani</button><button class="btn ${ui.busy.sx?"busy":""}" data-act="sx-test" ${LS.get("sonioxKey","")&&!ui.busy.sx?"":"disabled"}>Preizkusi ključ</button></div>
  </section>

  <section class="panel"><h2>Varnostna kopija</h2>
    <p class="lede">Izvoz podatkov vseh družb v datoteko (brez zvočnih posnetkov). Z uvozom lahko prenesete tudi podatke iz različice aplikacije v Claudu; obstoječi podatki se ohranijo.</p>
    <div class="row"><button class="btn" data-act="izvozi">Izvozi podatke</button><label class="btn" for="uvozFile">Uvozi podatke</label><input type="file" id="uvozFile" accept=".json,application/json" hidden></div>
  </section>

  <section class="panel"><h3>Namestitev</h3>
    <ul class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;max-width:75ch">
      <li><strong>Windows:</strong> v Edgeu ali Chromu kliknite ikono za namestitev v naslovni vrstici ali gumb »Namesti aplikacijo« zgoraj.</li>
      <li><strong>iPhone:</strong> v Safariju tapnite Deli → Dodaj na začetni zaslon. Odpirajte jo vedno z ikone na začetnem zaslonu.</li>
    </ul>
    <p class="small muted">Različica 2 · ${isStandalone()?"nameščena aplikacija":"v brskalniku"}</p>
  </section>`;
}

/* ---------- uvoz / izvoz ---------- */
function exportData(){
  const col={};COLS.forEach(c=>{col[c]=Object.fromEntries(Object.entries(D.col[c]||{}).filter(([,r])=>r&&!r._d))});
  saveFile(`Nadzorni_svet_podatki_${today()}.json`,new Blob([JSON.stringify({format:"nadzorni-svet",verzija:2,izvozeno:new Date().toISOString(),col},null,1)],{type:"application/json"}));
}
function importData(j){
  if(!j||(j.format!=="ns-vpl"&&j.format!=="nadzorni-svet"))throw new Error("To ni izvoz aplikacije Nadzorni svet.");
  const now=Date.now();let n=0;const inc={v:1,col:{}};COLS.forEach(c=>inc.col[c]={});
  if(j.verzija>=2&&j.col){COLS.forEach(c=>Object.entries(j.col[c]||{}).forEach(([k,r])=>{const ex=D.col[c][k];if(ex&&!ex._d&&(ex._u||0)>=(r._u||0))return;inc.col[c][k]={...r,_u:Math.max(r._u||0,now)};n++}))}
  else{ // izvoz iz različice v Claudu: ena družba
    const naziv=(j.druzba&&j.druzba.naziv)||"Uvožena družba";
    let did=(S.druzbe.find(d=>(d.naziv||"").trim().toLowerCase()===naziv.trim().toLowerCase())||{}).id;
    if(!did){did=uid();inc.col.druzbe[did]={...strip(j.druzba||{}),naziv,_u:now};n++}
    const put=(c,id,rec)=>{if(!id||!rec)return;const ex=D.col[c][id];if(ex&&!ex._d)return;inc.col[c][id]={...strip(rec),...(c==="prepisi"?{}:{druzbaId:did}),_u:now};n++};
    PER_DRUZBA.forEach(c=>(j[c]||[]).forEach(r=>put(c,r.id,r)));
    ["finance","direktor"].forEach(c=>Object.entries(j[c]||{}).forEach(([y,v])=>put(c,did+"_"+y,{...v,leto:+y})));
    Object.entries(j.prepisi||{}).forEach(([k,v])=>put("prepisi",k,v));
    LS.set("druzba",did);
  }
  D=merge(D,inc).out;derive();persistNow();Sync.soon();render();
  return n;
}

/* ---------- dogodki ---------- */
document.addEventListener("click",ev=>{
  const b=ev.target.closest("[data-act],[data-tab]");if(!b||b.disabled)return;
  if(b.tagName==="LABEL"||b.tagName==="A")return;
  if(b.dataset.tab){go(b.dataset.tab);return}
  act(b.dataset.act,b.dataset.id,b);
});
function arm(key){if(ui.confirm===key){ui.confirm=null;return true}ui.confirm=key;clearTimeout(arm._t);arm._t=setTimeout(()=>{ui.confirm=null;rr()},4000);render();return false}
async function act(a,id){
  const s=ui.draft;
  switch(a){
    case "nova-seja":novaSeja();break;
    case "odpri-sejo":openSeja(id);break;
    case "nazaj":if(Rec.active){toast("Najprej ustavite snemanje.");break}
      if((isDirty()||ui.prepis!==ui.prepisSaved)&&ui.confirm!=="leave"){ui.confirm="leave";toast("Imate neshranjene spremembe. Kliknite »Vse seje« še enkrat za izhod brez shranjevanja.");setTimeout(()=>ui.confirm=null,4000);break}
      ui.confirm=null;ui.sejaId=null;ui.draft=null;render();break;
    case "brisi-sejo":if(Rec.active){toast("Najprej ustavite snemanje.");break}
      if(arm("seja")){const sid=ui.sejaId;ui.sejaId=null;ui.draft=null;write("seje/"+sid,null);if(S.prepisi[sid])write("prepisi/"+sid,null);toast("Seja je izbrisana.");render()}break;
    case "tocka-dodaj":s.tocke.push({naslov:"",gradivo:"",predlog:""});render();break;
    case "tocka-brisi":s.tocke.splice(+id,1);render();break;
    case "tocka-gor":{const i=+id;[s.tocke[i-1],s.tocke[i]]=[s.tocke[i],s.tocke[i-1]];render();break}
    case "tocka-dol":{const i=+id;[s.tocke[i+1],s.tocke[i]]=[s.tocke[i],s.tocke[i+1]];render();break}
    case "vabilo-sestavi":s.vabilo=sestaviVabilo();render();break;
    case "vabilo-word":saveDocx(fname(`Vabilo_${s.stevilka}_seja_NS_${s.datum}`)+".docx",textToW(s.vabilo));break;
    case "zapisnik-word":saveDocx(fname(`Zapisnik_${s.stevilka}_seja_NS_${s.datum}`)+".docx",textToW(s.zapisnik));break;
    case "kopiraj":{const t=document.getElementById(id);if(!t)break;try{await navigator.clipboard.writeText(t.value);toast("Besedilo je kopirano.")}catch(e){t.focus();t.select();toast("Besedilo je označeno – kopirajte ga.")}break}
    case "prepis-shrani":{const t=ui.prepis||"";write("prepisi/"+ui.sejaId,{besedilo:t,posodobljeno:new Date().toISOString()});ui.prepisSaved=t;toast("Prepis je shranjen.");render();break}
    case "zapisnik-pripravi":await pripraviZapisnik();break;
    case "zapisnik-ustavi":if(zapisnikCtl)zapisnikCtl.abort();break;
    case "sklepi-izlusci":await izlusciSklepe();break;
    case "izl-preklici":ui.izlusceni=null;render();break;
    case "manual-kopiraj":{const t=ui.manual.prompt;try{await navigator.clipboard.writeText(t);toast("Navodilo je kopirano. Prilepite ga v Claude.")}catch(e){const ta=$("#manualPrompt");ta.hidden=false;ta.focus();ta.select();toast("Navodilo je označeno – kopirajte ga.")}break}
    case "manual-uporabi":manualApply();break;
    case "manual-preklici":ui.manual=null;render();break;
    case "sklepi-dodaj":{const sel=(ui.izlusceni||[]).filter(k=>k.sel);sel.forEach(k=>write("sklepi/"+uid(),{oznaka:k.oznaka,besedilo:k.besedilo,zadolzen:k.zadolzen,rok:k.rok,status:"odprt",porocilo:"",sejaId:ui.sejaId,ustvarjeno:new Date().toISOString()}));
      ui.izlusceni=null;toast(sel.length?`V evidenco dodanih ${sel.length} sklepov.`:"Ni izbranih sklepov.");render();break}
    case "seja-shrani":{write("seje/"+ui.sejaId,strip(s));const sv=savedSeja();ui._draftU=sv&&sv._u;updateDirty();
      if(ui.prepis!==ui.prepisSaved){write("prepisi/"+ui.sejaId,{besedilo:ui.prepis||"",posodobljeno:new Date().toISOString()});ui.prepisSaved=ui.prepis;toast("Seja in prepis sta shranjena.")}else toast("Seja je shranjena.");break}
    case "seja-zavrzi":{const sv=savedSeja();if(sv){ui.draft=clone(sv);ui._draftU=sv._u;render();toast("Spremembe so zavržene.")}break}
    case "rec-start":Rec.start();break;
    case "rec-pause":Rec.pause();break;
    case "rec-resume":Rec.resume();break;
    case "rec-stop":Rec.stop();break;
    case "pos-predvajaj":{const b=await IDB.get("blobs",id);if(b){ui.audioUrl[id]=URL.createObjectURL(b);render()}break}
    case "pos-shrani":{const p=S.posnetki.find(x=>x.id===id);let b=await IDB.get("blobs",id);
      if(!b&&p&&p.onedriveId){try{toast("Prenašam posnetek iz OneDriva …",8000);b=await Sync.download(p.onedriveId)}catch(e){toast("Prenos ni uspel: "+(e.message||e.code||e));break}}
      if(b)saveFile(p?p.ime:"posnetek.m4a",b);break}
    case "pos-nalozi":uploadRec(id);break;
    case "pos-brisi-lokalno":if(arm("pl-"+id)){await IDB.del("blobs",id);Rec.local.delete(id);if(ui.audioUrl[id]){URL.revokeObjectURL(ui.audioUrl[id]);delete ui.audioUrl[id]}toast("Posnetek je odstranjen s te naprave, v OneDrivu ostane.");render()}break;
    case "pos-brisi":if(arm("pd-"+id)){await IDB.del("blobs",id).catch(()=>{});Rec.local.delete(id);write("posnetki/"+id,null);toast("Posnetek je izbrisan iz aplikacije. Kopija v OneDrivu (če obstaja) ostane v mapi Posnetki.",6000);render()}break;
    case "filter":ui.filter=id;ui.sklepEdit=null;render();break;
    case "sklep-nov":ui.sklepEdit={oznaka:"",besedilo:"",zadolzen:"",rok:"",status:"odprt",porocilo:"",sejaId:""};render();setTimeout(()=>{const e=$("#sk-oznaka");if(e)e.focus()},0);break;
    case "sklep-uredi":ui.sklepEdit=clone(S.sklepi.find(x=>x.id===id));render();window.scrollTo({top:0});break;
    case "sklep-preklici":ui.sklepEdit=null;render();break;
    case "sklep-shrani":{const e=ui.sklepEdit;if(!e.besedilo.trim()){toast("Vpišite besedilo sklepa.");break}const sid=e.id||uid();const data=strip(e);if(!data.ustvarjeno)data.ustvarjeno=new Date().toISOString();
      write("sklepi/"+sid,data);ui.sklepEdit=null;toast("Sklep je shranjen.");render();break}
    case "sklep-brisi":if(arm("sk-"+id)){write("sklepi/"+id,null);ui.sklepEdit=null;render()}break;
    case "sklepi-word":sklepiWord();break;
    case "fin-uvozi":finUvozi();break;
    case "fin-word":finWord();break;
    case "kpi-privzeti":dirSet(ui.leto,d=>{d.kazalniki=[
      {id:uid(),naziv:"Prihodki od prodaje",vir:"prihodki",utez:30},
      {id:uid(),naziv:"Poslovni izid",vir:"rezultat",utez:30},
      {id:uid(),naziv:"Realizacija sklepov nadzornega sveta",vir:"sklepi",utez:20},
      {id:uid(),naziv:"Izvedba letnih razvojnih ciljev (ocena NS)",vir:"rocno",utez:20,enota:"%",cilj:100}]});render();break;
    case "kpi-dodaj":dirSet(ui.leto,d=>{d.kazalniki.push({id:uid(),naziv:"",vir:"rocno",utez:10})});render();break;
    case "kpi-brisi":dirSet(ui.leto,d=>{d.kazalniki.splice(+id,1)});render();break;
    case "dir-porocilo":await dirPorocilo();break;
    case "dir-word":{const t=($("#dir-por")||{}).value||ui.dirPorocilo;const d=druzba();saveDocx(fname(`Porocilo_uspesnost_direktorja_${ui.leto}`)+".docx",wPara(d.naziv,{b:true})+wPara("Nadzorni svet")+wPara("")+wPara(`POROČILO O POSLOVNI USPEŠNOSTI DIREKTORJA ZA LETO ${ui.leto}`,{b:true,sz:26})+wPara("")+textToW(t)+wPara("")+
      wTable([["Kazalnik","Utež %","Cilj","Realizacija","Doseganje"],...(dirData(ui.leto).kazalniki||[]).map(k=>{const c=kpiCalc(k,ui.leto);const u=k.vir==="sklepi"?" %":(k.vir==="rocno"?(k.enota?" "+k.enota:""):" €");const f=v=>v==null?"":NUM.format(Math.round(v))+u;return [k.naziv,String(k.utez??""),f(c.cilj),f(c.real),PCT(c.dos)]}),["Skupna ocena","","","",PCT(dirScore(ui.leto))]]));break}
    case "predloga-prilepi":ui.novaPredloga=true;render();break;
    case "predloga-preklici":ui.novaPredloga=false;render();break;
    case "predloga-shrani":{const n=$("#np-naziv").value.trim()||"Zapisnik",t=$("#np-bes").value.trim();if(!t){toast("Prilepite besedilo zapisnika.");break}
      write("predloge/"+uid(),{naziv:n,besedilo:t.slice(0,MAXC),datum:new Date().toISOString()});ui.novaPredloga=false;toast("Zapisnik je dodan med predloge.");render();break}
    case "predloga-pokazi":ui.predlogaOdprta=ui.predlogaOdprta===id?null:id;render();break;
    case "predloga-brisi":if(arm("p-"+id)){write("predloge/"+id,null);render()}break;
    case "nastavitve-shrani":{const cur=druzba();const d={naziv:$("#n-naziv").value.trim()||cur.naziv,naslov:$("#n-naslov").value.trim(),direktor:$("#n-direktor").value.trim(),kraj:$("#n-kraj").value.trim(),
      clani:cur.clani.map((c,i)=>({ime:$("#n-cl-ime-"+i).value.trim(),funkcija:$("#n-cl-fun-"+i).value.trim()}))};
      write("druzbe/"+S.druzbaId,d);toast("Podatki družbe so shranjeni.");render();break}
    case "druzba-dodaj":{const n=(($("#nd-naziv")||{}).value||"").trim();if(!n){toast("Vpišite naziv družbe.");break}const nid=uid();write("druzbe/"+nid,{naziv:n,clani:[{ime:"",funkcija:"predsednica"},{ime:"",funkcija:"namestnik predsednice"},{ime:"",funkcija:"član"}]});setDruzba(nid);ui.tab="nastavitve";render();toast("Družba "+n+" je dodana. Dopolnite podatke in člane NS.");break}
    case "druzba-preklopi":setDruzba(id);break;
    case "druzba-brisi":if(arm("dr-"+id)){const now=Date.now();
      PER_DRUZBA.concat(["finance","direktor"]).forEach(c=>Object.entries(D.col[c]||{}).forEach(([k,r])=>{if(r&&!r._d&&r.druzbaId===id){D.col[c][k]={_d:1,_u:now};if(c==="seje"&&D.col.prepisi[k])D.col.prepisi[k]={_d:1,_u:now}}}));
      write("druzbe/"+id,null);LS.set("druzba",null);derive();render();toast("Družba in vsi njeni podatki so izbrisani.")}break;
    case "od-prijava":Sync.login();break;
    case "od-odjava":Sync.logout();break;
    case "od-sync":Sync.run();break;
    case "client-shrani":{LS.set("clientId",$("#n-client").value.trim());toast("Client ID je shranjen.");Sync.msal=null;await Sync.init();render();break}
    case "key-shrani":LS.set("apiKey",$("#n-key").value.trim());LS.set("model",$("#n-model").value);toast("Nastavitve za Claude so shranjene.");render();break;
    case "key-test":{ui.busy.key=true;render();try{await claude("Odgovori samo z besedo: deluje",{maxTokens:10,model:"claude-haiku-5-5"});toast("Ključ deluje.")}catch(e){toast(errMsg(e),6000)}ui.busy.key=false;render();break}
    case "sx-shrani":LS.set("sonioxKey",$("#n-sxkey").value.trim());LS.set("sonioxModel",$("#n-sxmodel").value.trim()||"stt-rt-v6");LS.set("sonioxOn",$("#n-sxon").checked);LS.set("sonioxLegacy",false);toast("Nastavitve za Soniox so shranjene.");render();break;
    case "sx-test":{ui.busy.sx=true;render();try{await Live.test();toast("Ključ Soniox deluje.")}catch(e){toast("Ključ ne deluje: "+(e.message||e),7000)}ui.busy.sx=false;render();break}
    case "izvozi":exportData();break;
    case "skrij-ios":LS.set("hideIosTip",true);render();break;
  }
}
document.addEventListener("input",ev=>{
  const el=ev.target;
  if(ui.draft&&el.dataset.f){ui.draft[el.dataset.f]=el.value;updateDirty();return}
  if(ui.draft&&el.dataset.t){ui.draft.tocke[+el.dataset.i][el.dataset.t]=el.value;updateDirty();return}
  if(el.id==="prepis"){ui.prepis=el.value;updateDirty();const b=$('[data-act="prepis-shrani"]');if(b)b.disabled=ui.prepis===ui.prepisSaved;return}
  if(ui.sklepEdit&&el.dataset.sk){ui.sklepEdit[el.dataset.sk]=el.value;return}
  if(el.id==="dir-kom"){const v=el.value;clearTimeout(ui._komT);ui._komT=setTimeout(()=>dirSet(ui.leto,d=>{d.komentar=v}),600);return}
  if(el.id==="dir-por"){ui.dirPorocilo=el.value;return}
  if(el.id==="manualRes"&&ui.manual){ui.manual.result=el.value;return}
});
document.addEventListener("change",async ev=>{
  const el=ev.target;
  if(el.id==="druzbaSel"){if(Rec.active){toast("Najprej ustavite snemanje.");paintSwitch();return}setDruzba(el.value);return}
  if(ui.draft&&el.dataset.prisoten!=null){const p=new Set(ui.draft.prisotni||[]);el.checked?p.add(el.dataset.prisoten):p.delete(el.dataset.prisoten);ui.draft.prisotni=[...p];updateDirty();return}
  if(el.dataset.predloga){const set=new Set(ui.izbranePredloge);el.checked?set.add(el.dataset.predloga):set.delete(el.dataset.predloga);ui.izbranePredloge=[...set];return}
  if(el.dataset.izl!=null){ui.izlusceni[+el.dataset.izl].sel=el.checked;return}
  if(el.dataset.statusId){const sk=S.sklepi.find(x=>x.id===el.dataset.statusId);if(sk){write("sklepi/"+sk.id,{...strip(sk),status:el.value});toast("Status sklepa je posodobljen.")}return}
  if(el.id==="leto"){ui.leto=+el.value;ui.dirPorocilo="";render();return}
  if(el.dataset.m){const v=parseNum(el.value);finSet(ui.leto,+el.dataset.m,el.dataset.k,v);el.value=fmtIn(v);return}
  if(el.dataset.ki!=null){const i=+el.dataset.ki,f=el.dataset.kf;let v=el.type==="checkbox"?el.checked:el.value;
    if(f==="utez"||f==="cilj"||f==="realizacija")v=parseNum(v);
    dirSet(ui.leto,d=>{const k=d.kazalniki[i];if(!k)return;if(f==="cilj"&&v==null)delete k.cilj;else k[f]=v; if(f==="vir"){delete k.cilj;delete k.realizacija}});
    if(f==="vir"||f==="manjse")render();return}
  if(el.id==="prepisFile"&&el.files&&el.files[0]){try{const t=await readFileText(el.files[0]);ui.prepis=t.trim();render();toast("Prepis je naložen ("+NUM.format(t.length)+" znakov). Shranite ga.")}catch(e){toast("Branje ni uspelo: "+(e.message||e))}el.value="";return}
  if(el.id==="predlogaFile"&&el.files){let n=0;for(const f of el.files){try{const t=(await readFileText(f)).trim();if(t.length>MAXC)toast(f.name+": skrajšano na prvih "+NUM.format(MAXC)+" znakov.");
      write("predloge/"+uid(),{naziv:f.name.replace(/\.[^.]+$/,""),besedilo:t.slice(0,MAXC),datum:new Date().toISOString()});n++}catch(e){toast("Branje ni uspelo: "+(e.message||e))}}
    el.value="";if(n)toast(`Dodanih ${n} zapisnikov.`);render();return}
  if(el.id==="uvozFile"&&el.files&&el.files[0]){try{const n=importData(JSON.parse(await el.files[0].text()));toast(`Uvoženih ${n} zapisov.`)}catch(e){toast("Uvoz ni uspel: "+(e.message||e),6000)}el.value="";return}
});
window.addEventListener("beforeunload",e=>{persistNow();if(Rec.active){e.preventDefault();e.returnValue=""}});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden"){persistNow();if(Rec.active&&Rec.mr)try{Rec.mr.requestData()}catch(e){}}
  else{Sync.run();if(Rec.active){Rec.lock();if(Rec.stream&&Rec.stream.getAudioTracks().some(t=>t.readyState==="ended")){toast("Snemanje se je ustavilo, ker je bila aplikacija v ozadju. Posnetek do tega trenutka je shranjen.",8000);Rec.stop()}}}
});
window.addEventListener("online",()=>Sync.run());
window.addEventListener("offline",()=>{if(Sync.account)Sync.set("offline")});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;const b=$("#installBtn");b.hidden=false;b.onclick=async()=>{b.hidden=true;installEvt.prompt();installEvt=null}});
setInterval(()=>{if(document.visibilityState==="visible")Sync.run()},5*60*1000);

/* ---------- zagon ---------- */
const h=(location.hash||"").slice(1);if(["pregled","seje","sklepi","poslovanje","direktor","predloge","nastavitve"].includes(h))ui.tab=h;
(async function init(){
  try{const saved=await IDB.get("kv","data");if(saved&&saved.col){D=saved;COLS.forEach(c=>D.col[c]=D.col[c]||{})}}catch(e){toast("Shramba na napravi ni na voljo – podatki se ne bodo ohranili.",8000)}
  migrateV1();derive();render();paintConn();
  await recoverRecording();render();
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  await Sync.init();
  if(location.hash.includes("code=")||location.hash.includes("error="))try{history.replaceState(null,"",location.pathname+"#"+ui.tab)}catch(e){}
  render();
  if("serviceWorker" in navigator&&location.protocol!=="file:"){
    navigator.serviceWorker.register("sw.js").then(reg=>{
      reg.addEventListener("updatefound",()=>{const w=reg.installing;w&&w.addEventListener("statechange",()=>{if(w.state==="installed"&&navigator.serviceWorker.controller){toast("Na voljo je nova različica – zaprite in znova odprite aplikacijo.",8000);w.postMessage("skipWaiting")}})});
    }).catch(()=>{});
  }
})();
})();
