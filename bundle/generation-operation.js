import {parseDeck} from "./deck.js";
import {creditSummary} from "./redesign-operation.js";

export function retryOutputBudget(request,response,pages) {
  const cap=response?._meta?.maxTokens;
  if(["model","transport"].includes(cap?.limitedBy) && Number.isFinite(cap.effective) && cap.effective<=request.maxTokens)return null;
  const reasoning=Number.isFinite(response?.usage?.reasoningTokens)?Math.max(0,response.usage.reasoningTokens):0;
  const next=Math.min(16384,Math.max(request.maxTokens*2,Math.ceil(reasoning+pages*320+2048)));
  return next>request.maxTokens?next:null;
}

export async function runGenerationOperation({request,pages,complete,isCancelled=()=>false,isCurrent=()=>true,onUpdate=()=>{},operation={}}) {
  Object.assign(operation,{id:operation.id??crypto.randomUUID(),status:"requesting",attempts:[],credits:{total:"0",unknown:0}});
  const update=()=>{operation.credits=creditSummary(operation.attempts);onUpdate(operation);};
  const stopped=()=>isCancelled()?"cancelled":!isCurrent()?"expired":null;
  let current=request,response,error;
  for(let number=1;number<=2;number++) {
    const stop=stopped();if(stop){operation.status=stop;break;}
    const attempt={number,status:"requesting",requestSent:true,requestedMaxTokens:current.maxTokens,recordedAt:new Date().toISOString()};
    operation.attempts.push(attempt);update();
    try {response=await complete(current);}catch(cause){
      error=cause;attempt.status=stopped()??"failed";attempt.error=cause.message??String(cause);operation.status=stopped()??"failed";update();break;
    }
    Object.assign(attempt,{rawText:response?.content?.text,model:response?.model,usage:response?.usage,quotaConsumed:response?._meta?.quotaConsumed,
      stopReason:response?.stopReason,maxTokens:response?._meta?.maxTokens,thinking:response?._meta?.thinking});
    const stopAfter=stopped();if(stopAfter){attempt.status=stopAfter;operation.status=stopAfter;update();break;}
    if(response?.stopReason==="maxTokens") {
      attempt.status="truncated";attempt.error="stopReason=maxTokens，输出不完整";
      const next=number===1?retryOutputBudget(current,response,pages):null;
      if(next) {
        const instruction={role:"user",content:{type:"text",text:"上次输出因预算截断，请重新完整生成紧凑JSON，不延续残缺JSON；优先完成全部页数与核心事实，省略不必要的可选设计字段，不输出分析或Markdown。"}};
        current={...request,maxTokens:next,messages:[...request.messages,instruction]};
        update();continue;
      }
      operation.status="failed";operation.reason=number===1?"HARD_OUTPUT_CAP":"TRUNCATED_AFTER_RETRY";
      error=new Error("Anna 返回内容被截断，原稿未更改。");update();break;
    }
    try {
      const deck=parseDeck(response,pages);
      attempt.status="succeeded";operation.status="succeeded";update();return {deck,response,operation};
    }catch(cause){error=cause;attempt.status="failed";attempt.error=cause.message;operation.status="failed";update();break;}
  }
  if(operation.status==="requesting")operation.status=stopped()??"failed";
  update();return {response,error,operation};
}
