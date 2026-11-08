import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
  auth: { persistSession: false, autoRefreshToken: false }
});
const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP".split(" "));
const TRADES = new Set(["Plumbing","HVAC","Electrical","Construction","Landscaping","Maintenance","Roofing","Roadwork","General"]);
const BLUE_COLLAR=["Plumbing","HVAC","Electrical","Construction","Landscaping","Maintenance","Roofing","Roadwork"];
const ORIGINS = new Set(["https://projectscouthq.com","https://www.projectscouthq.com","https://jaydenp1023.github.io"]);
const FIELDS = "id,title,source,source_id,source_url,state,city,zip_code,agency,due_date,posted_date,notice_type,suggested_trade,naics_code,related_notice_count";
const MS_DAY = 86400000, MAX_RESULTS = 95;
const geoCache = new Map();
const OUTSIDE_MENTIONS = ["korea","japan","germany","panama","philippines","afghanistan","iraq","italy","spain","jordan","kuwait","poland","qatar"];
const NAMED_STATES = {AL:"alabama",AK:"alaska",AZ:"arizona",AR:"arkansas",CA:"california",CO:"colorado",CT:"connecticut",DE:"delaware",FL:"florida",GA:"georgia",HI:"hawaii",ID:"idaho",IL:"illinois",IN:"indiana",IA:"iowa",KS:"kansas",KY:"kentucky",LA:"louisiana",ME:"maine",MD:"maryland",MA:"massachusetts",MI:"michigan",MN:"minnesota",MS:"mississippi",MO:"missouri",MT:"montana",NE:"nebraska",NV:"nevada",NH:"new hampshire",NJ:"new jersey",NM:"new mexico",NY:"new york",NC:"north carolina",ND:"north dakota",OH:"ohio",OK:"oklahoma",OR:"oregon",PA:"pennsylvania",RI:"rhode island",SC:"south carolina",SD:"south dakota",TN:"tennessee",TX:"texas",UT:"utah",VT:"vermont",VA:"virginia",WA:"washington state",WV:"west virginia",WI:"wisconsin",WY:"wyoming",DC:"district of columbia",PR:"puerto rico"};
function mismatchedTitleLocation(x,state){
 if(state==="ALL")return false;
 const title=String(x.title||"").toLowerCase();
 const wrapped=" "+title.replace(/[^a-z]+/g," ").replace(/\s+/g," ")+" ";
 if(OUTSIDE_MENTIONS.some(word=>wrapped.includes(" "+word+" ")))return true;
 return Object.entries(NAMED_STATES).some(([code,name])=>code!==state && wrapped.includes(" "+name+" "));
}
function duplicateKey(x){
 return [String(x.title||"").toLowerCase().replace(/[^a-z0-9]/g,""),String(x.agency||"").toLowerCase().trim(),String(x.state||""),String(x.city||"").toLowerCase().trim(),String(x.due_date||"")].join("|");
}
const ZIP_URL = "https://api.zippopotam.us/us/";

function greatCircleMiles(a,b){
 const deg=Math.PI/180;
 const lat=(b.lat-a.lat)*deg, lon=(b.lon-a.lon)*deg;
 const aa=Math.sin(lat/2)**2+Math.cos(a.lat*deg)*Math.cos(b.lat*deg)*Math.sin(lon/2)**2;
 return Math.round(3958.8*2*Math.atan2(Math.sqrt(aa),Math.sqrt(Math.max(0,1-aa))));
}
async function lookupZip(zip){
 const key="zip:"+zip;
 if(geoCache.has(key))return geoCache.get(key);
 const r=await fetch(ZIP_URL+zip,{signal:AbortSignal.timeout(3500)});
 if(r.status===404)return null;
 if(!r.ok)throw new Error("ZIP lookup is temporarily unavailable");
 const data=await r.json();
 const place=(data.places||[])[0];
 if(!place)return null;
 const ret={
  state:place["state abbreviation"],city:place["place name"],
  lat:Number(place.latitude),lon:Number(place.longitude),zip
 };
 if(!Number.isFinite(ret.lat)||!Number.isFinite(ret.lon)||!STATES.has(ret.state))return null;
 geoCache.set(key,ret);
 return ret;
}
async function lookupCity(state,city){
 if(!city||city.length>100||/nationwide|multiple locations|unspecified|various/i.test(city))return null;
 const normalized=city.trim().toLowerCase();
 const key=state+":"+normalized;
 if(geoCache.has(key))return geoCache.get(key);
 try{
  const r=await fetch(ZIP_URL+state.toLowerCase()+"/"+encodeURIComponent(normalized),{signal:AbortSignal.timeout(2000)});
  if(!r.ok){geoCache.set(key,null);return null;}
  const data=await r.json();
  const pts=(data.places||[]).slice(0,80)
   .map(v=>({lat:Number(v.latitude),lon:Number(v.longitude)}))
   .filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon));
  if(!pts.length){geoCache.set(key,null);return null;}
  const loc={
   lat:pts.reduce((s,v)=>s+v.lat,0)/pts.length,
   lon:pts.reduce((s,v)=>s+v.lon,0)/pts.length
  };
  geoCache.set(key,loc);return loc;
 }catch{return null;}
}
// Preview and paid accounts share the same server-side ranking function.
const respond=(body,status,headers)=>Response.json(body,{status,headers});

