import { runNvidiaText, type NvidiaPurpose, type NvidiaResult } from "../providers/nvidia";
import { providerRoutingHints, recordProviderAttempt } from "./memory";

type Env={DB:D1Database;NVIDIA_API_KEY:string};

export async function runFactoryAI(env:Env,input:{
  prompt:string;system?:string;maxTokens?:number;temperature?:number;purpose?:NvidiaPurpose;avoidModels?:string[];preferredModels?:string[];allowedModels?:string[];initialResponseTimeoutMs?:number;streamIdleTimeoutMs?:number;streamTotalTimeoutMs?:number;onHeartbeat?:()=>Promise<void>|void;
}):Promise<NvidiaResult>{
  const purpose=input.purpose??"producer";
  const hints=await providerRoutingHints(env.DB,purpose);
  const preferred=[...(input.preferredModels??[]),...hints.preferredModels].filter((x,i,a)=>a.indexOf(x)===i);
  const avoid=[...new Set([...(input.avoidModels??[]),...hints.avoidModels])];
  return runNvidiaText(env,{...input,purpose,preferredModels:preferred,avoidModels:avoid,onAttempt:(event)=>recordProviderAttempt(env.DB,event)});
}
