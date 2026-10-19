const pkgs=['@mastra/core','mastra','@mastra/client-js','@mastra/memory','@mastra/rag','@mastra/evals','@mastra/libsql','@mastra/pg','@mastra/upstash','@mastra/mcp','@mastra/ai-sdk','@mastra/nestjs','@mastra/fastify','@mastra/hono','@mastra/hono-multi','@mastra/express','@mastra/server','@mastra/playground-ui','@mastra/observability','@mastra/loggers','@mastra/cloud','@mastra/pinecone','@mastra/pgvector','@mastra/deployer','@mastra/datasets','@mastra/auth'];
(async()=>{
for(const p of pkgs){
 try{
  const r=await fetch('https://registry.npmjs.org/'+encodeURIComponent(p).replace('%40','@'));
  if(!r.ok){console.log(p,'-> HTTP',r.status);continue;}
  const j=await r.json();
  const latest=j['dist-tags']?.latest;const t=j.time||{};
  const v=j.versions?.[latest]||{};
  console.log([p,latest,t[latest]?.slice(0,10),v.license,(v.engines&&v.engines.node)||'-'].join(' | '));
 }catch(e){console.log(p,'ERR',e.message)}
}})();