Deno.serve(async request=>{
 const origin=request.headers.get("origin")||"";
 const headers={
  "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://projectscouthq.com",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"content-type,apikey,authorization",
  "Cache-Control":"public,max-age=30",
  "Vary":"Origin"
 };
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="GET")return respond({error:"GET only"},405,headers);
 const u=new URL(request.url),q=u.searchParams;
 const p={
  state:(q.get("state")||"ALL").toUpperCase(),
  trade:q.get("trade")||"all",
  source:q.get("source")||"all",
  deadline:q.get("deadline")||"all",
  keyword:(q.get("q")||"").trim().replace(/[^A-Za-z0-9 -]/g," ").replace(/\s+/g," ").slice(0,55),
  zip:(q.get("zip")||"").trim(),
  radius:Number(q.get("radius")||50)
 };
 if((p.state!=="ALL"&&!STATES.has(p.state))||
   (p.trade!=="all"&&!TRADES.has(p.trade))||
   !["all","federal","state"].includes(p.source)||
   !["all","7","14","30"].includes(p.deadline)||
   ![25,50,100].includes(p.radius)||
   (p.zip&&!/^\d{5}$/.test(p.zip))){
   return respond({error:"Check your search filters. ZIP codes must have exactly five digits."},400,headers);
 }
 try{
  let geo=null;
  if(p.zip){
   try{geo=await lookupZip(p.zip);}catch(e){return respond({error:"ZIP lookup is unavailable right now. Try state-only search or search again later."},503,headers);}
   if(!geo)return respond({error:"We could not recognize this ZIP. Check all five digits."},400,headers);
   if(p.state!=="ALL"&&p.state!==geo.state)return respond({
     error:"ZIP "+p.zip+" is in "+geo.state+", but you selected "+p.state+". Select the matching state or clear your ZIP."
   },400,headers);
   p.state=geo.state; // ZIP never expands the selected state; it limits a nationwide search to the ZIP state.
  }
  const today=new Date().toISOString().slice(0,10);
  async function search(spec,limit=MAX_RESULTS){
   const {data,error}=await db.rpc("scout_member_ranked_search",{
     p_state:p.state,
     p_source:spec.source,
     p_trade:spec.trade,
     p_keyword:spec.keyword||"",
     p_deadline_days:Number(spec.deadline)||0,
     p_city:geo?.city||"",
     p_limit:Math.min(100,limit),p_offset:0,p_saved_only:false
   });
   if(error)throw new Error("Ranked search failed: "+error.message);
   const items=(data||[]).filter(x=>
     (!spec.blueCollarOnly||BLUE_COLLAR.includes(x.suggested_trade))&&
     (!spec.city||String(x.city||"").trim().toLowerCase()===String(spec.city).trim().toLowerCase())
   );
   return {items,count:Number(data?.[0]?.search_total||0)};
  }
  const exact=await search(p,85);
  const candidates=new Map(),titleKeys=new Set();
  function add(list,related){
   for(const item of list){
    if(candidates.size>=140)break;
    if(mismatchedTitleLocation(item,p.state))continue;
    const k=duplicateKey(item);
    if(candidates.has(item.id)||titleKeys.has(k))continue;
    titleKeys.add(k);
    candidates.set(item.id,{...item,related});
   }
  }
  if(geo){
   // Prioritize matches whose listed city agrees with the requested ZIP city.
   const local=await search({...p,city:geo.city,blueCollarOnly:p.trade==="all"},35);
   add(local.items,false);
  }
  if(p.trade==="all"){
   // Contractor-facing discovery starts with blue-collar categories, not unrelated federal research listings.
   const blue=await search({...p,blueCollarOnly:true},75);
   add(blue.items,false);
  }
  if(p.trade!=="all")add(exact.items,false);
  if(candidates.size<50 || ![...candidates.values()].some(x=>Number(x.engine_score)<=80)){
   // Broaden only INSIDE the selected state. Never suggest a different state.
   const variants=[
    {...p,deadline:"all",keyword:"",blueCollarOnly:p.trade==="all"},
    {...p,deadline:"all",keyword:"",trade:"all",blueCollarOnly:true},
    {...p,deadline:"all",keyword:"",trade:"all",source:"all",blueCollarOnly:true}
   ];
   for(const v of variants){
    if(candidates.size>=85)break;
    const r=await search(v,65);
    add(r.items,true);
   }
  }
  const items=[...candidates.values()];
  if(geo){
   // Geocoded city points are APPROXIMATE. Source city is not necessarily a worksite location.
   // Rate-limit optional city lookups and tolerate timeouts without making up distances.
   const cityKeys=[...new Set(items.filter(x=>x.city&&!x.zip_code).map(x=>String(x.city).trim()))].slice(0,22);
   const cityPoints=new Map();
   for(let at=0;at<cityKeys.length;at+=6){
    const batch=cityKeys.slice(at,at+6);
    const coords=await Promise.all(batch.map(async c=>[c,await lookupCity(p.state,c)]));
    for(const [c,point] of coords)cityPoints.set(c,point);
   }
   for(const x of items){
    x.distance_miles=null;
    x.nearby=false;
    x.location_basis="unspecified";
    let point=null;
    if(x.zip_code&&/^\d{5}$/.test(x.zip_code)){
     try{point=await lookupZip(x.zip_code);x.location_basis="listed_zip";}catch{}
    }
    if(!point&&x.city){
     if(String(x.city).trim().toLowerCase()===geo.city.toLowerCase())point=geo;
     else point=cityPoints.get(String(x.city).trim())||null;
     if(point)x.location_basis="listed_city_estimate";
    }
    if(point){
     x.distance_miles=greatCircleMiles(geo,point);
     x.nearby=x.distance_miles<=p.radius;
    }
   }
  }else for(const x of items){x.distance_miles=null;x.nearby=null;x.location_basis=x.zip_code?"listed_zip":x.city?"listed_city":"unspecified";}
  for(const x of items){
   x.match_percent=Math.max(0,Math.min(100,Math.round(Number(x.engine_score)||0)));
   x.location_verified=!!x.zip_code;
   x.related_reason=x.related?"Other work indexed under "+(p.state==="ALL"?"the United States":p.state)+(p.trade!=="all"&&x.suggested_trade!==p.trade?" · different trade":""):"";
   if(geo&&!x.nearby){
     x.related_reason+=(x.related_reason?" · ":"")+(x.distance_miles!==null?"Outside "+p.radius+"-mile city radius":"Local project location not verified");
   }
  }
  const sorter=(a,b)=>{
   // Prefer near matches for ZIP search, then exact trade/state, then score.
   if(geo){
    const nearDiff=Number(b.nearby)-Number(a.nearby);
    if(nearDiff)return nearDiff;
   }
   if(a.related!==b.related)return Number(a.related)-Number(b.related);
   return b.match_percent-a.match_percent ||
    String(a.due_date||"9999").localeCompare(String(b.due_date||"9999"));
  };
  const ranked=items.sort(sorter);
  // Free preview displays a genuine, moderate-ranked result with a score of at most 80.
  // Never change a real match score merely to entice an upgrade.
  const moderate=ranked.filter(x=>x.match_percent<=80);
  const free=(moderate.filter(x=>!x.related).length?moderate.filter(x=>!x.related):moderate).slice(0,1);
  const freeIds=new Set(free.map(x=>x.id));
  const premium=ranked.filter(x=>!freeIds.has(x.id)).slice(0,2);
  // The blue overlay intentionally conceals the exact percent and identifiable fields.
  const teasers=premium.map((x,i)=>({
   rank:i+1,
   match_percent:x.match_percent,
   engine_score:x.engine_score,
   state:x.state,suggested_trade:x.suggested_trade,nearby:x.nearby,
   related:x.related,
   location_basis:x.location_basis,
   better_than_free:!!free.length&&x.match_percent>Math.max(...free.map(f=>f.match_percent))
  }));
  const relatedShown=free.some(x=>x.related);
  const nearShown=geo?free.some(x=>x.nearby):null;
  const freeItems=free.map(x=>({
   ...x,
   location_display:x.city?x.city+", "+x.state:(x.state||"Location not supplied"),
   related_reason:x.related_reason || (geo&&!x.nearby?"Other location in "+p.state:"")
  }));
  return respond({
   opportunities:freeItems,teasers,matching_count:exact.count,
   related_shown:relatedShown,
   scope_state:p.state,
   zip_area:geo?{zip:p.zip,city:geo.city,state:geo.state,radius_miles:p.radius,nearby_shown:nearShown}:null,
   free_score_max:80,
   engine_score_max:100,
   preview_only:true,
   notice:"Scores are generated by the same 0–100 ranking engine used for paid search. Free cards show real results rated at most 80; higher-scored matches are locked. Scores are relevance estimates, not award probabilities. Listed city may be an agency office, not the actual worksite."
  },200,headers);
 }catch(e){
  console.error("Project Scout preview v4 query failed",String(e));
  return respond({error:"We could not load contracts. Please retry your search."},503,headers);
 }
});
