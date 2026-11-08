import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const admin=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false,autoRefreshToken:false}});
const URL="https://www.txsmartbuy.gov/esbd";
const SOURCE="tx_esbd", MAX_PAGES=14, RECENT_WINDOW_PAGES=60;
function clean(x,max=500){
 return String(x||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
 .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function ymd(s){
 const m=String(s||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
 return m?m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0"):null;
}
function parsed(html){
 const pg=html.match(/Page\s+\d+\s+of\s+(\d+)\s+Pages/i);
 const total=pg?Number(pg[1]):null;
 const entries=html.split('<div class="esbd-result-row">').slice(1);
 const rows=[];
 for(const entry of entries){
  const anchor=entry.match(/<div class="esbd-result-title">\s*<a href="([^"]+)">\s*([\s\S]*?)\s*<\/a>/i);
  const field=(key)=>clean(entry.match(new RegExp("<strong>"+key+":?\\s*<\\/strong>\\s*([^<]+)<\\/p>","i"))?.[1],200);
  const id=field("Solicitation ID"),title=clean(anchor?.[2]),due=ymd(field("Due Date")),posted=ymd(field("Posting Date")),status=field("Status");
  if(!id||!title||!due||!anchor?.[1])continue;
  if(!/\/esbd\/[^/?#]+/.test(anchor[1]))continue;
  rows.push({id,title,due,posted,status,agency:field("Agency/Texas SmartBuy Member Number"),url:"https://www.txsmartbuy.gov"+anchor[1]});
 }
 return {rows,total,blocks:entries.length};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const token=req.headers.get("x-scout-sync-token");
 if(!token)return Response.json({error:"Unauthorized"},{status:401});
 const valid=await admin.rpc("scout_tx_sync_valid",{candidate_token:token});
 if(valid.error||valid.data!==true)return Response.json({error:"Forbidden"},{status:403});
 const {data:cursor,error:cursorError}=await admin.from("scout_state_scan_cursors").select("*").eq("source",SOURCE).single();
 if(cursorError)return Response.json({error:"Cursor unavailable"},{status:503});
 const savedPage=Number(cursor.next_page)||1;
 const start=savedPage>RECENT_WINDOW_PAGES?1:Math.max(1,savedPage),time=new Date().toISOString();
 let attempted=0,found=0,added=0,lastPage=start,totalPages=cursor.reported_pages||null;
 try{
  const today=new Date().toISOString().slice(0,10);
  await admin.from("state_source_sync").upsert({source:SOURCE,state:"TX",status:"running",last_attempt_at:time,last_error:"",updated_at:time},{onConflict:"source"});
  for(let page=start;page<start+MAX_PAGES && page<=RECENT_WINDOW_PAGES;page++){
   const link=page===1?URL:URL+"?page="+page;
   let parsedPage=null;
   for(let retries=0;retries<4;retries++){
    try{
     const resp=await fetch(link,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36","Accept":"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(12000)});
     if(!resp.ok)throw new Error("Texas registry HTTP "+resp.status);
     parsedPage=parsed(await resp.text());
     // NetSuite intermittently returns a 200 HTML shell instead of its server-rendered rows.
     // Treat that as retryable, not a real empty page or end of results.
     if(parsedPage.blocks<1||parsedPage.rows.length<1||!parsedPage.total||parsedPage.total>12000)
       throw new Error("Texas ESBD page "+page+" returned unrendered shell or invalid data");
     break;
    }catch(e){
      if(retries===3)throw e;
      await new Promise(resolve=>setTimeout(resolve,800*(retries+1)));
    }
   }
   if(!parsedPage)throw new Error("Unable to load Texas page "+page);
   totalPages=parsedPage.total;
   attempted++;found+=parsedPage.rows.length;lastPage=page;
   const active=parsedPage.rows.filter(x=>x.due>=today && !/closed|awarded|cancelled|no award/i.test(x.status));
   const retired=parsedPage.rows.filter(x=>/closed|awarded|cancelled|no award/i.test(x.status)).map(x=>x.id);
   if(retired.length){
    const {error:closeError}=await admin.from("opportunities").update({
     status:"Closed",last_verified_at:time,source_updated_at:time
    }).eq("source",SOURCE).in("source_id",retired);
    if(closeError)throw new Error("Could not close retired Texas listings: "+closeError.message);
   }
   if(active.length){
    const items=active.map(x=>({
     source:SOURCE,source_id:x.id,state:"TX",title:x.title,city:null,agency:x.agency||null,
     source_url:x.url,status:x.status||"Posted",
     due_date:x.due,posted_date:x.posted,last_verified_at:time,source_updated_at:time,is_placeholder:false
    }));
    const {error}=await admin.from("opportunities").upsert(items,{onConflict:"source,source_id"});
    if(error)throw new Error("Saving Texas listings failed: "+error.message);
    added+=items.length;
   }
   // Persist progress after EACH page. A later page returning an unrendered shell
   // cannot cause successfully imported pages to be repeated indefinitely.
   const nextCommitted=page>=Math.min(totalPages,RECENT_WINDOW_PAGES)?1:page+1;
   const {error:checkpointError}=await admin.from("scout_state_scan_cursors").update({
    next_page:nextCommitted,reported_pages:totalPages,
    pages_scanned:Number(cursor.pages_scanned||0)+attempted,
    records_examined:Number(cursor.records_examined||0)+found,
    last_success_at:time,last_attempt_at:time,last_error:"",updated_at:time
   }).eq("source",SOURCE);
   if(checkpointError)throw new Error("Saving Texas crawler checkpoint failed: "+checkpointError.message);
   if(page>=Math.min(totalPages,RECENT_WINDOW_PAGES))break;
  }
  const next=lastPage>=Math.min(totalPages,RECENT_WINDOW_PAGES)?1:lastPage+1;
  const {error:saveError}=await admin.from("scout_state_scan_cursors").update({
   next_page:next,reported_pages:totalPages,
   pages_scanned:Number(cursor.pages_scanned||0)+attempted,
   records_examined:Number(cursor.records_examined||0)+found,
   last_success_at:time,last_attempt_at:time,last_error:"",updated_at:time
  }).eq("source",SOURCE);
  if(saveError)throw saveError;
  const {count:indexedCurrentCount,error:countError}=await admin.from("opportunities")
   .select("id",{count:"exact",head:true}).eq("source",SOURCE).eq("state","TX")
   .gte("due_date",today).neq("status","Closed");
  if(countError)throw new Error("Could not calculate indexed Texas count: "+countError.message);
  await admin.from("state_source_sync").upsert({
   source:SOURCE,state:"TX",status:"recent_window",reported_count:null,
   scanned_count:Number(cursor.records_examined||0)+found,
   imported_count:indexedCurrentCount??added,
   last_success_at:time,last_attempt_at:time,last_error:"",updated_at:time
  },{onConflict:"source"});
  return Response.json({ok:true,starting_page:start,through_page:lastPage,pages_processed:attempted,archive_pages:totalPages,
   scan_window_pages:RECENT_WINDOW_PAGES,coverage:"recent-window only; historical archive not fully scanned",
   listings_parsed:found,upserted_active:added,next_page:next,at:time});
 }catch(err){
  const detail=String(err).slice(0,320);
  await admin.from("scout_state_scan_cursors").update({last_error:detail,last_attempt_at:time,updated_at:new Date().toISOString()}).eq("source",SOURCE);
  await admin.from("state_source_sync").upsert({source:SOURCE,state:"TX",status:"error",last_attempt_at:time,last_error:detail,updated_at:new Date().toISOString()},{onConflict:"source"});
  return Response.json({ok:false,starting_page:start,last_completed_page:lastPage,error:detail},{status:503});
 }
});