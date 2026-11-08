import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const admin=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false,autoRefreshToken:false}});
const SOURCE="ga_gpr";
const URL="https://ssl.doas.state.ga.us/gpr/eventSearch";
const PAGE=100;
const trim=(s,max=600)=>String(s??"").replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
function date(s){const m=String(s||"").match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null;}
function searchParams(start){
 return new URLSearchParams({
  draw:"1",start:String(start),length:String(PAGE),responseType:"ALL",
  eventStatus:"OPEN",eventIdTitle:"",govType:"ALL",govEntity:"",
  eventProcessType:"ALL",dateRangeType:"",rangeStartDate:"",rangeEndDate:"",
  isReset:"false",persisted:"",refreshSearchData:"false",
  "order[0][column]":"5","order[0][dir]":"asc"
 }).toString();
}
async function readPage(start){
 let last;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(URL,{method:"POST",headers:{
    "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
    "Accept":"application/json, text/javascript, */*; q=0.01",
    "X-Requested-With":"XMLHttpRequest","Referer":"https://ssl.doas.state.ga.us/gpr/",
    "Origin":"https://ssl.doas.state.ga.us",
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
   },body:searchParams(start),signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw new Error("Georgia GPR returned HTTP "+r.status);
   const json=await r.json();
   if(!Array.isArray(json.data)||!Number.isFinite(Number(json.recordsTotal)))
    throw new Error("Georgia GPR returned invalid search JSON");
   return json;
  }catch(err){last=err;await new Promise(done=>setTimeout(done,300*(attempt+1)));}
 }
 throw last;
}
function normalize(raw,checkedAt){
 const number=trim(raw.esourceNumber,180);
 const title=trim(raw.title);
 const due=date(raw.closingDate);
 if(!number||!title||!due||due<checkedAt.slice(0,10)||String(raw.status||"").toLowerCase()!=="open")return null;
 const system=trim(raw.sourceId||raw.eSourceId||"gpr20",40);
 const numberKey=trim(raw.esourceNumberKey||raw.esourceNumber,180);
 return {
  source:SOURCE,source_id:"ga:"+number,title,state:"GA",city:null,
  agency:trim(raw.agencyName,250)||null,
  description:null,trade:null,
  status:"Open",due_date:due,posted_date:date(raw.postingDate),
  notice_type:trim(raw.bidProcessType||raw.governmentType,100)||null,
  source_url:"https://ssl.doas.state.ga.us/gpr/eventDetails?eSourceNumber="+encodeURIComponent(numberKey)+"&sourceSystemType="+encodeURIComponent(system),
  last_verified_at:checkedAt,source_updated_at:checkedAt,is_placeholder:false
 };
}
Deno.serve(async req=>{
 if(req.method!=="POST")return Response.json({error:"POST only"},{status:405});
 const supplied=req.headers.get("x-scout-sync-token")||"";
 if(!supplied)return Response.json({error:"Unauthorized"},{status:401});
 const auth=await admin.rpc("scout_ga_sync_valid",{candidate_token:supplied});
 if(auth.error||auth.data!==true)return Response.json({error:"Forbidden"},{status:403});
 const now=new Date().toISOString();
 await admin.from("state_source_sync").upsert({
  source:SOURCE,state:"GA",status:"running",last_attempt_at:now,last_error:"",updated_at:now
 },{onConflict:"source"});
 try{
  const first=await readPage(0),total=Number(first.recordsFiltered??first.recordsTotal);
  if(!Number.isInteger(total)||total<1||total>10000)throw new Error("Unexpected open-event count");
  const map=new Map();
  let scanned=0;
  function collect(page){
   scanned+=page.data.length;
   for(const row of page.data){
    const item=normalize(row,now);
    if(item)map.set(item.source_id,item);
   }
  }
  collect(first);
  for(let n=PAGE;n<total;n+=PAGE)collect(await readPage(n));
  if(scanned<total-5||map.size<Math.min(20,total/3))
   throw new Error("Georgia results incomplete; import canceled");
  const items=[...map.values()];
  for(let i=0;i<items.length;i+=75){
   const {error}=await admin.from("opportunities").upsert(items.slice(i,i+75),{onConflict:"source,source_id"});
   if(error)throw error;
  }
  // Only mark previous Georgia GPR rows as closed after successfully retrieving the entire official open index.
  const {data:previous,error:prevError}=await admin.from("opportunities")
    .select("id,source_id").eq("source",SOURCE).eq("state","GA").neq("status","Closed").limit(6000);
  if(prevError)throw prevError;
  const old=(previous||[]).filter(x=>!map.has(x.source_id)).map(x=>x.id);
  for(let i=0;i<old.length;i+=100){
   const {error}=await admin.from("opportunities").update({status:"Closed",last_verified_at:now}).in("id",old.slice(i,i+100));
   if(error)throw error;
  }
  const {error:stateError}=await admin.from("state_source_sync").upsert({
   source:SOURCE,state:"GA",status:"success",reported_count:total,scanned_count:scanned,imported_count:items.length,
   last_success_at:now,last_attempt_at:now,last_error:"",updated_at:now
  },{onConflict:"source"});
  if(stateError)throw stateError;
  return Response.json({ok:true,reported:total,scanned,active:items.length,closed:old.length,at:now});
 }catch(e){
  console.error("GA GPR sync",String(e));
  await admin.from("state_source_sync").upsert({
   source:SOURCE,state:"GA",status:"error",last_attempt_at:now,last_error:String(e).slice(0,300),updated_at:new Date().toISOString()
  },{onConflict:"source"});
  return Response.json({ok:false,error:String(e).slice(0,190)},{status:503});
 }
});